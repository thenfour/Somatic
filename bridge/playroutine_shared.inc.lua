-- Shared playroutine code.
-- Injected into both bridge.lua and playroutine.lua during build.

local MOD_SRC_ENVELOPE = 0
local MOD_SRC_LFO = 1
local MOD_SRC_NONE = 2

local WAVE_ENGINE_MORPH = 0
local WAVE_ENGINE_NATIVE = 1
local WAVE_ENGINE_PWM = 2

local EFFECT_KIND_WAVEFOLD = 1
local EFFECT_KIND_HARDSYNC = 2

local TRACK_BYTES_PER_TRACK = 51
local PATTERN_BYTES_PER_PATTERN = 192
local ROW_BYTES = 3
local WAVE_BYTES_PER_WAVE = 16 -- 32x 4-bit samples packed 2-per-byte
local WAVE_SAMPLES_PER_WAVE = 32

-- Decode a pattern row's 3-byte triplet into note nibble and sfx id.
-- Triplet layout (see pattern_encoding.ts):
--  byte0: high nibble = argX, low nibble = noteNibble
--  byte1: bit7 = instrument bit5, bits4..6 = command, low nibble = argY
--  byte2: bits5..7 = octave, low5 = instrument low5
local function decode_pattern_row(patternId1b, rowIndex)
	if patternId1b == 0 then
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

local function decode_track_frame_patterns(trackIndex, frameIndex)
	local addr = TRACKS_BASE + trackIndex * TRACK_BYTES_PER_TRACK + frameIndex * 3
	local b0 = peek(addr)
	local b1 = peek(addr + 1)
	local b2 = peek(addr + 2)
	return b0 & 0x3f,
		((b0 >> 6) | (b1 << 2)) & 0x3f,
		((b1 >> 4) | (b2 << 4)) & 0x3f,
		(b2 >> 2) & 0x3f
end

local function clamp(x, minVal, maxVal)
	return math.min(math.max(x, minVal), maxVal)
end

local function clamp01(x)
	return clamp(x, 0, 1)
end

local function clamp_nibble_round(v)
	return math.floor(clamp(v, 0, 15) + 0.5)
end

-- Codecs use Lua byte tables as their one canonical representation. These
-- scratch tables are reused; callers must carry the returned explicit lengths.
local codecSrc = {}
local codecDst = {}

local function memoryToTable(src, len, out)
	for i = 1, len do
		out[i] = peek(src + i - 1)
	end
	return out, len
end

local function tableToMemory(src, len, dst)
	for i = 1, len do
		poke(dst + i - 1, src[i])
	end
	return len
end

local function lzDecode(src, srcLen, out)
	local function readVarint(si)
		local x, f = 0, 1
		while true do
			local b = src[si + 1]
			si = si + 1
			x = x + (b % 0x80) * f
			if b < 0x80 then
				return x, si
			end
			f = f * 0x80
		end
	end

	local si, di = 0, 0
	while si < srcLen do
		local tag = src[si + 1]
		si = si + 1
		if tag == 0 then
			local len
			len, si = readVarint(si)
			for _ = 1, len do
				out[di + 1] = src[si + 1]
				si = si + 1
				di = di + 1
			end
		else
			local len, distance
			len, si = readVarint(si)
			distance, si = readVarint(si)
			-- BEGIN_DEBUG_ONLY
			if distance <= 0 or distance > di then
				error("invalid LZ match distance")
			end
			-- END_DEBUG_ONLY
			for _ = 1, len do
				out[di + 1] = out[di - distance + 1]
				di = di + 1
			end
		end
	end
	return out, di
end

local function lzMemoryToTable(src, srcLen)
	memoryToTable(src, srcLen, codecSrc)
	return lzDecode(codecSrc, srcLen, codecDst)
end

local function lzMemoryToMemory(src, srcLen, dst)
	local bytes, len = lzMemoryToTable(src, srcLen)
	return tableToMemory(bytes, len, dst)
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

-- Per channel, track which SFX is currently playing and how long it has been held (in 60Hz ticks)
-- This is manual state; TIC-80 does not expose this per-channel for SFX (in a stable way)
local SFX_CHANNELS = 4
local ch_sfx_id = { -1, -1, -1, -1 } -- 0-based channel -> sfx id (or -1)
local ch_sfx_ticks = { 0, 0, 0, 0 } -- 0-based channel -> duration since note-on (ticks)
local ch_effect_strength_scale_u8 = { 255, 255, 255, 255 } -- per channel (0..3)
local ch_lowpass_strength_scale_u8 = { 255, 255, 255, 255 } -- per channel (0..3)
local ch_pan_override_u8 = { nil, nil, nil, nil } -- Pxx override; reset on the next note event
local ch_volume_scale_u8 = { nil, nil, nil, nil } -- volume-column gain; reset on the next note event

local render_src_a = {}
local render_src_b = {}
local render_out = {}
local lfo_ticks_by_sfx = {}

local last_music_track = -2
local last_music_frame = -1
local last_music_row = -1

local function wave_read_samples(waveIndex, outSamples)
	local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
	for i = 0, WAVE_BYTES_PER_WAVE - 1 do
		local b = peek(base + i)
		outSamples[i * 2] = b & 0x0f
		outSamples[i * 2 + 1] = (b >> 4) & 0x0f
	end
end

local function write_channel_waveform(channel, samples)
	local base = SOUND_REGISTERS_BASE + channel * SOUND_REGISTER_BYTES + SOUND_REGISTER_WAVEFORM_OFFSET
	local si = 0
	for i = 0, WAVE_BYTES_PER_WAVE - 1 do
		local s0 = clamp_nibble_round(samples[si])
		local s1 = clamp_nibble_round(samples[si + 1])
		poke(base + i, (s1 << 4) | s0)
		si = si + 2
	end
end

local function wave_unpack_byte_to_samples(b, outSamples, si)
	outSamples[si] = b & 0x0f
	outSamples[si + 1] = (b >> 4) & 0x0f
	return si + 2
end

local function hasBit(bytes, base, bitIndex)
	local b = bytes[base + (bitIndex // 8)]
	return (b & (1 << (bitIndex % 8))) ~= 0
end

local function somaticMaskBitCount(bytes, base)
	local count = 0
	for i = 0, SOMATIC_PATTERN_MASK_BYTES - 1 do
		local b = bytes[base + i]
		while b ~= 0 do
			b = b & (b - 1)
			count = count + 1
		end
	end
	return count
end

-- Parse decompressed extra-song table and produce runtime struct.
local function decodeSomaticExtraSongBytes(bytes)
	local pos = 1
	local instrumentCount = bytes[pos]
	pos = pos + 1
	local nextMorphMap = {}
	local nextMorphIds = {}

	for _ = 1, instrumentCount do
		local entry = decode_MorphEntry(bytes, pos - 1)
		pos = pos + MORPH_ENTRY_BYTES
		local nodeCount = bytes[pos]
		pos = pos + 1
		local nodes = {}
		for _ = 1, nodeCount do
			-- BEGIN_FEATURE_WAVEMORPH
			local node = decode_WaveformMorphGradientNode(bytes, pos - 1)
			local samples = {}
			local sampleIndex = 0
			for byteIndex = 1, 16 do
				sampleIndex = wave_unpack_byte_to_samples(node.waveBytes[byteIndex], samples, sampleIndex)
			end
			node.waveBytes = nil
			node.samples = samples
			nodes[#nodes + 1] = node
			-- END_FEATURE_WAVEMORPH
			pos = pos + WAVEFORM_MORPH_GRADIENT_NODE_BYTES
		end
		entry.lowpassEnabled = entry.lowpassEnabled ~= 0
		-- BEGIN_FEATURE_WAVEMORPH
		entry.morphGradientNodes = nodes
		-- END_FEATURE_WAVEMORPH
		nextMorphMap[entry.instrumentId] = entry
		nextMorphIds[#nextMorphIds + 1] = entry.instrumentId
	end

	local volumeMask = pos
	local panMask = volumeMask + SOMATIC_PATTERN_MASK_BYTES
	local effectMask = panMask + SOMATIC_PATTERN_MASK_BYTES
	pos = effectMask + SOMATIC_PATTERN_MASK_BYTES

	local volumeValuePos = pos
	local panValuePos = volumeValuePos + somaticMaskBitCount(bytes, volumeMask)
	local effectValuePos = panValuePos + somaticMaskBitCount(bytes, panMask)
	local paramValuePos = effectValuePos + somaticMaskBitCount(bytes, effectMask)
	local nextPatternExtra = {}

	for bitIndex = 0, SOMATIC_PATTERN_CELL_COUNT - 1 do
		local cell = nil
		if hasBit(bytes, volumeMask, bitIndex) then
			cell = cell or {}
			cell.volumeU8 = bytes[volumeValuePos]
			volumeValuePos = volumeValuePos + 1
		end
		if hasBit(bytes, panMask, bitIndex) then
			cell = cell or {}
			cell.panU8 = bytes[panValuePos]
			panValuePos = panValuePos + 1
		end
		if hasBit(bytes, effectMask, bitIndex) then
			cell = cell or {}
			cell.effectId = bytes[effectValuePos]
			cell.paramU8 = bytes[paramValuePos]
			effectValuePos = effectValuePos + 1
			paramValuePos = paramValuePos + 1
		end
		if cell ~= nil then
			local patternIndex = bitIndex // SOMATIC_PATTERN_ROW_COUNT
			local cells = nextPatternExtra[patternIndex]
			if cells == nil then
				cells = {}
				nextPatternExtra[patternIndex] = cells
			end
			cells[(bitIndex % SOMATIC_PATTERN_ROW_COUNT) + 1] = cell
		end
	end

	return nextMorphMap, nextPatternExtra, nextMorphIds
end

local function calculate_mod_t(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks, fallbackT)
	-- BEGIN_FEATURE_LFO
	if modSource == MOD_SRC_LFO then
		local cycle = lfoCycleTicks
		if cycle <= 0 then
			return 0
		end
		local phase01 = (lfoTicks % cycle) / cycle
		-- Map sine to 0..1, starting at 0 when phase01=0.
		return (1 - math.cos(phase01 * math.pi * 2)) * 0.5
	end
	-- END_FEATURE_LFO

	if durationTicks <= 0 then
		return fallbackT
	end
	return clamp01(ticksPlayed / durationTicks)
end

local function pan_u8_to_n11(panU8)
	local v = clamp(panU8, 0, 255) - 128
	if v < 0 then
		return v / 128
	end
	return v / 127
end

-- Apply Somatic gain after TIC-80 has produced its native envelope/Mxy stereo levels.
local function write_channel_mix(channel, baseVolumeU8, basePanU8, depthU8, lfoTicks, lfoCycleTicks)
	local volumeScaleU8 = ch_volume_scale_u8[channel + 1] or 255
	local baseVolume = clamp01(baseVolumeU8 / 255)
	local volumeScale = clamp01(volumeScaleU8 / 255)
	local volume = baseVolume * volumeScale
	local panU8 = ch_pan_override_u8[channel + 1]
	if panU8 == nil then
		panU8 = basePanU8
	end
	local pan = pan_u8_to_n11(panU8)

	-- BEGIN_FEATURE_LFO
	local depth = clamp01(depthU8 / 255)
	if depth > 0 and lfoCycleTicks > 0 then
		local lfo = calculate_mod_t(MOD_SRC_LFO, 0, 0, lfoTicks, lfoCycleTicks, 0) * 2 - 1
		pan = clamp(pan + depth * lfo, -1, 1)
	end
	-- END_FEATURE_LFO

	-- Center-preserving balance law: center keeps both sides at their existing gain.
	local leftGain = 1
	local rightGain = 1
	if pan < 0 then
		rightGain = 1 + pan
	else
		leftGain = 1 - pan
	end

	local addr = STEREO_VOLUME_BASE + channel
	local engineVolume = peek(addr)
	local left = engineVolume & 0x0f
	local right = (engineVolume >> 4) & 0x0f
	left = math.floor(left * leftGain * volume + 0.5)
	right = math.floor(right * rightGain * volume + 0.5)
	poke(addr, left | right << 4)
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

-- BEGIN_FEATURE_LOWPASS
-- a 1-pole lowpass filter applied forward and backward for zero-phase
-- a 1-pole lowpass filter applied forward and backward for zero-phase
local function apply_lowpass_effect_to_samples(samples, strength) -- string is 0..1
	local strength = strength * strength -- better param curve

	local n = WAVE_SAMPLES_PER_WAVE

	local alpha = 0.95 * strength

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
	local gain = 1 + 20 * clamp01(strength01)
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
	if multiplier <= 1.001 then
		return
	end

	local N = WAVE_SAMPLES_PER_WAVE

	for i = 0, N - 1 do
		hs_scratch[i] = samples[i]
	end

	for i = 0, N - 1 do
		local u = (i / N) * multiplier -- slave cycles within master cycle
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
