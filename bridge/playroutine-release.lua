-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
	songOrder = { 0, 3, 2 },
	patternLengths = {
		-- (pattern lengths here ...)
	},
	patterns = {
		-- (base85 encoded patterns here ...)
	},
}
-- END_SOMATIC_MUSIC_DATA

do
	local initialized = false
	local currentSongOrder = 0 -- the "back buffer"
	local playingSongOrder = 0 -- the "front buffer"
	local lastPlayingFrame = -1
	local backBufferIsA = false
	local stopPlayingOnNextFrame = false
	local PATTERN_BUFFER_BYTES = 192 * 4
	local bufferALocation = 0x11164
	local bufferBLocation = bufferALocation + PATTERN_BUFFER_BYTES

	local function base85_decode_to_mem(s, n, d)
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

	local function lzdec_mem(src, srcLen, dst)
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

	local function getSongOrderCount()
		return #SOMATIC_MUSIC_DATA.songOrder
	end

	local function swapInPlayorder(songPosition0b, destPointer)
		local patternIndex0b = SOMATIC_MUSIC_DATA.songOrder[songPosition0b + 1]
		local patternString = SOMATIC_MUSIC_DATA.patterns[patternIndex0b + 1]
		local patternLengthBytes = SOMATIC_MUSIC_DATA.patternLengths[patternIndex0b + 1]

		local TEMP_DECODE_BUFFER = 0x13B60 -- put temp buffer towards end of the pattern memory
		local decodedLen = base85_decode_to_mem(patternString, patternLengthBytes, TEMP_DECODE_BUFFER)
		local decompressedLen = lzdec_mem(TEMP_DECODE_BUFFER, decodedLen, destPointer)
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
		music(0, 0, startRow, true, true)
	end

	function somatic_get_state()
		local track = peek(0x13FFC)
		local frame = peek(0x13FFD)
		local row = peek(0x13FFE)
		if track == 255 then
			track = -1
		end
		return track, playingSongOrder, frame, row
	end

	function somatic_tick()
		if not initialized then
			somatic_init(0, 0)
			initialized = true
		end
		local track, _, currentFrame = somatic_get_state()
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
		playingSongOrder = currentSongOrder
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
	-- "track" is -1 otherwise kinda worthless
	-- "playingSongOrder" is the song order index of the pattern currently being played (0-255)
	-- "currentFrame" is the TIC-80 internal frame counter; kinda worthless.
	-- "currentRow" is the current row within the pattern being played (0-63).
	local track, playingSongOrder, currentFrame, currentRow = somatic_get_state()
	print(string.format("t:%d ord:%d f:%d r:%d", track, playingSongOrder, currentFrame, currentRow), 60, y, 6)
end
