-- title: Sine-wave speech POC
-- author: Somatic project
-- desc: Three published speech-formant trajectories rendered by TIC-80 wavetable channels
-- script: lua

-- Purpose
-- -------
-- This cart tests whether TIC-80 can reproduce established sine-wave speech
-- using only its normal wavetable sound registers. It is deliberately not a
-- text-to-speech implementation and does not play PCM samples.
--
-- Source and distribution
-- -----------------------
-- Trajectory source: Haskins Laboratories / Dan Ellis, s1pars.swi.
-- https://www.haskinslaboratories.org/sws-information
-- https://www.ee.columbia.edu/~dpwe/resources/matlab/sws/
--
-- The Haskins page describes the source package as (c) 1996 Dan Ellis and
-- Haskins Laboratories and available for noncommercial distribution. Confirm
-- licensing separately before redistributing this data outside the POC.
--
-- Conversion performed for this cart:
--   * parse 200 source control frames at 10 ms intervals (100 Hz)
--   * linearly interpolate frequency and magnitude at 60 Hz
--   * round frequency to the TIC-80 12-bit Hz register value
--   * round normalized magnitude to 8 bits
--
-- Runtime data layout is nine bytes per frame. Each of the three oscillator
-- records is: frequency low byte, frequency high nibble, magnitude U8.
-- Keeping magnitude at 8 bits lets the cart compare two mappings into TIC's
-- 4-bit channel volume without changing the embedded speech trajectory.

local SOUND_REGISTERS_BASE = 0x0ff9c
local SOUND_REGISTER_BYTES = 18
local WAVEFORM_OFFSET = 2
local FRAME_COUNT = 120
local BYTES_PER_FRAME = 9
local EXPECTED_DATA_CHECKSUM = 2566

-- A 32-sample, 4-bit sine centered around 7.5, packed two samples per byte.
-- The first sample occupies the low nibble, matching TIC-80 waveform storage.
local SINE_BYTES = {
	152, 202, 237, 254, 255, 238, 205, 154,
	104, 53, 18, 1, 0, 17, 50, 101,
}

-- S1 control tracks resampled from 100 Hz to 60 Hz. Hex keeps the source cart
-- ASCII-only and makes the packed representation inspectable.
local DATA_HEX =
	"000000000000000000000000000000000000000000000000000000000000000000000000" ..
	"000000000000000000000000000000000000000000000000000000da0096000000000000" ..
	"f700a8000000000000f700b50000000000002301f64702000000006701a2f2033e80080c" ..
	"980178d7043d500821be0191e70542150841d7016f650675f40764ef0156a9068224086e" ..
	"f90152a90671630846fe01688c06676d082afe01786f069f330823fe016e3e0689e5072b" ..
	"fe0167120673a50724fe015ddd057367071ffe0159ad0568230722fe016650055e050723" ..
	"fe0185110542f2061bf401a2a10446f20611ea01981e043cf20614b5019a79033e2c070c" ..
	"8501b1fa02466b07064001e4bb02649707034001cbe70246a107034001cb260340750705" ..
	"6701cb6f037d4907098901d5b30354f206169801ab1e0468d5061c9301aa970461df061c" ..
	"8901a32e05620f071580018ad4054e6c07147b016d56063c5e080e6c0165b8062148090c" ..
	"2d019e3107240f0a120601d07f0712920a130601c2a10710d10a1e0601c3af070c9c0a1b" ..
	"0601c6af0715490a1b0601d0af0718f709180601bfaf0736a90927150180a507494c0948" ..
	"40018c750742ff08435d015d2c0742b10864710156bd06409408457b014a3406318a0827" ..
	"7b016d99053e8a082b89015bf904178a081f89016d7104009908197b0177010410d8080d" ..
	"7b01639603282609057b017379031e4809057b014a74031c4d09047601a18c0333430906" ..
	"6c01a51904202a090d6c0188f9041f1c091071019bdd05181c09124001c68c062b39091f" ..
	"1901bb310700a90918f700e09c070d530a1cf700d2ea0722e00a22da00cc2e08236d0b24" ..
	"da00ad4608178f0b31da00b35e08168f0b20da00c66d080f850b26da00ff6d0812590b23" ..
	"da00ff5e0810370b11ed00ff500825e00a0ef700f23c0832af0a180601d233082a5d0a15" ..
	"1e01dc29083e0f0a273201ff070839d9091c3201ffcd07395609104001f097071c2b0917" ..
	"4001fc3b072ad808105d01b50107278a08156701bda406474108206c01e4430664ef072f" ..
	"6c01e9dd0560a107267f01ed64055e5d07159801b2dc045d22070d980198620461d50610" ..
	"be017136046ed5060ec80176450455d50613e10173620460010711e10172a60480660709" ..
	"e1015fe10479a60716e10142f4044cdb0722a1017e3c05321a08154a016a00000038080d" ..
	"2301000000000000000000000000005a0500800144d7010055082598019185054f7c0834" ..
	"d7018b5a0539a20832eb01aa460532dd083a1b02832e0536f008302e028411052b120914" ..
	"3d028ff4044a2a0900470270e5043239092747027ed7040039092942027db40418390929" ..
	"3802859c043848091f38028a93043348092129027c7504254809241b0285530423560922" ..
	"1b027d2d0431600926fe01900f0431650924e1016ded032165091b980170a50343220300" ..
	"f300005b035e0000000000003e0300000000000000000000000000000000000000000000"

local MODE_LINEAR = 1
local MODE_LOG_42_DB = 2
local mode = MODE_LINEAR
local frame = 0
local playing = false
local dataError = nil
local currentFrequency = { 0, 0, 0 }
local currentMagnitude = { 0, 0, 0 }
local currentVolume = { 0, 0, 0 }

local function clamp(value, minimum, maximum)
	return math.min(math.max(value, minimum), maximum)
end

local function readHexByte(byteIndex)
	local charIndex = byteIndex * 2 + 1
	return tonumber(DATA_HEX:sub(charIndex, charIndex + 1), 16)
end

local function validateData()
	local expectedHexChars = FRAME_COUNT * BYTES_PER_FRAME * 2
	if #DATA_HEX ~= expectedHexChars then
		return "length " .. #DATA_HEX .. ", expected " .. expectedHexChars
	end

	local checksum = 0
	for byteIndex = 0, FRAME_COUNT * BYTES_PER_FRAME - 1 do
		local value = readHexByte(byteIndex)
		if value == nil then
			return "invalid hex at byte " .. byteIndex
		end
		checksum = (checksum + value) & 0xffff
	end

	if checksum ~= EXPECTED_DATA_CHECKSUM then
		return "checksum " .. checksum .. ", expected " .. EXPECTED_DATA_CHECKSUM
	end
	return nil
end

local function readTrack(frameIndex, channel)
	local byteIndex = frameIndex * BYTES_PER_FRAME + channel * 3
	local frequencyLow = readHexByte(byteIndex)
	local frequencyHigh = readHexByte(byteIndex + 1)
	local magnitude = readHexByte(byteIndex + 2)
	return frequencyLow | (frequencyHigh << 8), magnitude
end

local function quantizeMagnitude(magnitude)
	if magnitude <= 0 then
		return 0
	end

	if mode == MODE_LINEAR then
		return clamp(math.floor(magnitude * 15 / 255 + 0.5), 0, 15)
	end

	-- Experimental companding: preserve nonzero control values across a 42 dB
	-- range before TIC's linear 4-bit volume register. This intentionally alters
	-- the original relative amplitudes; it is an A/B diagnostic, not the baseline.
	local decibels = 20 * math.log(magnitude / 255) / math.log(10)
	local normalized = clamp((decibels + 42) / 42, 0, 1)
	return clamp(math.floor(1 + normalized * 14 + 0.5), 1, 15)
end

local function writeVoice(channel, frequency, volume)
	local base = SOUND_REGISTERS_BASE + channel * SOUND_REGISTER_BYTES
	local control = clamp(frequency, 0, 0x0fff) | (clamp(volume, 0, 15) << 12)
	poke(base, control & 0xff)
	poke(base + 1, (control >> 8) & 0xff)
	for byteIndex = 0, 15 do
		poke(base + WAVEFORM_OFFSET + byteIndex, SINE_BYTES[byteIndex + 1])
	end
end

local function silenceAllVoices()
	for channel = 0, 3 do
		local base = SOUND_REGISTERS_BASE + channel * SOUND_REGISTER_BYTES
		poke(base, 0)
		poke(base + 1, 0)
	end
end

local function restart()
	frame = 0
	playing = dataError == nil
	for channel = 1, 3 do
		currentFrequency[channel] = 0
		currentMagnitude[channel] = 0
		currentVolume[channel] = 0
	end
end

local function renderSpeechFrame()
	if not playing or frame >= FRAME_COUNT then
		playing = false
		silenceAllVoices()
		return
	end

	for channel = 0, 2 do
		local frequency, magnitude = readTrack(frame, channel)
		local volume = quantizeMagnitude(magnitude)
		currentFrequency[channel + 1] = frequency
		currentMagnitude[channel + 1] = magnitude
		currentVolume[channel + 1] = volume
		writeVoice(channel, frequency, volume)
	end

	-- Reserve channel four for a later, separately testable noise experiment.
	local fourthChannelBase = SOUND_REGISTERS_BASE + 3 * SOUND_REGISTER_BYTES
	poke(fourthChannelBase, 0)
	poke(fourthChannelBase + 1, 0)
	frame = frame + 1
end

local TRACK_COLORS = { 12, 11, 10 }

local function drawTrack(channel, y)
	local frequency = currentFrequency[channel]
	local magnitude = currentMagnitude[channel]
	local volume = currentVolume[channel]
	local color = TRACK_COLORS[channel]
	print("F" .. channel, 8, y, color)
	print(string.format("%4d Hz", frequency), 24, y, 15)
	print(string.format("src %3d", magnitude), 80, y, 6)
	print(string.format("vol %2d", volume), 132, y, 15)
	rect(176, y + 1, 48, 4, 1)
	if volume > 0 then
		rect(176, y + 1, math.floor(volume * 48 / 15), 4, color)
	end
end

local function drawInterface()
	cls(0)
	print("SINE-WAVE SPEECH / TIC-80", 8, 6, 12)

	if dataError then
		print("DATA ERROR", 8, 22, 2)
		print(dataError, 8, 32, 15)
		return
	end

	local status = playing and "PLAYING" or "DONE"
	local modeName = mode == MODE_LINEAR and "linear" or "42 dB companded"
	print(status, 8, 20, playing and 11 or 6)
	print(string.format("frame %3d/%d  %1.2f s", math.min(frame, FRAME_COUNT), FRAME_COUNT,
		math.min(frame, FRAME_COUNT) / 60), 64, 20, 15)
	print("volume: " .. modeName, 8, 31, 14)
	print("Haskins / Ellis S1, 3 moving sine tones", 8, 42, 6)

	drawTrack(1, 58)
	drawTrack(2, 70)
	drawTrack(3, 82)

	line(8, 101, 231, 101, 1)
	for channel = 1, 3 do
		local x = 8 + math.floor(currentFrequency[channel] * 223 / 4095)
		line(x, 97, x, 105, TRACK_COLORS[channel])
	end

	rect(8, 112, 224, 3, 1)
	local progress = math.floor(math.min(frame, FRAME_COUNT) * 224 / FRAME_COUNT)
	if progress > 0 then
		rect(8, 112, progress, 3, 12)
	end
	print("Z: replay    X: switch volume mapping", 8, 124, 5)
end

function BOOT()
	dataError = validateData()
	restart()
end

function TIC()
	if btnp(4) then
		restart()
	end
	if btnp(5) then
		mode = mode == MODE_LINEAR and MODE_LOG_42_DB or MODE_LINEAR
		restart()
	end

	renderSpeechFrame()
	drawInterface()
end
