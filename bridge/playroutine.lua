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

	local MOD_SRC_ENVELOPE = 0
	local MOD_SRC_LFO = 1

	local WAVE_ENGINE_MORPH = 0
	local WAVE_ENGINE_NATIVE = 1
	local WAVE_ENGINE_PWM = 2

	local EFFECT_KIND_NONE = 0
	local EFFECT_KIND_WAVEFOLD = 1
	local EFFECT_KIND_HARDSYNC = 2

	-- =========================
	-- general playroutine support
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
	local SFX_CHANNELS = 4
	local ch_sfx_id = { -1, -1, -1, -1 }
	local ch_sfx_ticks = { 0, 0, 0, 0 }
	local ch_effect_strength_scale_u8 = { 255, 255, 255, 255 }
	local last_music_track = -2
	local last_music_frame = -1
	local last_music_row = -1

	local morphMap = {}
	local patternExtra = {}

	local WAVE_BYTES_PER_WAVE = 16
	local WAVE_SAMPLES_PER_WAVE = 32
	local TRACK_BYTES_PER_TRACK = 51
	local PATTERN_BYTES_PER_PATTERN = 192
	local ROW_BYTES = 3

	local function clamp(x, minVal, maxVal)
		return math.min(math.max(x, minVal), maxVal)
	end

	-- local function clamp(x, minVal, maxVal)
	-- 	if x < minVal then
	-- 		return minVal
	-- 	elseif x > maxVal then
	-- 		return maxVal
	-- 	end
	-- 	return x
	-- end

	local function clamp01(x)
		return clamp(x, 0, 1)
	end

	local function clamp_nibble_round(v)
		return math.floor(clamp(v, 0, 15) + 0.5)
	end

	-- base85 decode (ASCII85-style) for TIC-80 Lua
	-- Decodes 's' into memory starting at 'dst', writing exactly expectedLen bytes.
	-- Returns the number of bytes written (should equal expectedLen or error).

	-- BTW, justification for using this instead of typical tonumber() method:
	-- ASCII85 is 1.25 chars per byte
	-- HEX is 2 chars per byte
	-- the ascii85 lua decoder is about 600 bytes.
	-- so in lua,
	-- ascii85's payload is 600 + (1.25 * N) bytes
	-- hex's payload is 2 * N bytes, and probably some tiny amount of decoder like 30 bytes.
	-- the break-even point is @
	--      let d85 = ascii85 decoder size 600 bytes
	--      let d16 = hex decoder size / 30 bytes
	--      d85 + 1.25 * N < d16 + 2 * N
	--      2 N - 1.25 N > d85 - d16
	--      0.75 N > d85 - d16
	-- 	    N > (d85 - d16) / 0.75
	-- -> Break-even point = (ascii85 decoder size - hex decoder size) / 0.75
	-- -> (600 - 30) / 0.75 = 760 bytes
	-- So for patterns larger than that, ascii85 is more size-efficient.

	local function base85Plus1Decode(s, d)
		local miss = s:byte(1) - 33
		s = s:sub(2)
		local n = (#s // 5) * 4 - miss
		local i = 1
		for o = 0, n - 1, 4 do
			local v = 0
			for j = i, i + 4 do
				v = v * 85 + s:byte(j) - 33
			end
			i = i + 5
			for k = 3, 0, -1 do
				if o + k < n then
					poke(d + o + k, v % 256)
				end
				v = v // 256
			end
		end
		return n
	end

	-- Read unsigned LEB128 varint from memory.
	-- base:   start address of encoded stream
	-- si:     current offset (0-based) into the stream
	-- srcLen: total length of the encoded stream (in bytes)
	-- Returns: value, next_si
	local function varint(base, si, srcLen)
		local x, f = 0, 1
		while true do
			local b = peek(base + si)
			si = si + 1
			x = x + (b % 0x80) * f
			if b < 0x80 then
				return x, si
			end
			f = f * 0x80
		end
	end

	-- LZ-Decompress from [src .. src+srcLen-1] into [dst ..).
	-- Returns number of decompressed bytes written.
	local function lzdm(src, srcLen, dst)
		local si, di = 0, 0
		while si < srcLen do
			local t = peek(src + si)
			si = si + 1
			if t == 0 then
				local l
				l, si = varint(src, si, srcLen)
				for j = 1, l do
					poke(dst + di, peek(src + si))
					si = si + 1
					di = di + 1
				end
			else
				local l, d
				l, si = varint(src, si, srcLen)
				d, si = varint(src, si, srcLen)
				for j = 1, l do
					poke(dst + di, peek(dst + di - d))
					di = di + 1
				end
			end
		end
		return di
	end

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

	local function apply_curveN11(t, curveS6)
		if t <= 0 then
			return 0
		end
		if t >= 1 then
			return 1
		end

		local k = curveS6 / 31 -- curveS6 is signed 6-bit (-32..31)
		k = clamp(k, -1, 1)
		if k == 0 then
			return t
		end

		local e = 2 ^ (4 * math.abs(k))
		return (k > 0) and (t ^ e) or (1 - (1 - t) ^ e)
	end

	local function wave_read_samples(waveIndex, outSamples)
		local r = _bp_make_reader(WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE)
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			outSamples[i] = r.u(4)
		end
	end

	local function wave_write_samples(waveIndex, samples)
		local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
		local si = 0
		for i = 0, WAVE_BYTES_PER_WAVE - 1 do
			local s0 = clamp_nibble_round(samples[si])
			local s1 = clamp_nibble_round(samples[si + 1])
			poke(base + i, (s1 << 4) | s0)
			si = si + 2
		end
	end

	-- BEGIN_FEATURE_LOWPASS
	-- a 1-pole lowpass filter applied forward and backward for zero-phase
	local function apply_lowpass_effect_to_samples(samples, strength01)
		local strength = (clamp01(1 - strength01))
		strength = strength * strength -- better param curve

		local n = WAVE_SAMPLES_PER_WAVE

		local alpha = 0.03 + 0.95 * strength

		-- estimate initial state as average to reduce edge junk
		local acc = 0
		for i = 0, n - 1 do
			acc = acc + samples[i]
		end
		local y = acc / n

		local function doPass(from, to, step)
			for i = from, to, step do
				local x = samples[i]
				y = y + alpha * (x - y)
				samples[i] = y
			end
		end
		doPass(0, n - 1, 1) -- forward pass
		doPass(n - 1, 0, -1) -- backward pass for zero-phase
	end

	-- END_FEATURE_LOWPASS

	-- BEGIN_FEATURE_WAVEFOLD
	local function apply_wavefold_effect_to_samples(samples, strength01)
		local gain = 1 + 20 * clamp01(strength01 or 0)
		if gain <= 1 then
			return
		end

		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			-- map 0..15 -> -1..1 and apply gain
			local x = (samples[i] / 7.5 - 1) * gain

			-- triangle-ish fold in [-1,1]
			local y = (2 / math.pi) * math.asin(math.sin(x))

			-- back to 0..15
			local out = (y + 1) * 7.5

			-- clamp and quantize
			samples[i] = clamp_nibble_round(out, 0, 15)
		end
	end

	-- END_FEATURE_WAVEFOLD

	-- BEGIN_FEATURE_HARDSYNC
	local hs_scratch = {}
	local function apply_hardsync_effect_to_samples(samples, multiplier)
		local m = multiplier or 1
		if m <= 1.001 then
			return
		end

		local N = WAVE_SAMPLES_PER_WAVE

		for i = 0, N - 1 do
			hs_scratch[i] = samples[i]
		end

		for i = 0, N - 1 do
			local u = (i / N) * m -- slave cycles within master cycle
			local k = math.floor(u)
			local frac = u - k -- 0..1
			local p = frac * N
			local idx0 = math.floor(p)
			local f = p - idx0
			local idx1 = (idx0 + 1) % N

			local s0 = hs_scratch[idx0]
			local s1 = hs_scratch[idx1]
			local v = s0 + (s1 - s0) * f

			samples[i] = v
		end
	end
	-- END_FEATURE_HARDSYNC

	local render_src_a = {}
	local render_src_b = {}
	local render_out = {}
	local lfo_ticks_by_sfx = {}
	local morphIds = {}
	local morph_nodes_cache = {}
	local MORPH_GRADIENT_BASE = __AUTOGEN_TEMP_PTR_B

	local function calculate_mod_t(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks, fallbackT)
		-- BEGIN_FEATURE_LFO
		if modSource == MOD_SRC_LFO then
			local cycle = lfoCycleTicks
			if cycle <= 0 then
				return 0
			end
			local phase01 = (lfoTicks % cycle) / cycle
			return (1 - math.cos(phase01 * math.pi * 2)) * 0.5
		end
		-- END_FEATURE_LFO

		if durationTicks == nil or durationTicks <= 0 then
			return fallbackT
		end
		return clamp01(ticksPlayed / durationTicks)
	end

	local function cfg_is_k_rate_processing(cfg)
		if not cfg then
			return false
		end
		local we = cfg.waveEngineId
		-- BEGIN_FEATURE_WAVEMORPH
		if we == WAVE_ENGINE_MORPH then
			return true
		end
		-- END_FEATURE_WAVEMORPH
		-- BEGIN_FEATURE_PWM
		if we == WAVE_ENGINE_PWM then
			return true
		end
		-- END_FEATURE_PWM
		-- BEGIN_FEATURE_LOWPASS
		if cfg.lowpassEnabled then
			return true
		end
		-- END_FEATURE_LOWPASS
		local effectKind = cfg.effectKind
		-- BEGIN_FEATURE_WAVEFOLD
		if effectKind == EFFECT_KIND_WAVEFOLD and cfg.effectAmtU8 > 0 then
			return true
		end
		-- END_FEATURE_WAVEFOLD
		-- BEGIN_FEATURE_HARDSYNC
		if effectKind == EFFECT_KIND_HARDSYNC and cfg.effectAmtU8 > 0 then
			return true
		end
		-- END_FEATURE_HARDSYNC
		return false
	end

	-- BEGIN_FEATURE_WAVEMORPH

	local function wave_unpack_byte_to_samples(b, outSamples, si)
		outSamples[si] = b & 0x0f
		outSamples[si + 1] = (b >> 4) & 0x0f
		return si + 2
	end

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

	local function render_tick_cfg(cfg, instId, ticksPlayed, lfoTicks, effectStrengthScaleU8)
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		if not render_waveform_samples(cfg, ticksPlayed, render_out, lfoTicks) then
			return
		end
		local scale01 = clamp01((effectStrengthScaleU8 or 255) / 255)
		local effectKind = cfg.effectKind or EFFECT_KIND_NONE
		-- BEGIN_FEATURE_HARDSYNC
		if effectKind == EFFECT_KIND_HARDSYNC and cfg.effectAmtU8 > 0 and scale01 > 0 then
			local hsT = calculate_mod_t(
				cfg.effectModSource,
				cfg.effectDurationTicks12,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleTicks12,
				0
			)
			local env = 1 - apply_curveN11(hsT, cfg.effectCurveS6)
			local multiplier = 1 + (cfg.effectAmtU8 / 255) * scale01 * 7 * env
			apply_hardsync_effect_to_samples(render_out, multiplier)
		end
		-- END_FEATURE_HARDSYNC
		-- BEGIN_FEATURE_WAVEFOLD
		local effectModSource = cfg.effectModSource
		local wavefoldHasTime = (effectModSource == MOD_SRC_LFO and cfg.lfoCycleTicks12 > 0)
			or (cfg.effectDurationTicks12 > 0)
		if effectKind == EFFECT_KIND_WAVEFOLD and cfg.effectAmtU8 > 0 and wavefoldHasTime and scale01 > 0 then
			local maxAmt = clamp01(cfg.effectAmtU8 / 255) * scale01
			local wfT = calculate_mod_t(
				effectModSource,
				cfg.effectDurationTicks12,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleTicks12,
				0
			)
			local envShaped = 1 - apply_curveN11(wfT, cfg.effectCurveS6)
			local strength = maxAmt * envShaped
			apply_wavefold_effect_to_samples(render_out, strength)
		end
		-- END_FEATURE_WAVEFOLD
		-- BEGIN_FEATURE_LOWPASS
		if cfg.lowpassEnabled then
			local lpT = calculate_mod_t(
				cfg.lowpassModSource,
				cfg.lowpassDurationTicks12,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleTicks12,
				1
			)
			local strength = apply_curveN11(lpT, cfg.lowpassCurveS6)
			apply_lowpass_effect_to_samples(render_out, strength)
		end
		-- END_FEATURE_LOWPASS
		wave_write_samples(cfg.renderWaveformSlot, render_out)
	end

	local function prime_render_slot_for_note_on(instId, ch)
		local cfg = morphMap and morphMap[instId]
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		local lt = lfo_ticks_by_sfx[instId] or 0
		local scaleU8 = ch_effect_strength_scale_u8[(ch or 0) + 1] or 255
		render_tick_cfg(cfg, instId, 0, lt, scaleU8)
	end

	local function decode_track_frame_patterns(trackIndex, frameIndex)
		local r = _bp_make_reader(TRACKS_BASE + trackIndex * TRACK_BYTES_PER_TRACK + frameIndex * 3)
		return r.u(6), r.u(6), r.u(6), r.u(6)
	end

	local function decode_pattern_row(patternId1b, rowIndex)
		if patternId1b == nil or patternId1b == 0 then
			return 0, 0
		end
		local pat0b = patternId1b - 1
		local addr = PATTERNS_BASE + pat0b * PATTERN_BYTES_PER_PATTERN + rowIndex * ROW_BYTES
		local b0 = peek(addr)
		local b1 = peek(addr + 1)
		local b2 = peek(addr + 2)
		local noteNibble = b0 & 0x0f
		local inst = (b2 & 0x1f) | (((b1 >> 7) & 0x01) << 5)
		return noteNibble, inst
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
			-- effectId: 0=none; 1='E'; 2='L'
			if cell and cell.effectId == 1 then
				-- 'E': Set effect strength scale
				ch_effect_strength_scale_u8[ch + 1] = cell.paramU8 or 255
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
				ch_sfx_id[ch + 1] = -1
				ch_sfx_ticks[ch + 1] = 0
			else
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
		if not cfg_is_k_rate_processing(cfg) then
			ch_sfx_ticks[ch + 1] = ticksPlayed + 1
			return
		end
		local lt = lfo_ticks_by_sfx[instId] or 0
		local scaleU8 = ch_effect_strength_scale_u8[ch + 1] or 255
		render_tick_cfg(cfg, instId, ticksPlayed, lt, scaleU8)
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
-- END_DISABLE_MINIFICATION
