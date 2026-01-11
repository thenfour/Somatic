-- Shared playroutine code.
-- Injected into both bridge.lua and playroutine.lua during build.

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
