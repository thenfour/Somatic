local MUSIC_DATA = {
	songOrder = { 0, 3, 2 },
	patterns = {
		"#lnB?!'pSb!!!!!!!!!!!!!!!!!!!!#lm6k!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!(!'pSb!!`Ki!!!!!!!!6(5l^lb!!!!(!'pSb!!!!!#67$i!!!6(5l^lb!!!!!!!!6(5l^lb!!!!(!'pSb!!!!!#67$i!!!!!!!`Ki!!!!!!!!6(5l^lb!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki#67$i!!!!!!!`Ki!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9;j1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9>+q!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"#67$i!!!6(5l^lb!!!!(!'pSb!!!!!!!!!(!'pSb!!!!!#67$i!!!6(5l^lb#67$p!'pSb!!`Ki#67%\"!+?*45n3m'#67$i!!!!!!!`Ki%KKo;!!!!!!!`Ki%KKoB!'q(p@0Zcu!!!!(!'pSb!\"K!;#67$p!'pSb!!!!!#67%\"!+>j-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9;j1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9<uQ!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"TX)R!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"#67$i!!!0&@K6B.!!!!(!'pSb!!!!!%feor!!!N063dKV!!!!!!!!!!!!!!!%feor!!!!!!!!!!!!!!!!!!6(5l^lb!!!!!!!!!!!!!!!%feor!!!!!!!!!!!!!!!!!!!!!!`Ki!!!!!!!!!!!\"T&r!!!!!!!!!!!!!!!!!!!(!'pSb!!!!!!!!!!!!!!!!\"T&r!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!0!($Yc!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#6804!!!!!!!!!!!!!!!!!!!!!!!!!",
		"%felq!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!&!+>j-!!!!!!!!!!!!!!!!!!!!#9Z;4!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%KKo;!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!\"T&q!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0+@,u-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!N@2!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!E:Q!!!!!!!!!!!!!!!#lm6k!!!!!!!!!!!!!!!!!!!!!!N@2!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%felq!!!!!!!!!!!!!!!!!!N05l^lb!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!-!'pSb!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0&@/p9-%KJcp!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!!!!!!!!!!!!!!!!!!!!0&@/p9-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!&!+>j-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0&@0Zcu%fem!!+?B<5mIBU\"TVsA!'phi5m76s!!!!!!!!!!!!!!!",
		"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
	},
}

-- =========================
-- general playroutine support
musicInitialized = false
currentSongOrder = 0
lastPlayingFrame = -1
backBufferIsA = false -- A means patterns 0,1,2,3; B = 4,5,6,7
stopPlayingOnNextFrame = false
local PATTERN_BUFFER_BYTES = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
local bufferALocation = 0x11164 -- pointer to first pattern https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
local bufferBLocation = bufferALocation + PATTERN_BUFFER_BYTES -- pointer to pattern 4

-- base85 decode (ASCII85-style) for TIC-80 Lua
-- Will become your compressed byte stream (before RLE3 decode)
-- local bytes = base85_decode_to_bytes(PAT0_B85, COMPRESSED_LEN)
-- returns array of byte values
function base85_decode_to_bytes(s, expectedLen)
	-- Alphabet: chars with codes 33..117 ('!'..'u')
	local BASE85_RADIX = 85
	local BASE85_OFFSET = 33

	local n = #s
	if n % 5 ~= 0 then
		error("base85_decode_to_bytes: input length not multiple of 5")
	end

	local bytes = {}
	local outCount = 0
	local i = 1

	while i <= n do
		local v = 0

		-- Read 5 base85 chars -> 32-bit value
		for j = 1, 5 do
			local c = s:byte(i)
			i = i + 1
			local digit = c - BASE85_OFFSET
			if digit < 0 or digit >= BASE85_RADIX then
				error("base85_decode_to_bytes: invalid base85 char")
			end
			v = v * BASE85_RADIX + digit
		end

		-- Extract 4 bytes (big-endian)
		local b0 = math.floor(v / 16777216) % 256 -- 256^3
		local b1 = math.floor(v / 65536) % 256 -- 256^2
		local b2 = math.floor(v / 256) % 256 -- 256^1
		local b3 = v % 256 -- 256^0

		-- Append, but don't exceed expectedLen
		local remaining = expectedLen - outCount
		if remaining <= 0 then
			break
		end

		if remaining >= 1 then
			bytes[#bytes + 1] = b0
			outCount = outCount + 1
		end
		if remaining >= 2 then
			bytes[#bytes + 1] = b1
			outCount = outCount + 1
		end
		if remaining >= 3 then
			bytes[#bytes + 1] = b2
			outCount = outCount + 1
		end
		if remaining >= 4 then
			bytes[#bytes + 1] = b3
			outCount = outCount + 1
		end
	end

	if outCount ~= expectedLen then
		error("base85_decode_to_bytes: decoded length mismatch")
	end

	return bytes
end

local function getSongOrderCount()
	return #MUSIC_DATA.songOrder
end

-- demo version:
local function swapInPlayorder(songPosition0b, destPointer)
	patternIndex0b = MUSIC_DATA.songOrder[songPosition0b + 1]
	patternString = MUSIC_DATA.patterns[patternIndex0b + 1]
	local patternLengthBytes = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
	patternBytes = base85_decode_to_bytes(patternString, patternLengthBytes)
	for i = 0, patternLengthBytes - 1 do
		poke(destPointer + i, patternBytes[i + 1])
	end
end

-- =========================
-- general playroutine support

local function getBufferPointer()
	if backBufferIsA then
		return bufferALocation
	else
		return bufferBLocation
	end
end

local function clearPatternBuffer(destPointer)
	for i = 0, PATTERN_BUFFER_BYTES - 1 do
		poke(destPointer + i, 0)
	end
end

tf_music_reset_state = function()
	currentSongOrder = 0
	lastPlayingFrame = -1
	backBufferIsA = false
	stopPlayingOnNextFrame = false
	--ch_set_playroutine_regs(0xFF)
end

tf_music_reset_state()

-- init state and begin playback from start
tf_music_init = function(songPosition, startRow)
	songPosition = songPosition or 0
	startRow = startRow or 0

	-- seed state
	currentSongOrder = songPosition
	backBufferIsA = true -- act like we came from buffer B so tick() will set it correctly on first pass.
	lastPlayingFrame = -1 -- this means tick() will immediately seed the back buffer.
	stopPlayingOnNextFrame = false

	local patternIndex = swapInPlayorder(currentSongOrder, bufferALocation)

	--ch_set_playroutine_regs(currentSongOrder)

	music(
		0, -- track
		0, -- frame
		startRow, -- row
		false, -- loop
		true -- sustain
	)
end

local function get_music_pos()
	local track = peek(0x13FFC)
	local frame = peek(0x13FFD)
	if track == 255 then
		track = -1
	end -- stopped / none
	return track, frame
end

function tf_music_tick()
	local track, currentFrame = get_music_pos()

	if track == -1 then
		return -- not playing
	end

	if currentFrame == lastPlayingFrame then
		return
	end

	if stopPlayingOnNextFrame then
		music() -- stops playback.
		tf_music_reset_state()
		return
	end

	backBufferIsA = not backBufferIsA
	lastPlayingFrame = currentFrame
	--ch_set_playroutine_regs(currentSongOrder) -- the queued pattern is now playing; inform host.
	currentSongOrder = currentSongOrder + 1

	local destPointer = getBufferPointer()
	local orderCount = getSongOrderCount()

	if orderCount == 0 or currentSongOrder >= orderCount then
		clearPatternBuffer(destPointer)
		stopPlayingOnNextFrame = true
		return
	end

	local patternIndex = swapInPlayorder(currentSongOrder, destPointer)
end

-- =========================
-- TIC loop
-- =========================
function TIC()
	if not musicInitialized then
		tf_music_init(0, 0)
		musicInitialized = true
	end

	tf_music_tick()
	cls(0)
	print("Somatic", 84, 68, 12)
end
