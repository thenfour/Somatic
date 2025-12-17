-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
	songOrder = { 0, 3, 2 },
	patterns = {
		-- (base85 encoded patterns here ...)
	},
}
-- END_SOMATIC_MUSIC_DATA

do
	local initialized = false
	local currentSongOrder = 0
	local lastPlayingFrame = -1
	local backBufferIsA = false
	local stopPlayingOnNextFrame = false
	local PATTERN_BUFFER_BYTES = 192 * 4
	local bufferALocation = 0x11164
	local bufferBLocation = bufferALocation + PATTERN_BUFFER_BYTES

	function base85_decode_to_bytes(s, expectedLen)
		local RADIX, OFFSET = 85, 33
		local bytes, outCount = {}, 0
		local n, i = #s, 1

		while i <= n and outCount < expectedLen do
			local v = 0
			for _ = 1, 5 do
				local c = s:byte(i)
				i = i + 1
				local d = c - OFFSET
				v = v * RADIX + d
			end

			for shift = 3, 0, -1 do
				if outCount >= expectedLen then
					break
				end
				bytes[#bytes + 1] = math.floor(v / (256 ^ shift)) % 256
				outCount = outCount + 1
			end
		end

		return bytes
	end

	local function getSongOrderCount()
		return #SOMATIC_MUSIC_DATA.songOrder
	end

	local function swapInPlayorder(songPosition0b, destPointer)
		local patternIndex0b = SOMATIC_MUSIC_DATA.songOrder[songPosition0b + 1]
		local patternString = SOMATIC_MUSIC_DATA.patterns[patternIndex0b + 1]
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

	local function reset_state()
		currentSongOrder = 0
		lastPlayingFrame = -1
		backBufferIsA = false
		stopPlayingOnNextFrame = false
	end

	local function somatic_init(songPosition, startRow)
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

	function somatic_get_state()
		local track = peek(0x13FFC)
		local frame = peek(0x13FFD)
		local row = peek(0x13FFE)
		if track == 255 then
			track = -1
		end
		return track, frame, row
	end

	function somatic_tick()
		if not initialized then
			somatic_init(0, 0)
			initialized = true
		end
		local track, currentFrame = somatic_get_state()
		if track == -1 then
			return
		end
		if currentFrame == lastPlayingFrame then
			return
		end
		if stopPlayingOnNextFrame then
			music()
			reset_state()
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
end -- do

function TIC()
	somatic_tick()

	cls(0)
	local y = 2
	print("PLAYROUTINE TEST", 52, y, 12)
	y = y + 8
	local track, currentFrame, currentRow = somatic_get_state()
	print(string.format("t:%d f:%d r:%d", track, currentFrame, currentRow), 60, y, 6)
end
