-- PLAYROUTINE_AUTOGEN_START

-- injected at build time.

-- PLAYROUTINE_AUTOGEN_END

-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
	songOrder = { { 0, 0, 0, 0 }, { 0, 0, 0, 0 }, { 0, 0, 0, 0 } },
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
	local curOrd = 0 -- back buffer
	local playOrd = 0 --front
	local lastFrame = -1
	local backA = false
	local stopNext = false
	local PBUF = 768

	local MOD_SRC_ENVELOPE = 0
	local MOD_SRC_LFO = 1

	local WAVE_ENGINE_MORPH = 0
	local WAVE_ENGINE_NATIVE = 1
	local WAVE_ENGINE_PWM = 2

	local EFFECT_KIND_NONE = 0
	local EFFECT_KIND_WAVEFOLD = 1
	local EFFECT_KIND_HARDSYNC = 2

	-- Wave morphing (music playback only)
	local SFX_CHANNELS = 4
	local chId = { -1, -1, -1, -1 }
	local chTk = { 0, 0, 0, 0 }
	local lastTrk = -2
	local lastFrm = -1
	local lastRow = -1

	local morphs = {}

	local WBYTES = 16 -- 32x 4-bit samples packed 2-per-byte
	local WSAMPLES = 32
	local TRK_BYTES = 51
	local PAT_BYTES = 192
	local ROW_BYTES = 3

	local pk, pe, fl, cos, pi = poke, peek, math.floor, math.cos, math.pi
	local function u16(p)
		return pe(p) + pe(p + 1) * 256
	end

	local function b85d(s, n, d)
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

	local function vi(base, si, srcLen)
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

	local function lzdm(src, srcLen, dst)
		local si, di = 0, 0
		while si < srcLen do
			local t = pe(src + si)
			si = si + 1
			if t == 0 then
				local l
				l, si = vi(src, si, srcLen)
				for j = 1, l do
					pk(dst + di, pe(src + si))
					si = si + 1
					di = di + 1
				end
			else
				local l, d
				l, si = vi(src, si, srcLen)
				d, si = vi(src, si, srcLen)
				for j = 1, l do
					pk(dst + di, pe(dst + di - d))
					di = di + 1
				end
			end
		end
		return di
	end

	local function cl01(x)
		if x < 0 then
			return 0
		elseif x > 1 then
			return 1
		end
		return x
	end

	local function cnr(v)
		if v < 0 then
			v = 0
		elseif v > 15 then
			v = 15
		end
		return fl(v + 0.5)
	end

	local function u8s8(b)
		if b > 0x7f then
			return b - 0x100
		end
		return b
	end

	local function s6s8(b)
		local v = b & 0x3f
		if v >= 0x20 then
			v = v - 0x40
		end
		return fl(v * 127 / 31)
	end

	local function crvN11(t01, curveS6)
		local t = cl01(t01)
		if t <= 0 then
			return 0
		elseif t >= 1 then
			return 1
		end

		local k = curveS6 / 31 -- curveS6 is signed 6-bit (-32..31)
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

	local function dmorph()
		local m = SOMATIC_MUSIC_DATA.instrumentMorphMap
		b85d(m.morphMapB85, m.morphMapCLen, __AUTOGEN_TEMP_PTR_A)
		lzdm(__AUTOGEN_TEMP_PTR_A, m.morphMapCLen, __AUTOGEN_TEMP_PTR_B)
		local count = pe(__AUTOGEN_TEMP_PTR_B)
		local o = __AUTOGEN_TEMP_PTR_B + MORPH_HEADER_BYTES
		for _ = 1, count do
			local entry = decode_MorphEntry(o)
			local z = {
				we = entry.waveEngineId,
				sA = entry.sourceWaveformIndex,
				sB = entry.morphWaveB,
				r = entry.renderWaveformSlot,
				pwmD = entry.pwmDuty5,
				pwmDp = entry.pwmDepth5,
				xDcy = entry.morphDurationTicks12,
				xCrv = entry.morphCurveS6,
				lpE = entry.lowpassEnabled,
				lpDcy = entry.lowpassDurationTicks12,
				lpCrv = entry.lowpassCurveS6,
				lpSrc = entry.lowpassModSource,
				effK = entry.effectKind,
				effAmt = entry.effectAmtU8,
				effDcy = entry.effectDurationTicks12,
				effCrv = entry.effectCurveS6,
				effSrc = entry.effectModSource,
				lfoC = entry.lfoCycleTicks12,
			}
			morphs[entry.instrumentId] = z
			o = o + MORPH_ENTRY_BYTES
		end
	end

	-- Deserialize a waveform (packed nibbles in RAM) into a 0-based array of samples (0..15).
	local function wread(waveIndex, outSamples)
		local base = WAVE_BASE + waveIndex * WBYTES
		local si = 0
		for i = 0, WBYTES - 1 do
			local b = pe(base + i)
			outSamples[si] = b & 0x0f
			outSamples[si + 1] = (b >> 4) & 0x0f
			si = si + 2
		end
	end

	local function wwrite(waveIndex, samples)
		local base = WAVE_BASE + waveIndex * WBYTES
		local si = 0
		for i = 0, WBYTES - 1 do
			local s0 = cnr(samples[si])
			local s1 = cnr(samples[si + 1])
			pk(base + i, (s1 << 4) | s0)
			si = si + 2
		end
	end

	local lfp
	-- BEGIN_FEATURE_LOWPASS
	local function lpdiff(x, y, n, amt)
		for i = 0, n - 1 do
			local xm1 = x[(i - 1) % n]
			local x0 = x[i]
			local xp1 = x[(i + 1) % n]
			y[i] = x0 + amt * (((xm1 + xp1) * 0.5) - x0)
		end
	end

	local lp_scratch_a = {}
	local lp_scratch_b = {}

	lfp = function(samples, strength01)
		local strength = cl01(strength01)
		local steps = fl(1 + strength * 23 + 0.5) -- 1..24
		local amt = 0.02 + strength * 0.88 -- ~0.02..0.90
		if amt > 0.95 then
			amt = 0.95
		end
		for i = 0, WSAMPLES - 1 do
			lp_scratch_a[i] = samples[i]
		end
		local x = lp_scratch_a
		local y = lp_scratch_b
		for _ = 1, steps do
			lpdiff(x, y, WSAMPLES, amt)
			x, y = y, x
		end
		for i = 0, WSAMPLES - 1 do
			samples[i] = x[i]
		end
	end
	-- END_FEATURE_LOWPASS

	local wfold
	-- BEGIN_FEATURE_WAVEFOLD
	local function fold_reflect(u)
		local v = (u + 1) % 4
		if v > 2 then
			v = 4 - v
		end
		return v - 1
	end

	wfold = function(samples, strength01)
		local strength = cl01(strength01)
		local gain = 1 + strength * 20
		for i = 0, WSAMPLES - 1 do
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
	-- END_FEATURE_WAVEFOLD

	local hsync
	-- BEGIN_FEATURE_HARDSYNC
	local hs_scratch = {}
	hsync = function(samples, multiplier)
		local m = multiplier
		if m <= 1.001 then
			return
		end

		local N = WSAMPLES

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
	-- END_FEATURE_HARDSYNC

	local srcA = {}
	local srcB = {}
	local render = {}
	local lfoTicks
	-- BEGIN_FEATURE_LFO
	lfoTicks = {}
	-- END_FEATURE_LFO

	local function ct(modSource, durationTicks, ticksPlayed, lfoTicks, lfoCycleTicks)
		-- BEGIN_FEATURE_LFO
		if modSource == MOD_SRC_LFO then
			local cycle = lfoCycleTicks
			if cycle <= 0 then
				return 0
			end
			local phase01 = (lfoTicks % cycle) / cycle
			return (1 - cos(phase01 * pi * 2)) * 0.5
		end
		-- END_FEATURE_LFO
		return cl01(ticksPlayed / durationTicks)
	end

	local r_morph
	-- BEGIN_FEATURE_WAVEMORPH
	r_morph = function(cfg, ticksPlayed, outSamples)
		local durationTicks = cfg.xDcy
		local t
		if durationTicks == nil or durationTicks <= 0 then
			t = 1.0
		else
			t = cl01(ticksPlayed / durationTicks)
		end
		wread(cfg.sA, srcA)
		wread(cfg.sB, srcB)
		for i = 0, WSAMPLES - 1 do
			local a = srcA[i]
			local b = srcB[i]
			outSamples[i] = a + (b - a) * t
		end
	end
	-- END_FEATURE_WAVEMORPH

	local r_pwm
	-- BEGIN_FEATURE_PWM
	r_pwm = function(cfg, ticks, out, lfoTicks)
		local c = cfg.lfoC
		local p = 0
		if c > 0 then
			p = (lfoTicks % c) / c
		end
		local tri = (p < 0.5) and (p * 4 - 1) or (3 - p * 4)
		local d = cfg.pwmD + cfg.pwmDp * tri
		if d < 1 then
			d = 1
		elseif d > 30 then
			d = 30
		end
		local thr = (d / 31) * WSAMPLES
		for i = 0, WSAMPLES - 1 do
			out[i] = (i < thr) and 15 or 0
		end
	end
	-- END_FEATURE_PWM

	local function r_native(cfg, outSamples)
		wread(cfg.sA, outSamples)
	end

	local function r_wave(cfg, ticksPlayed, outSamples, lfoTicks)
		local we = cfg.we
		if we == WAVE_ENGINE_MORPH then
			if r_morph then
				r_morph(cfg, ticksPlayed, outSamples)
			else
				r_native(cfg, outSamples)
			end
		elseif we == WAVE_ENGINE_PWM then
			if r_pwm then
				r_pwm(cfg, ticksPlayed, outSamples, lfoTicks)
			else
				r_native(cfg, outSamples)
			end
		elseif we == WAVE_ENGINE_NATIVE then
			r_native(cfg, outSamples)
		end
	end

	local function hask(cfg)
		if not cfg then
			return false
		end
		local we = cfg.we
		return (r_morph and we == WAVE_ENGINE_MORPH)
			or (r_pwm and we == WAVE_ENGINE_PWM)
			or (lfp and cfg.lpE ~= 0)
			or (wfold and cfg.effK == EFFECT_KIND_WAVEFOLD and cfg.effAmt > 0)
			or (hsync and cfg.effK == EFFECT_KIND_HARDSYNC and cfg.effAmt > 0)
	end

	local function rtick(cfg, instId, ticksPlayed, lfoTicks)
		if not hask(cfg) then
			return
		end
		r_wave(cfg, ticksPlayed, render, lfoTicks)
		if hsync and cfg.effK == EFFECT_KIND_HARDSYNC and cfg.effAmt > 0 then
			local hsT = ct(cfg.effSrc, cfg.effDcy, ticksPlayed, lfoTicks, cfg.lfoC)
			local env = 1 - crvN11(hsT, cfg.effCrv)
			local multiplier = 1 + (cfg.effAmt / 255) * 7 * env
			hsync(render, multiplier)
		end
		if wfold then
			local wavefoldHasTime = (cfg.effSrc == MOD_SRC_LFO and cfg.lfoC > 0) or (cfg.effDcy > 0)
			if cfg.effK == EFFECT_KIND_WAVEFOLD and cfg.effAmt > 0 and wavefoldHasTime then
				local maxAmt = cl01(cfg.effAmt / 255)
				local wfT = ct(cfg.effSrc, cfg.effDcy, ticksPlayed, lfoTicks, cfg.lfoC)
				local envShaped = 1 - crvN11(wfT, cfg.effCrv)
				local strength = maxAmt * envShaped
				wfold(render, strength)
			end
		end
		if lfp and cfg.lpE ~= 0 then
			local lpT = ct(cfg.lpSrc, cfg.lpDcy, ticksPlayed, lfoTicks, cfg.lfoC)
			local strength = crvN11(lpT, cfg.lpCrv)
			lfp(render, strength)
		end
		wwrite(cfg.r, render)
	end

	local function prime(instId)
		local cfg = morphs[instId]
		if not hask(cfg) then
			return
		end
		local lt = 0
		-- BEGIN_FEATURE_LFO
		lt = lfoTicks[instId] or 0
		-- END_FEATURE_LFO
		rtick(cfg, instId, 0, lt)
	end

	local function dtfp(trackIndex, frameIndex)
		if trackIndex == nil or trackIndex < 0 then
			return 0, 0, 0, 0
		end
		local base = TRACKS_BASE + trackIndex * TRK_BYTES + frameIndex * 3
		local p, s = pe(base) + u16(base + 1) * 256, 63
		return p & s, (p >> 6) & s, (p >> 12) & s, (p >> 18) & s
	end

	local function dpr(patternId1b, rowIndex)
		if patternId1b == nil or patternId1b == 0 then
			return 0, 0
		end
		local pat0b = patternId1b - 1
		local addr = PATTERNS_BASE + pat0b * PAT_BYTES + rowIndex * ROW_BYTES
		local b0 = pe(addr)
		local b1 = pe(addr + 1)
		local b2 = pe(addr + 2)
		local noteNibble = b0 & 0x0f
		local inst = (b2 & 0x1f) | (((b1 >> 7) & 0x01) << 5)
		return noteNibble, inst
	end

	local function applyRow(track, frame, row)
		if track == lastTrk and frame == lastFrm and row == lastRow then
			return
		end
		lastTrk = track
		lastFrm = frame
		lastRow = row

		local p0, p1, p2, p3 = dtfp(track, frame)
		local patterns = { p0, p1, p2, p3 }

		for ch = 0, SFX_CHANNELS - 1 do
			local patternId1b = patterns[ch + 1]
			local noteNibble, inst = dpr(patternId1b, row)
			if noteNibble == 0 then
				-- no event
			elseif noteNibble < 4 then
				chId[ch + 1] = -1
				chTk[ch + 1] = 0
			else
				chId[ch + 1] = inst
				chTk[ch + 1] = 0
				prime(inst)
			end
		end
	end

	local function stc(ch)
		local instId = chId[ch + 1]
		if instId == -1 then
			return
		end
		local ticksPlayed = chTk[ch + 1]
		local cfg = morphs[instId]
		if not hask(cfg) then
			chTk[ch + 1] = ticksPlayed + 1
			return
		end
		local lt = 0
		-- BEGIN_FEATURE_LFO
		lt = lfoTicks[instId] or 0
		-- END_FEATURE_LFO
		rtick(cfg, instId, ticksPlayed, lt)
		chTk[ch + 1] = ticksPlayed + 1
	end

	local function st(track, frame, row)
		applyRow(track, frame, row)
		-- BEGIN_FEATURE_LFO
		for id, _ in pairs(morphs) do
			lfoTicks[id] = (lfoTicks[id] or 0) + 1
		end
		-- END_FEATURE_LFO
		for ch = 0, SFX_CHANNELS - 1 do
			stc(ch)
		end
	end

	function somatic_get_channel_state(ch)
		return chId[ch + 1], chTk[ch + 1]
	end

	dmorph()

	local function blitCol(columnIndex0b, destPointer)
		local entry = SOMATIC_MUSIC_DATA.patterns[columnIndex0b + 1]
		local clen = SOMATIC_MUSIC_DATA.patternLengths[columnIndex0b + 1]
		if type(entry) == "number" then
			lzdm(entry + PATTERNS_BASE, clen, destPointer)
		else
			lzdm(__AUTOGEN_TEMP_PTR_A, b85d(entry, clen, __AUTOGEN_TEMP_PTR_A), destPointer)
		end
	end

	local function swapPO(songPosition0b, destPointer)
		local entry = SOMATIC_MUSIC_DATA.songOrder[songPosition0b + 1]
		for ch = 0, 3 do
			local columnIndex0b = entry[ch + 1]
			local dst = destPointer + ch * PAT_BYTES
			blitCol(columnIndex0b, dst)
		end
	end

	local function somatic_init(songPosition, startRow)
		songPosition = songPosition or 0
		startRow = startRow or 0
		pk(0x14000, 15)
		for ch = 0, 3 do
			pk(0x14001 + ch, 15)
		end
		curOrd = songPosition
		backA = true
		lastFrame = -1
		stopNext = false
		swapPO(curOrd, __AUTOGEN_BUF_PTR_A)
		music(0, 0, startRow, true, true)
	end

	function somatic_get_state()
		local track = u8s8(pe(0x13FFC))
		local frame = pe(0x13FFD)
		local row = pe(0x13FFE)
		return track, playOrd, frame, row
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
		st(track, currentFrame, row)
		if currentFrame == lastFrame then
			return
		end
		if stopNext then
			music()
			curOrd = 0
			lastFrame = -1
			backA = false
			stopNext = false
			return
		end
		backA = not backA
		lastFrame = currentFrame
		playOrd = curOrd
		curOrd = curOrd + 1
		local destPointer = backA and __AUTOGEN_BUF_PTR_A or __AUTOGEN_BUF_PTR_B
		if curOrd >= #SOMATIC_MUSIC_DATA.songOrder then
			for i = 0, PBUF - 1 do
				pk(destPointer + i, 0)
			end
			stopNext = true
			return
		end
		swapPO(curOrd, destPointer)
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
