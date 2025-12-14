-- TIC-80 orchestration bridge

local MARKER_ADDR = 0x14E24
local INBOX_ADDR = 0x14E40
local OUTBOX_ADDR = 0x14E80

-- Host->cart synchronization registers (mutex-ish)
-- The host sets BUSY=1 while writing a payload, then bumps SEQ and clears BUSY.
-- The cart only reads when BUSY=0 and SEQ has changed.
local INBOX_MUTEX_ADDR = INBOX_ADDR + 12 -- non-zero while host is writing
local INBOX_SEQ_ADDR = INBOX_ADDR + 13 -- increments per host write
local INBOX_TOKEN_ADDR = INBOX_ADDR + 14 -- host increments per command; echoed back on completion

-- Cart->host synchronization registers (mirrors the above for OUTBOX)
local OUTBOX_MUTEX_ADDR = OUTBOX_ADDR + 12 -- non-zero while cart is writing a log
local OUTBOX_SEQ_ADDR = OUTBOX_ADDR + 13 -- increments per log write
local OUTBOX_TOKEN_ADDR = OUTBOX_ADDR + 14 -- cart echoes host token when finishing a cmd

local MARKER = "CHROMATIC_TIC80_V1" -- 17 bytes; host scans for this at MARKER_ADDR

-- =========================
-- OUTBOX layout (cart -> host)
-- =========================
-- OUTBOX_ADDR + 0  : 'B' (0x42) magic
-- OUTBOX_ADDR + 1  : version (1)
-- OUTBOX_ADDR + 2  : heartbeat (increments every TIC)
-- OUTBOX_ADDR + 3  : stateFlags (bit0 = isPlaying)
-- OUTBOX_ADDR + 4  : playingTrack (0..7)
-- OUTBOX_ADDR + 5  : lastCmd (0..255)
-- OUTBOX_ADDR + 6  : lastCmdResult (0=ok, nonzero=error-ish)
-- OUTBOX_ADDR + 7  : logWritePtr (0..LOG_SIZE-1)
-- OUTBOX_ADDR + 8  : logDroppedCount (0..255 wraps)
-- OUTBOX_ADDR + 9  : reserved
-- OUTBOX_ADDR + 10 : reserved
-- OUTBOX_ADDR + 11 : reserved
-- OUTBOX_ADDR + 12 : OUTBOX_MUTEX (cart sets non-zero while writing an entry)
-- OUTBOX_ADDR + 13 : OUTBOX_SEQ   (increments on each entry written)
-- OUTBOX_ADDR + 14 : reserved
-- OUTBOX_ADDR + 15 : reserved
--
-- OUTBOX_ADDR + 16 .. +16+LOG_SIZE-1 : outbox command ring buffer
-- Entry format: [cmd][len][payload...]; wrap marker is cmd=0,len=0.

local LOG_BASE = OUTBOX_ADDR + 16
local LOG_SIZE = 240 -- keep small & simple (fits in reserved region)
local LOG_CMD_LOG = 1 -- log message to host

-- Log stream format (ring buffer):
-- Each entry: [len][ascii bytes...]
-- len is 0..31 (we clamp). Host can decode by walking from its own readPtr to current writePtr.

-- =========================
-- =========================
-- INBOX_ADDR + 0: cmd  (0=NOP, 1=PLAY, 2=STOP, 3=PING/FX)
-- INBOX_ADDR + 1: track (0..7)
-- INBOX_ADDR + 2: frame (0..15)
-- INBOX_ADDR + 3: row   (0..63)
-- INBOX_ADDR + 4: loop (0/1)
-- INBOX_ADDR + 5: sustain (0/1)
-- INBOX_ADDR + 6: tempo (0=default)
-- INBOX_ADDR + 7: speed (0=default)
-- INBOX_ADDR + 8: hostAck (optional; host may write its logReadPtr here if you want)
-- INBOX_ADDR + 9.. : reserved

-- =========================
-- Marker
-- =========================
local function write_marker()
	for i = 1, #MARKER do
		poke(MARKER_ADDR + (i - 1), string.byte(MARKER, i))
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
	out_set(OUTBOX_ADDR + 0, 0x42) -- 'B' -- important for host to detect presence of memory.
	out_set(OUTBOX_ADDR + 1, 1) -- version
	out_set(OUTBOX_ADDR + 2, 0) -- heartbeat
	out_set(OUTBOX_ADDR + 3, 0) -- stateFlags
	out_set(OUTBOX_ADDR + 4, 0) -- playingTrack
	out_set(OUTBOX_ADDR + 5, 0) -- lastCmd
	out_set(OUTBOX_ADDR + 6, 0) -- lastCmdResult
	out_set(OUTBOX_ADDR + 7, 0) -- logWritePtr
	out_set(OUTBOX_ADDR + 8, 0) -- logDroppedCount
	out_set(OUTBOX_MUTEX_ADDR, 0)
	out_set(OUTBOX_SEQ_ADDR, 0)
	out_set(OUTBOX_TOKEN_ADDR, 0)
end

local function log_drop()
	out_set(OUTBOX_ADDR + 8, (out_get(OUTBOX_ADDR + 8) + 1) & 0xFF)
end

local function log_write_ascii(s)
	out_set(OUTBOX_MUTEX_ADDR, 1)

	-- Clamp payload so entries stay small and parsing is trivial
	local n = #s
	if n > 31 then
		n = 31
	end

	local wp = out_get(OUTBOX_ADDR + 7)

	local needed = 2 + n -- cmd + len + payload

	-- If we would wrap across end, write wrap marker and reset
	if wp + needed >= LOG_SIZE then
		poke(LOG_BASE + wp + 0, 0) -- cmd=0 wrap marker
		poke(LOG_BASE + wp + 1, 0)
		wp = 0
	end

	-- If still no room (LOG_SIZE too small), drop
	if needed >= LOG_SIZE then
		out_set(OUTBOX_MUTEX_ADDR, 0)
		log_drop()
		return
	end

	-- write entry
	poke(LOG_BASE + wp + 0, LOG_CMD_LOG)
	poke(LOG_BASE + wp + 1, n)
	for i = 1, n do
		poke(LOG_BASE + wp + 1 + i, string.byte(s, i))
	end

	wp = wp + needed
	out_set(OUTBOX_ADDR + 7, wp & 0xFF)
	out_set(OUTBOX_SEQ_ADDR, (out_get(OUTBOX_SEQ_ADDR) + 1) & 0xFF)
	out_set(OUTBOX_MUTEX_ADDR, 0)
end

-- Also show some recent logs on-screen for sanity
local LOG_LINES = 6
local log_lines = {}
local function log_screen(s)
	-- ring of strings for display
	table.insert(log_lines, 1, s)
	if #log_lines > LOG_LINES then
		table.remove(log_lines)
	end
end

local function log(s)
	log_write_ascii(s)
	log_screen(s)
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

	out_set(OUTBOX_ADDR + 3, flags)
	out_set(OUTBOX_ADDR + 4, playingTrack & 0xFF)
end

local function publish_cmd(cmd, result)
	lastCmd = cmd
	lastCmdResult = result or 0
	out_set(OUTBOX_ADDR + 5, lastCmd & 0xFF)
	out_set(OUTBOX_ADDR + 6, lastCmdResult & 0xFF)
	out_set(OUTBOX_TOKEN_ADDR, peek(INBOX_TOKEN_ADDR))
end

-- =========================
-- Commands
-- =========================
local function handle_play()
	local track = peek(INBOX_ADDR + 1)
	local frame = peek(INBOX_ADDR + 2)
	local row = peek(INBOX_ADDR + 3)
	local loop = peek(INBOX_ADDR + 4) ~= 0
	local sustain = peek(INBOX_ADDR + 5) ~= 0
	local tempo = peek(INBOX_ADDR + 6)
	local speed = peek(INBOX_ADDR + 7)

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
	local sfx_id = peek(INBOX_ADDR + 1)
	local note = peek(INBOX_ADDR + 2)
	-- Clamp to valid ranges for TIC sfx API
	if sfx_id > 63 then
		sfx_id = 63
	end
	if note > 95 then
		note = 95
	end
	-- duration 30 frames, channel -1 (auto), volume 15, speed 0
	sfx(sfx_id, note, -1, 30, -1, 15, 0)
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
	if peek(INBOX_MUTEX_ADDR) ~= 0 then
		return false
	end

	local seq = peek(INBOX_SEQ_ADDR)
	if seq == host_last_seq then
		return false -- nothing new
	end
	host_last_seq = seq

	local cmd = peek(INBOX_ADDR + 0)
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
	poke(INBOX_ADDR + 0, 0)
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
		local a = i * (math.pi * 2 / 8) + t * 0.2
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
	print("hb:" .. tostring(out_get(OUTBOX_ADDR + 2)), 40, y, 13)
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
		host_last_seq = peek(INBOX_SEQ_ADDR)
		log("BOOT")
		booted = true
	end

	t = t + 1

	-- heartbeat
	out_set(OUTBOX_ADDR + 2, (out_get(OUTBOX_ADDR + 2) + 1) & 0xFF)

	local gotCmd = poll_inbox()

	cls(0)
	draw_idle_anim()

	if gotCmd then
		-- brief visual flash on command receipt
		rect(0, 0, 240, 6, 12)
	end

	draw_status()
end
