-- BEGIN_DISABLE_MINIFICATION
-- (begin Somatic playroutine)

-- BEGIN_DEBUG_ONLY
local LOG_LINES = 15
local log_lines = {}
local log_serial = 0

local function log(s)
	log_serial = log_serial + 1
	local prefix = string.format("[%03d] ", log_serial)
	trace(prefix .. s)
	table.insert(log_lines, 1, prefix .. s)
	if #log_lines > LOG_LINES then
		table.remove(log_lines)
	end
end
-- END_DEBUG_ONLY
-- END_DISABLE_MINIFICATION

-- (begin somatic playroutine code)
do
	-- BEGIN_SOMATIC_MUSIC_DATA
	-- injected at build time.
	-- END_SOMATIC_MUSIC_DATA

	-- PLAYROUTINE_AUTOGEN_START
	-- injected at build time.
	-- PLAYROUTINE_AUTOGEN_END

	-- BEGIN_SOMATIC_PLAYROUTINE_SHARED
	-- injected at build time.
	-- END_SOMATIC_PLAYROUTINE_SHARED

	-- =========================
	local initialized = false
	local currentSongOrder = 0
	local playingSongOrder0b = 0
	local lastPlayingFrame = -1
	local backBufferIsA = false -- A means patterns 0,1,2,3; B = 4,5,6,7
	local stopPlayingOnNextFrame = false
	local loopSongForeverEnabled = false
	local playbackMuted = false
	local PATTERN_BUFFER_BYTES = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
	local bufferALocation = __AUTOGEN_BUF_PTR_A -- pattern 46
	local bufferBLocation = __AUTOGEN_BUF_PTR_B -- pattern 50
	local ROW_EPSILON = 0.000001

	-- Wave morphing
	local morphMap = {}
	local patternExtra = {}

	-- Base85+1 is only needed by exported carts. Decode to the canonical byte
	-- table representation and copy to TIC memory only at the final boundary.
	local function base85Plus1Decode(s, out)
		local miss = s:byte(1) - 33
		local n = ((#s - 1) // 5) * 4 - miss
		local i = 2
		for o = 0, n - 1, 4 do
			local v = 0
			for j = i, i + 4 do
				v = v * 85 + s:byte(j) - 33
			end
			i = i + 5
			for k = 3, 0, -1 do
				if o + k < n then
					out[o + k + 1] = v % 256
				end
				v = v // 256
			end
		end
		return out, n
	end

	local function b85Plus1LZDecode(s)
		local _, compressedLen = base85Plus1Decode(s, codecSrc)
		return lzDecode(codecSrc, compressedLen, codecDst)
	end

	local function b85Plus1LZDecodeToMemory(s, dst)
		local bytes, len = b85Plus1LZDecode(s)
		return tableToMemory(bytes, len, dst)
	end

	local morphIds = {}

	-- BEGIN_FEATURE_WAVEMORPH

	local function render_waveform_morph(cfg, ticksPlayed, outSamples)
		local nodes = cfg.morphGradientNodes
		local n = #nodes
		-- BEGIN_DEBUG_ONLY
		if n == 0 then
			error("waveform morph requires at least one gradient node")
		end
		-- END_DEBUG_ONLY
		if n == 1 then
			local s = nodes[1].samples
			for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
				outSamples[i] = s[i]
			end
			return true
		end

		local tRemaining = ticksPlayed
		local seg = (n - 1)
		local localT = 1.0
		for i = 1, (n - 1) do
			local dur = nodes[i].durationTicks10
			if dur > 0 then
				if tRemaining < dur then
					seg = i
					localT = tRemaining / dur
					break
				end
				tRemaining = tRemaining - dur
			end
		end

		local shapedT = apply_curveN11(localT, nodes[seg].curveS6)
		local a = nodes[seg].samples
		local b = nodes[seg + 1].samples
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			outSamples[i] = a[i] + (b[i] - a[i]) * shapedT
		end
		return true
	end
	-- END_FEATURE_WAVEMORPH

	-- BEGIN_FEATURE_PWM
	local function render_waveform_pwm(cfg, ticksPlayed, outSamples, lfoTicks)
		local cycle = cfg.lfoCycleTicks12
		local phase = 0
		if cycle > 0 then
			phase = (lfoTicks % cycle) / cycle
		end
		local tri
		if phase < 0.5 then
			tri = phase * 4 - 1
		else
			tri = 3 - phase * 4
		end
		local duty = cfg.pwmDuty5 + cfg.pwmDepth5 * tri
		-- important to avoid all-high or all-low; it produces noise on TIC-80
		duty = clamp(duty, 1, 30)
		local threshold = (duty / 31) * WAVE_SAMPLES_PER_WAVE
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			outSamples[i] = (i < threshold) and 15 or 0
		end
		return true
	end
	-- END_FEATURE_PWM

	local function render_waveform_native(cfg, outSamples)
		wave_read_samples(cfg.sourceWaveformIndex, outSamples)
		return true
	end

	local function render_waveform_samples(cfg, ticksPlayed, outSamples, lfoTicks)
		local we = cfg.waveEngineId
		-- BEGIN_FEATURE_WAVEMORPH
		if we == WAVE_ENGINE_MORPH then
			return render_waveform_morph(cfg, ticksPlayed, outSamples)
		end
		-- END_FEATURE_WAVEMORPH
		-- BEGIN_FEATURE_PWM
		if we == WAVE_ENGINE_PWM then
			return render_waveform_pwm(cfg, ticksPlayed, outSamples, lfoTicks)
		end
		-- END_FEATURE_PWM
		if we == WAVE_ENGINE_NATIVE then
			return render_waveform_native(cfg, outSamples)
		end
		return false
	end

	local function render_tick_cfg(cfg, instId, ch, ticksPlayed, lfoTicks, effectStrengthScaleU8, lowpassStrengthScaleU8)
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		if not render_waveform_samples(cfg, ticksPlayed, render_out, lfoTicks) then
			return
		end
		local scale01 = clamp01(effectStrengthScaleU8 / 255)
		local lpScale01 = clamp01(lowpassStrengthScaleU8 / 255)
		local baseLpAmount01 = clamp01(cfg.lowpassAmountU8 / 255)
		local lpAmount01 = baseLpAmount01 * lpScale01
		local effectKind = cfg.effectKind
		-- BEGIN_FEATURE_HARDSYNC
		if effectKind == EFFECT_KIND_HARDSYNC and cfg.effectAmtU8 > 0 and scale01 > 0 then
			local hsT = 0
			if cfg.effectModSource ~= MOD_SRC_NONE then
				hsT = calculate_mod_t(
					cfg.effectModSource,
					cfg.effectDurationTicks12,
					ticksPlayed,
					lfoTicks,
					cfg.lfoCycleTicks12,
					0
				)
			end
			local env = 1 - apply_curveN11(hsT, cfg.effectCurveS6)
			local multiplier = 1 + (cfg.effectAmtU8 / 255) * scale01 * 7 * env
			apply_hardsync_effect_to_samples(render_out, multiplier)
		end
		-- END_FEATURE_HARDSYNC
		-- BEGIN_FEATURE_WAVEFOLD
		local effectModSource = cfg.effectModSource
		local wavefoldHasTime = (effectModSource == MOD_SRC_NONE)
			or (effectModSource == MOD_SRC_LFO and cfg.lfoCycleTicks12 > 0)
			or (cfg.effectDurationTicks12 > 0)
		if effectKind == EFFECT_KIND_WAVEFOLD and cfg.effectAmtU8 > 0 and wavefoldHasTime and scale01 > 0 then
			local maxAmt = clamp01(cfg.effectAmtU8 / 255) * scale01
			local wfT = 0
			if effectModSource ~= MOD_SRC_NONE then
				wfT = calculate_mod_t(
					effectModSource,
					cfg.effectDurationTicks12,
					ticksPlayed,
					lfoTicks,
					cfg.lfoCycleTicks12,
					0
				)
			end
			local envShaped = 1 - apply_curveN11(wfT, cfg.effectCurveS6)
			local strength = maxAmt * envShaped
			apply_wavefold_effect_to_samples(render_out, strength)
		end
		-- END_FEATURE_WAVEFOLD
		-- BEGIN_FEATURE_LOWPASS
		if cfg.lowpassEnabled then
			local t
			if cfg.lowpassModSource == MOD_SRC_NONE then
				t = 1
			else
				t = calculate_mod_t(
					cfg.lowpassModSource,
					cfg.lowpassDurationTicks12,
					ticksPlayed,
					lfoTicks,
					cfg.lfoCycleTicks12,
					1
				)
			end
			-- Close over time: start bypassed (amount=0) and increase toward lpAmount01.
			local amountAtTime01 = lpAmount01 * clamp01(t)
			amountAtTime01 = apply_curveN11(amountAtTime01, cfg.lowpassCurveS6)
			local openness01 = 1 - amountAtTime01
			apply_lowpass_effect_to_samples(render_out, openness01)
		end
		-- END_FEATURE_LOWPASS
		write_channel_waveform(ch, render_out)
	end

	local function getColumnIndex(songPosition0b, ch)
		return SOMATIC_MUSIC_DATA.songOrder[songPosition0b * 4 + ch + 1]
	end

	local function apply_music_row_to_sfx_state(track, frame, row)
		if track == last_music_track and frame == last_music_frame and row == last_music_row then
			return
		end
		last_music_track = track
		last_music_frame = frame
		last_music_row = row

		-- Apply Somatic per-pattern extra commands.
		local playingSongOrder = playingSongOrder0b
		--local orderEntry = SOMATIC_MUSIC_DATA.songOrder[playingSongOrder + 1]

		local p0, p1, p2, p3 = decode_track_frame_patterns(track, frame)
		local patterns = { p0, p1, p2, p3 }
		for ch = 0, SFX_CHANNELS - 1 do
			--if orderEntry then
			--local columnIndex0b = orderEntry[ch + 1]
			local columnIndex0b = getColumnIndex(playingSongOrder, ch)
			local cells = patternExtra[columnIndex0b]
			local cell = cells and cells[row + 1] or nil
			-- E/F/L affect the currently playing voice. Pan and volume are applied after
			-- the note event below so same-row values control the newly triggered voice.
			if cell and cell.effectId == 1 then
				-- 'E': Set effect strength scale
				ch_effect_strength_scale_u8[ch + 1] = cell.paramU8
			elseif cell and cell.effectId == 3 then
				-- 'F': Set lowpass strength scale (00=bypass, FF=max)
				ch_lowpass_strength_scale_u8[ch + 1] = cell.paramU8
			elseif cell and cell.effectId == 2 then
				-- 'L': Set LFO phase for the instrument playing on this channel
				local instId = ch_sfx_id[ch + 1]
				if instId and instId >= 0 then
					local cfg = morphMap[instId]
					local cycle = cfg and cfg.lfoCycleTicks12 or 0
					if cycle > 0 then
						-- paramU8 0x00..0xFF maps to phase 0..cycle
						lfo_ticks_by_sfx[instId] = math.floor(cell.paramU8 / 255 * cycle)
					end
				end
				--end
			end

			local patternId1b = patterns[ch + 1]
			local noteNibble, inst = decode_pattern_row(patternId1b, row)
			if noteNibble == 0 then
			-- no event
			elseif noteNibble < 4 then
				-- note off
				ch_sfx_id[ch + 1] = -1
				ch_sfx_ticks[ch + 1] = 0
				ch_pan_override_u8[ch + 1] = nil
				ch_volume_scale_u8[ch + 1] = nil
			else
				-- note on
				ch_sfx_id[ch + 1] = inst
				ch_sfx_ticks[ch + 1] = 0
				ch_pan_override_u8[ch + 1] = nil
				ch_volume_scale_u8[ch + 1] = nil
			end

			if cell and cell.effectId == 5 then
				-- 'P': Per-channel pan override (00=left, 80=center, FF=right)
				ch_pan_override_u8[ch + 1] = cell.paramU8
			end
			if cell and cell.panU8 ~= nil then
				-- Dedicated pan column takes precedence over a same-row legacy Pxx command.
				ch_pan_override_u8[ch + 1] = cell.panU8
			end
			if cell and cell.volumeU8 ~= nil then
				ch_volume_scale_u8[ch + 1] = cell.volumeU8
			end
		end
	end

	local function sfx_tick_channel(ch)
		local instId = ch_sfx_id[ch + 1]
		if instId == -1 then
			return
		end
		local ticksPlayed = ch_sfx_ticks[ch + 1]
		local cfg = morphMap[instId]
		local lt = lfo_ticks_by_sfx[instId] or 0
		if cfg_is_k_rate_processing(cfg) then
			local scaleU8 = ch_effect_strength_scale_u8[ch + 1] or 255
			local lpScaleU8 = ch_lowpass_strength_scale_u8[ch + 1] or 255
			render_tick_cfg(cfg, instId, ch, ticksPlayed, lt, scaleU8, lpScaleU8)
		end
		write_channel_mix(
			ch,
			cfg and cfg.volumeU8 or 255,
			cfg and cfg.panU8 or 128,
			cfg and cfg.panLfoDepthU8 or 0,
			lt,
			cfg and cfg.lfoCycleTicks12 or 0
		)
		ch_sfx_ticks[ch + 1] = ticksPlayed + 1
	end

	local function somatic_sfx_tick(track, frame, row)
		apply_music_row_to_sfx_state(track, frame, row)
		-- BEGIN_FEATURE_LFO
		for i = 1, #morphIds do
			local id = morphIds[i]
			lfo_ticks_by_sfx[id] = (lfo_ticks_by_sfx[id] or 0) + 1
		end
		-- END_FEATURE_LFO
		for ch = 0, SFX_CHANNELS - 1 do
			sfx_tick_channel(ch)
		end
	end

	local function decode_extra_song_data()
		local m = SOMATIC_MUSIC_DATA.extraSongData
		morphMap = {}
		patternExtra = {}
		morphIds = {}

		local bytes = b85Plus1LZDecode(m)
		morphMap, patternExtra, morphIds = decodeSomaticExtraSongBytes(bytes)
	end

	decode_extra_song_data()

	-- BEGIN_DEBUG_ONLY
	-- Computes a simple checksum and first-bytes hex preview for a memory region.
	-- addr:      start address in memory
	-- total_len: number of bytes to include in the checksum
	-- preview_len: how many bytes to show in the "firstBytes" preview (default 16)
	local function print_buffer_fingerprint(addr, total_len, preview_len)
		preview_len = preview_len or 16

		-- checksum over the whole buffer (like the TS version)
		local checksum = 0
		for i = 0, total_len - 1 do
			checksum = checksum + peek(addr + i)
		end

		-- hex representation of the first N bytes
		local hex = {}
		local count = math.min(preview_len, total_len)
		for i = 0, count - 1 do
			local b = peek(addr + i)
			hex[#hex + 1] = string.format("%02x", b)
		end

		local firstBytes = table.concat(hex, " ")
		if total_len > preview_len then
			firstBytes = firstBytes .. " ..."
		end

		log(" checksum: " .. checksum)
		log(" firstBytes: [" .. firstBytes .. "]")
	end
	-- END_DEBUG_ONLY
	local function song_order_count()
		return #SOMATIC_MUSIC_DATA.songOrder / 4
	end

	local function song_order_row_count(songPosition0b)
		return SOMATIC_MUSIC_DATA.orderRows[songPosition0b + 1]
	end

	local function song_row_count()
		local total = 0
		for i = 0, song_order_count() - 1 do
			total = total + song_order_row_count(i)
		end
		return total
	end

	local function song_position_to_abs_row(songPosition, row)
		local safeSongPosition = clamp(songPosition or 0, 0, math.max(0, song_order_count() - 1))
		local absRow = 0
		for i = 0, safeSongPosition - 1 do
			absRow = absRow + song_order_row_count(i)
		end
		return absRow + clamp(row or 0, 0, math.max(0, song_order_row_count(safeSongPosition) - 1))
	end

	-- decode b85+1 LZ-compressed data into a table of integers with 'bits' bits each.
	local function decodeBits(blob, bits)
		local bytes, n = b85Plus1LZDecode(blob)
		local r = _bp_make_reader(bytes)
		local out = {}
		local count = (n * 8) // bits
		for i = 1, count do
			out[i] = r.u(bits)
		end
		return out
	end

	-- on boot, decode
	SOMATIC_MUSIC_DATA.rpd = decodeBits(SOMATIC_MUSIC_DATA.rp, 16)
	SOMATIC_MUSIC_DATA.songOrder = decodeBits(SOMATIC_MUSIC_DATA.so, 8)
	SOMATIC_MUSIC_DATA.orderRows = decodeBits(SOMATIC_MUSIC_DATA.orows, 8)

	local function blit_pattern_column(columnIndex0b, destPointer)
		local rp = SOMATIC_MUSIC_DATA.rpd
		local ramPatternCount = #rp / 2 -- each pattern uses 2 entries (ptroffset + length)
		if columnIndex0b < ramPatternCount then
			-- pattern in RAM.
			-- ram pat:#0 src= dst=
			-- local src = PATTERNS_BASE + rp[columnIndex0b * 2 + 1] -- DEBUG_ONLY
			-- log( -- DEBUG_ONLY
			-- 	string.format( -- DEBUG_ONLY
			-- 		"ram pat:%d src=0x%04X len=%d dst=0x%04X", -- DEBUG_ONLY
			-- 		columnIndex0b, -- DEBUG_ONLY
			-- 		src, -- DEBUG_ONLY
			-- 		rp[columnIndex0b * 2 + 2], -- DEBUG_ONLY
			-- 		destPointer -- DEBUG_ONLY
			-- 	) -- DEBUG_ONLY
			-- ) -- DEBUG_ONLY
			lzMemoryToMemory(
				PATTERNS_BASE + rp[columnIndex0b * 2 + 1], -- src ptr
				rp[columnIndex0b * 2 + 2], -- src len
				destPointer
			)
			-- report the resulting pattern for debugging
			-- local b0, b1, b2, b3 =
			-- 	peek(destPointer), peek(destPointer + 1), peek(destPointer + 2), peek(destPointer + 3)
			-- log( -- DEBUG_ONLY
			-- 	string.format( -- DEBUG_ONLY
			-- 		"  -> first row: %02X %02X %02X %02X", -- DEBUG_ONLY
			-- 		b0, -- DEBUG_ONLY
			-- 		b1, -- DEBUG_ONLY
			-- 		b2, -- DEBUG_ONLY
			-- 		b3 -- DEBUG_ONLY
			-- 	) -- DEBUG_ONLY
			-- ) -- DEBUG_ONLY
			return
		end
		-- pattern in string literal
		local entry = SOMATIC_MUSIC_DATA.cp[columnIndex0b + 1 - ramPatternCount]
		b85Plus1LZDecodeToMemory(entry, destPointer)
	end

	local function swapInPlayorder(songPosition0b, destPointer)
		for ch = 0, 3 do
			local columnIndex0b = getColumnIndex(songPosition0b, ch)
			--local columnIndex0b = entry[ch + 1]
			local dst = destPointer + ch * PATTERN_BYTES_PER_PATTERN
			blit_pattern_column(columnIndex0b, dst)
		end
	end

	local function patch_pattern_end_jump(songPosition0b, destPointer, playingFrame)
		local rowCount = song_order_row_count(songPosition0b)
		if rowCount >= SOMATIC_MUSIC_DATA.rowsPerPattern then
			return
		end
		local row = rowCount - 1
		local chosenCh = 0
		for ch = 0, 3 do
			local addr = destPointer + ch * PATTERN_BYTES_PER_PATTERN + row * ROW_BYTES
			local command = (peek(addr + 1) >> 4) & 0x07
			if command == 0 then
				chosenCh = ch
				break
			end
		end
		local targetFrame = (playingFrame + 1) % 16
		local addr = destPointer + chosenCh * PATTERN_BYTES_PER_PATTERN + row * ROW_BYTES
		poke(addr, ((targetFrame & 0x0f) << 4) | (peek(addr) & 0x0f))
		poke(addr + 1, (peek(addr + 1) & 0x80) | (3 << 4))
	end

	local function clearPatternBuffer(destPointer)
		for i = 0, PATTERN_BUFFER_BYTES - 1 do
			poke(destPointer + i, 0)
		end
	end

	local function writeMutedPatternBuffer(destPointer)
		for i = 0, PATTERN_BUFFER_BYTES - 1, 3 do
			poke(destPointer + i, 1) -- note cut
			poke(destPointer + i + 1, 0)
			poke(destPointer + i + 2, 0)
		end
	end

	local function clearAllPlaybackBuffers()
		writeMutedPatternBuffer(bufferALocation)
		writeMutedPatternBuffer(bufferBLocation)
	end

	local function stopAllVoices()
		for ch = 0, SFX_CHANNELS - 1 do
			sfx(-1, 0, 0, ch)
			ch_sfx_id[ch + 1] = -1
			ch_sfx_ticks[ch + 1] = 0
			ch_pan_override_u8[ch + 1] = nil
			ch_volume_scale_u8[ch + 1] = nil
		end
	end

	local function queuePlaybackBuffer(songPosition0b, destPointer, playingFrame)
		if playbackMuted then
			writeMutedPatternBuffer(destPointer)
		else
			swapInPlayorder(songPosition0b, destPointer)
			patch_pattern_end_jump(songPosition0b, destPointer, playingFrame)
		end
	end

	-- =========================
	-- general playroutine support

	-- Mute is implemented as zeroing out patterns. When unmuting, we need to re-queue them.
	-- todo: unify a bit with tick logic because it's similar buffer mgmt
	local function rebuildPlaybackBuffers()
		local orderCount = song_order_count()
		local frontPointer = backBufferIsA and bufferBLocation or bufferALocation
		local backPointer = backBufferIsA and bufferALocation or bufferBLocation

		if orderCount == 0 then
			clearAllPlaybackBuffers()
			return
		end

		if playingSongOrder0b >= 0 and playingSongOrder0b < orderCount then
			queuePlaybackBuffer(playingSongOrder0b, frontPointer, math.max(0, lastPlayingFrame))
		else
			clearPatternBuffer(frontPointer)
		end

		local nextSongOrder = currentSongOrder
		if nextSongOrder >= orderCount then
			if loopSongForeverEnabled then
				nextSongOrder = 0
			else
				nextSongOrder = nil
			end
		end

		if nextSongOrder == nil then
			clearPatternBuffer(backPointer)
		else
			queuePlaybackBuffer(nextSongOrder, backPointer, (math.max(0, lastPlayingFrame) + 1) % 16)
		end
	end

	local function set_muted(muted)
		local newMuted = (muted == true)
		if playbackMuted == newMuted then
			return
		end

		playbackMuted = newMuted
		last_music_track = -2
		last_music_frame = -1
		last_music_row = -1

		if playbackMuted then
			clearAllPlaybackBuffers()
			stopAllVoices()
		else
			rebuildPlaybackBuffers()
		end
	end

	-- TIC-80 tempo/speed pair expressed as BPM-ish beats.
	local function somatic_get_bpm(tempo, speed)
		return tempo * 6 / speed
	end

	-- Shared state for music playback and demo timing.
	local baseTempo = SOMATIC_MUSIC_DATA.tempo
	local baseSpeed = SOMATIC_MUSIC_DATA.speed
	local baseRowsPerBeat = SOMATIC_MUSIC_DATA.rowsPerBeat
	local baseRowsPerPattern = SOMATIC_MUSIC_DATA.rowsPerPattern
	local baseSongPatternCount = song_order_count()
	local baseSongRowCount = song_row_count()
	local baseSongBeatCount = baseSongRowCount / baseRowsPerBeat
	local baseSongMillis = baseSongBeatCount * 60000 / somatic_get_bpm(baseTempo, baseSpeed)
	local somatic_transport = {
		-- Base timing stays fixed; overrides derive playbackRate.
		baseTempo = baseTempo,
		baseSpeed = baseSpeed,
		tempo = baseTempo,
		speed = baseSpeed,
		rowsPerBeat = baseRowsPerBeat,
		rowsPerPattern = baseRowsPerPattern,
		songPatternCount = baseSongPatternCount,
		songRowCount = baseSongRowCount,
		songBeatCount = baseSongBeatCount,
		songMillis = baseSongMillis,
		isPlaying = true,
		playbackRate = 1,
		syncOffsetMS = 0,
		-- Internal only: public transport time can be fractional, but TIC-80 music starts on rows.
		pendingAudioAbsRow = nil,
		prevWallMillis = time(),
		projectedTime = {},
		-- Public mutable snapshot returned by somatic_get_time().
		time = {
			tempo = baseTempo,
			speed = baseSpeed,
			rowsPerBeat = baseRowsPerBeat,
			rowsPerPattern = baseRowsPerPattern,
			songPatternCount = baseSongPatternCount,
			songRowCount = baseSongRowCount,
			songBeatCount = baseSongBeatCount,
			songMillis = baseSongMillis,
			-- isPlaying means the public/demo transport is running. After a fractional seek,
			-- TIC-80 audio may be briefly silent until the next integer row boundary.
			isPlaying = true,
			isMuted = false,
			loopSongForever = false,
			didSeek = false,
			playbackRate = 1,
			syncOffsetMS = 0,
			wallFrame = 0,
			wallDeltaMillis = 0,
			wallMillis = 0,
			demoMillis = 0,
			demoDeltaMillis = 0,
			demoBeats = 0,
			demoDeltaBeats = 0,
			demoPatternIndex = 0,
			demoPatternRow = 0,
		},
	}

	-- Convert canonical demo beats to base-song milliseconds.
	local function somatic_get_millis_at_beat(beat)
		local bpm = somatic_get_bpm(somatic_transport.baseTempo, somatic_transport.baseSpeed)
		return beat * 60000 / bpm
	end

	local somatic_abs_row_to_position

	-- Override timing as a ratio against the exported song.
	local function somatic_derive_playback_rate()
		local baseBpm = somatic_get_bpm(somatic_transport.baseTempo, somatic_transport.baseSpeed)
		return somatic_get_bpm(somatic_transport.tempo, somatic_transport.speed) / baseBpm
	end

	-- Refresh row/pattern fields from demoBeats.
	local function somatic_write_position_fields(state)
		state = state or somatic_transport.time
		local row = state.demoBeats * somatic_transport.rowsPerBeat
		if row < 0 then
			row = 0
		end
		local songPosition, patternRow = somatic_abs_row_to_position(row // 1)
		state.demoPatternIndex = songPosition
		state.demoPatternRow = patternRow
	end

	-- Mirror current settings into the public time table.
	local function somatic_write_settings_fields()
		local state = somatic_transport.time
		state.tempo = somatic_transport.tempo
		state.speed = somatic_transport.speed
		state.rowsPerBeat = somatic_transport.rowsPerBeat
		state.rowsPerPattern = somatic_transport.rowsPerPattern
		state.songPatternCount = somatic_transport.songPatternCount
		state.songRowCount = somatic_transport.songRowCount
		state.songBeatCount = somatic_transport.songBeatCount
		state.songMillis = somatic_transport.songMillis
		state.isPlaying = somatic_transport.isPlaying
		state.isMuted = playbackMuted
		state.loopSongForever = loopSongForeverEnabled
		state.playbackRate = somatic_transport.playbackRate
		state.syncOffsetMS = 0
	end

	local function somatic_sync_offset_ms(syncOffsetMS)
		if syncOffsetMS ~= nil then
			somatic_transport.syncOffsetMS = tonumber(syncOffsetMS) or 0
		end
		return somatic_transport.syncOffsetMS or 0
	end

	local function somatic_get_sync_offset_beats(syncOffsetMS)
		local offsetMS = somatic_sync_offset_ms(syncOffsetMS)
		if offsetMS == 0 then
			return 0
		end
		local bpm = somatic_get_bpm(somatic_transport.baseTempo, somatic_transport.baseSpeed)
		return offsetMS * somatic_transport.playbackRate * bpm / 60000
	end

	function somatic_project_time(state, syncOffsetMS)
		local offsetMS = somatic_sync_offset_ms(syncOffsetMS)
		if offsetMS == 0 then
			state.syncOffsetMS = 0
			return state
		end

		local projected = somatic_transport.projectedTime
		for k in pairs(projected) do
			projected[k] = nil
		end
		for k, v in pairs(state) do
			projected[k] = v
		end

		local offsetDemoMillis = offsetMS * somatic_transport.playbackRate
		projected.rawDemoMillis = state.demoMillis
		projected.rawDemoBeats = state.demoBeats
		projected.syncOffsetMS = offsetMS
		projected.demoMillis = math.max(0, state.demoMillis + offsetDemoMillis)
		projected.demoBeats = math.max(0, state.demoBeats + somatic_get_sync_offset_beats())
		somatic_write_position_fields(projected)
		return projected
	end

	-- Apply runtime tempo/speed/isPlaying overrides.
	local function somatic_apply_options(options)
		options = options or {}
		if options.tempo ~= nil then
			if options.tempo <= 0 then
				error("somatic_set_options: tempo must be > 0")
			end
			somatic_transport.tempo = options.tempo
		end
		if options.speed ~= nil then
			if options.speed <= 0 then
				error("somatic_set_options: speed must be > 0")
			end
			somatic_transport.speed = options.speed
		end
		if options.rowsPerBeat ~= nil then
			error("somatic_set_options: rowsPerBeat is song metadata")
		end
		if options.isPlaying ~= nil then
			somatic_transport.isPlaying = options.isPlaying == true
		end
		if options.isMuted ~= nil then
			set_muted(options.isMuted == true)
		end
		if options.loopSongForever ~= nil then
			loopSongForeverEnabled = options.loopSongForever == true
		end
		somatic_transport.playbackRate = somatic_derive_playback_rate()
		somatic_transport.time.demoMillis = somatic_get_millis_at_beat(somatic_transport.time.demoBeats)
		somatic_write_settings_fields()
		somatic_write_position_fields()
	end

	-- sync transport from a somatic position.
	local function somatic_set_time_from_position(songPosition, row)
		local absRow = song_position_to_abs_row(songPosition, row)
		local beat = absRow / somatic_transport.rowsPerBeat
		local state = somatic_transport.time
		state.demoBeats = beat
		state.demoMillis = somatic_get_millis_at_beat(beat)
		state.demoDeltaMillis = 0
		state.demoDeltaBeats = 0
		somatic_write_position_fields()
	end

	local function somatic_clamp_abs_row(absRow)
		local orderCount = song_order_count()
		if orderCount <= 0 then
			return 0, 0
		end
		local maxRow = song_row_count() - 1
		if absRow < 0 then
			absRow = 0
		end
		if absRow > maxRow then
			absRow = maxRow
		end
		return absRow, maxRow
	end

	function somatic_abs_row_to_position(absRow)
		local remaining = absRow // 1
		local orderCount = song_order_count()
		for songPosition = 0, orderCount - 1 do
			local rows = song_order_row_count(songPosition)
			if remaining < rows then
				return songPosition, remaining
			end
			remaining = remaining - rows
		end
		local lastPosition = math.max(0, orderCount - 1)
		return lastPosition, math.max(0, song_order_row_count(lastPosition) - 1)
	end

	local function somatic_normalize_beat(beat)
		local absRow = (beat or 0) * somatic_transport.rowsPerBeat
		absRow = somatic_clamp_abs_row(absRow)
		return absRow / somatic_transport.rowsPerBeat, absRow
	end

	local function somatic_is_integral_row(absRow)
		local floorRow = absRow // 1
		if absRow - floorRow <= ROW_EPSILON then
			return true, floorRow
		end
		if (floorRow + 1) - absRow <= ROW_EPSILON then
			return true, floorRow + 1
		end
		return false, floorRow
	end

	local function somatic_beat_to_audio_position(beat)
		local normalizedBeat, absRow = somatic_normalize_beat(beat)
		local isIntegral, floorRow = somatic_is_integral_row(absRow)
		local audioAbsRow = floorRow
		local pendingAbsRow = nil
		if not isIntegral then
			audioAbsRow = floorRow + 1
			audioAbsRow = somatic_clamp_abs_row(audioAbsRow)
			pendingAbsRow = audioAbsRow
		end
		local songPosition, row = somatic_abs_row_to_position(audioAbsRow)
		return songPosition, row, normalizedBeat, absRow, pendingAbsRow
	end

	-- Advance wall clock time; transport time advances only when playing or stepping.
	local function somatic_update_time(wallDeltaMillisOverride, forceDemoAdvance)
		local state = somatic_transport.time
		local wallDeltaMillis = wallDeltaMillisOverride
		if wallDeltaMillis == nil then
			local now = time()
			wallDeltaMillis = now - somatic_transport.prevWallMillis
			somatic_transport.prevWallMillis = now
		end
		if wallDeltaMillis < 0 then
			wallDeltaMillis = 0
		end

		state.wallFrame = state.wallFrame + 1
		state.wallDeltaMillis = wallDeltaMillis
		state.wallMillis = state.wallMillis + wallDeltaMillis
		state.didSeek = state.didSeek == true

		if somatic_transport.isPlaying or forceDemoAdvance == true then
			local demoDeltaMillis = wallDeltaMillis * somatic_transport.playbackRate
			local bpm = somatic_get_bpm(somatic_transport.baseTempo, somatic_transport.baseSpeed)
			local demoDeltaBeats = demoDeltaMillis * bpm / 60000
			state.demoDeltaMillis = demoDeltaMillis
			state.demoMillis = state.demoMillis + demoDeltaMillis
			state.demoDeltaBeats = demoDeltaBeats
			state.demoBeats = state.demoBeats + demoDeltaBeats
		else
			state.demoDeltaMillis = 0
			state.demoDeltaBeats = 0
		end

		somatic_write_settings_fields()
		somatic_write_position_fields()
		return state
	end

	-- Read current transport state without ticking.
	function somatic_get_raw_time()
		return somatic_transport.time
	end

	function somatic_get_time(syncOffsetMS)
		return somatic_project_time(somatic_transport.time, syncOffsetMS)
	end

	-- Clear one-frame flags after demo code consumes them.
	function somatic_end_frame()
		somatic_transport.time.didSeek = false
	end

	local function reset_music_state()
		currentSongOrder = 0
		playingSongOrder0b = 0
		lastPlayingFrame = -1
		backBufferIsA = false
		stopPlayingOnNextFrame = false
		ch_effect_strength_scale_u8 = { 255, 255, 255, 255 }
		ch_lowpass_strength_scale_u8 = { 255, 255, 255, 255 }
		ch_pan_override_u8 = { nil, nil, nil, nil }
		ch_volume_scale_u8 = { nil, nil, nil, nil }
		lfo_ticks_by_sfx = {}
		if playbackMuted then
			clearAllPlaybackBuffers()
		end
		log("reset_music_state") -- DEBUG_ONLY
		--ch_set_playroutine_regs(0xFF)
	end

	reset_music_state()

	-- Start/restart TIC music at a tracker position.
	local function start_music_at_position(songPosition, startRow, preserveTime)
		somatic_transport.isPlaying = true
		somatic_transport.pendingAudioAbsRow = nil
		somatic_write_settings_fields()

		log(string.format("start_music: pos=%d row=%d", songPosition, startRow)) -- DEBUG_ONLY

		-- seed state
		currentSongOrder = songPosition + 1
		playingSongOrder0b = songPosition
		backBufferIsA = false -- frame 0 plays buffer A; buffer B is preloaded for frame 1.
		lastPlayingFrame = 0
		stopPlayingOnNextFrame = false
		if playbackMuted then
			clearAllPlaybackBuffers()
		else
			queuePlaybackBuffer(songPosition, bufferALocation, 0)
		end

		local orderCount = song_order_count()
		local nextSongOrder = currentSongOrder
		if orderCount == 0 then
			clearPatternBuffer(bufferBLocation)
			stopPlayingOnNextFrame = true
		elseif nextSongOrder >= orderCount then
			if loopSongForeverEnabled then
				nextSongOrder = 0
				currentSongOrder = 0
				queuePlaybackBuffer(nextSongOrder, bufferBLocation, 1)
			else
				clearPatternBuffer(bufferBLocation)
				stopPlayingOnNextFrame = true
			end
		else
			queuePlaybackBuffer(nextSongOrder, bufferBLocation, 1)
		end

		stopAllVoices()

		-- Seed LFO tick counters so per-tick advancement can be branch-free.
		for i = 1, #morphIds do
			lfo_ticks_by_sfx[morphIds[i]] = 0
		end

		initialized = true
		if preserveTime ~= true then
			somatic_set_time_from_position(songPosition, startRow)
		end
		somatic_transport.prevWallMillis = time()

		if somatic_transport.isPlaying then
			music(
				0, -- track
				0, -- frame
				startRow, -- row
				true, -- loop
				true, -- sustain
				somatic_transport.tempo,
				somatic_transport.speed
			)
		end
	end

	-- Stop TIC music and optionally mark transport paused.
	local function stop_music(markPaused, preservePending)
		music()
		if markPaused ~= false then
			somatic_transport.isPlaying = false
		end
		if preservePending ~= true then
			somatic_transport.pendingAudioAbsRow = nil
		end
		somatic_write_settings_fields()
		reset_music_state()
	end

	local function pause_music_until_row(absRow)
		stop_music(false, true)
		stopAllVoices()
		somatic_transport.pendingAudioAbsRow = absRow
		initialized = true
		somatic_transport.prevWallMillis = time()
	end

	local function start_or_schedule_music_at_current_time()
		local songPosition, row, _, _, pendingAbsRow = somatic_beat_to_audio_position(somatic_transport.time.demoBeats)
		if pendingAbsRow == nil then
			start_music_at_position(songPosition, row, true)
		else
			pause_music_until_row(pendingAbsRow)
		end
	end

	local function maybe_start_pending_audio(state)
		local pendingAbsRow = somatic_transport.pendingAudioAbsRow
		if pendingAbsRow == nil then
			return false
		end
		local currentAbsRow = state.demoBeats * somatic_transport.rowsPerBeat
		if currentAbsRow + ROW_EPSILON < pendingAbsRow then
			return true
		end
		local songPosition, row = somatic_abs_row_to_position(pendingAbsRow)
		start_music_at_position(songPosition, row, true)
		return false
	end

	-- seek by beat; fractional seeks keep public time exact and delay TIC audio to the next row.
	function somatic_seek(beat, syncOffsetMS)
		local _, _, normalizedBeat = somatic_beat_to_audio_position((beat or 0) - somatic_get_sync_offset_beats(syncOffsetMS))
		local state = somatic_transport.time
		state.demoBeats = normalizedBeat
		state.demoMillis = somatic_get_millis_at_beat(normalizedBeat)
		state.demoDeltaMillis = 0
		state.demoDeltaBeats = 0
		state.didSeek = true
		somatic_write_position_fields()

		if somatic_transport.isPlaying then
			start_or_schedule_music_at_current_time()
		else
			stop_music(false)
		end
		return somatic_project_time(state)
	end

	-- apply timing/play state; restarts music when needed.
	function somatic_set_options(options)
		options = options or {}
		somatic_sync_offset_ms(options.syncOffsetMS)
		local wasPlaying = somatic_transport.isPlaying
		local restartsMusic = wasPlaying
			and (options.tempo ~= nil or options.speed ~= nil)
		somatic_apply_options(options)

		if wasPlaying and not somatic_transport.isPlaying then
			stop_music(false)
		elseif (not wasPlaying and somatic_transport.isPlaying) or restartsMusic then
			start_or_schedule_music_at_current_time()
		end

		return somatic_project_time(somatic_transport.time)
	end

	-- step demo time 1 frame.
	function somatic_advance_frame()
		-- somatic cannot do a frame advance while playing.
		if somatic_transport.isPlaying then
			return somatic_project_time(somatic_transport.time)
		end
		return somatic_project_time(somatic_update_time(1000 / 60, true))
	end

	-- Internal TIC-80 music cursor; not part of public timing API.
	local function read_tic_music_state()
		local track = peek(0x13FFC)
		local frame = peek(0x13FFD)
		local row = peek(0x13FFE)
		if track == 255 then
			track = -1
		end -- stopped / none
		return track, playingSongOrder0b, frame, row
	end

	-- Main per-frame API: updates time, then music buffers/SFX.
	function somatic_tick(wallDeltaMillisOverride, syncOffsetMS)
		somatic_sync_offset_ms(syncOffsetMS)
		if not initialized and somatic_transport.isPlaying then
			start_or_schedule_music_at_current_time()
		end

		local state = somatic_update_time(wallDeltaMillisOverride, false)
		if not somatic_transport.isPlaying then
			return somatic_project_time(state)
		end
		if maybe_start_pending_audio(state) then
			return somatic_project_time(state)
		end

		local track, _, currentFrame, row = read_tic_music_state()
		if track == -1 then
			return somatic_project_time(state)
		end

		-- If we've advanced to a new music frame, update our order bookkeeping *first*
		-- so per-row E/L commands are applied to the correct playing order.
		if currentFrame ~= lastPlayingFrame then
			if stopPlayingOnNextFrame then
				-- We already cleared the upcoming buffer when we hit end-of-song;
				-- once the music engine advances again, stop cleanly.
				stop_music(true)
				return somatic_project_time(state)
			end

			backBufferIsA = not backBufferIsA
			lastPlayingFrame = currentFrame
			playingSongOrder0b = currentSongOrder
			--ch_set_playroutine_regs(currentSongOrder) -- the queued pattern is now playing; inform host.
			currentSongOrder = currentSongOrder + 1

			local destPointer = backBufferIsA and bufferALocation or bufferBLocation
			local orderCount = song_order_count()

			log(string.format("tick: advance to=%d count=%d", currentSongOrder, orderCount)) -- DEBUG_ONLY

			local function clearNextBufferAndStop()
				-- No next entry to queue. Don't stop *immediately* (that would kill playback
				-- when starting on the last order / length==1). Instead, clear the next buffer
				-- so the next advance is silent, and stop on the following tick.
				clearPatternBuffer(destPointer)
				stopPlayingOnNextFrame = true
			end

			if orderCount == 0 then
				clearNextBufferAndStop()
			elseif currentSongOrder >= orderCount then
				if loopSongForeverEnabled then
					currentSongOrder = 0
					queuePlaybackBuffer(currentSongOrder, destPointer, (currentFrame + 1) % 16)
				else
					clearNextBufferAndStop()
				end
			else
				queuePlaybackBuffer(currentSongOrder, destPointer, (currentFrame + 1) % 16)
			end
		end

		somatic_sfx_tick(track, currentFrame, row)
		return somatic_project_time(state)
	end
end -- do
-- BEGIN_DISABLE_MINIFICATION
-- (end Somatic playroutine)

--#if false -- when importing into ticbuild, exclude the example entrypoint

-- BEGIN_CUSTOM_ENTRYPOINT
-- example main loop...
function TIC()
	local state = somatic_tick()

	if btnp(2) then -- left
		state = somatic_seek(math.max(0, state.demoBeats - 1))
	end
	if btnp(3) then -- right
		state = somatic_seek(state.demoBeats + 1)
	end
	if btnp(1) then -- down
		state = somatic_set_options({ isPlaying = not state.isPlaying })
	end
	if keyp(13) then -- M
		state = somatic_set_options({ isMuted = not state.isMuted })
	end
	if btnp(0) then -- up
		state = somatic_advance_frame()
	end

	cls(0)
	local y = 2
	print("Somatic playroutine", 0, y, 12)
	y = y + 8
	print("Left/Right = prev/next beat", 0, y, 15)
	y = y + 8
	print("Down = pause/resume", 0, y, 15)
	y = y + 8
	print("Up = step paused transport", 0, y, 15)
	y = y + 8
	print("M = mute toggle", 0, y, 15)
	y = y + 8
	print(
		string.format(
			"play:%s mute:%s beat:%.2f pat:%d row:%d",
			state.isPlaying and "y" or "n",
			state.isMuted and "y" or "n",
			state.demoBeats,
			state.demoPatternIndex,
			state.demoPatternRow
		),
		0,
		y,
		6
	)
	somatic_end_frame()

	-- BEGIN_DEBUG_ONLY
	-- Show logs
	y = y + 8
	for i = math.min(#log_lines, LOG_LINES), 1, -1 do
		local logY = y + (LOG_LINES - i) * 6
		if logY < 136 then
			print(log_lines[i], 2, logY, 15)
		end
	end

	-- -- Show per-channel SFX/morph state for sanity checking.
	-- for ch = 0, 3 do
	-- 	local sid = ch_sfx_id[ch + 1]
	-- 	local ticks = ch_sfx_ticks[ch + 1]
	-- 	print(string.format("ch%d sfx:%d t:%d", ch, sid, ticks), 40, y, 12)
	-- 	y = y + 8
	-- end

	-- END_DEBUG_ONLY
end
-- END_CUSTOM_ENTRYPOINT

--#endif

-- END_DISABLE_MINIFICATION
