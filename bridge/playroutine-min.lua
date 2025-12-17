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
-- END_SOMATIC_MUSIC_DATA

musicInitialized = false
currentSongOrder = 0
lastPlayingFrame = -1
backBufferIsA = false
stopPlayingOnNextFrame = false
local PATTERN_BUFFER_BYTES = 192 * 4
local bufferALocation = 0x11164
local bufferBLocation = bufferALocation + PATTERN_BUFFER_BYTES

function base85_decode_to_bytes(s, expectedLen)
	-- Alphabet: chars with codes 33..117 ('!'..'u')
	local BASE85_RADIX = 85
	local BASE85_OFFSET = 33
	local n = #s
	local bytes = {}
	local outCount = 0
	local i = 1
	while i <= n do
		local v = 0
		for j = 1, 5 do
			local c = s:byte(i)
			i = i + 1
			local digit = c - BASE85_OFFSET
			v = v * BASE85_RADIX + digit
		end
		local b0 = math.floor(v / 16777216) % 256
		local b1 = math.floor(v / 65536) % 256
		local b2 = math.floor(v / 256) % 256
		local b3 = v % 256
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
	return bytes
end

local function getSongOrderCount()
	return #MUSIC_DATA.songOrder
end

local function swapInPlayorder(songPosition0b, destPointer)
	local patternIndex0b = MUSIC_DATA.songOrder[songPosition0b + 1]
	local patternString = MUSIC_DATA.patterns[patternIndex0b + 1]
	local patternLengthBytes = 192 * 4
	local patternBytes = base85_decode_to_bytes(patternString, patternLengthBytes)
	for i = 0, patternLengthBytes - 1 do
		poke(destPointer + i, patternBytes[i + 1])
	end
	sync(24, 0, true)
end

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
end

tf_music_reset_state()

tf_music_init = function(songPosition, startRow)
	songPosition = songPosition or 0
	startRow = startRow or 0
	poke(0x14000, 15)
	for ch = 0, 3 do
		poke(0x14001 + ch, 15)
	end
	currentSongOrder = songPosition
	backBufferIsA = true
	lastPlayingFrame = -1
	stopPlayingOnNextFrame = false
	swapInPlayorder(currentSongOrder, bufferALocation)
	music(0, 0, startRow, false, true)
end

local function get_music_pos()
	local track = peek(0x13FFC)
	local frame = peek(0x13FFD)
	local row = peek(0x13FFE)
	if track == 255 then
		track = -1
	end
	return track, frame, row
end

function tf_music_tick()
	local track, currentFrame = get_music_pos()
	if track == -1 then
		return
	end
	if currentFrame == lastPlayingFrame then
		return
	end
	if stopPlayingOnNextFrame then
		music()
		tf_music_reset_state()
		return
	end
	backBufferIsA = not backBufferIsA
	lastPlayingFrame = currentFrame
	currentSongOrder = currentSongOrder + 1
	local destPointer = getBufferPointer()
	local orderCount = getSongOrderCount()
	if orderCount == 0 or currentSongOrder >= orderCount then
		clearPatternBuffer(destPointer)
		stopPlayingOnNextFrame = true
		return
	end
	swapInPlayorder(currentSongOrder, destPointer)
end

function TIC()
	if not musicInitialized then
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
end
