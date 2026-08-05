-- TIC-80 orchestration bridge
-- a build step injects configuration constants
-- and builds bridge.tic from the generated source automatically.

-- BRIDGE_AUTOGEN_START
-- injected at build time.
-- BRIDGE_AUTOGEN_END

-- BEGIN_SOMATIC_PLAYROUTINE_SHARED
-- injected at build time.
-- END_SOMATIC_PLAYROUTINE_SHARED

-- Derived constants from BRIDGE_CONFIG (Lua view bridge_config.ts)
local ADDR = {
	MARKER = BRIDGE_CONFIG.memory.MARKER_ADDR,
	REGISTERS = BRIDGE_CONFIG.memory.REGISTERS_ADDR,
	INBOX = BRIDGE_CONFIG.memory.INBOX_ADDR,
	OUTBOX = BRIDGE_CONFIG.memory.OUTBOX_ADDR,
	SFX = BRIDGE_CONFIG.memory.SFX_ADDR,
	TRACKS = BRIDGE_CONFIG.memory.TRACKS_ADDR,

	TF_ORDER_LIST_COUNT = BRIDGE_CONFIG.memory.TF_ORDER_LIST_COUNT,
	TF_ORDER_LIST_ENTRIES = BRIDGE_CONFIG.memory.TF_ORDER_LIST_ENTRIES,
	TF_ORDER_LIST_ROWS = BRIDGE_CONFIG.memory.TF_ORDER_LIST_ROWS,
	TF_PATTERN_DATA = BRIDGE_CONFIG.memory.TF_PATTERN_DATA,
	TRANSFER_BUFFER = BRIDGE_CONFIG.memory.BRIDGE_TRANSFER_BUFFER_ADDR,
}

-- Inbox command IDs (host -> cart)
local CMD_NOP = BRIDGE_CONFIG.inboxCommands.NOP
local CMD_TRANSMIT_AND_PLAY = BRIDGE_CONFIG.inboxCommands.TRANSMIT_AND_PLAY
local CMD_STOP = BRIDGE_CONFIG.inboxCommands.STOP
local CMD_PING = BRIDGE_CONFIG.inboxCommands.PING
local CMD_TRANSMIT = BRIDGE_CONFIG.inboxCommands.TRANSMIT
local CMD_PLAY_SFX_ON = BRIDGE_CONFIG.inboxCommands.PLAY_SFX_ON
local CMD_PLAY_SFX_OFF = BRIDGE_CONFIG.inboxCommands.PLAY_SFX_OFF

-- Outbox commands (cart -> host)
local LOG_CMD_LOG = BRIDGE_CONFIG.outboxCommands.LOG

-- Marker string written into RAM for host detection
local MARKER = BRIDGE_CONFIG.markerText

-- Host->cart synchronization registers (mutex-ish)
-- The host sets BUSY=1 while writing a payload, then bumps SEQ and clears BUSY.
-- The cart only reads when BUSY=0 and SEQ has changed.
local INBOX = {
	CMD = ADDR.INBOX + 0,
	SONG_POSITION = ADDR.INBOX + 1,
	ROW = ADDR.INBOX + 2,
	LOOP = ADDR.INBOX + 3,
	SUSTAIN = ADDR.INBOX + 4,
	TEMPO = ADDR.INBOX + 5,
	SPEED = ADDR.INBOX + 6,
	HOST_ACK = ADDR.INBOX + 7,
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

-- =========================
-- OUTBOX layout (cart -> host)
-- =========================
-- Fields and base address are defined in bridge_config.ts (memory.OUTBOX_ADDR).
-- This section documents how the cart currently uses them:
-- OUTBOX.MAGIC        : magic byte; set to 'B' (0x42) at boot so the host can detect the bridge.
-- OUTBOX.VERSION      : protocol version; currently hard-coded to 1 at boot.
-- OUTBOX.HEARTBEAT    : increments every TIC once booted; used by the host as a liveness check.
-- OUTBOX.STATE_FLAGS  : reserved; currently always 0.
-- OUTBOX.PLAYING_TRACK: reserved; not written by the cart (host reads music state directly).
-- OUTBOX.LAST_CMD     : last inbox command ID that completed (copied from INBOX.CMD).
-- OUTBOX.LAST_CMD_RESULT : result code for LAST_CMD (0 = ok, non‑zero = error-ish).
-- OUTBOX.LOG_WRITE_PTR: reserved; initialized to 0 but not updated.
-- OUTBOX.LOG_DROPPED  : count of dropped log entries; increments when the cart would overflow logging.
-- OUTBOX.RESERVED_9   : reserved.
-- OUTBOX.RESERVED_10  : reserved.
-- OUTBOX.RESERVED_11  : reserved.
-- OUTBOX.MUTEX        : reserved for a future cart->host log mutex; currently initialized to 0 and unused.
-- OUTBOX.SEQ          : reserved for a future cart->host log sequence; currently initialized to 0 and unused.
-- OUTBOX.TOKEN        : echoed host token when finishing a command (copied from INBOX.TOKEN in publish_cmd).
-- OUTBOX.LOG_BASE .. LOG_BASE+LOG_SIZE-1 : reserved region for a future outbox command ring buffer.
--
-- Note: LOG_CMD_LOG and the LOG_* ring-buffer protocol are specified in bridge_config.ts
-- and are not currently implemented on the cart side.

-- =========================
-- INBOX layout (host -> cart)
-- =========================
-- Fields and base address are defined in bridge_config.ts (memory.INBOX_ADDR).
-- This section documents how the cart currently interprets them:
-- INBOX.CMD          : inbox command code; numeric IDs are defined in bridge_config.ts.inboxCommands.
-- INBOX.SONG_POSITION: overloaded by several commands;
--                      used as song order position for PLAY, and as sfx id for PLAY_SFX_ON.
-- INBOX.ROW          : overloaded by several commands; used as row index for PLAY, and as note for PLAY_SFX_ON.
-- INBOX.LOOP         : for PLAY, non-zero means "loop forever" (wrap to order 0 instead of stopping at end);
--                      for PLAY_SFX_ON/OFF, low 2 bits used as channel index (0..3).
-- INBOX.SUSTAIN      : boolean sustain flag for PLAY; signed speed offset ([-4..+3]) for PLAY_SFX_ON.
-- INBOX.TEMPO        : optional tempo override for PLAY; volume byte for PLAY_SFX_ON.
-- INBOX.SPEED        : optional speed override for PLAY; mix flags for PLAY_SFX_ON
--                      (bit 0=volume present, bit 1=pan present).
-- INBOX.HOST_ACK     : pan byte for PLAY_SFX_ON; otherwise reserved.
-- INBOX + 8..        : reserved; INBOX.MUTEX/SEQ/TOKEN live at offsets 12/13/14 for host->cart mailbox sync.

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
end

-- Also show some recent logs on-screen for sanity
local LOG_LINES = 10
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

local lastCmd = 0
local lastCmdResult = 0
local host_last_seq = 0

local morphMap = {}
local morphIds = {}
local patternExtra = {}

local function lerp(a, b, t)
	return a + (b - a) * t
end

-- a,b: 0..15, t: 0..1
local function lerp_nibble_lin(a, b, t)
	local v = a + (b - a) * t
	if v < 0 then
		v = 0
	elseif v > 15 then
		v = 15
	end
	return math.floor(v + 0.5)
end

-- equal power (sqrt or sine law) makes a better xfade, but it doesn't preserve the waveshapes at either end so... not the best idea
local lerp_nibble = lerp_nibble_lin

local function read_sfx_cfg(instrumentId)
	if instrumentId == nil then
		return nil
	end
	return morphMap[instrumentId]
end

local function read_pattern_extra_cells(patternIndex0b)
	if patternIndex0b == nil then
		return nil
	end
	return patternExtra[patternIndex0b]
end

local function decode_bridge_extra_song_data()
	local addr = ADDR.TRANSFER_BUFFER
	local headerBytes = BRIDGE_CONFIG.extraSongData.compressedLengthHeaderBytes
	local compressedLength = peek(addr) | (peek(addr + 1) << 8)
	local limit = BRIDGE_CONFIG.extraSongData.maxCompressedBytes
	if compressedLength <= 0 or compressedLength > limit then
		error(
			"Bridge extra-song payload length out of range: "
				.. tostring(compressedLength)
				.. " (limit "
				.. tostring(limit)
				.. ")"
		)
	end
	local bytes = lzMemoryToTable(addr + headerBytes, compressedLength)
	return decodeSomaticExtraSongBytes(bytes)
end

local function render_waveform_morph(cfg, ticksPlayed, outSamples)
	local nodes = cfg.morphGradientNodes
	local n = #nodes
	if nodes == nil or n == 0 then
		return false
	end
	if n == 1 then
		local s = nodes[1].samples
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			outSamples[i] = s[i]
		end
		return true
	end

	local tRemaining = ticksPlayed
	local seg = (n - 1)
	local localT = 1.0
	for i = 1, (n - 1) do
		local dur = nodes[i].durationTicks10
		if dur > 0 then
			if tRemaining < dur then
				seg = i
				localT = tRemaining / dur
				break
			end
			tRemaining = tRemaining - dur
		end
	end

	local shapedT = apply_curveN11(localT, nodes[seg].curveS6)
	local a = nodes[seg].samples
	local b = nodes[seg + 1].samples
	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		outSamples[i] = a[i] + (b[i] - a[i]) * shapedT
	end
	return true
end

local function render_waveform_pwm(cfg, ticksPlayed, instrumentId, lfoTicks, outSamples)
	-- PWM is driven by the per-instrument LFO
	local cycle = cfg.lfoCycleTicks12 or 0
	local phase
	if cycle <= 0 then
		phase = 0
	else
		phase = (lfoTicks % cycle) / cycle
	end
	local tri
	if phase < 0.5 then
		tri = phase * 4 - 1 -- -1..+1
	else
		tri = 3 - phase * 4 -- +1..-1
	end
	local duty = (cfg.pwmDuty5 or 0) + (cfg.pwmDepth5 or 0) * tri
	-- Avoid generating a constant waveform (all -1 / all +1).
	-- TIC-80 treats that as a special case; we force at least one sample of each polarity.
	if duty < 1 then
		duty = 1
	elseif duty > 30 then
		duty = 30
	end
	local threshold = (duty / 31) * WAVE_SAMPLES_PER_WAVE
	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		outSamples[i] = (i < threshold) and 15 or 0
	end
	return true
end

local function render_waveform_native(cfg, outSamples)
	-- native: use the configured source waveform.
	wave_read_samples(cfg.sourceWaveformIndex, outSamples)
	return true
end

local function render_waveform_samples(cfg, ticksPlayed, instrumentId, lfoTicks, outSamples)
	-- Output format: 0-based array of 32 samples in 0..15 (floats ok).
	if cfg.waveEngineId == WAVE_ENGINE_MORPH then
		return render_waveform_morph(cfg, ticksPlayed, outSamples)
	elseif cfg.waveEngineId == WAVE_ENGINE_PWM then
		return render_waveform_pwm(cfg, ticksPlayed, instrumentId, lfoTicks, outSamples)
	elseif cfg.waveEngineId == WAVE_ENGINE_NATIVE then
		return render_waveform_native(cfg, outSamples)
	end
end

local function render_tick_cfg(cfg, instrumentId, channel, ticksPlayed, lfoTicks, effectStrengthScaleU8, lowpassStrengthScaleU8)
	if not cfg_is_k_rate_processing(cfg) then
		return
	end

	local rendered = render_waveform_samples(cfg, ticksPlayed, instrumentId, lfoTicks, render_out)
	if not rendered then
		return
	end

	local scale01 = clamp01((effectStrengthScaleU8 or 255) / 255)
	local lpScale01 = clamp01((lowpassStrengthScaleU8 or 255) / 255)
	local baseLpAmount01 = clamp01(((cfg.lowpassAmountU8 or 0) / 255))
	local lpAmount01 = baseLpAmount01 * lpScale01

	if (cfg.effectKind == EFFECT_KIND_HARDSYNC) and cfg.effectAmtU8 > 0 and scale01 > 0 then
		local hsT = 0
		local effectModSource = cfg.effectModSource or MOD_SRC_ENVELOPE
		if effectModSource ~= MOD_SRC_NONE then
			hsT = calculate_mod_t(
				effectModSource,
				cfg.effectDurationTicks12,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleTicks12,
				0
			)
		end
		local env = 1 - apply_curveN11(hsT, cfg.effectCurveS6)
		local multiplier = 1 + (cfg.effectAmtU8 / 255) * scale01 * 7 * env
		apply_hardsync_effect_to_samples(render_out, multiplier)
	end

	-- Wavefold first (adds harmonics), then lowpass (smooths)
	local wavefoldModSource = cfg.effectModSource or MOD_SRC_ENVELOPE
	local wavefoldHasTime = (wavefoldModSource == MOD_SRC_NONE)
		or (wavefoldModSource == MOD_SRC_LFO and (cfg.lfoCycleTicks12 or 0) > 0)
		or ((cfg.effectDurationTicks12 or 0) > 0)
	if (cfg.effectKind == EFFECT_KIND_WAVEFOLD) and cfg.effectAmtU8 > 0 and wavefoldHasTime and scale01 > 0 then
		local maxAmt = clamp01(cfg.effectAmtU8 / 255) * scale01
		local wfT = 0
		if wavefoldModSource ~= MOD_SRC_NONE then
			wfT = calculate_mod_t(
				wavefoldModSource,
				cfg.effectDurationTicks12,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleTicks12,
				0
			)
		end
		local envShaped = 1 - apply_curveN11(wfT, cfg.effectCurveS6)
		local strength = maxAmt * envShaped
		apply_wavefold_effect_to_samples(render_out, strength)
	end

	if cfg.lowpassEnabled then
		local lpModSource = cfg.lowpassModSource or MOD_SRC_ENVELOPE
		local t = 0
		if lpModSource == MOD_SRC_NONE then
			t = 1
		else
			t = calculate_mod_t(lpModSource, cfg.lowpassDurationTicks12, ticksPlayed, lfoTicks, cfg.lfoCycleTicks12, 1)
		end

		-- Close over time: start bypassed (amount=0) and increase toward lpAmount01.
		local amountAtTime01 = lpAmount01 * clamp01(t)
		amountAtTime01 = apply_curveN11(amountAtTime01, cfg.lowpassCurveS6)
		local openness01 = 1 - amountAtTime01
		apply_lowpass_effect_to_samples(render_out, openness01)
	end

	write_channel_waveform(channel, render_out)
end

local function sfx_tick_channel(channel)
	local idx = ch_sfx_id[channel + 1]
	if idx == -1 then
		return
	end

	local ticksPlayed = ch_sfx_ticks[channel + 1]
	local cfg = read_sfx_cfg(idx)
	local lt = lfo_ticks_by_sfx[idx] or 0
	if cfg_is_k_rate_processing(cfg) then
		local scaleU8 = ch_effect_strength_scale_u8[channel + 1] or 255
		local lpScaleU8 = ch_lowpass_strength_scale_u8[channel + 1] or 255
		render_tick_cfg(cfg, idx, channel, ticksPlayed, lt, scaleU8, lpScaleU8)
	end
	write_channel_mix(
		channel,
		cfg and cfg.volumeU8 or 255,
		cfg and cfg.panU8 or 128,
		cfg and cfg.panLfoDepthU8 or 0,
		lt,
		cfg and cfg.lfoCycleTicks12 or 0
	)
	ch_sfx_ticks[channel + 1] = ticksPlayed + 1
end

local function advance_all_lfo_ticks()
	for i = 1, #morphIds do
		local id = morphIds[i]
		lfo_ticks_by_sfx[id] = (lfo_ticks_by_sfx[id] or 0) + 1
	end
end

local function sfx_tick()
	advance_all_lfo_ticks()
	for ch = 0, SFX_CHANNELS - 1 do
		sfx_tick_channel(ch)
	end
end

local function ch_set_playroutine_regs(songPosition)
	poke(BRIDGE_CONFIG.memory.MUSIC_STATE_SOMATIC_SONG_POSITION, songPosition & 0xFF)
end

-- =========================
-- Music playback -> SFX channel state tracking
-- =========================
-- We want morphing to follow whatever SFX the tracker is triggering during music playback.
-- This reads the current track frame -> pattern IDs, then reads the pattern row triplets.
local TRACKS_BASE = BRIDGE_CONFIG.memory.TRACKS_ADDR
local PATTERNS_BASE = BRIDGE_CONFIG.memory.PATTERNS_ADDR

local function apply_music_row_to_sfx_state(track, frame, row)
	-- Only process once per new (track,frame,row) combination.
	if track == last_music_track and frame == last_music_frame and row == last_music_row then
		return
	end
	last_music_track = track
	last_music_frame = frame
	last_music_row = row

	-- Apply Somatic per-pattern extra commands. Pan and volume are deferred until
	-- after note events so same-row values control the newly triggered voice.
	local pendingPanByChannel = {}
	local pendingVolumeByChannel = {}
	local songPosition0b = peek(BRIDGE_CONFIG.memory.MUSIC_STATE_SOMATIC_SONG_POSITION)
	if songPosition0b ~= nil and songPosition0b ~= 0xFF then
		local base = ADDR.TF_ORDER_LIST_ENTRIES + songPosition0b * 4
		for ch = 0, SFX_CHANNELS - 1 do
			local columnIndex0b = peek(base + ch)
			local cells = read_pattern_extra_cells(columnIndex0b)
			local cell = cells and cells[row + 1] or nil
			if cell and cell.effectId == 1 then
				-- 'E': Set effect strength scale
				ch_effect_strength_scale_u8[ch + 1] = cell.paramU8 or 255
			elseif cell and cell.effectId == 3 then
				-- 'F': Set lowpass strength scale (00=bypass, FF=max)
				ch_lowpass_strength_scale_u8[ch + 1] = cell.paramU8 or 255
			elseif cell and cell.effectId == 2 then
				-- 'L': Set LFO phase for the instrument playing on this channel
				local instId = ch_sfx_id[ch + 1]
				if instId and instId >= 0 then
					local cfg = read_sfx_cfg(instId)
					local cycle = cfg and cfg.lfoCycleTicks12 or 0
					if cycle > 0 then
						-- paramU8 0x00..0xFF maps to phase 0..cycle
						lfo_ticks_by_sfx[instId] = math.floor((cell.paramU8 or 0) / 255 * cycle)
					end
				end
			elseif cell and cell.effectId == 5 then
				pendingPanByChannel[ch + 1] = cell.paramU8 or 128
			end
			if cell and cell.panU8 ~= nil then
				-- Dedicated pan column takes precedence over a same-row legacy Pxx command.
				pendingPanByChannel[ch + 1] = cell.panU8
			end
			if cell and cell.volumeU8 ~= nil then
				pendingVolumeByChannel[ch + 1] = cell.volumeU8
			end
		end
	end

	local p0, p1, p2, p3 = decode_track_frame_patterns(track, frame)
	local patterns = { p0, p1, p2, p3 }

	for ch = 0, SFX_CHANNELS - 1 do
		local patternId1b = patterns[ch + 1]
		local noteNibble, inst = decode_pattern_row(patternId1b, row)
		if noteNibble == 0 then
			-- empty cell; keep existing SFX state (note is still held)
		elseif noteNibble < 4 then
			-- stop/cut/off codes
			ch_sfx_id[ch + 1] = -1
			ch_sfx_ticks[ch + 1] = 0
			ch_pan_override_u8[ch + 1] = nil
			ch_volume_scale_u8[ch + 1] = nil
		else
			-- note-on
			ch_sfx_id[ch + 1] = inst
			ch_sfx_ticks[ch + 1] = 0
			ch_pan_override_u8[ch + 1] = nil
			ch_volume_scale_u8[ch + 1] = nil
		end
		local pendingPan = pendingPanByChannel[ch + 1]
		if pendingPan ~= nil then
			ch_pan_override_u8[ch + 1] = pendingPan
		end
		local pendingVolume = pendingVolumeByChannel[ch + 1]
		if pendingVolume ~= nil then
			ch_volume_scale_u8[ch + 1] = pendingVolume
		end
	end
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
local function handle_transmit()
	local nextMorphMap, nextPatternExtra, nextMorphIds = decode_bridge_extra_song_data()
	sync(24, 0, true)
	morphMap = nextMorphMap
	patternExtra = nextPatternExtra
	morphIds = nextMorphIds
	publish_cmd(CMD_TRANSMIT, 0)
end

local function handle_play()
	-- assumes host has uploaded music data already to RAM.
	local nextMorphMap, nextPatternExtra, nextMorphIds = decode_bridge_extra_song_data()

	-- Force reload of music data
	-- https://github.com/nesbox/TIC-80/wiki/sync
	-- flags = 8 (sfx) + 16 (music) = 24
	-- bank = 0 (default)
	-- true means sync from runtime -> cart.
	sync(24, 0, true)
	morphMap = nextMorphMap
	patternExtra = nextPatternExtra
	morphIds = nextMorphIds

	local songPosition = peek(INBOX.SONG_POSITION)
	local startRow = peek(INBOX.ROW)
	local loopFlag = peek(INBOX.LOOP)
	loopSongForever = loopFlag ~= 0
	tf_music_init(songPosition, startRow)
	publish_cmd(CMD_TRANSMIT_AND_PLAY, 0)
end

local function handle_stop()
	music()
	tf_music_reset_state()
	publish_cmd(CMD_STOP, 0)
	--log("STOP")
end

local function handle_ping_fx()
	-- Simple visible acknowledgement + log
	publish_cmd(CMD_PING, 0)
	log("PING/FX")
end

local function handle_play_sfx_on()
	local sfx_id = peek(INBOX.SONG_POSITION)
	local note = peek(INBOX.ROW)
	local channel = peek(INBOX.LOOP) & 0x03
	local speed = peek(INBOX.SUSTAIN) - 4 -- subtract 4 to get signed speed in the requisite range -4..+3
	local volumeU8 = peek(INBOX.TEMPO)
	local mixFlags = peek(INBOX.SPEED)
	local hasVolumeScale = (mixFlags & 1) ~= 0
	local panU8 = peek(INBOX.HOST_ACK)
	local hasPanOverride = (mixFlags & 2) ~= 0
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

	-- Track per-channel note state for morphing
	ch_sfx_id[channel + 1] = sfx_id
	ch_sfx_ticks[channel + 1] = 0
	ch_pan_override_u8[channel + 1] = nil
	if hasPanOverride then
		ch_pan_override_u8[channel + 1] = panU8
	end
	ch_volume_scale_u8[channel + 1] = nil
	if hasVolumeScale then
		ch_volume_scale_u8[channel + 1] = volumeU8
	end

	-- id, note, duration (-1 = sustained), channel 0..3, volume 15, speed 0
	sfx(sfx_id, note, -1, channel, 15, speed)
	publish_cmd(CMD_PLAY_SFX_ON, 0)
	log(string.format("PLAY_SFX_ON id=%d note=%d ch=%d", sfx_id, note, channel))
end

local function handle_play_sfx_off()
	local channel = peek(INBOX.LOOP) & 0x03
	-- id, note, duration (-1 = sustained), channel 0..3, volume 15, speed 0
	sfx(-1, 0, 0, channel)
	ch_sfx_id[channel + 1] = -1
	ch_sfx_ticks[channel + 1] = 0
	ch_pan_override_u8[channel + 1] = nil
	ch_volume_scale_u8[channel + 1] = nil
	publish_cmd(CMD_PLAY_SFX_OFF, 0)
	log(string.format("PLAY_SFX_OFF ch=%d", channel))
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

	if cmd == CMD_TRANSMIT then
		handle_transmit()
	elseif cmd == CMD_TRANSMIT_AND_PLAY then
		handle_play()
	elseif cmd == CMD_STOP then
		handle_stop()
	elseif cmd == CMD_PING then
		handle_ping_fx()
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
	local icon_scale = 2
	local icon_x = 240 - (__somatic_version_icon_w * icon_scale) - 2
	renderVersionIcon(icon_x, y, icon_scale)
	print(SOMATIC_VERSION_STRING, 40, y, 12)
	y = y + 8
	print("fps:" .. tostring(fps), 40, y, 13)
	y = y + 8

	local track, frame, row, looping = get_music_pos()
	print(string.format("track:%d frame:%d row:%d loop:%s", track, frame, row, tostring(looping)), 40, y, 6)
	y = y + 8

	-- Show per-channel SFX/morph state for sanity checking.
	for ch = 0, SFX_CHANNELS - 1 do
		local sid = ch_sfx_id[ch + 1]
		local ticks = ch_sfx_ticks[ch + 1]
		print(string.format("ch%d sfx:%d t:%d", ch, sid, ticks), 40, y, 12)
		y = y + 8
	end

	-- Recent logs
	for i = #log_lines, 1, -1 do
		print(log_lines[i], 2, 70 + (i - 1) * 8, 6)
	end
end

-- =========================
-- general playroutine support
currentSongOrder = 0
lastPlayingFrame = -1
backBufferIsA = false -- A means patterns 0,1,2,3; B = 4,5,6,7
stopPlayingOnNextFrame = false
loopSongForever = false
local PATTERN_BUFFER_BYTES = 192 * 4 -- 192 bytes per pattern-channel * 4 channels
local bufferALocation = PATTERN_BUFFER_A
local bufferBLocation = PATTERN_BUFFER_B

-- =========================
-- tracker-specific playroutine support

local function getSongOrderCount()
	return peek(ADDR.TF_ORDER_LIST_COUNT)
end

local function getSongOrderRowCount(songPosition)
	local rows = peek(ADDR.TF_ORDER_LIST_ROWS + songPosition)
	if rows == nil or rows <= 0 then
		return 64 - peek(ADDR.TRACKS + 49)
	end
	return clamp(rows, 1, 64 - peek(ADDR.TRACKS + 49))
end

-- Computes a simple checksum and first-bytes hex preview for a memory region.
-- addr:      start address in memory
-- total_len: number of bytes to include in the checksum
-- preview_len: how many bytes to show in the "firstBytes" preview (default 16)
local function print_buffer_fingerprint(addr, total_len, preview_len)
	preview_len = preview_len or 16

	-- checksum over the whole buffer (like the TS version)
	local checksum = 0
	for i = 0, total_len - 1 do
		checksum = checksum + peek(addr + i)
	end

	-- hex representation of the first N bytes
	local hex = {}
	local count = math.min(preview_len, total_len)
	for i = 0, count - 1 do
		local b = peek(addr + i)
		hex[#hex + 1] = string.format("%02x", b)
	end

	local firstBytes = table.concat(hex, " ")
	if total_len > preview_len then
		firstBytes = firstBytes .. " ..."
	end

	log(" checksum: " .. checksum)
	log(" firstBytes: [" .. firstBytes .. "]")
end

local function blitPattern(patternIndex0b, destPointer)
	-- ADDR.TF_PATTERN_DATA contains patterns in sequence.
	-- each pattern is serialized as
	-- * 16-bit little-endian pattern blob size
	-- * the blob itself (length as above)

	local readPos = ADDR.TF_PATTERN_DATA

	-- Skip past patterns before the one we want
	for i = 0, patternIndex0b - 1 do
		-- Read 16-bit little-endian length
		local len_lo = peek(readPos)
		local len_hi = peek(readPos + 1)
		local patternSize = len_lo + (len_hi * 256)

		-- Skip past this pattern's header (2 bytes) and data
		readPos = readPos + 2 + patternSize
	end

	-- Now read the target pattern
	local len_lo = peek(readPos)
	local len_hi = peek(readPos + 1)
	local patternSize = len_lo + (len_hi * 256)
	readPos = readPos + 2 -- skip past length header

	-- Decompress through the shared heap codec, then copy into the playback buffer.
	local decompressedSize = lzMemoryToMemory(readPos, patternSize, destPointer)

	-- -- check payload.
	-- log("pattern " .. tostring(patternIndex0b) .. " blitted")
	-- log("COMPRESSED")
	-- log(" size " .. tostring(patternSize))
	-- print_buffer_fingerprint(readPos, patternSize)

	--log("UNCOMPRESSED")
	-- log size compressed & decompressed
	--log(" size " .. tostring(decompressedSize))
	--print_buffer_fingerprint(destPointer, decompressedSize)
end

local function addressToPattern(addr)
	local offset = addr - 0x11164
	local patIndex = offset // PATTERN_BYTES_PER_PATTERN
	local remainder = offset % PATTERN_BYTES_PER_PATTERN
	return patIndex, remainder
end

local function swapInPlayorder(songPosition, destPointer)
	local base = ADDR.TF_ORDER_LIST_ENTRIES + songPosition * 4
	for ch = 0, 3 do
		local columnIndex0b = peek(base + ch)
		local dst = destPointer + ch * PATTERN_BYTES_PER_PATTERN

		local patIndex, remainder = addressToPattern(dst)
		-- log(
		-- 	"blit ci:"
		-- 		.. tostring(columnIndex0b)
		-- 		.. "->"
		-- 		.. string.format("0x%X", dst)
		-- 		.. " pat:"
		-- 		.. tostring(patIndex)
		-- 		.. " rem:"
		-- 		.. tostring(remainder)
		-- )

		blitPattern(columnIndex0b, dst)
	end
end

local function patchPatternEndJump(songPosition, destPointer, playingFrame)
	local rowCount = getSongOrderRowCount(songPosition)
	local rowsPerPattern = 64 - peek(ADDR.TRACKS + 49)
	if rowCount >= rowsPerPattern then
		return
	end
	local row = rowCount - 1 -- make 0-based.

	-- find a channel with empty command so we can safely patch the jmp
	-- if none available, clobber first chan
	local chosenCh = 0
	for ch = 0, 3 do
		local addr = destPointer + ch * PATTERN_BYTES_PER_PATTERN + row * ROW_BYTES
		local command = (peek(addr + 1) >> 4) & 0x07
		if command == 0 then
			chosenCh = ch
			break
		end
	end
	local targetFrame = ((playingFrame or 0) + 1) % 16
	local addr = destPointer + chosenCh * PATTERN_BYTES_PER_PATTERN + row * ROW_BYTES
	-- set command to jump
	poke(addr, ((targetFrame & 0x0f) << 4) | (peek(addr) & 0x0f))
	-- and the param...
	poke(addr + 1, (peek(addr + 1) & 0x80) | (3 << 4))
end

local function queuePlayorder(songPosition, destPointer, playingFrame)
	swapInPlayorder(songPosition, destPointer)
	patchPatternEndJump(songPosition, destPointer, playingFrame)
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
	memset(destPointer, 0, PATTERN_BUFFER_BYTES)
end

tf_music_reset_state = function()
	currentSongOrder = 0
	lastPlayingFrame = -1
	backBufferIsA = false
	stopPlayingOnNextFrame = false
	loopSongForever = false
	ch_effect_strength_scale_u8 = { 255, 255, 255, 255 }
	ch_lowpass_strength_scale_u8 = { 255, 255, 255, 255 }
	ch_pan_override_u8 = { nil, nil, nil, nil }
	ch_volume_scale_u8 = { nil, nil, nil, nil }
	log("reset_state: Music state reset.")
	ch_set_playroutine_regs(0xFF)
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

	log("music_init: Starting playback from position " .. tostring(songPosition) .. " row " .. tostring(startRow))

	queuePlayorder(songPosition, bufferALocation, 0)

	currentSongOrder = songPosition + 1
	backBufferIsA = false -- frame 0 plays buffer A; buffer B is preloaded for frame 1.
	lastPlayingFrame = 0
	local orderCount = getSongOrderCount()
	if orderCount == 0 then
		clearPatternBuffer(bufferBLocation)
		stopPlayingOnNextFrame = true
	elseif currentSongOrder >= orderCount then
		if loopSongForever then
			currentSongOrder = 0
			queuePlayorder(currentSongOrder, bufferBLocation, 1)
		else
			clearPatternBuffer(bufferBLocation)
			stopPlayingOnNextFrame = true
		end
	else
		queuePlayorder(currentSongOrder, bufferBLocation, 1)
	end

	ch_set_playroutine_regs(songPosition)

	music(
		0, -- track
		0, -- frame
		startRow, -- row
		true, -- loop
		true -- sustain
	)
end

function tf_music_tick()
	local track, currentFrame = get_music_pos()

	if track == -1 then
		return -- not playing
	end

	if currentFrame == lastPlayingFrame then
		return
	end

	-- log current & last playing frame
	log("tick: currentFrame=" .. tostring(currentFrame) .. " lastPlayingFrame=" .. tostring(lastPlayingFrame))

	if stopPlayingOnNextFrame then
		log("tick: Stopping playback; next music frame reached.")
		-- log the current & last playing frame
		music() -- stops playback.
		tf_music_reset_state()
		return
	end

	backBufferIsA = not backBufferIsA
	lastPlayingFrame = currentFrame
	ch_set_playroutine_regs(currentSongOrder) -- the queued pattern is now playing; inform host.
	currentSongOrder = currentSongOrder + 1

	local destPointer = getBufferPointer()
	local orderCount = getSongOrderCount()

	log("tick: Advancing to seq " .. tostring(currentSongOrder))

	if orderCount == 0 then
		clearPatternBuffer(destPointer)
		stopPlayingOnNextFrame = true
		return
	end

	if currentSongOrder >= orderCount then
		if loopSongForever then
			log("tick: Looping back to start of order list.")
			currentSongOrder = 0
		else
			clearPatternBuffer(destPointer)
			stopPlayingOnNextFrame = true
			return
		end
	end

	queuePlayorder(currentSongOrder, destPointer, (currentFrame + 1) % 16)
end

local sweetie16_pal = "1a1c2c5d275db13e53ef7d57ffcd75a7f07038b76425717929366f3b5dc941a6f673eff7f4f4f494b0c2566c86333c57"

-- set the palette
function tovram(str)
	local o = 0
	for c = 1, #str, 2 do -- walk colors
		local v = tonumber(str:sub(c, c + 1), 16) -- get color (v)alue
		poke(0x3fc0 + o, v)
		o = o + 1 -- set color
	end
end

tovram(sweetie16_pal)
poke(0x3FF8, 0) -- border
poke(0x3FF9, 0) -- screen offset
poke(0x3FFA, 0)

-- =========================
-- TIC loop
-- =========================
function TIC()
	if not booted then
		math.randomseed(12345) -- stable-ish
		write_marker()
		out_init()
		host_last_seq = peek(INBOX.SEQ)
		fps_last_time = time()
		log("BOOT")
		booted = true
	end

	tf_music_tick()
	-- Mirror tracker playback into our per-channel SFX state for morphing.
	local track, frame, row, _looping = get_music_pos()
	if track ~= -1 then
		apply_music_row_to_sfx_state(track, frame, row)
	end
	sfx_tick()

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

	poke(BRIDGE_CONFIG.memory.FPS, fps & 0xFF)

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
