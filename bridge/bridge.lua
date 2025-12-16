-- TIC-80 orchestration bridge

local ADDR = {
	-- NB: KEEP IN SYNC WITH HOST (search FOR "BRIDGE_MEMORY_MAP")
	-- https://tic80.com/learn <-- memory map of tic80
	-- another candidate is at 0x14004 which is 1kb of "persistent memory"
	MARKER = 0x14E24, -- beginning of reserved region; 12764 bytes free
	REGISTERS = 0x14E40, -- 0x40 bytes for internal registers
	INBOX = 0x14E80, -- 0x40 bytes for incoming args
	OUTBOX = 0x14EC0, -- for strings, this is bigger than inbox (~256 bytes)

	TF_ORDER_LIST_COUNT = 0x8000, --   // MAP_BASE + 0
	TF_ORDER_LIST_ENTRIES = 0x8001, -- // MAP_BASE + 1 -- max 256 entries
	TF_PATTERN_DATA = 0x8101, --       // MAP_BASE + 256 // theoretically you can support the whole map area for pattern data (32640 bytes).
}

-- Host->cart synchronization registers (mutex-ish)
-- The host sets BUSY=1 while writing a payload, then bumps SEQ and clears BUSY.
-- The cart only reads when BUSY=0 and SEQ has changed.
local INBOX = {
	CMD = ADDR.INBOX + 0,
	TRACK = ADDR.INBOX + 1,
	FRAME = ADDR.INBOX + 2,
	ROW = ADDR.INBOX + 3,
	LOOP = ADDR.INBOX + 4,
	SUSTAIN = ADDR.INBOX + 5,
	TEMPO = ADDR.INBOX + 6,
	SPEED = ADDR.INBOX + 7,
	HOST_ACK = ADDR.INBOX + 8,
	MUTEX = ADDR.INBOX + 12, -- non-zero while host is writing
	SEQ = ADDR.INBOX + 13, -- increments per host write
	TOKEN = ADDR.INBOX + 14, -- host increments per command; echoed back on completion
}

local CH_REGISTERS = {
	-- NB: KEEP IN SYNC WITH HOST (search FOR "BRIDGE_MEMORY_MAP")
	SONG_POSITION = ADDR.REGISTERS + 0, -- current song position (0..255)
	PATTERN_ID = ADDR.REGISTERS + 1, -- current pattern id (0..255)
}

-- Cart->host synchronization registers (mirrors the above for OUTBOX)
local OUTBOX = {
	MAGIC = ADDR.OUTBOX + 0,
	VERSION = ADDR.OUTBOX + 1,
	HEARTBEAT = ADDR.OUTBOX + 2,
	STATE_FLAGS = ADDR.OUTBOX + 3,
	PLAYING_TRACK = ADDR.OUTBOX + 4,
	LAST_CMD = ADDR.OUTBOX + 5,
	LAST_CMD_RESULT = ADDR.OUTBOX + 6,
	LOG_WRITE_PTR = ADDR.OUTBOX + 7,
	LOG_DROPPED = ADDR.OUTBOX + 8,
	RESERVED_9 = ADDR.OUTBOX + 9,
	RESERVED_10 = ADDR.OUTBOX + 10,
	RESERVED_11 = ADDR.OUTBOX + 11,
	MUTEX = ADDR.OUTBOX + 12, -- non-zero while cart is writing a log
	SEQ = ADDR.OUTBOX + 13, -- increments per log write
	TOKEN = ADDR.OUTBOX + 14, -- cart echoes host token when finishing a cmd
	LOG_BASE = ADDR.OUTBOX + 16,
	LOG_SIZE = 240, -- keep small & simple (fits in reserved region)
}

local MARKER = "CHROMATIC_TIC80_V1" -- 17 bytes; host scans for this at MARKER

-- =========================
-- OUTBOX layout (cart -> host)
-- =========================
-- OUTBOX.MAGIC        : 'B' (0x42) magic
-- OUTBOX.VERSION      : version (1)
-- OUTBOX.HEARTBEAT    : heartbeat (increments every TIC)
-- OUTBOX.STATE_FLAGS  : stateFlags (bit0 = isPlaying)
-- OUTBOX.PLAYING_TRACK: playingTrack (0..7)
-- OUTBOX.LAST_CMD     : lastCmd (0..255)
-- OUTBOX.LAST_CMD_RESULT : lastCmdResult (0=ok, nonzero=error-ish)
-- OUTBOX.LOG_WRITE_PTR: logWritePtr (0..LOG_SIZE-1)
-- OUTBOX.LOG_DROPPED  : logDroppedCount (0..255 wraps)
-- OUTBOX.RESERVED_9   : reserved
-- OUTBOX.RESERVED_10  : reserved
-- OUTBOX.RESERVED_11  : reserved
-- OUTBOX.MUTEX        : OUTBOX mutex (cart sets non-zero while writing an entry)
-- OUTBOX.SEQ          : OUTBOX seq (increments on each entry written)
-- OUTBOX.TOKEN        : echoed host token when finishing a command
-- OUTBOX.LOG_BASE .. LOG_BASE+LOG_SIZE-1 : outbox command ring buffer
--
-- Entry format: [cmd][len][payload...]; wrap marker is cmd=0,len=0.
local LOG_CMD_LOG = 1 -- log message to host

-- Log stream format (ring buffer):
-- Each entry: [len][ascii bytes...]
-- len is 0..31 (we clamp). Host can decode by walking from its own readPtr to current writePtr.

-- =========================
-- =========================
-- INBOX.CMD     : cmd  (0=NOP, 1=PLAY, 2=STOP, 3=PING/FX)
-- INBOX.TRACK   : track (0..7)
-- INBOX.FRAME   : frame (0..15)
-- INBOX.ROW     : row   (0..63)
-- INBOX.LOOP    : loop (0/1)
-- INBOX.SUSTAIN : sustain (0/1)
-- INBOX.TEMPO   : tempo (0=default)
-- INBOX.SPEED   : speed (0=default)
-- INBOX.HOST_ACK: hostAck (optional; host may write its logReadPtr here if you want)
-- INBOX + 9..   : reserved

-- =========================
-- Marker
-- =========================
local function write_marker()
	for i = 1, #MARKER do
		poke(ADDR.MARKER + (i - 1), string.byte(MARKER, i))
	end
end

-- =========================
-- OUTBOX helpers
-- =========================
local function out_set(addr, v)
	poke(addr, v & 0xFF)
end
local function out_get(addr)
	return peek(addr)
end

local function out_init()
	out_set(OUTBOX.MAGIC, 0x42) -- 'B' -- important for host to detect presence of memory.
	out_set(OUTBOX.VERSION, 1)
	out_set(OUTBOX.HEARTBEAT, 0)
	out_set(OUTBOX.STATE_FLAGS, 0)
	out_set(OUTBOX.PLAYING_TRACK, 0)
	out_set(OUTBOX.LAST_CMD, 0)
	out_set(OUTBOX.LAST_CMD_RESULT, 0)
	out_set(OUTBOX.LOG_WRITE_PTR, 0)
	out_set(OUTBOX.LOG_DROPPED, 0)
	out_set(OUTBOX.MUTEX, 0)
	out_set(OUTBOX.SEQ, 0)
	out_set(OUTBOX.TOKEN, 0)
end

local function log_drop()
	out_set(OUTBOX.LOG_DROPPED, (out_get(OUTBOX.LOG_DROPPED) + 1) & 0xFF)
end

local function log_write_ascii(s)
	trace("TIC80: " .. s)
	out_set(OUTBOX.MUTEX, 1)

	-- Clamp payload so entries stay small and parsing is trivial
	local n = #s
	if n > 31 then
		n = 31
	end

	local wp = out_get(OUTBOX.LOG_WRITE_PTR)

	local needed = 2 + n -- cmd + len + payload

	-- If we would wrap across end, write wrap marker and reset
	if wp + needed >= OUTBOX.LOG_SIZE then
		poke(OUTBOX.LOG_BASE + wp + 0, 0) -- cmd=0 wrap marker
		poke(OUTBOX.LOG_BASE + wp + 1, 0)
		wp = 0
	end

	-- If still no room (LOG_SIZE too small), drop
	if needed >= OUTBOX.LOG_SIZE then
		out_set(OUTBOX.MUTEX, 0)
		log_drop()
		return
	end

	-- write entry
	poke(OUTBOX.LOG_BASE + wp + 0, LOG_CMD_LOG)
	poke(OUTBOX.LOG_BASE + wp + 1, n)
	for i = 1, n do
		poke(OUTBOX.LOG_BASE + wp + 1 + i, string.byte(s, i))
	end

	wp = wp + needed
	out_set(OUTBOX.LOG_WRITE_PTR, wp & 0xFF)
	out_set(OUTBOX.SEQ, (out_get(OUTBOX.SEQ) + 1) & 0xFF)
	out_set(OUTBOX.MUTEX, 0)
end

-- Also show some recent logs on-screen for sanity
local LOG_LINES = 6
local log_lines = {}
local log_serial = 0
local function log_screen(s)
	-- ring of strings for display
	table.insert(log_lines, 1, s)
	if #log_lines > LOG_LINES then
		table.remove(log_lines)
	end
end

local function log(s)
	log_serial = log_serial + 1
	local prefix = string.format("[%03d] ", log_serial)
	log_write_ascii(prefix .. s)
	log_screen(prefix .. s)
end

-- =========================
-- State
-- =========================
local t = 0
local booted = false
local fps = 0
local fps_last_time = 0
local fps_frame_count = 0

local isPlaying = false
local playingTrack = 0
local lastCmd = 0
local lastCmdResult = 0
local host_last_seq = 0
local CMD_PLAY = 1
local CMD_STOP = 2
local CMD_PING = 3
local CMD_BEGIN_UPLOAD = 4
local CMD_END_UPLOAD = 5
local CMD_PLAY_SFX_ON = 6
local CMD_PLAY_SFX_OFF = 7

local function set_playing(track, playing)
	isPlaying = playing
	playingTrack = track or playingTrack

	local flags = 0
	if isPlaying then
		flags = flags | 0x01
	end

	out_set(OUTBOX.STATE_FLAGS, flags)
	out_set(OUTBOX.PLAYING_TRACK, playingTrack & 0xFF)
end

local function publish_cmd(cmd, result)
	lastCmd = cmd
	lastCmdResult = result or 0
	out_set(OUTBOX.LAST_CMD, lastCmd & 0xFF)
	out_set(OUTBOX.LAST_CMD_RESULT, lastCmdResult & 0xFF)
	out_set(OUTBOX.TOKEN, peek(INBOX.TOKEN))
end

-- =========================
-- Commands
-- =========================
local function handle_play()
	local track = peek(INBOX.TRACK)
	local frame = peek(INBOX.FRAME)
	local row = peek(INBOX.ROW)
	local loop = peek(INBOX.LOOP) ~= 0
	local sustain = peek(INBOX.SUSTAIN) ~= 0
	local tempo = peek(INBOX.TEMPO)
	local speed = peek(INBOX.SPEED)

	-- Defensive clamps (so garbage commands don't crash your bridge behavior)
	if track > 7 then
		track = 7
	end
	if frame > 15 then
		frame = 15
	end
	if row > 63 then
		row = 63
	end

	if tempo == 0 and speed == 0 then
		music(track, frame, row, loop, sustain)
	else
		music(track, frame, row, loop, sustain, tempo, speed)
	end

	set_playing(track, true)
	publish_cmd(1, 0)
	log(
		string.format(
			"PLAY tr=%d f=%d r=%d L=%d S=%d T=%d Sp=%d",
			track,
			frame,
			row,
			loop and 1 or 0,
			sustain and 1 or 0,
			tempo,
			speed
		)
	)
end

local function handle_stop()
	music()
	set_playing(playingTrack, false)
	publish_cmd(CMD_STOP, 0)
	log("STOP")
end

local function handle_ping_fx()
	-- Simple visible acknowledgement + log
	publish_cmd(CMD_PING, 0)
	log("PING/FX")
end

local function handle_play_sfx_on()
	local sfx_id = peek(INBOX.TRACK)
	local note = peek(INBOX.FRAME)
	local channel = peek(INBOX.ROW) & 0x03
	local speed = peek(INBOX.LOOP) - 4 -- subtract 4 to get signed speed in the requisite range -4..+3
	-- Clamp to valid ranges for TIC sfx API
	if note > 95 then
		note = 95
	end

	if sfx_id > 63 then
		sfx_id = 63
	end

	if speed < -4 then
		speed = -4
	elseif speed > 3 then
		speed = 3
	end

	-- id, note, duration (-1 = sustained), channel 0..3, volume 15, speed 0
	sfx(sfx_id, note, -1, channel, 15, speed)
	publish_cmd(CMD_PLAY_SFX_ON, 0)
	log(string.format("PLAY_SFX_ON id=%d note=%d ch=%d", sfx_id, note, channel))
end

local function handle_play_sfx_off()
	local channel = peek(INBOX.ROW) & 0x03
	-- id, note, duration (-1 = sustained), channel 0..3, volume 15, speed 0
	sfx(-1, 0, 0, channel)
	publish_cmd(CMD_PLAY_SFX_OFF, 0)
	log(string.format("PLAY_SFX_OFF ch=%d", channel))
end

local function handle_begin_upload()
	-- Stop any playback before host overwrites music data
	music()
	set_playing(playingTrack, false)
	publish_cmd(CMD_BEGIN_UPLOAD, 0)
	log("BEGIN_UPLOAD")
end

local function handle_end_upload()
	-- Force reload of music data
	-- https://github.com/nesbox/TIC-80/wiki/sync
	-- flags = 8 (sfx) + 16 (music) = 24
	-- bank = 0 (default)
	-- true means sync from runtime -> cart.
	sync(24, 0, true)
	publish_cmd(CMD_END_UPLOAD, 0)
	log("END_UPLOAD")
end

local function poll_inbox()
	-- If host is mid-write, ignore to avoid tearing
	if peek(INBOX.MUTEX) ~= 0 then
		return false
	end

	local seq = peek(INBOX.SEQ)
	if seq == host_last_seq then
		return false -- nothing new
	end
	host_last_seq = seq

	local cmd = peek(INBOX.CMD)
	if cmd == 0 then
		return false
	end

	if cmd == CMD_PLAY then
		handle_play()
	elseif cmd == CMD_STOP then
		handle_stop()
	elseif cmd == CMD_PING then
		handle_ping_fx()
	elseif cmd == CMD_BEGIN_UPLOAD then
		handle_begin_upload()
	elseif cmd == CMD_END_UPLOAD then
		handle_end_upload()
	elseif cmd == CMD_PLAY_SFX_ON then
		handle_play_sfx_on()
	elseif cmd == CMD_PLAY_SFX_OFF then
		handle_play_sfx_off()
	else
		publish_cmd(cmd, 1)
		log("UNKNOWN CMD " .. tostring(cmd))
	end

	-- Acknowledge: clear cmd so host can send next
	poke(INBOX.CMD, 0)
	return true
end

-- =========================
-- Visuals
-- =========================
local function draw_idle_anim()
	-- Small spinner/pulse in top-left so you always see life
	local cx, cy = 10, 10
	local phase = (t // 4) % 8
	local r = 6

	--circ(cx, cy, r, 1) -- ring
	for i = 0, 7 do
		local a = i * (math.pi * 2 / 8) + t * 0.02
		local px = cx + math.cos(a) * r
		local py = cy + math.sin(a) * r
		local col = (i == phase) and 12 or 5
		pix(px, py, col)
	end

	-- Pulse bar
	local w = 30
	local p = (t % 60) / 59
	rect(2, 22, w, 3, 5)
	rect(2, 22, math.floor(w * p), 3, isPlaying and 11 or 12)
end

local function get_music_pos()
	local track = peek(0x13FFC)
	local frame = peek(0x13FFD)
	local row = peek(0x13FFE)
	local flags = peek(0x13FFF)

	if track == 255 then
		track = -1
	end -- stopped / none

	local looping = (flags & 0x01) ~= 0 -- in newer builds

	return track, frame, row, looping
end

local function draw_status()
	local y = 2
	print("BRIDGE", 40, y, 12)
	y = y + 8
	print("fps:" .. tostring(fps), 40, y, 13)
	y = y + 8
	--print("hb:" .. tostring(out_get(OUTBOX.HEARTBEAT)), 40, y, 13)
	--y = y + 8
	print(isPlaying and ("PLAY tr:" .. playingTrack) or "IDLE", 40, y, isPlaying and 11 or 6)
	y = y + 8

	local track, frame, row, looping = get_music_pos()
	print(string.format("track:%d frame:%d row:%d loop:%s", track, frame, row, tostring(looping)), 40, y, 6)

	-- Recent logs
	for i = #log_lines, 1, -1 do
		print(log_lines[i], 2, 90 + (i - 1) * 8, 6)
	end
end

-- =========================
-- tracker-specific playroutine support

local function getSongOrderCount() {
	return peek(ADDR.TF_ORDER_LIST_COUNT)
}

local function swapInPlayorder(songPosition, destPointer) {
	local patternIndex = peek(ADDR.TF_ORDER_LIST_ENTRIES + songPosition)
	-- read the pattern pointer (3 bytes little-endian)
	-- at ADDR.TF_PATTERN_DATA
	-- * first byte is pattern count
	-- * then for N patterns, 3 bytes each little-endian offset.
	--   the offset is from the start of TF_PATTERN_DATA
	local patternPointerOffset = 1 + 1 + patternIndex * 3
	local b0 = peek(ADDR.TF_PATTERN_DATA + patternPointerOffset + 0)
	local b1 = peek(ADDR.TF_PATTERN_DATA + patternPointerOffset + 1)
	local b2 = peek(ADDR.TF_PATTERN_DATA + patternPointerOffset + 2)
	local patternPointer = b0 + (b1 << 8) + (b2 << 16) + ADDR.TF_PATTERN_DATA

--   patternPointer = peek(music patterns pointer list + patternIndex * 4)
--   copy 192 bytes * 4 channels from patternPointer to destPointer
end

}

-- =========================
-- demo-specific playroutine support

-- local TF_MUSIC_DATA = {
-- 	songOrder = {
-- 		0,1,
-- 	}, -- pattern indices (0-based)
-- 	patterns = { -- base85 encoded pattern data
-- 		"",
-- 		"",
-- 	},
-- }

-- -- base85 decode (ASCII85-style) for TIC-80 Lua
-- -- Will become your compressed byte stream (before RLE3 decode)
-- -- local bytes = base85_decode_to_bytes(PAT0_B85, COMPRESSED_LEN)
-- -- returns array of byte values
-- function base85_decode_to_bytes(s, expectedLen)
--    -- Alphabet: chars with codes 33..117 ('!'..'u')
--    local BASE85_RADIX  = 85
--    local BASE85_OFFSET = 33

--    local n = #s
--   if n % 5 ~= 0 then
--     error("base85_decode_to_bytes: input length not multiple of 5")
--   end

--   local bytes = {}
--   local outCount = 0
--   local i = 1

--   while i <= n do
--     local v = 0

--     -- Read 5 base85 chars -> 32-bit value
--     for j = 1, 5 do
--       local c = s:byte(i); i = i + 1
--       local digit = c - BASE85_OFFSET
--       if digit < 0 or digit >= BASE85_RADIX then
--         error("base85_decode_to_bytes: invalid base85 char")
--       end
--       v = v * BASE85_RADIX + digit
--     end

--     -- Extract 4 bytes (big-endian)
--     local b0 = math.floor(v / 16777216) % 256 -- 256^3
--     local b1 = math.floor(v / 65536)    % 256 -- 256^2
--     local b2 = math.floor(v / 256)      % 256 -- 256^1
--     local b3 = v                        % 256 -- 256^0

--     -- Append, but don't exceed expectedLen
--     local remaining = expectedLen - outCount
--     if remaining <= 0 then
--       break
--     end

--     if remaining >= 1 then
--       bytes[#bytes + 1] = b0; outCount = outCount + 1
--     end
--     if remaining >= 2 then
--       bytes[#bytes + 1] = b1; outCount = outCount + 1
--     end
--     if remaining >= 3 then
--       bytes[#bytes + 1] = b2; outCount = outCount + 1
--     end
--     if remaining >= 4 then
--       bytes[#bytes + 1] = b3; outCount = outCount + 1
--     end
--   end

--   if outCount ~= expectedLen then
--     error("base85_decode_to_bytes: decoded length mismatch")
--   end

--   return bytes
-- end

-- local function getSongOrderCount() {
-- 	return #TF_MUSIC_DATA.songOrder
-- }

-- -- demo version:
-- local function swapInPlayorder(songPosition0b, destPointer) {
--   patternIndex0b = TF_MUSIC_DATA.songOrder[songPosition0b + 1]
--   patternString = TF_MUSIC_DATA.patterns[patternIndex0b + 1]
--   local patternLengthBytes = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
--   patternBytes = base85_decode_to_bytes(patternString, patternLengthBytes)
--   for i = 0, patternLengthBytes - 1 do
-- 	poke(destPointer + i, patternBytes[i + 1])
--   end
-- }

-- =========================
-- general playroutine support
function tf_music_tick()
	--
end

-- currentSongOrder = 0
-- lastPlayingFrame = -1
-- backBufferIsA = false // A means patterns 0,1,2,3; B = 4,5,6,7
-- bufferALocation = pointer to pattern 0
-- bufferBLocation = pointer to pattern 4
-- stopPlayingOnNextFrame = false

-- getBufferPointer() {
--   if (backBufferIsA) {
--     return bufferALocation
--   } else {
--     return bufferBLocation
--   }
-- }

-- // demo calls similar to begin playback.
-- handle_music_ready {
--   // seed state
--   currentSongOrder = 0
--   backBufferIsA = true // act like we came from buffer B so tick() will set it correctly on first pass.
--   lastPlayingFrame = -1 // this means tick() will immediately seed the back buffer.
--   stopPlayingOnNextFrame = false

--   swapInPlayorder(currentSongOrder, bufferALocation);

--   music(...)
-- }

-- on_music_tick {
--   currentFrame = tic80_get_playing_frame()
--   if (currentFrame != lastPlayingFrame) {

--     if (stopPlayingOnNextFrame) {
--       tic80_stop_music()
--       return
--     }
--     // advance
--     backBufferIsA = !backBufferIsA
--     lastPlayingFrame = currentFrame
--     currentSongOrder += 1
--     if (currentSongOrder >= getSongOrderCount()) {
--       // next frame will stop the song. copy silence and wait for next frame.
--       copy silence to getBufferPointer()
--       stopPlayingOnNextFrame = true
--     }

--     swapInPlayorder(currentSongOrder, getBufferPointer())
--   }
-- } // on music tick

-- =========================
-- TIC loop
-- =========================
function TIC()
	if not booted then
		math.randomseed(12345) -- stable-ish; remove if you want varying visuals
		write_marker()
		out_init()
		host_last_seq = peek(INBOX.SEQ)
		fps_last_time = time()
		log("BOOT")
		booted = true
	end

	tf_music_tick()

	t = t + 1

	-- Calculate FPS
	fps_frame_count = fps_frame_count + 1
	local current_time = time()
	local elapsed = current_time - fps_last_time
	if elapsed >= 1000 then -- Update FPS every second
		fps = math.floor((fps_frame_count * 1000) / elapsed + 0.5)
		fps_frame_count = 0
		fps_last_time = current_time
	end

	-- heartbeat
	out_set(OUTBOX.HEARTBEAT, (out_get(OUTBOX.HEARTBEAT) + 1) & 0xFF)

	local gotCmd = poll_inbox()

	cls(0)
	draw_idle_anim()

	if gotCmd then
		-- brief visual flash on command receipt
		rect(0, 0, 240, 6, 12)
	end

	draw_status()
end
