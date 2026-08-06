-- title: Sine-wave speech POC
-- author: Somatic project
-- desc: Published speech-formant trajectories rendered by TIC-80 wavetable channels
-- script: lua

--[[

todo:

x i think we also need to add at least 1 more phrase for demonstration
- Harmonic source–filter wavetable synthesis sounds very interesting, because
  it will make better use of the
  very limited bandwidth available to us, and probably will mix better with
  noise-based fricatives, aspirants, bursts
- add fricatives, aspirants, bursts; this would likely help add character pulling
  more towards speech and less towards "stacked sine waves" sound.
  -> note that this is NOT part of original SWS; explore this via another algo
   - Klatt cascade/parallel formant synthesis
   - SAM (common in C64)
   - Votrax SC-01-A

--]]

--#include "phrases/s1.lua"
--#include "phrases/s6.lua"

-- Purpose
-- -------
-- This cart tests whether TIC-80 can reproduce established sine-wave speech
-- using only its normal wavetable sound registers. It is deliberately not a
-- text-to-speech implementation and does not play PCM samples.
--
-- Source and distribution
-- -----------------------
-- Trajectory sources: Haskins Laboratories / Dan Ellis sentence parameters.
-- https://www.haskinslaboratories.org/sws-information
-- https://www.ee.columbia.edu/~dpwe/resources/matlab/sws/
--
-- The Haskins page describes the source package as (c) 1996 Dan Ellis and
-- Haskins Laboratories and available for noncommercial distribution. Confirm
-- licensing separately before redistributing this data outside the POC.
--
-- Conversion performed for this cart:
--   * parse source control frames at 10 ms intervals (100 Hz)
--   * linearly interpolate frequency and magnitude at 60 Hz
--   * round frequency to the TIC-80 12-bit Hz register value
--   * round normalized magnitude to 8 bits
--
-- Runtime data uses three bytes per oscillator per frame: frequency low byte,
-- frequency high nibble, and magnitude U8. Phrases may use three or four tones.
-- Keeping magnitude at 8 bits lets the cart compare two mappings into TIC's
-- 4-bit channel volume without changing the embedded speech trajectory.

local SOUND_REGISTERS_BASE = 0x0ff9c
local SOUND_REGISTER_BYTES = 18
local WAVEFORM_OFFSET = 2
local BYTES_PER_TRACK = 3

-- A 32-sample, 4-bit sine centered around 7.5, packed two samples per byte.
-- The first sample occupies the low nibble, matching TIC-80 waveform storage.
local SINE_BYTES = {
	152, 202, 237, 254, 255, 238, 205, 154,
	104, 53, 18, 1, 0, 17, 50, 101,
}

local MODE_LINEAR = 1
local MODE_LOG_42_DB = 2
local PHRASES = { PHRASE_S1, PHRASE_S6 }
local phraseIndex = 1
local currentPhrase = PHRASES[phraseIndex]
local mode = MODE_LINEAR
local frame = 0
local playing = false
local dataError = nil
local currentFrequency = { 0, 0, 0, 0 }
local currentMagnitude = { 0, 0, 0, 0 }
local currentVolume = { 0, 0, 0, 0 }

local function clamp(value, minimum, maximum)
	return math.min(math.max(value, minimum), maximum)
end

local function readHexByte(phrase, byteIndex)
	local charIndex = byteIndex * 2 + 1
	return tonumber(phrase.dataHex:sub(charIndex, charIndex + 1), 16)
end

local function validatePhrase(phrase)
	if phrase.oscillatorCount < 1 or phrase.oscillatorCount > 4 then
		return phrase.id .. " has " .. phrase.oscillatorCount .. " oscillators"
	end

	local byteCount = phrase.frameCount * phrase.oscillatorCount * BYTES_PER_TRACK
	local expectedHexChars = byteCount * 2
	if #phrase.dataHex ~= expectedHexChars then
		return phrase.id .. " length " .. #phrase.dataHex .. ", expected " .. expectedHexChars
	end

	local checksum = 0
	for byteIndex = 0, byteCount - 1 do
		local value = readHexByte(phrase, byteIndex)
		if value == nil then
			return phrase.id .. " invalid hex at byte " .. byteIndex
		end
		checksum = (checksum + value) & 0xffff
	end

	if checksum ~= phrase.checksum then
		return phrase.id .. " checksum " .. checksum .. ", expected " .. phrase.checksum
	end
	return nil
end

local function validatePhrases()
	for _, phrase in ipairs(PHRASES) do
		local phraseError = validatePhrase(phrase)
		if phraseError then
			return phraseError
		end
	end
	return nil
end

local function readTrack(phrase, frameIndex, channel)
	local bytesPerFrame = phrase.oscillatorCount * BYTES_PER_TRACK
	local byteIndex = frameIndex * bytesPerFrame + channel * BYTES_PER_TRACK
	local frequencyLow = readHexByte(phrase, byteIndex)
	local frequencyHigh = readHexByte(phrase, byteIndex + 1)
	local magnitude = readHexByte(phrase, byteIndex + 2)
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
	for channel = 1, 4 do
		currentFrequency[channel] = 0
		currentMagnitude[channel] = 0
		currentVolume[channel] = 0
	end
end

local function selectPhrase(delta)
	phraseIndex = ((phraseIndex - 1 + delta) % #PHRASES) + 1
	currentPhrase = PHRASES[phraseIndex]
	restart()
end

local function renderSpeechFrame()
	if not playing or frame >= currentPhrase.frameCount then
		playing = false
		silenceAllVoices()
		return
	end

	for channel = 0, currentPhrase.oscillatorCount - 1 do
		local frequency, magnitude = readTrack(currentPhrase, frame, channel)
		local volume = quantizeMagnitude(magnitude)
		currentFrequency[channel + 1] = frequency
		currentMagnitude[channel + 1] = magnitude
		currentVolume[channel + 1] = volume
		writeVoice(channel, frequency, volume)
	end

	for channel = currentPhrase.oscillatorCount, 3 do
		local base = SOUND_REGISTERS_BASE + channel * SOUND_REGISTER_BYTES
		poke(base, 0)
		poke(base + 1, 0)
	end
	frame = frame + 1
end

local TRACK_COLORS = { 12, 11, 10, 9 }

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
	print("SINE-WAVE SPEECH / TIC-80", 8, 5, 12)

	if dataError then
		print("DATA ERROR", 8, 22, 2)
		print(dataError, 8, 32, 15)
		return
	end

	local status = playing and "PLAYING" or "DONE"
	local modeName = mode == MODE_LINEAR and "linear" or "42 dB companded"
	local frameCount = currentPhrase.frameCount
	print(status, 8, 16, playing and 11 or 6)
	print(string.format("frame %3d/%d  %1.2f s", math.min(frame, frameCount), frameCount,
		math.min(frame, frameCount) / 60), 64, 16, 15)
	print("volume: " .. modeName, 8, 27, 14)
	print(string.format("%s (%d/%d, %d tones): %s", currentPhrase.id, phraseIndex, #PHRASES,
		currentPhrase.oscillatorCount, currentPhrase.title), 8, 38, 6, false, 1, true)

	for channel = 1, currentPhrase.oscillatorCount do
		drawTrack(channel, 50 + (channel - 1) * 10)
	end

	line(8, 96, 231, 96, 1)
	for channel = 1, currentPhrase.oscillatorCount do
		local x = 8 + math.floor(currentFrequency[channel] * 223 / 4095)
		line(x, 92, x, 100, TRACK_COLORS[channel])
	end

	rect(8, 108, 224, 3, 1)
	local progress = math.floor(math.min(frame, frameCount) * 224 / frameCount)
	if progress > 0 then
		rect(8, 108, progress, 3, 12)
	end
	print("LEFT/RIGHT: phrase", 8, 117, 5, false, 1, true)
	print("Z: replay    X: volume mapping", 8, 126, 5, false, 1, true)
end

function BOOT()
	dataError = validatePhrases()
	restart()
end

function TIC()
	if btnp(2) then
		selectPhrase(-1)
	elseif btnp(3) then
		selectPhrase(1)
	end
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
