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
	local musicInitialized = false
	local currentSongOrder = 0
	local playingSongOrder0b = 0
	local lastPlayingFrame = -1
	local backBufferIsA = false -- A means patterns 0,1,2,3; B = 4,5,6,7
	local stopPlayingOnNextFrame = false
	local PATTERN_BUFFER_BYTES = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
	local bufferALocation = __AUTOGEN_BUF_PTR_A -- pattern 46
	local bufferBLocation = __AUTOGEN_BUF_PTR_B -- pattern 50

	-- Wave morphing
	local morphMap = {}
	local patternExtra = {}

	-- decodes a b85+1 string, then LZ-decompresses it into dst.
	-- uses __AUTOGEN_TEMP_PTR_A as temp storage
	-- returns number of bytes written to dst.
	local function b85Plus1LZDecodeToMem(s, dst)
		-- BEGIN_DEBUG_ONLY
		-- assert that dst is not overlapping
		if dst >= __AUTOGEN_TEMP_PTR_A and dst < (__AUTOGEN_TEMP_PTR_A + 256) then -- reasonable temp buffer size
			error("b85Plus1LZDecodeToMem: dst overlaps with temp buffer")
		end
		-- END_DEBUG_ONLY
		return lzdm(__AUTOGEN_TEMP_PTR_A, base85Plus1Decode(s, __AUTOGEN_TEMP_PTR_A), dst)
	end

	local morphIds = {}
	local morph_nodes_cache = {}
	local MORPH_GRADIENT_BASE = __AUTOGEN_TEMP_PTR_B

	-- BEGIN_FEATURE_WAVEMORPH

	local function morph_get_nodes(offBytes)
		if offBytes == nil or offBytes <= 0 then
			return nil
		end
		local cached = morph_nodes_cache[offBytes]
		if cached ~= nil then
			return cached or nil
		end
		local nodes = decode_WaveformMorphGradient(MORPH_GRADIENT_BASE + offBytes)
		if nodes == nil or #nodes == 0 then
			morph_nodes_cache[offBytes] = false
			return nil
		end
		for ni = 1, #nodes do
			local wb = nodes[ni].waveBytes
			local s = {}
			local si = 0
			for bi = 1, 16 do
				si = wave_unpack_byte_to_samples(wb[bi] or 0, s, si)
			end
			nodes[ni].samples = s
		end
		morph_nodes_cache[offBytes] = nodes
		return nodes
	end

	local function render_waveform_morph(cfg, ticksPlayed, outSamples)
		local nodes = cfg.morphGradientNodes
		local n = #nodes
		if nodes == nil or n == 0 then
			return false
		end
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

	local function render_tick_cfg(cfg, instId, ticksPlayed, lfoTicks, effectStrengthScaleU8, lowpassStrengthScaleU8)
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		if not render_waveform_samples(cfg, ticksPlayed, render_out, lfoTicks) then
			return
		end
		local scale01 = clamp01(effectStrengthScaleU8 / 255)
		local lpScale01 = clamp01((lowpassStrengthScaleU8 or 255) / 255)
		local baseLpAmount01 = clamp01((cfg.lowpassAmountU8 or 0) / 255)
		local lpAmount01 = baseLpAmount01 * lpScale01
		local effectKind = cfg.effectKind or EFFECT_KIND_NONE
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
			local openness01 = 1 - amountAtTime01
			openness01 = apply_curveN11(openness01, cfg.lowpassCurveS6)
			apply_lowpass_effect_to_samples(render_out, openness01)
		end
		-- END_FEATURE_LOWPASS
		wave_write_samples(cfg.renderWaveformSlot, render_out)
	end

	local function prime_render_slot_for_note_on(instId, ch)
		local cfg = morphMap and morphMap[instId]
		if cfg_is_k_rate_processing(cfg) then
			local lt = lfo_ticks_by_sfx[instId] or 0
			local scaleU8 = ch_effect_strength_scale_u8[ch + 1] or 255
			local lpScaleU8 = ch_lowpass_strength_scale_u8[ch + 1] or 255
			render_tick_cfg(cfg, instId, 0, lt, scaleU8, lpScaleU8)
		end
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

		-- Apply Somatic per-pattern extra commands (currently: E param => effect strength scale)
		local playingSongOrder = playingSongOrder0b
		--local orderEntry = SOMATIC_MUSIC_DATA.songOrder[playingSongOrder + 1]

		local p0, p1, p2, p3 = decode_track_frame_patterns(track, frame)
		local patterns = { p0, p1, p2, p3 }
		for ch = 0, SFX_CHANNELS - 1 do
			--if orderEntry then
			--local columnIndex0b = orderEntry[ch + 1]
			local columnIndex0b = getColumnIndex(playingSongOrder, ch)
			local cells = columnIndex0b ~= nil and patternExtra[columnIndex0b] or nil
			local cell = cells and cells[row + 1] or nil
			-- effectId: 0=none; 1='E'; 2='L'; 3='F'
			if cell and cell.effectId == 1 then
				-- 'E': Set effect strength scale
				ch_effect_strength_scale_u8[ch + 1] = cell.paramU8 or 255
			elseif cell and cell.effectId == 3 then
				-- 'F': Set lowpass strength scale (00=bypass, FF=max)
				ch_lowpass_strength_scale_u8[ch + 1] = cell.paramU8 or 255
			elseif cell and cell.effectId == 2 then
				-- 'L': Set LFO phase for the instrument playing on this channel
				local instId = ch_sfx_id[ch + 1]
				if instId and instId >= 0 then
					local cfg = morphMap and morphMap[instId]
					local cycle = cfg and cfg.lfoCycleTicks12 or 0
					if cycle > 0 then
						-- paramU8 0x00..0xFF maps to phase 0..cycle
						lfo_ticks_by_sfx[instId] = math.floor((cell.paramU8 or 0) / 255 * cycle)
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
			else
				-- note on
				ch_sfx_id[ch + 1] = inst
				ch_sfx_ticks[ch + 1] = 0
				prime_render_slot_for_note_on(inst, ch)
			end
		end
	end

	local function sfx_tick_channel(ch)
		local instId = ch_sfx_id[ch + 1]
		if instId == -1 then
			return
		end
		local ticksPlayed = ch_sfx_ticks[ch + 1]
		local cfg = morphMap and morphMap[instId]
		if cfg_is_k_rate_processing(cfg) then
			local lt = lfo_ticks_by_sfx[instId] or 0
			local scaleU8 = ch_effect_strength_scale_u8[ch + 1] or 255
			local lpScaleU8 = ch_lowpass_strength_scale_u8[ch + 1] or 255
			render_tick_cfg(cfg, instId, ticksPlayed, lt, scaleU8, lpScaleU8)
		end
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
		if not m then
			return
		end

		morphMap = {}
		patternExtra = {}
		morphIds = {}
		morph_nodes_cache = {}

		-- let's use a part of pattern mem for temp storage
		b85Plus1LZDecodeToMem(m, __AUTOGEN_TEMP_PTR_B)
		local instrumentCount = peek(__AUTOGEN_TEMP_PTR_B)
		local patternCount = peek(__AUTOGEN_TEMP_PTR_B + 1)
		local off = __AUTOGEN_TEMP_PTR_B + SOMATIC_EXTRA_SONG_HEADER_BYTES
		for _ = 1, instrumentCount do
			local entry = decode_MorphEntry(off)
			local id = entry.instrumentId

			-- adjust fields as needed
			entry.lowpassEnabled = entry.lowpassEnabled ~= 0
			-- BEGIN_FEATURE_WAVEMORPH
			if entry.waveEngineId == WAVE_ENGINE_MORPH then
				entry.morphGradientNodes = morph_get_nodes(entry.gradientOffsetBytes or 0)
			end
			-- END_FEATURE_WAVEMORPH

			morphMap[id] = entry
			morphIds[#morphIds + 1] = id
			off = off + MORPH_ENTRY_BYTES
		end
		for _ = 1, patternCount do
			local entry = decode_SomaticPatternEntry(off)
			patternExtra[entry.patternIndex] = entry.cells
			off = off + SOMATIC_PATTERN_ENTRY_BYTES
		end
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
	function somatic_get_song_order_count()
		return #SOMATIC_MUSIC_DATA.songOrder / 4
	end

	-- decode b85+1 LZ-compressed data into a table of integers with 'bits' bits each.
	local function decodeBits(blob, bits)
		local n = b85Plus1LZDecodeToMem(blob, __AUTOGEN_TEMP_PTR_B)
		local r = _bp_make_reader(__AUTOGEN_TEMP_PTR_B)
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
			lzdm(
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
		b85Plus1LZDecodeToMem(entry, destPointer)
	end

	local function swapInPlayorder(songPosition0b, destPointer)
		for ch = 0, 3 do
			local columnIndex0b = getColumnIndex(songPosition0b, ch)
			--local columnIndex0b = entry[ch + 1]
			local dst = destPointer + ch * PATTERN_BYTES_PER_PATTERN
			blit_pattern_column(columnIndex0b, dst)
		end
	end

	-- =========================
	-- general playroutine support

	somatic_reset_state = function()
		currentSongOrder = 0
		playingSongOrder0b = 0
		lastPlayingFrame = -1
		backBufferIsA = false
		stopPlayingOnNextFrame = false
		ch_effect_strength_scale_u8 = { 255, 255, 255, 255 }
		ch_lowpass_strength_scale_u8 = { 255, 255, 255, 255 }
		lfo_ticks_by_sfx = {}
		log("somatic_reset_state") -- DEBUG_ONLY
		--ch_set_playroutine_regs(0xFF)
	end

	somatic_reset_state()

	-- init state and begin playback. can be called multiple times.
	somatic_init = function(songPosition, startRow)
		songPosition = songPosition or 0
		startRow = startRow or 0

		log(string.format("somatic_init: pos=%d row=%d", songPosition, startRow)) -- DEBUG_ONLY

		-- seed state
		currentSongOrder = songPosition
		playingSongOrder0b = songPosition
		backBufferIsA = true -- act like we came from buffer B so tick() will set it correctly on first pass.
		lastPlayingFrame = -1 -- this means tick() will immediately seed the back buffer.
		stopPlayingOnNextFrame = false

		swapInPlayorder(currentSongOrder, bufferALocation)

		-- Seed LFO tick counters so per-tick advancement can be branch-free.
		for i = 1, #morphIds do
			lfo_ticks_by_sfx[morphIds[i]] = 0
		end

		initialized = true

		music(
			0, -- track
			0, -- frame
			startRow, -- row
			true, -- loop
			true -- sustain
		)
	end

	function somatic_get_state()
		local track = peek(0x13FFC)
		local frame = peek(0x13FFD)
		local row = peek(0x13FFE)
		if track == 255 then
			track = -1
		end -- stopped / none
		return track, playingSongOrder0b, frame, row
	end

	function somatic_stop()
		log("tick: stopping") -- DEBUG_ONLY
		music() -- stops playback.
		somatic_reset_state()
	end

	function somatic_tick()
		if not initialized then
			somatic_init(0, 0)
		end
		local track, _, currentFrame, row = somatic_get_state()
		if track == -1 then
			return
		end

		-- If we've advanced to a new music frame, update our order bookkeeping *first*
		-- so per-row E/L commands are applied to the correct playing order.
		if currentFrame ~= lastPlayingFrame then
			if stopPlayingOnNextFrame then
				-- We already cleared the upcoming buffer when we hit end-of-song;
				-- once the music engine advances again, stop cleanly.
				somatic_stop()
				return
			end

			backBufferIsA = not backBufferIsA
			lastPlayingFrame = currentFrame
			playingSongOrder0b = currentSongOrder
			--ch_set_playroutine_regs(currentSongOrder) -- the queued pattern is now playing; inform host.
			currentSongOrder = currentSongOrder + 1

			local destPointer = backBufferIsA and bufferALocation or bufferBLocation
			local orderCount = somatic_get_song_order_count()

			log(string.format("tick: advance to=%d count=%d", currentSongOrder, orderCount)) -- DEBUG_ONLY

			if orderCount == 0 or currentSongOrder >= orderCount then
				-- No next entry to queue. Don't stop *immediately* (that would kill playback
				-- when starting on the last order / length==1). Instead, clear the next buffer
				-- so the next advance is silent, and stop on the following tick.
				for i = 0, PATTERN_BUFFER_BYTES - 1 do
					poke(destPointer + i, 0)
				end
				stopPlayingOnNextFrame = true
			else
				swapInPlayorder(currentSongOrder, destPointer)
			end
		end

		somatic_sfx_tick(track, currentFrame, row)
	end
end -- do
-- BEGIN_DISABLE_MINIFICATION
-- (end Somatic playroutine)

-- BEGIN_CUSTOM_ENTRYPOINT
-- example main loop...
local lastKnownOrder = 0
local lastKnownRow = 0
function TIC()
	-- call once per frame
	somatic_tick()

	-- somatic_get_song_order_count() returns the total number of song orders.
	-- somatic_init(orderIndex0b, startRow0b) starts playback at the given order and row.
	-- somatic_stop() stops playback.

	-- somatic_get_state() returns four values:
	-- "track" is -1 when stopped; otherwise kinda worthless
	-- "playingSongOrder" is the song order index of the pattern currently being played (0-255)
	-- "currentFrame" is the TIC-80 internal frame counter; kinda worthless.
	-- "currentRow" is the current row within the pattern being played (0-63).
	local track, playingSongOrder, currentFrame, currentRow = somatic_get_state()

	if track ~= -1 then -- if playing
		lastKnownOrder = playingSongOrder
		lastKnownRow = currentRow
	end

	if btnp(2) then -- left
		somatic_init(math.max(0, playingSongOrder - 1), 0)
	end
	if btnp(3) then -- right
		-- clamping...
		local nextPattern = math.min(somatic_get_song_order_count() - 1, playingSongOrder + 1)
		somatic_init(nextPattern, 0)
	end
	if btnp(1) then -- down
		if track == -1 then
			somatic_init(lastKnownOrder, lastKnownRow)
		else
			somatic_stop()
		end
	end

	cls(0)
	local y = 2
	print("Somatic playroutine", 0, y, 12)
	y = y + 8
	print("Left/Right = next/prev song order", 0, y, 15)
	y = y + 8
	print("Down = pause/resume", 0, y, 15)
	y = y + 8
	print(string.format("t:%d ord:%d r:%d", track, playingSongOrder, currentRow), 0, y, 6)

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
-- END_DISABLE_MINIFICATION
