-- Shared playroutine code.
-- Injected into both bridge.lua and playroutine.lua during build.

local MOD_SRC_ENVELOPE = 0
local MOD_SRC_LFO = 1
local MOD_SRC_NONE = 2

local WAVE_ENGINE_MORPH = 0
local WAVE_ENGINE_NATIVE = 1
local WAVE_ENGINE_PWM = 2

local EFFECT_KIND_NONE = 0
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

local function decode_track_frame_patterns(trackIndex, frameIndex)
	local r = _bp_make_reader(TRACKS_BASE + trackIndex * TRACK_BYTES_PER_TRACK + frameIndex * 3)
	return r.u(6), r.u(6), r.u(6), r.u(6)
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

local render_src_a = {}
local render_src_b = {}
local render_out = {}
local lfo_ticks_by_sfx = {}

local last_music_track = -2
local last_music_frame = -1
local last_music_row = -1

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

	if durationTicks == nil or durationTicks <= 0 then
		return fallbackT or 0
	end
	return clamp01(ticksPlayed / durationTicks)
end
