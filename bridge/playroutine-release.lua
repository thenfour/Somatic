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

	local morphMap = {}

	local WAVE_BASE = 0x0FFE4
	local WAVE_BYTES_PER_WAVE = 16 -- 32x 4-bit samples packed 2-per-byte
	local WAVE_SAMPLES_PER_WAVE = 32
	local TRACKS_BASE = 0x13E64
	local PATTERNS_BASE = 0x11164
	local TRACK_BYTES_PER_TRACK = 51
	local PATTERN_BYTES_PER_PATTERN = 192
	local ROW_BYTES = 3

	local pk, pe, fl, cos, pi = poke, peek, math.floor, math.cos, math.pi
	local function u16(p)
		return pe(p) + pe(p + 1) * 256
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
					pk(d + o + k, v % 256)
				end
				v = v // 256
			end
		end
		return n
	end

	local function varint(base, si, srcLen)
		local x, f = 0, 1
		while true do
			local b = pe(base + si)
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
			local t = pe(src + si)
			si = si + 1
			if t == 0 then
				local l
				l, si = varint(src, si, srcLen)
				for j = 1, l do
					pk(dst + di, pe(src + si))
					si = si + 1
					di = di + 1
				end
			else
				local l, d
				l, si = varint(src, si, srcLen)
				d, si = varint(src, si, srcLen)
				for j = 1, l do
					pk(dst + di, pe(dst + di - d))
					di = di + 1
				end
			end
		end
		return di
	end

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
		return fl(v + 0.5)
	end

	local function u8_s8(b)
		if b > 0x7f then
			return b - 0x100
		end
		return b
	end

	local function crvN11(t01, curveS8)
		local t = clamp01(t01)
		if t <= 0 then
			return 0
		elseif t >= 1 then
			return 1
		end

		local k = curveS8 / 127
		if k < -1 then
			k = -1
		elseif k > 1 then
			k = 1
		end
		if k == 0 then
			return t
		end

		local e = 2 ^ (4 * math.abs(k))
		return (k > 0) and (t ^ e) or (1 - (1 - t) ^ e)
	end

	local function decode_morph_map()
		local smd = SOMATIC_MUSIC_DATA
		local m = smd.instrumentMorphMap
		local TMP = 0x13B60
		local DST = TMP + 0x200
		base85_decode_to_mem(m.morphMapB85, m.morphMapCLen, TMP)
		lzdec_mem(TMP, m.morphMapCLen, DST)
		local count = pe(DST)
		local off = DST + 1
		for _ = 1, count do
			local id = pe(off)
			local cfg = {
				we = pe(off + 1),
				sA = pe(off + 2),
				sB = pe(off + 3),
				r = pe(off + 4),
				xDcy = u16(off + 5),
				pwmC = u16(off + 7),
				pwmD = pe(off + 9),
				pwmDp = pe(off + 10),
				pwmPh = pe(off + 11),
				lpE = pe(off + 12) ~= 0,
				lpDcy = u16(off + 13),
				wfAmt = pe(off + 15),
				wfDcy = u16(off + 16),
				xCrv = u8_s8(pe(off + 18)),
				lpCrv = u8_s8(pe(off + 19)),
				wfCrv = u8_s8(pe(off + 20)),
				hsE = pe(off + 21) ~= 0,
				hsStr = pe(off + 22),
				hsDcy = u16(off + 23),
				hsCrv = u8_s8(pe(off + 25)),
				lfoC = u16(off + 26),
				lpSrc = pe(off + 28),
				wfSrc = pe(off + 29),
				hsSrc = pe(off + 30),
			}
			morphMap[id] = cfg
			off = off + 31
		end
	end

	local MOD_SRC_ENVELOPE = 0
	local MOD_SRC_LFO = 1

	-- Deserialize a waveform (packed nibbles in RAM) into a 0-based array of samples (0..15).
	local function wave_read_samples(waveIndex, outSamples)
		local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
		local si = 0
		for i = 0, WAVE_BYTES_PER_WAVE - 1 do
			local b = pe(base + i)
			outSamples[si] = b & 0x0f
			outSamples[si + 1] = (b >> 4) & 0x0f
			si = si + 2
		end
	end

	local function wave_write_samples(waveIndex, samples)
		local base = WAVE_BASE + waveIndex * WAVE_BYTES_PER_WAVE
		local si = 0
		for i = 0, WAVE_BYTES_PER_WAVE - 1 do
			local s0 = clamp_nibble_round(samples[si])
			local s1 = clamp_nibble_round(samples[si + 1])
			pk(base + i, (s1 << 4) | s0)
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
		local strength = clamp01(strength01)
		local steps = fl(1 + strength * 23 + 0.5) -- 1..24
		local amt = 0.02 + strength * 0.88 -- ~0.02..0.90
		if amt > 0.95 then
			amt = 0.95
		end
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			lp_scratch_a[i] = samples[i]
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
		local strength = clamp01(strength01)
		local gain = 1 + strength * 20
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			local s = samples[i]
			local x = (s / 7.5) - 1
			local folded = fold_reflect(x * gain)
			local out = (folded + 1) * 7.5
			if out < 0 then
				out = 0
			elseif out > 15 then
				out = 15
			end
			samples[i] = fl(out + 0.5)
		end
	end

	local hs_scratch = {}
	local function apply_hardsync_effect_to_samples(samples, multiplier)
		local m = multiplier
		if m <= 1.001 then
			return
		end

		local N = WAVE_SAMPLES_PER_WAVE

		for i = 0, N - 1 do
			hs_scratch[i] = samples[i]
		end

		for i = 0, N - 1 do
			local u = (i / N) * m -- slave cycles within master cycle
			local k = fl(u)
			local frac = u - k -- 0..1
			local p = frac * N
			local idx0 = fl(p)
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
	local lfo_ticks_by_sfx = {}

	local function calculate_mod_t(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks)
		if modSource == MOD_SRC_LFO then
			local cycle = lfoCycleTicks
			if cycle <= 0 then
				return 0
			end
			local phase01 = (lfoTicks % cycle) / cycle
			return (1 - cos(phase01 * pi * 2)) * 0.5
		end
		return clamp01(ticksPlayed / durationTicks)
	end

	local function has_k_rate(cfg)
		if not cfg then
			return false
		end
		local we = cfg.we
		return we == 0 or we == 2 or cfg.lpE or cfg.wfAmt > 0 or (cfg.hsE and cfg.hsStr > 0)
	end

	local function render_waveform_morph(cfg, ticksPlayed, outSamples)
		local durationTicks = cfg.xDcy
		local t
		if durationTicks == nil or durationTicks <= 0 then
			t = 1.0
		else
			t = clamp01(ticksPlayed / durationTicks)
		end
		wave_read_samples(cfg.sA, render_src_a)
		wave_read_samples(cfg.sB, render_src_b)
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			local a = render_src_a[i] or 0
			local b = render_src_b[i] or 0
			outSamples[i] = a + (b - a) * t
		end
	end

	local function render_waveform_pwm(cfg, ticks, out)
		local c = cfg.pwmC or 0
		local p = (cfg.pwmPh or 0) / 255
		p = ((c > 0 and ((ticks % c) / c) or 0) + p) % 1
		local tri = (p < 0.5) and (p * 4 - 1) or (3 - p * 4)
		local d = (cfg.pwmD or 0) + (cfg.pwmDp or 0) * tri
		if d < 1 then
			d = 1
		elseif d > 30 then
			d = 30
		end
		local thr = (d / 31) * WAVE_SAMPLES_PER_WAVE
		for i = 0, WAVE_SAMPLES_PER_WAVE - 1 do
			out[i] = (i < thr) and 15 or 0
		end
	end

	local function render_waveform_native(cfg, outSamples)
		wave_read_samples(cfg.sA, outSamples)
	end

	local function render_waveform_samples(cfg, ticksPlayed, outSamples)
		local we = cfg.we or cfg.waveEngine or cfg.waveEngineId or 1
		if we == 0 then
			render_waveform_morph(cfg, ticksPlayed, outSamples)
		elseif we == 2 then
			render_waveform_pwm(cfg, ticksPlayed, outSamples)
		elseif we == 1 then
			render_waveform_native(cfg, outSamples)
		end
	end

	local function render_tick_cfg(cfg, instId, ticksPlayed, lfoTicks)
		if not has_k_rate(cfg) then
			return
		end
		render_waveform_samples(cfg, ticksPlayed, render_out)
		if cfg.hsE ~= 0 and cfg.hsStr > 0 then
			local hsT = calculate_mod_t(cfg.hsSrc or MOD_SRC_ENVELOPE, cfg.hsDcy, ticksPlayed, lfoTicks, cfg.lfoC)
			local env = 1 - crvN11(hsT, u8_s8(cfg.hsCrv))
			local multiplier = 1 + ((cfg.hsStr or 0) / 255) * 7 * env
			apply_hardsync_effect_to_samples(render_out, multiplier)
		end
		local wavefoldModSource = cfg.wfSrc or MOD_SRC_ENVELOPE
		local wavefoldHasTime = (wavefoldModSource == MOD_SRC_LFO and cfg.lfoC > 0) or (cfg.wfDcy > 0)
		if cfg.wfAmt > 0 and wavefoldHasTime then
			local maxAmt = clamp01((cfg.wfAmt or 0) / 255)
			local wfT = calculate_mod_t(wavefoldModSource, cfg.wfDcy, ticksPlayed, lfoTicks, cfg.lfoC)
			local envShaped = 1 - crvN11(wfT, u8_s8(cfg.wfCrv))
			local strength = maxAmt * envShaped
			apply_wavefold_effect_to_samples(render_out, strength)
		end
		if cfg.lpE ~= 0 then
			local lpT = calculate_mod_t(cfg.lpSrc or MOD_SRC_ENVELOPE, cfg.lpDcy, ticksPlayed, lfoTicks, cfg.lfoC)
			local strength = crvN11(lpT, u8_s8(cfg.lpCrv))
			apply_lowpass_effect_to_samples(render_out, strength)
		end
		wave_write_samples(cfg.r, render_out)
	end

	local function prime_render_slot_for_note_on(instId)
		local cfg = morphMap and morphMap[instId]
		if not has_k_rate(cfg) then
			return
		end
		local lt = lfo_ticks_by_sfx[instId] or 0
		render_tick_cfg(cfg, instId, 0, lt)
	end

	local function decode_track_frame_patterns(trackIndex, frameIndex)
		if trackIndex == nil or trackIndex < 0 then
			return 0, 0, 0, 0
		end
		local base = TRACKS_BASE + trackIndex * TRACK_BYTES_PER_TRACK + frameIndex * 3
		local b0 = pe(base)
		local pak, s = b0 + u16(base + 1) * 256, 63
		local p0 = pak & s
		local p1 = (pak >> 6) & s
		local p2 = (pak >> 12) & s
		local p3 = (pak >> 18) & s
		return p0, p1, p2, p3
	end

	local function decode_pattern_row(patternId1b, rowIndex)
		if patternId1b == nil or patternId1b == 0 then
			return 0, 0
		end
		local pat0b = patternId1b - 1
		local addr = PATTERNS_BASE + pat0b * PATTERN_BYTES_PER_PATTERN + rowIndex * ROW_BYTES
		local b0 = pe(addr)
		local b1 = pe(addr + 1)
		local b2 = pe(addr + 2)
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
		if not has_k_rate(cfg) then
			ch_sfx_ticks[ch + 1] = ticksPlayed + 1
			return
		end
		local lt = lfo_ticks_by_sfx[instId] or 0
		render_tick_cfg(cfg, instId, ticksPlayed, lt)
		ch_sfx_ticks[ch + 1] = ticksPlayed + 1
	end

	local function sfx_tick(track, frame, row)
		apply_music_row_to_sfx_state(track, frame, row)
		for id, _ in pairs(morphMap) do
			lfo_ticks_by_sfx[id] = (lfo_ticks_by_sfx[id] or 0) + 1
		end
		for ch = 0, SFX_CHANNELS - 1 do
			sfx_tick_channel(ch)
		end
	end

	function somatic_get_channel_state(ch)
		return ch_sfx_id[ch + 1], ch_sfx_ticks[ch + 1]
	end

	decode_morph_map()

	local function getSongOrderCount()
		return #SOMATIC_MUSIC_DATA.songOrder
	end

	local function swapInPlayorder(songPosition0b, destPointer)
		local patternIndex0b = SOMATIC_MUSIC_DATA.songOrder[songPosition0b + 1]
		local patternString = SOMATIC_MUSIC_DATA.patterns[patternIndex0b + 1]
		local patternLengthBytes = SOMATIC_MUSIC_DATA.patternLengths[patternIndex0b + 1]

		local TEMP_DECODE_BUFFER = 0x13B60 -- put temp buffer towards end of the pattern memory
		local decodedLen = base85_decode_to_mem(patternString, patternLengthBytes, TEMP_DECODE_BUFFER)
		lzdec_mem(TEMP_DECODE_BUFFER, decodedLen, destPointer)
	end

	local function getBufferPointer()
		if backBufferIsA then
			return bufferALocation
		end
		return bufferBLocation
	end

	local function clearPatternBuffer(destPointer)
		for i = 0, PATTERN_BUFFER_BYTES - 1 do
			pk(destPointer + i, 0)
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
		pk(0x14000, 15)
		for ch = 0, 3 do
			pk(0x14001 + ch, 15)
		end
		currentSongOrder = songPosition
		backBufferIsA = true
		lastPlayingFrame = -1
		stopPlayingOnNextFrame = false
		swapInPlayorder(currentSongOrder, bufferALocation)
		music(0, 0, startRow, true, true)
	end

	function somatic_get_state()
		local track = u8_s8(pe(0x13FFC))
		local frame = pe(0x13FFD)
		local row = pe(0x13FFE)
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
		sfx_tick(track, currentFrame, row)
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
