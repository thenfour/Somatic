-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
	songOrder = { 0, 3, 2 },
	patterns = {
		"#lnB?!'pSb!!!!!!!!!!!!!!!!!!!!#lm6k!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!(!'pSb!!`Ki!!!!!!!!6(5l^lb!!!!(!'pSb!!!!!#67$i!!!6(5l^lb!!!!!!!!6(5l^lb!!!!(!'pSb!!!!!#67$i!!!!!!!`Ki!!!!!!!!6(5l^lb!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki#67$i!!!!!!!`Ki!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9;j1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9>+q!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"#67$i!!!6(5l^lb!!!!(!'pSb!!!!!!!!!(!'pSb!!!!!#67$i!!!6(5l^lb#67$p!'pSb!!`Ki#67%\"!+?*45n3m'#67$i!!!!!!!`Ki%KKo;!!!!!!!`Ki%KKoB!'q(p@0Zcu!!!!(!'pSb!\"K!;#67$p!'pSb!!!!!#67%\"!+>j-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9;j1!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"9<uQ!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\"TX)R!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"#67$i!!!0&@K6B.!!!!(!'pSb!!!!!%feor!!!N063dKV!!!!!!!!!!!!!!!%feor!!!!!!!!!!!!!!!!!!6(5l^lb!!!!!!!!!!!!!!!%feor!!!!!!!!!!!!!!!!!!!!!!`Ki!!!!!!!!!!!\"T&r!!!!!!!!!!!!!!!!!!!(!'pSb!!!!!!!!!!!!!!!!\"T&r!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!0!($Yc!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#6804!!!!!!!!!!!!!!!!!!!!!!!!!",
		"%felq!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!&!+>j-!!!!!!!!!!!!!!!!!!!!#9Z;4!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%KKo;!!!!!!!!!!!!!!!!!!!!!!!!!#67$i!!!!!!\"T&q!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0+@,u-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!N@2!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!E:Q!!!!!!!!!!!!!!!#lm6k!!!!!!!!!!!!!!!!!!!!!!N@2!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!%felq!!!!!!!!!!!!!!!!!!N05l^lb!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!-!'pSb!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0&@/p9-%KJcp!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`Ki!!!!!!!!!!!!`Ki!!!!!!!!!!!!!!!!!!!!!!!0&@/p9-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!&!+>j-!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!0&@0Zcu%fem!!+?B<5mIBU\"TVsA!'phi5m76s!!!!!!!!!!!!!!!",
		"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
	},
}
-- END_SOMATIC_MUSIC_DATA

-- Debug logging
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
	local count = #SOMATIC_MUSIC_DATA.songOrder
	log("getSongOrderCount: " .. tostring(count))
	return count
end

-- demo version:
local function swapInPlayorder(songPosition0b, destPointer)
	patternIndex0b = SOMATIC_MUSIC_DATA.songOrder[songPosition0b + 1]
	patternString = SOMATIC_MUSIC_DATA.patterns[patternIndex0b + 1]
	local patternLengthBytes = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
	log(string.format("swapIn: pos=%d pat=%d len=%d", songPosition0b, patternIndex0b, #patternString))
	patternBytes = base85_decode_to_bytes(patternString, patternLengthBytes)

	-- Calculate checksum for debugging
	local checksum = 0
	for i = 1, #patternBytes do
		checksum = checksum + patternBytes[i]
	end
	log(string.format("Pattern checksum: %d (bytes: %d)", checksum, #patternBytes))

	-- Log first few bytes of pattern data
	local sampleBytes = {}
	for i = 1, math.min(12, #patternBytes) do
		sampleBytes[i] = string.format("%02X", patternBytes[i])
	end
	log(string.format("First bytes: %s", table.concat(sampleBytes, " ")))

	for i = 0, patternLengthBytes - 1 do
		poke(destPointer + i, patternBytes[i + 1])
	end
	sync(24, 0, true)
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
	log("tf_music_reset_state")
	--ch_set_playroutine_regs(0xFF)
end

tf_music_reset_state()

-- init state and begin playback from start
tf_music_init = function(songPosition, startRow)
	songPosition = songPosition or 0
	startRow = startRow or 0

	log(string.format("tf_music_init: pos=%d row=%d", songPosition, startRow))

	-- Initialize audio system - set master volume and enable all channels
	-- Master volume is at 0x14000 (range 0-15)
	poke(0x14000, 15)
	log("Set master volume to 15")

	-- Channel volumes at 0x14001-0x14004 (range 0-15 each)
	for ch = 0, 3 do
		poke(0x14001 + ch, 15)
	end
	log("Set all channel volumes to 15")

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
	log("tf_music_init: music() called")

	-- Verify what's actually in memory at pattern 0
	local verifyBytes = {}
	for i = 0, 11 do
		verifyBytes[i + 1] = string.format("%02X", peek(bufferALocation + i))
	end
	log(string.format("Memory verify: %s", table.concat(verifyBytes, " ")))
end

local function get_music_pos()
	local track = peek(0x13FFC)
	local frame = peek(0x13FFD)
	local row = peek(0x13FFE)

	if track == 255 then
		track = -1
	end -- stopped / none

	return track, frame, row
end

function tf_music_tick()
	local track, currentFrame = get_music_pos()

	if track == -1 then
		return -- not playing
	end

	if currentFrame == lastPlayingFrame then
		return
	end

	log(string.format("tick: frm=%d last=%d", currentFrame, lastPlayingFrame))

	if stopPlayingOnNextFrame then
		log("tick: stopping")
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

	log(string.format("tick: advance to=%d count=%d", currentSongOrder, orderCount))

	if orderCount == 0 or currentSongOrder >= orderCount then
		log("tick: end of song")
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
		log("Initializing music...")
		tf_music_init(0, 0)
		musicInitialized = true
	end

	tf_music_tick()
	cls(0)
	local y = 2
	print("PLAYROUTINE TEST", 52, y, 12)
	y = y + 8
	local track, currentFrame, currentRow = get_music_pos()
	print(string.format("t:%d f:%d r:%d", track, currentFrame, currentRow), 60, y, 6)
	y = y + 8
	print(
		string.format(
			"ord:%d buf:%s stop:%s",
			currentSongOrder,
			tostring(backBufferIsA),
			tostring(stopPlayingOnNextFrame)
		),
		2,
		y,
		11
	)
	y = y + 10

	-- Show logs
	print("LOGS:", 2, y, 14)
	y = y + 8
	for i = math.min(#log_lines, LOG_LINES), 1, -1 do
		local logY = y + (LOG_LINES - i) * 6
		if logY < 136 then
			print(log_lines[i], 2, logY, 15)
		end
	end
end
