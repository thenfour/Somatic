-- TIC-80 orchestration bridge
-- a build step injects configuration constants
-- and builds bridge.tic from the generated source automatically.

-- BRIDGE_AUTOGEN_START

-- injected at build time.

-- BRIDGE_AUTOGEN_END

-- Derived constants from BRIDGE_CONFIG (Lua view bridge_config.ts)
local ADDR = {
	MARKER = BRIDGE_CONFIG.memory.MARKER_ADDR,
	REGISTERS = BRIDGE_CONFIG.memory.REGISTERS_ADDR,
	INBOX = BRIDGE_CONFIG.memory.INBOX_ADDR,
	OUTBOX = BRIDGE_CONFIG.memory.OUTBOX_ADDR,
	SFX = BRIDGE_CONFIG.memory.SFX_ADDR,

	TF_ORDER_LIST_COUNT = BRIDGE_CONFIG.memory.TF_ORDER_LIST_COUNT,
	TF_ORDER_LIST_ENTRIES = BRIDGE_CONFIG.memory.TF_ORDER_LIST_ENTRIES,
	TF_PATTERN_DATA = BRIDGE_CONFIG.memory.TF_PATTERN_DATA,
	SOMATIC_SFX_CONFIG = BRIDGE_CONFIG.memory.SOMATIC_SFX_CONFIG,
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

local CH_REGISTERS = {
	-- NB: KEEP IN SYNC WITH HOST (search FOR "BRIDGE_MEMORY_MAP")
	SONG_POSITION = ADDR.REGISTERS + 0, -- current song position (0..255)
	FPS = ADDR.REGISTERS + 1, -- current FPS
}

local function ch_set_playroutine_regs(songPosition)
	poke(CH_REGISTERS.SONG_POSITION, songPosition & 0xFF)
end

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
-- INBOX.TEMPO        : optional tempo override for PLAY (0 = default).
-- INBOX.SPEED        : optional speed override for PLAY (0 = default).
-- INBOX.HOST_ACK     : reserved; currently unused (intended for host log read pointer or similar acknowledgements).
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

local lastCmd = 0
local lastCmdResult = 0
local host_last_seq = 0

-- Per channel, track which SFX is currently playing and how long it has been held (in 60Hz ticks)
-- This is manual state; TIC-80 does not expose this per-channel for SFX (in a stable way)
local SFX_CHANNELS = 4
local ch_sfx_id = { -1, -1, -1, -1 } -- 0-based channel -> sfx id (or -1)
local ch_sfx_ticks = { 0, 0, 0, 0 } -- 0-based channel -> duration since note-on (ticks)

local MORPH_MAP_BASE = ADDR.SOMATIC_SFX_CONFIG

local MORPH_HEADER_BYTES = 1
local MORPH_ENTRY_BYTES = 14

-- SOMATIC_SFX_CONFIG lives below the MARKER region; fail fast if layout or payload is inconsistent.
local MORPH_MAP_BYTES = ADDR.MARKER - MORPH_MAP_BASE

local function u8_to_s8(b)
	if b > 0x7f then
		return b - 0x100
	end
	return b
end

local function s6_to_s8(b)
	local v = b & 0x3f
	if v >= 0x20 then
		v = v - 0x40 -- sign-extend 6-bit
	end
	-- map -32..31 to roughly -128..127 for the existing curve helper
	local s8 = math.floor((v * 127) / 31 + 0.5)
	if s8 < -128 then
		s8 = -128
	elseif s8 > 127 then
		s8 = 127
	end
	return s8
end

local MOD_SRC_ENVELOPE = 0
local MOD_SRC_LFO = 1

local WAVE_BASE = BRIDGE_CONFIG.memory.WAVEFORMS_ADDR
local WAVE_BYTES_PER_WAVE = 16 -- 32x 4-bit samples packed 2-per-byte
local WAVE_SAMPLES_PER_WAVE = 32

local function clamp01(x)
	if x < 0 then
		return 0
	elseif x > 1 then
		return 1
	end
	return x
end

local function clamp_nibble_round(v)
	if v < 0 then
		v = 0
	elseif v > 15 then
		v = 15
	end
	return math.floor(v + 0.5)
end

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

-- Packed as (14 bytes per entry):
-- [0] entryCount (u8)
-- per entry
--  0: instrumentId (u8)
--  1: flags (bits: waveEngineId[0..1], lowpassEnabled[2], effectKind[3..4], lowpassModSrc[5], effectModSrc[6], reserved[7])
--  2: wave indices: sourceWaveformIndex[0..3] | morphWaveB[4..7]
--  3-6: packedG0 (LE32): renderWaveformSlot[0..3], pwmDuty5[4..8], pwmDepth5[9..13], morphDurationTicks12[14..25], morphCurveS6[26..31]
--  7-10: packedG1 (LE32): lowpassDurationTicks12[0..11], lowpassCurveS6[12..17], effectAmtU8[18..25], effectDurationTicks12_low6[26..31]
--  11-13: packedG2 (LE24): effectDurationTicks12_high6[0..5], effectCurveS6[6..11], lfoCycleTicks12[12..23]
-- total payload = 1 + entryCount * 14 bytes
local function read_sfx_cfg(instrumentId)
	local rawCount = peek(MORPH_MAP_BASE)
	local maxCount = math.floor((MORPH_MAP_BYTES - MORPH_HEADER_BYTES) / MORPH_ENTRY_BYTES)
	assert(MORPH_MAP_BYTES > 0, "Invalid bridge memory map: SOMATIC_SFX_CONFIG must be below MARKER")
	assert(
		rawCount <= maxCount,
		"SOMATIC_SFX_CONFIG overflow: entryCount=" .. tostring(rawCount) .. " max=" .. tostring(maxCount)
	)
	local count = rawCount

	for i = 0, count - 1 do
		local off = MORPH_MAP_BASE + MORPH_HEADER_BYTES + i * MORPH_ENTRY_BYTES
		local id = peek(off)
		if id == instrumentId then
			local flags = peek(off + 1)
			local waves = peek(off + 2)
			local packedG0 = peek(off + 3) | (peek(off + 4) << 8) | (peek(off + 5) << 16) | (peek(off + 6) << 24)
			local packedG1 = peek(off + 7) | (peek(off + 8) << 8) | (peek(off + 9) << 16) | (peek(off + 10) << 24)
			local packedG2 = peek(off + 11) | (peek(off + 12) << 8) | (peek(off + 13) << 16)

			local waveEngine = flags & 0x03
			local lowpassEnabled = ((flags >> 2) & 0x01) ~= 0
			local effectKindId = (flags >> 3) & 0x03 -- 0=none,1=wavefold,2=hardSync
			local lowpassModSource = (flags >> 5) & 0x01
			local effectModSource = (flags >> 6) & 0x01

			local sourceWaveformIndex = waves & 0x0f
			local morphWaveB = (waves >> 4) & 0x0f

			local renderWaveformSlot = packedG0 & 0x0f
			local pwmDuty = (packedG0 >> 4) & 0x1f
			local pwmDepth = (packedG0 >> 9) & 0x1f
			local morphDurationInTicks = (packedG0 >> 14) & 0x0fff
			local morphCurveS8 = s6_to_s8((packedG0 >> 26) & 0x3f)

			local lowpassDurationInTicks = packedG1 & 0x0fff
			local lowpassCurveS8 = s6_to_s8((packedG1 >> 12) & 0x3f)
			local effectAmtU8 = (packedG1 >> 18) & 0xff
			local effectDurationLow6 = (packedG1 >> 26) & 0x3f

			local effectDurationHigh6 = packedG2 & 0x3f
			local effectCurveS8 = s6_to_s8((packedG2 >> 6) & 0x3f)
			local lfoCycleInTicks = (packedG2 >> 12) & 0x0fff
			local effectDurationInTicks = (effectDurationHigh6 << 6) | effectDurationLow6

			local wavefoldAmt = 0
			local wavefoldDurationInTicks = 0
			local wavefoldCurveS8 = 0
			local wavefoldModSource = 0
			local hardSyncEnabled = false
			local hardSyncStrengthU8 = 0
			local hardSyncDecayInTicks = 0
			local hardSyncCurveS8 = 0
			local hardSyncModSource = effectModSource

			if effectKindId == 1 then
				wavefoldAmt = effectAmtU8
				wavefoldDurationInTicks = effectDurationInTicks
				wavefoldCurveS8 = effectCurveS8
				wavefoldModSource = effectModSource
			elseif effectKindId == 2 then
				hardSyncEnabled = true
				hardSyncStrengthU8 = effectAmtU8
				hardSyncDecayInTicks = effectDurationInTicks
				hardSyncCurveS8 = effectCurveS8
				hardSyncModSource = effectModSource
			end

			-- Shape matches makeMorphMapLua(): values are numeric IDs.
			return {
				waveEngine = waveEngine,
				sourceWaveformIndex = sourceWaveformIndex,
				morphWaveB = morphWaveB,
				renderWaveformSlot = renderWaveformSlot,
				morphDurationInTicks = morphDurationInTicks,
				morphCurveS8 = morphCurveS8,
				pwmDuty = pwmDuty,
				pwmDepth = pwmDepth,
				lowpassEnabled = lowpassEnabled,
				lowpassDurationInTicks = lowpassDurationInTicks,
				lowpassCurveS8 = lowpassCurveS8,
				wavefoldAmt = wavefoldAmt,
				wavefoldDurationInTicks = wavefoldDurationInTicks,
				wavefoldCurveS8 = wavefoldCurveS8,
				hardSyncEnabled = hardSyncEnabled,
				hardSyncStrengthU8 = hardSyncStrengthU8,
				hardSyncDecayInTicks = hardSyncDecayInTicks,
				hardSyncCurveS8 = hardSyncCurveS8,
				lfoCycleInTicks = lfoCycleInTicks,
				lowpassModSource = lowpassModSource,
				wavefoldModSource = wavefoldModSource,
				hardSyncModSource = hardSyncModSource,
				effectKind = effectKindId,
				effectModSource = effectModSource,
			}
		end
	end

	return nil
end

-- =========================
-- Waveform processing

-- Deserialize a waveform (packed nibbles in RAM) into a 0-based array of samples (0..15).
local function wave_read_samples(waveIndex, outSamples)
	local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
	local si = 0
	for i = 0, WAVE_BYTES_PER_WAVE - 1 do
		local b = peek(base + i)
		outSamples[si] = b & 0x0f
		outSamples[si + 1] = (b >> 4) & 0x0f
		si = si + 2
	end
end

local function wave_write_samples(waveIndex, samples)
	local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
	local si = 0
	for i = 0, WAVE_BYTES_PER_WAVE - 1 do
		local s0 = clamp_nibble_round(samples[si] or 0)
		local s1 = clamp_nibble_round(samples[si + 1] or 0)
		poke(base + i, (s1 << 4) | s0)
		si = si + 2
	end
end

-- s8: -128..127 mapped to -1..+1
local function apply_curveN11(t01, curveS8)
	local t = clamp01(t01 or 0)
	if t <= 0 then
		return 0
	end
	if t >= 1 then
		return 1
	end

	local k = (curveS8 or 0) / 127
	if k < -1 then
		k = -1
	elseif k > 1 then
		k = 1
	end
	if k == 0 then
		return t
	end

	local s = 4
	local function a(x)
		return 2 ^ (s * x)
	end

	if k > 0 then
		return t ^ (a(k))
	end
	return 1 - (1 - t) ^ (a(-k))
end

-- simple lowpass "diffusion"
--   y[i] = x[i] + a * (0.5*(x[i-1] + x[i+1]) - x[i])
--   https://en.wikipedia.org/wiki/Heat_equation
--   https://en.wikipedia.org/wiki/FTCS_scheme
-- x,y are 0-based arrays of length n; amt ~= diffusion strength per step.
local function lp_diffuse_wrap(x, y, n, amt)
	for i = 0, n - 1 do
		local xm1 = x[(i - 1) % n]
		local x0 = x[i]
		local xp1 = x[(i + 1) % n]
		y[i] = x0 + amt * (((xm1 + xp1) * 0.5) - x0)
	end
end

local lp_scratch_a = {}
local lp_scratch_b = {}

local function apply_lowpass_effect_to_samples(samples, strength01)
	local strength = clamp01(strength01 or 0)
	if strength <= 0 then
		return
	end

	-- can adjust the multiplier here for stronger effect; adjusting steps
	local steps = math.floor(1 + strength * 23 + 0.5) -- 1..24
	local amt = 0.02 + strength * 0.88 -- ~0.02..0.90
	if amt > 0.95 then
		amt = 0.95
	end

	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		lp_scratch_a[i] = samples[i] or 0
	end

	local x = lp_scratch_a
	local y = lp_scratch_b
	for _ = 1, steps do
		lp_diffuse_wrap(x, y, WAVE_SAMPLES_PER_WAVE, amt)
		x, y = y, x
	end

	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		samples[i] = x[i]
	end
end

local function fold_reflect(u)
	-- Reflect u into [-1, 1] with repeated folding.
	-- Period 4 in "u-space": [-1..1] then reflected pieces beyond.
	local v = (u + 1) % 4 -- v in [0,4)
	if v > 2 then
		v = 4 - v
	end -- reflect into [0,2]
	return v - 1 -- back to [-1,1]
end

local function apply_wavefold_effect_to_samples(samples, strength01)
	local strength = clamp01(strength01 or 0)
	if strength <= 0 then
		return
	end

	local gain = 1 + strength * 20

	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		local s = samples[i] or 0

		-- 0..15 -> -1..1
		local x = (s / 7.5) - 1

		local folded = fold_reflect(x * gain)

		-- optional dry/wet (keeps strength intuitive)
		--local y = lerp(x, folded, strength)
		local y = folded

		-- -1..1 -> 0..15 (with quantize + clamp)
		local out = (y + 1) * 7.5
		if out < 0 then
			out = 0
		elseif out > 15 then
			out = 15
		end
		samples[i] = math.floor(out + 0.5)
	end
end

local hs_scratch = {}
local function apply_hardsync_effect_to_samples(samples, multiplier)
	local m = multiplier or 1
	if m <= 1.001 then
		return
	end

	local N = WAVE_SAMPLES_PER_WAVE

	for i = 0, N - 1 do
		hs_scratch[i] = samples[i] or 0
	end

	for i = 0, N - 1 do
		local u = (i / N) * m -- slave cycles within master cycle
		local k = math.floor(u)
		local frac = u - k -- 0..1
		local p = frac * N
		local idx0 = math.floor(p)
		local f = p - idx0
		local idx1 = (idx0 + 1) % N

		local s0 = hs_scratch[idx0]
		local s1 = hs_scratch[idx1]
		local v = s0 + (s1 - s0) * f

		samples[i] = v
	end
end

local function cfg_is_k_rate_processing(cfg)
	if cfg.waveEngine == 0 or cfg.waveEngine == 2 then
		return true
	end
	if cfg.lowpassEnabled then
		return true
	end
	if (cfg.wavefoldAmt or 0) > 0 then
		return true
	end
	if (cfg.hardSyncEnabled or 0) ~= 0 and (cfg.hardSyncStrengthU8 or 0) > 0 then
		return true
	end
	return false
end

local render_src_a = {}
local render_src_b = {}
local render_out = {}
local lfo_ticks_by_sfx = {}

local function calculate_mod_t(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks, fallbackT)
	if modSource == MOD_SRC_LFO then
		local cycle = lfoCycleTicks or 0
		if cycle <= 0 then
			return 0
		end
		local phase01 = (lfoTicks % cycle) / cycle
		-- Map sine to 0..1, starting at 0 when phase01=0.
		return (1 - math.cos(phase01 * math.pi * 2)) * 0.5
	end

	if durationTicks == nil or durationTicks <= 0 then
		return fallbackT or 0
	end
	return clamp01(ticksPlayed / durationTicks)
end

local function render_waveform_morph(cfg, ticksPlayed, outSamples)
	local durationTicks = cfg.morphDurationInTicks
	local t
	if durationTicks == nil or durationTicks <= 0 then
		t = 1.0
	else
		t = clamp01(ticksPlayed / durationTicks)
	end

	wave_read_samples(cfg.sourceWaveformIndex, render_src_a)
	wave_read_samples(cfg.morphWaveB, render_src_b)
	for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
		local a = render_src_a[i] or 0
		local b = render_src_b[i] or 0
		outSamples[i] = a + (b - a) * t
	end
	return true
end

local function render_waveform_pwm(cfg, ticksPlayed, instrumentId, lfoTicks, outSamples)
	-- PWM is driven by the per-instrument LFO
	local cycle = cfg.lfoCycleInTicks or 0
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
	local duty = (cfg.pwmDuty or 0) + (cfg.pwmDepth or 0) * tri
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
	if cfg.waveEngine == 0 then
		return render_waveform_morph(cfg, ticksPlayed, outSamples)
	elseif cfg.waveEngine == 2 then
		return render_waveform_pwm(cfg, ticksPlayed, instrumentId, lfoTicks, outSamples)
	elseif cfg.waveEngine == 1 then
		return render_waveform_native(cfg, outSamples)
	end
end

local function render_tick_cfg(cfg, instrumentId, ticksPlayed, lfoTicks)
	if not cfg_is_k_rate_processing(cfg) then
		return
	end

	local rendered = render_waveform_samples(cfg, ticksPlayed, instrumentId, lfoTicks, render_out)
	if not rendered then
		return
	end

	if (cfg.hardSyncEnabled or 0) ~= 0 and (cfg.hardSyncStrengthU8 or 0) > 0 then
		local hsT = calculate_mod_t(
			cfg.hardSyncModSource or MOD_SRC_ENVELOPE,
			cfg.hardSyncDecayInTicks,
			ticksPlayed,
			lfoTicks,
			cfg.lfoCycleInTicks,
			0
		)
		local env = 1 - apply_curveN11(hsT, cfg.hardSyncCurveS8 or 0)
		local multiplier = 1 + ((cfg.hardSyncStrengthU8 or 0) / 255) * 7 * env
		apply_hardsync_effect_to_samples(render_out, multiplier)
	end

	-- Wavefold first (adds harmonics), then lowpass (smooths)
	local wavefoldModSource = cfg.wavefoldModSource or MOD_SRC_ENVELOPE
	local wavefoldHasTime = (wavefoldModSource == MOD_SRC_LFO and (cfg.lfoCycleInTicks or 0) > 0)
		or ((cfg.wavefoldDurationInTicks or 0) > 0)
	if (cfg.wavefoldAmt or 0) > 0 and wavefoldHasTime then
		local maxAmt = clamp01(cfg.wavefoldAmt / 255)
		local wfT = calculate_mod_t(
			wavefoldModSource,
			cfg.wavefoldDurationInTicks,
			ticksPlayed,
			lfoTicks,
			cfg.lfoCycleInTicks,
			0
		)
		local envShaped = 1 - apply_curveN11(wfT, cfg.wavefoldCurveS8)
		local strength = maxAmt * envShaped

		-- log(
		-- 	"wf str "
		-- 		.. tostring(math.floor(strength * 100))
		-- 		.. "% at t="
		-- 		.. tostring(ticksPlayed)
		-- 		.. "/"
		-- 		.. tostring(wfDur)
		-- 		.. " => "
		-- 		.. tostring(envShaped) -- shaped
		-- )

		--log("Wavefold strength: " .. tostring(strength))
		apply_wavefold_effect_to_samples(render_out, strength)
	end

	if cfg.lowpassEnabled then
		local lpT = calculate_mod_t(
			cfg.lowpassModSource or MOD_SRC_ENVELOPE,
			cfg.lowpassDurationInTicks,
			ticksPlayed,
			lfoTicks,
			cfg.lfoCycleInTicks,
			1
		)
		local strength = apply_curveN11(lpT, cfg.lowpassCurveS8)
		apply_lowpass_effect_to_samples(render_out, strength)
	end

	wave_write_samples(cfg.renderWaveformSlot, render_out)
end

local function prime_render_slot_for_note_on(instrumentId)
	local cfg = read_sfx_cfg(instrumentId)
	if cfg == nil then
		return
	end
	if not cfg_is_k_rate_processing(cfg) then
		return
	end
	-- Render tick 0 so audio starts with a defined wavetable.
	local lt = lfo_ticks_by_sfx[instrumentId] or 0
	render_tick_cfg(cfg, instrumentId, 0, lt)
end

local function sfx_tick_channel(channel)
	local idx = ch_sfx_id[channel + 1]
	if idx == -1 then
		return
	end

	local ticksPlayed = ch_sfx_ticks[channel + 1]
	local cfg = read_sfx_cfg(idx)
	if cfg == nil then
		ch_sfx_ticks[channel + 1] = ticksPlayed + 1
		return
	end

	-- Stable pipeline: if not k-rate processing, do nothing.
	if not cfg_is_k_rate_processing(cfg) then
		ch_sfx_ticks[channel + 1] = ticksPlayed + 1
		return
	end

	local lt = lfo_ticks_by_sfx[idx] or 0
	render_tick_cfg(cfg, idx, ticksPlayed, lt)
	ch_sfx_ticks[channel + 1] = ticksPlayed + 1
end

local function advance_all_lfo_ticks()
	local count = peek(MORPH_MAP_BASE)
	for i = 0, count - 1 do
		local id = peek(MORPH_MAP_BASE + MORPH_HEADER_BYTES + i * MORPH_ENTRY_BYTES)
		lfo_ticks_by_sfx[id] = (lfo_ticks_by_sfx[id] or 0) + 1
	end
end

local function sfx_tick()
	advance_all_lfo_ticks()
	for ch = 0, SFX_CHANNELS - 1 do
		sfx_tick_channel(ch)
	end
end

-- =========================
-- Music playback -> SFX channel state tracking
-- =========================
-- We want morphing to follow whatever SFX the tracker is triggering during music playback.
-- This reads the current track frame -> pattern IDs, then reads the pattern row triplets.
local TRACKS_BASE = BRIDGE_CONFIG.memory.TRACKS_ADDR
local PATTERNS_BASE = BRIDGE_CONFIG.memory.PATTERNS_ADDR
local TRACK_BYTES_PER_TRACK = 51
local PATTERN_BYTES_PER_PATTERN = 192
local ROW_BYTES = 3

local last_music_track = -2
local last_music_frame = -1
local last_music_row = -1

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

-- Decode a pattern row's 3-byte triplet into note nibble and sfx id.
-- Triplet layout (see pattern_encoding.ts):
--  byte0: high nibble = argX, low nibble = noteNibble
--  byte1: bit7 = instrument bit5, bits4..6 = command, low nibble = argY
--  byte2: bits5..7 = octave, low5 = instrument low5
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
	-- Only process once per new (track,frame,row) combination.
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
			-- empty cell; keep existing SFX state (note is still held)
		elseif noteNibble < 4 then
			-- stop/cut/off codes
			ch_sfx_id[ch + 1] = -1
			ch_sfx_ticks[ch + 1] = 0
		else
			-- note-on
			ch_sfx_id[ch + 1] = inst
			ch_sfx_ticks[ch + 1] = 0
			prime_render_slot_for_note_on(inst)
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
	sync(24, 0, true)
	publish_cmd(CMD_TRANSMIT, 0)
end

local function handle_play()
	-- assumes host has uploaded music data already to RAM.

	-- Force reload of music data
	-- https://github.com/nesbox/TIC-80/wiki/sync
	-- flags = 8 (sfx) + 16 (music) = 24
	-- bank = 0 (default)
	-- true means sync from runtime -> cart.
	sync(24, 0, true)

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
	-- Ensure the morph slot is initialized before starting audio.
	prime_render_slot_for_note_on(sfx_id)

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
	print("Somatic", 40, y, 12)
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
		print(log_lines[i], 2, 90 + (i - 1) * 8, 6)
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
local bufferALocation = 0x13324 -- pointer to first pattern https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
local bufferBLocation = 0x13624 -- pointer to pattern 4

-- =========================
-- tracker-specific playroutine support

local function getSongOrderCount()
	return peek(ADDR.TF_ORDER_LIST_COUNT)
end

-- Read unsigned LEB128 varint from memory.
-- base:   start address of encoded stream
-- si:     current offset (0-based) into the stream
-- srcLen: total length of the encoded stream (in bytes)
-- Returns: value, next_si
local function read_varint_mem(base, si, srcLen)
	local x = 0
	local factor = 1

	while true do
		if si >= srcLen then
			-- Truncated varint; in your use-case this should never happen.
			return 0, si
		end

		local b = peek(base + si)
		si = si + 1

		local low7 = b % 0x80 -- b & 0x7f
		x = x + low7 * factor
		factor = factor * 0x80 -- *= 128

		if b < 0x80 then
			break
		end
	end

	return x, si
end

-- Decompress from [src .. src+srcLen-1] into [dst ..).
-- Returns number of decompressed bytes written.
function lzdec_mem(src, srcLen, dst)
	local si = 0 -- source offset (0..srcLen-1)
	local di = 0 -- dest offset   (bytes written)

	while si < srcLen do
		local tag = peek(src + si)
		si = si + 1

		if tag == 0x00 then
			-- Literal run: 00 <varint len> <len bytes>
			local len
			len, si = read_varint_mem(src, si, srcLen)

			for j = 1, len do
				local b = peek(src + si)
				si = si + 1
				poke(dst + di, b)
				di = di + 1
			end
		elseif tag == 0x80 then
			-- LZ match: 80 <varint len> <varint dist>
			local len, dist
			len, si = read_varint_mem(src, si, srcLen)
			dist, si = read_varint_mem(src, si, srcLen)

			-- Overlapping copy (LZ-style)
			for j = 1, len do
				local b = peek(dst + di - dist)
				poke(dst + di, b)
				di = di + 1
			end
		elseif tag == 0x81 then
			-- RLE: 81 <varint len> <byte value>
			-- we shouldn't need this.
			local len
			len, si = read_varint_mem(src, si, srcLen)
			local v = peek(src + si)
			si = si + 1

			for j = 1, len do
				poke(dst + di, v)
				di = di + 1
			end
		else
			-- error(string.format("unknown LZ tag 0x%02x at src+%d", tag, si-1))
			break
		end
	end

	return di
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

	-- Decompress directly into destination buffer
	local decompressedSize = lzdec_mem(readPos, patternSize, destPointer)

	-- -- check payload.
	-- log("pattern " .. tostring(patternIndex0b) .. " blitted")
	-- log("COMPRESSED")
	-- log(" size " .. tostring(patternSize))
	-- print_buffer_fingerprint(readPos, patternSize)

	-- log("UNCOMPRESSED")
	-- -- log size compressed & decompressed
	-- log(" size " .. tostring(decompressedSize))
	-- print_buffer_fingerprint(destPointer, decompressedSize)
end

local function swapInPlayorder(songPosition, destPointer)
	local base = ADDR.TF_ORDER_LIST_ENTRIES + songPosition * 4
	for ch = 0, 3 do
		local columnIndex0b = peek(base + ch)
		local dst = destPointer + ch * PATTERN_BYTES_PER_PATTERN
		blitPattern(columnIndex0b, dst)
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
	loopSongForever = false
	log("tf_music_reset_state: Music state reset.")
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

	log("tf_music_init: Starting playback from position " .. tostring(songPosition) .. " row " .. tostring(startRow))

	swapInPlayorder(currentSongOrder, bufferALocation)

	ch_set_playroutine_regs(currentSongOrder)

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
	log("tf_music_tick: currentFrame=" .. tostring(currentFrame) .. " lastPlayingFrame=" .. tostring(lastPlayingFrame))

	if stopPlayingOnNextFrame then
		log("tf_music_tick: Stopping playback; next music frame reached.")
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

	log("tf_music_tick: Advancing to song order " .. tostring(currentSongOrder))
	log("             : Song order count is " .. tostring(orderCount))

	if orderCount == 0 then
		clearPatternBuffer(destPointer)
		stopPlayingOnNextFrame = true
		return
	end

	if currentSongOrder >= orderCount then
		if loopSongForever then
			log("tf_music_tick: Looping back to start of order list.")
			currentSongOrder = 0
		else
			clearPatternBuffer(destPointer)
			stopPlayingOnNextFrame = true
			return
		end
	end

	swapInPlayorder(currentSongOrder, destPointer)
end

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

	poke(CH_REGISTERS.FPS, fps & 0xFF)

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
