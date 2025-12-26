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

	-- Wave morphing (music playback only)
	local SFX_CHANNELS = 4
	local ch_sfx_id = { -1, -1, -1, -1 }
	local ch_sfx_ticks = { 0, 0, 0, 0 }
	local last_music_track = -2
	local last_music_frame = -1
	local last_music_row = -1

	local morphMap = (SOMATIC_MUSIC_DATA and SOMATIC_MUSIC_DATA.instrumentMorphMap) or {}

	local WAVE_BASE = 0x0FFE4
	local WAVE_BYTES_PER_WAVE = 16 -- 32x 4-bit samples packed 2-per-byte
	local TRACKS_BASE = 0x13E64
	local PATTERNS_BASE = 0x11164
	local TRACK_BYTES_PER_TRACK = 51
	local PATTERN_BYTES_PER_PATTERN = 192
	local ROW_BYTES = 3

	local function clamp01(x)
		if x < 0 then
			return 0
		elseif x > 1 then
			return 1
		end
		return x
	end

	local function lerp_nibble(a, b, t)
		local v = a + (b - a) * t
		if v < 0 then
			v = 0
		elseif v > 15 then
			v = 15
		end
		return math.floor(v + 0.5)
	end

	function LerpWaveform(waveAIndex, waveBIndex, targetWaveIndex, t)
		t = clamp01(t or 0)
		local aBase = WAVE_BASE + waveAIndex * WAVE_BYTES_PER_WAVE
		local bBase = WAVE_BASE + waveBIndex * WAVE_BYTES_PER_WAVE
		local dstBase = WAVE_BASE + targetWaveIndex * WAVE_BYTES_PER_WAVE
		for i = 0, WAVE_BYTES_PER_WAVE - 1 do
			local ba = peek(aBase + i)
			local bb = peek(bBase + i)
			local a0 = ba & 0x0f
			local a1 = (ba >> 4) & 0x0f
			local b0 = bb & 0x0f
			local b1 = (bb >> 4) & 0x0f
			local o0 = lerp_nibble(a0, b0, t)
			local o1 = lerp_nibble(a1, b1, t)
			poke(dstBase + i, (o1 << 4) | o0)
		end
	end

	local function read_morph_cfg(instId)
		local cfg = morphMap and morphMap[instId]
		if not cfg then
			return nil
		end
		return cfg.sourceWaveformIndex, cfg.morphWaveB, cfg.renderWaveformSlot, cfg.morphDurationInTicks
	end

	local function prime_morph_slot_for_note_on(instId)
		local waveA, waveB, slot, _dur = read_morph_cfg(instId)
		if waveA == nil then
			return
		end
		LerpWaveform(waveA, waveB, slot, 0.0)
	end

	local function decode_track_frame_patterns(trackIndex, frameIndex)
		if trackIndex == nil or trackIndex < 0 then
			return 0, 0, 0, 0
		end
		local base = TRACKS_BASE + trackIndex * TRACK_BYTES_PER_TRACK + frameIndex * 3
		local b0 = peek(base)
		local b1 = peek(base + 1)
		local b2 = peek(base + 2)
		local packed = b0 + b1 * 256 + b2 * 65536
		local p0 = packed & 0x3f
		local p1 = (packed >> 6) & 0x3f
		local p2 = (packed >> 12) & 0x3f
		local p3 = (packed >> 18) & 0x3f
		return p0, p1, p2, p3
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

	local function apply_music_row_to_sfx_state(track, frame, row)
		if track == last_music_track and frame == last_music_frame and row == last_music_row then
			return
		end
		last_music_track = track
		last_music_frame = frame
		last_music_row = row

		local p0, p1, p2, p3 = decode_track_frame_patterns(track, frame)
		local patterns = { p0, p1, p2, p3 }

		for ch = 0, SFX_CHANNELS - 1 do
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
				prime_morph_slot_for_note_on(inst)
			end
		end
	end

	local function morph_tick_channel(ch)
		local instId = ch_sfx_id[ch + 1]
		if instId == -1 then
			return
		end

		local ticksPlayed = ch_sfx_ticks[ch + 1]
		local waveA, waveB, slot, durationTicks = read_morph_cfg(instId)
		if waveA == nil then
			ch_sfx_ticks[ch + 1] = ticksPlayed + 1
			return
		end
		local t
		if durationTicks == nil or durationTicks <= 0 then
			t = 1.0
		else
			t = clamp01(ticksPlayed / durationTicks)
		end
		LerpWaveform(waveA, waveB, slot, t)
		ch_sfx_ticks[ch + 1] = ticksPlayed + 1
	end

	local function tf_music_morph_tick(track, frame, row)
		apply_music_row_to_sfx_state(track, frame, row)
		for ch = 0, SFX_CHANNELS - 1 do
			morph_tick_channel(ch)
		end
	end

	function somatic_get_channel_state(ch)
		return ch_sfx_id[ch + 1], ch_sfx_ticks[ch + 1]
	end

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
		local track, _, currentFrame, row = somatic_get_state()
		if track == -1 then
			return
		end
		tf_music_morph_tick(track, currentFrame, row)
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
	y = y + 8
	for ch = 0, 3 do
		local sid, ticks = somatic_get_channel_state(ch)
		print(string.format("ch%d sfx:%d t:%d", ch, sid, ticks), 60, y, 12)
		y = y + 8
	end
end
