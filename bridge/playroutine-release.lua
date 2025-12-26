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
	local WAVE_SAMPLES_PER_WAVE = 32
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

	local function clamp_nibble_round(v)
		if v < 0 then
			v = 0
		elseif v > 15 then
			v = 15
		end
		return math.floor(v + 0.5)
	end

	local function u8_to_s8(b)
		if b > 0x7f then
			return b - 0x100
		end
		return b
	end

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

	local MOD_SRC_ENVELOPE = 0
	local MOD_SRC_LFO = 1

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
		local v = (u + 1) % 4
		if v > 2 then
			v = 4 - v
		end
		return v - 1
	end

	local function apply_wavefold_effect_to_samples(samples, strength01)
		local strength = clamp01(strength01 or 0)
		if strength <= 0 then
			return
		end
		local gain = 1 + strength * 20
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			local s = samples[i] or 0
			local x = (s / 7.5) - 1
			local folded = fold_reflect(x * gain)
			local out = (folded + 1) * 7.5
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

	local render_src_a = {}
	local render_src_b = {}
	local render_out = {}
	local lfo_ticks = 0

	local function calculate_mod_t(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks, fallbackT)
		if modSource == MOD_SRC_LFO then
			local cycle = lfoCycleTicks or 0
			if cycle <= 0 then
				return 0
			end
			local phase01 = (lfoTicks % cycle) / cycle
			return (1 - math.cos(phase01 * math.pi * 2)) * 0.5
		end
		if durationTicks == nil or durationTicks <= 0 then
			return fallbackT or 0
		end
		return clamp01(ticksPlayed / durationTicks)
	end

	local function cfg_is_k_rate_processing(cfg)
		if not cfg then
			return false
		end
		local we = cfg.waveEngine or cfg.waveEngineId or 1
		if we == 0 or we == 2 then
			return true
		end
		if (cfg.lowpassEnabled or 0) ~= 0 then
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

	local function render_waveform_pwm(cfg, ticks, out)
		local c = cfg.pwmCycleInTicks or 0
		local p = (cfg.pwmPhaseU8 or 0) / 255
		p = ((c > 0 and ((ticks % c) / c) or 0) + p) % 1
		local tri = (p < 0.5) and (p * 4 - 1) or (3 - p * 4)
		local d = (cfg.pwmDuty or 0) + (cfg.pwmDepth or 0) * tri
		if d < 1 then
			d = 1
		elseif d > 30 then
			d = 30
		end
		local thr = (d / 31) * WAVE_SAMPLES_PER_WAVE
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			out[i] = (i < thr) and 15 or 0
		end
		return true
	end

	local function render_waveform_native(cfg, outSamples)
		wave_read_samples(cfg.sourceWaveformIndex, outSamples)
		return true
	end

	local function render_waveform_samples(cfg, ticksPlayed, outSamples)
		local we = cfg.waveEngine or cfg.waveEngineId or 1
		if we == 0 then
			return render_waveform_morph(cfg, ticksPlayed, outSamples)
		elseif we == 2 then
			return render_waveform_pwm(cfg, ticksPlayed, outSamples)
		elseif we == 1 then
			return render_waveform_native(cfg, outSamples)
		end
		return false
	end

	local function render_tick_cfg(cfg, instId, ticksPlayed, lfoTicks)
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		if not render_waveform_samples(cfg, ticksPlayed, render_out) then
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
			local env = 1 - apply_curveN11(hsT, u8_to_s8(cfg.hardSyncCurveS8 or 0))
			local multiplier = 1 + ((cfg.hardSyncStrengthU8 or 0) / 255) * 7 * env
			apply_hardsync_effect_to_samples(render_out, multiplier)
		end
		local wavefoldModSource = cfg.wavefoldModSource or MOD_SRC_ENVELOPE
		local wavefoldHasTime = (wavefoldModSource == MOD_SRC_LFO and (cfg.lfoCycleInTicks or 0) > 0)
			or ((cfg.wavefoldDurationInTicks or 0) > 0)
		if (cfg.wavefoldAmt or 0) > 0 and wavefoldHasTime then
			local maxAmt = clamp01((cfg.wavefoldAmt or 0) / 255)
			local wfT = calculate_mod_t(
				wavefoldModSource,
				cfg.wavefoldDurationInTicks,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleInTicks,
				0
			)
			local envShaped = 1 - apply_curveN11(wfT, u8_to_s8(cfg.wavefoldCurveS8 or 0))
			local strength = maxAmt * envShaped
			apply_wavefold_effect_to_samples(render_out, strength)
		end
		if (cfg.lowpassEnabled or 0) ~= 0 then
			local lpT = calculate_mod_t(
				cfg.lowpassModSource or MOD_SRC_ENVELOPE,
				cfg.lowpassDurationInTicks,
				ticksPlayed,
				lfoTicks,
				cfg.lfoCycleInTicks,
				1
			)
			local strength = apply_curveN11(lpT, u8_to_s8(cfg.lowpassCurveS8 or 0))
			apply_lowpass_effect_to_samples(render_out, strength)
		end
		wave_write_samples(cfg.renderWaveformSlot, render_out)
	end

	local function prime_render_slot_for_note_on(instId)
		local cfg = morphMap and morphMap[instId]
		if not cfg_is_k_rate_processing(cfg) then
			return
		end
		render_tick_cfg(cfg, instId, 0, lfo_ticks)
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
				prime_render_slot_for_note_on(inst)
			end
		end
	end

	local function sfx_tick_channel(ch)
		local instId = ch_sfx_id[ch + 1]
		if instId == -1 then
			return
		end
		local ticksPlayed = ch_sfx_ticks[ch + 1]
		local cfg = morphMap and morphMap[instId]
		if not cfg_is_k_rate_processing(cfg) then
			ch_sfx_ticks[ch + 1] = ticksPlayed + 1
			return
		end
		render_tick_cfg(cfg, instId, ticksPlayed, lfo_ticks)
		ch_sfx_ticks[ch + 1] = ticksPlayed + 1
	end

	local function tf_music_morph_tick(track, frame, row)
		lfo_ticks = lfo_ticks + 1
		apply_music_row_to_sfx_state(track, frame, row)
		for ch = 0, SFX_CHANNELS - 1 do
			sfx_tick_channel(ch)
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
		end
		return bufferBLocation
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
