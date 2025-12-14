-- TIC-80 orchestration bridge

local ADDR = {
	MARKER = 0x14E24,
	INBOX = 0x14E40,
	OUTBOX = 0x14E80,
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
	trace("cart log: " .. s)
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
local CMD_PLAY_SFX = 6

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

local function handle_play_sfx()
	local sfx_id = peek(INBOX.TRACK)
	local note = peek(INBOX.FRAME)
	-- Clamp to valid ranges for TIC sfx API
	if sfx_id > 63 then
		sfx_id = 63
	end
	if note > 95 then
		note = 95
	end
	-- id (-1 = stop playing channel)
	-- note
	-- duration 30 frames (-1 = continuous until stop)
	-- channel 0
	-- volume 15
	-- speed 0
	sfx(sfx_id, note, 30, 0, 15, 0)
	publish_cmd(CMD_PLAY_SFX, 0)
	log(string.format("PLAY_SFX id=%d note=%d", sfx_id, note))
end

local function handle_begin_upload()
	-- Stop any playback before host overwrites music data
	music()
	set_playing(playingTrack, false)
	publish_cmd(CMD_BEGIN_UPLOAD, 0)
	log("BEGIN_UPLOAD")
end

local function handle_end_upload()
	-- No-op placeholder; host signals completion
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
	elseif cmd == CMD_PLAY_SFX then
		handle_play_sfx()
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

	circ(cx, cy, r, 1) -- ring
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

local function draw_status()
	local y = 2
	print("BRIDGE", 40, y, 12)
	y = y + 8
	print("hb:" .. tostring(out_get(OUTBOX.HEARTBEAT)), 40, y, 13)
	y = y + 8
	print(isPlaying and ("PLAY tr:" .. playingTrack) or "IDLE", 40, y, isPlaying and 11 or 6)
	y = y + 8
	print("last:" .. tostring(lastCmd) .. " res:" .. tostring(lastCmdResult), 40, y, 6)
	y = y + 10

	-- Recent logs
	for i = #log_lines, 1, -1 do
		print(log_lines[i], 2, 90 + (i - 1) * 8, 6)
	end
end

-- =========================
-- TIC loop
-- =========================
function TIC()
	if not booted then
		math.randomseed(12345) -- stable-ish; remove if you want varying visuals
		write_marker()
		out_init()
		host_last_seq = peek(INBOX.SEQ)
		log("BOOT")
		booted = true
	end

	t = t + 1

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
