import playroutineDebug from "../../bridge/playroutine-debug.lua";
import playroutineRelease from "../../bridge/playroutine-release.lua";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import type {SomaticInstrumentWaveEngine, Tic80Instrument} from "../models/instruments";
import type {Song} from "../models/song";
import {gAllChannelsAudible, SomaticCaps, Tic80Caps, Tic80ChannelIndex} from "../models/tic80Capabilities";
import {BakedSong, BakeSong} from "../utils/bakeSong";
import {getMaxPatternUsedIndex, getMaxSfxUsedIndex, getMaxWaveformUsedIndex, MakeOptimizeResultEmpty, OptimizeResult, OptimizeSong} from "../utils/SongOptimizer";
import bridgeConfig from "../../bridge/bridge_config.jsonc";
import {assert, clamp, parseAddress, toLuaStringLiteral} from "../utils/utils";
import {LoopMode} from "./backend";
import {base85Encode, gSomaticLZDefaultConfig, lzCompress} from "./encoding";
import {encodePatternCombined} from "./pattern_encoding";

/** Chunk type IDs from https://github.com/nesbox/TIC-80/wiki/.tic-File-Format */
// see also: tic.h / sound.c (TIC80_SOURCE)
const CHUNK = {
   CODE: 5,
   SFX: 9,
   WAVEFORMS: 10,
   MUSIC_TRACKS: 14,
   MUSIC_PATTERNS: 15,
} as const;

const SFX_BYTES_PER_SAMPLE = 66;

function ToWaveEngineId(engine: SomaticInstrumentWaveEngine): number {
   switch (engine) {
      case "morph":
         return 0;
      case "native":
         return 1;
      case "pwm":
         return 2;
   }
   throw new Error(`Unknown wave engine: ${engine}`);
};

type Tic80MorphInstrumentConfig = {
   waveEngine: SomaticInstrumentWaveEngine; //
   waveEngineId: number;
   sourceWaveformIndex: number; //
   morphWaveB: number;          //
   renderWaveformSlot: number;  // also for PWM!
   morphDurationInTicks: number;

   // Curve parameters are currently undefined behavior-wise.
   // They are serialized as signed 8-bit values (s8).
   morphCurveS8: number;
   pwmCycleInTicks: number;
   pwmDuty: number;  // 0-31
   pwmDepth: number; // 0-31

   lowpassEnabled: boolean;
   lowpassDurationInTicks: number;
   lowpassCurveS8: number;
   wavefoldAmt: number; // 0-255
   wavefoldDurationInTicks: number;
   wavefoldCurveS8: number;
};

function getSomaticSfxConfigBytes(): number {
   const mem = bridgeConfig.memory as Record<string, string|number>;
   const base = parseAddress(mem.SOMATIC_SFX_CONFIG);
   const marker = parseAddress(mem.MARKER_ADDR);
   const bytes = marker - base;
   assert(
      bytes > 0,
      `Invalid bridge_config.jsonc memory layout: MARKER_ADDR (${marker.toString(16)}) must be > SOMATIC_SFX_CONFIG (${
         base.toString(16)})`);
   return bytes;
}

function curveN11ToS8(curveN11: number|null|undefined): number {
   const x0 = Number.isFinite(curveN11 as number) ? (curveN11 as number) : 0;
   const x = clamp(x0, -1, 1);
   // Simple linear mapping; exact semantics TBD.
   return clamp(Math.round(x * 127), -128, 127);
}

function durationSecondsToTicks60Hz(seconds: number): number {
   // Match the UI's convention (floor), and keep it integer.
   const s = Math.max(0, seconds ?? 0);
   return Math.floor(s * Tic80Caps.frameRate);
}

// takes rate in Hz, returns # of ticks per cycle at 60Hz
function RateInHzToTicks60Hz(rateHz: number): number {
   const r0 = Number.isFinite(rateHz) ? rateHz : 0;
   const r = Math.max(1, r0);
   return Math.floor(Tic80Caps.frameRate / r);
}

// Extract the wave-morphing instrument config from the song.
function getMorphMap(song: Song): {instrumentId: number; cfg: Tic80MorphInstrumentConfig;}[] {
   const entries: {instrumentId: number; cfg: Tic80MorphInstrumentConfig;}[] = [];
   for (let instrumentId = 0; instrumentId < (song.instruments?.length ?? 0); instrumentId++) {
      const inst = song.instruments[instrumentId];
      if (!inst)
         continue;

      // Only include instruments that require bridge-side runtime config.
      // This prevents overwriting the bridge marker/mailboxes in RAM.
      const waveEngine: SomaticInstrumentWaveEngine = inst.waveEngine ?? "native";
      const lowpassEnabled = !!inst.lowpassEnabled;
      const wavefoldAmt = clamp(inst.wavefoldAmt | 0, 0, 255);
      const needsRuntimeConfig = waveEngine !== "native" || lowpassEnabled || wavefoldAmt !== 0;
      if (!needsRuntimeConfig)
         continue;

      const morphDurationInTicks = durationSecondsToTicks60Hz(inst.morphDurationSeconds);
      const lowpassDurationInTicks = durationSecondsToTicks60Hz(inst.lowpassDurationSeconds);
      const wavefoldDurationInTicks = durationSecondsToTicks60Hz(inst.wavefoldDurationSeconds);
      entries.push({
         instrumentId,
         cfg: {
            sourceWaveformIndex: clamp(inst.sourceWaveformIndex | 0, 0, Tic80Caps.waveform.count - 1),
            morphWaveB: clamp(inst.morphWaveB | 0, 0, Tic80Caps.waveform.count - 1),
            renderWaveformSlot: clamp(inst.renderWaveformSlot | 0, 0, Tic80Caps.waveform.count - 1),
            morphDurationInTicks,

            morphCurveS8: curveN11ToS8(inst.morphCurveN11),
            waveEngine,
            pwmCycleInTicks: clamp(RateInHzToTicks60Hz(inst.pwmSpeedHz ?? 0) | 0, 0, 0xffff),
            pwmDuty: clamp(inst.pwmDuty | 0, 0, 31),
            pwmDepth: clamp(inst.pwmDepth | 0, 0, 31),
            lowpassEnabled,
            lowpassDurationInTicks,
            lowpassCurveS8: curveN11ToS8(inst.lowpassCurveN11),
            wavefoldAmt,
            wavefoldDurationInTicks,

            wavefoldCurveS8: curveN11ToS8(inst.wavefoldCurveN11),
            waveEngineId: ToWaveEngineId(waveEngine),
         }
      });
   }

   // Sort to keep output stable.
   entries.sort((a, b) => a.instrumentId - b.instrumentId);
   return entries;
}

// Packed as:
// [0] = entryCount (u8)
// per entry:
// - instrumentId (u8)
// - waveEngine (u8) 0=morph,1=native,2=pwm
// - sourceWaveformIndex (u8)
// - morphWaveB (u8)
// - renderWaveformSlot (u8)
// - morphDurationTicks (u16 LE)
// - pwmSpeedTicks (u16 LE)
// - pwmDuty (u8)
// - pwmDepth (u8)
// - lowpassEnabled (u8) 0/1
// - lowpassDurationTicks (u16 LE)
// - wavefoldAmt (u8)
// - wavefoldDurationTicks (u16 LE)
// - morphCurve (s8)
// - lowpassCurve (s8)
// - wavefoldCurve (s8)
// total payload = 1 + entryCount * 20 bytes
function encodeMorphMapForBridge(song: Song): Uint8Array {
   const entries = getMorphMap(song);
   const BYTES_PER_ENTRY = 20;
   const HEADER_BYTES = 1;

   const totalBytes = getSomaticSfxConfigBytes();
   const maxEntryCount = Math.floor((totalBytes - HEADER_BYTES) / BYTES_PER_ENTRY);
   assert(entries.length <= 255, `SOMATIC_SFX_CONFIG overflow: too many entries (${entries.length})`);
   assert(
      entries.length <= maxEntryCount,
      `SOMATIC_SFX_CONFIG overflow: need ${HEADER_BYTES + entries.length * BYTES_PER_ENTRY} bytes, have ${
         totalBytes} bytes`);
   const entryCount = entries.length;

   // Fixed-size buffer so we always fully overwrite the region (avoids stale entries)
   // and never overwrite the marker/mailboxes above it.
   const out = new Uint8Array(totalBytes);
   out[0] = entryCount & 0xff;

   let w = 1;
   for (let i = 0; i < entryCount; i++) {
      const {instrumentId, cfg} = entries[i];
      const morphDurationTicks = clamp(cfg.morphDurationInTicks | 0, 0, 0xffff);
      out[w++] = clamp(instrumentId | 0, 0, 255);
      out[w++] = cfg.waveEngineId & 0xff;
      out[w++] = clamp(cfg.sourceWaveformIndex | 0, 0, 255);
      out[w++] = clamp(cfg.morphWaveB | 0, 0, 255);
      out[w++] = clamp(cfg.renderWaveformSlot | 0, 0, 255);
      out[w++] = morphDurationTicks & 0xff;
      out[w++] = (morphDurationTicks >> 8) & 0xff;

      const pwmCycleTicks = clamp(cfg.pwmCycleInTicks | 0, 0, 0xffff);
      out[w++] = pwmCycleTicks & 0xff;
      out[w++] = (pwmCycleTicks >> 8) & 0xff;
      out[w++] = clamp(cfg.pwmDuty | 0, 0, 255);
      out[w++] = clamp(cfg.pwmDepth | 0, 0, 255);
      out[w++] = cfg.lowpassEnabled ? 1 : 0;

      const lowpassDurationTicks = clamp(cfg.lowpassDurationInTicks | 0, 0, 0xffff);
      out[w++] = lowpassDurationTicks & 0xff;
      out[w++] = (lowpassDurationTicks >> 8) & 0xff;
      out[w++] = clamp(cfg.wavefoldAmt | 0, 0, 255);

      const wavefoldDurationTicks = clamp(cfg.wavefoldDurationInTicks | 0, 0, 0xffff);
      out[w++] = wavefoldDurationTicks & 0xff;
      out[w++] = (wavefoldDurationTicks >> 8) & 0xff;

      out[w++] = cfg.morphCurveS8 & 0xff;
      out[w++] = cfg.lowpassCurveS8 & 0xff;
      out[w++] = cfg.wavefoldCurveS8 & 0xff;
   }
   return out;
}

function makeMorphMapLua(song: Song): string {
   // Emit a Lua table keyed by instrument ID:
   //   [id] = { sourceWaveformIndex=.., morphWaveB=.., renderWaveformSlot=.., morphDurationInTicks=.. }
   const entries = getMorphMap(song);
   const parts: string[] = [];

   for (const entry of entries) {
      const lowpassEnabled = entry.cfg.lowpassEnabled ? 1 : 0;
      parts.push(`[${entry.instrumentId}]={
 waveEngine=${entry.cfg.waveEngineId},
    sourceWaveformIndex=${entry.cfg.sourceWaveformIndex},
 morphWaveB=${entry.cfg.morphWaveB},
 renderWaveformSlot=${entry.cfg.renderWaveformSlot},
 morphDurationInTicks=${entry.cfg.morphDurationInTicks},
 morphCurveS8=${entry.cfg.morphCurveS8},
 pwmCycleInTicks=${entry.cfg.pwmCycleInTicks},
 pwmDuty=${entry.cfg.pwmDuty},
 pwmDepth=${entry.cfg.pwmDepth},
 lowpassEnabled=${lowpassEnabled},
 lowpassDurationInTicks=${entry.cfg.lowpassDurationInTicks},
 lowpassCurveS8=${entry.cfg.lowpassCurveS8},
 wavefoldAmt=${entry.cfg.wavefoldAmt},
 wavefoldDurationInTicks=${entry.cfg.wavefoldDurationInTicks},
 wavefoldCurveS8=${entry.cfg.wavefoldCurveS8}
}`);
   }
   return `{\n\t\t${parts.join(",\n\t\t")}\n\t}`;
}


// each of OUR internal patterns is actually 4 tic80 patterns (channel A, B, C, D) in series.
// so for double-buffering, the front buffer for the 4 channels is [0,1,2,3], and the back buffer is [4,5,6,7], etc.
// we output as a 4-channel pattern quad in order so it can just be copied directly to TIC-80 memory.
function encodeRealPatterns(song: Song): Uint8Array[] {
   const ret: Uint8Array[] = [];
   const patternCount = getMaxPatternUsedIndex(song) + 1;
   for (let p = 0; p < patternCount; p++) {
      const pattern = song.patterns[p]!;
      const combined = encodePatternCombined(pattern);

      // compress
      const compressed = lzCompress(combined, gSomaticLZDefaultConfig);

      //const fingerprintUncompressed = getBufferFingerprint(combined);
      //console.log(`Pattern ${p} fingerprint uncompressed:`, fingerprintUncompressed);

      // const fingerprintCompressed = getBufferFingerprint(compressed);
      // console.log(`Pattern ${p} fingerprint compressed:`, fingerprintCompressed);

      ret.push(compressed);
   }
   return ret;
}

// function encodeNullPatterns(): Uint8Array {
//    const patterns = new Uint8Array(Tic80Caps.pattern.count * Tic80Caps.pattern.maxRows * 3);
//    return patterns;
// }

// Decode raw byte S from the CHUNK_MUSIC track into "display speed" (1..31)
export function decodeTrackSpeed(rawSpeedByte: number): number {
   // rawSpeedByte: 0..255
   const speed = (rawSpeedByte + 6) % 255;
   // Spec says valid range is 1..31; clamp just in case
   return clamp(speed, 1, 31);
}

// Encode desired display speed (1..31) into raw S byte for CHUNK_MUSIC
export function encodeTrackSpeed(displaySpeed: number): number {
   // ensure integer & clamp to legal range
   let speed = clamp(displaySpeed, 1, 31);

   // Use the canonical mapping consistent with (S + 6) % 255
   if (speed === 6)
      return 0; // default speed
   if (speed >= 7)
      return speed - 6; // 7..31 -> 1..25
   // speed in 1..5
   return speed + 249; // 1..5 -> 250..254
}

// Tempo: decode is T + 150; we do not track tempo, so default 150 -> store 0
function encodeTempo(displayTempo: number): number {
   const tSigned = displayTempo - 150; // -118 .. +105 for 32..255
   return (tSigned + 256) & 0xFF;      // back to 0..255 byte
}
// for completeness
export function decodeTempo(byte: number): number {
   // byte is 0..255 from the cart
   const tSigned = byte >= 128 ? byte - 256 : byte; // convert to -128..127
   return tSigned + 150;                            // UI tempo
}

function packTrackFrame(channelPatterns: [number, number, number, number]): [number, number, number] {
   const patF = channelPatterns[0] & 0x3f;
   const patS = channelPatterns[1] & 0x3f;
   const patT = channelPatterns[2] & 0x3f;
   const patQ = channelPatterns[3] & 0x3f;
   const packed = patF | (patS << 6) | (patT << 12) | (patQ << 18);
   const byte0 = packed & 0xff;
   const byte1 = (packed >> 8) & 0xff;
   const byte2 = (packed >> 16) & 0xff;
   return [byte0, byte1, byte2];
};

function encodeTrack(song: Song): Uint8Array {
   /*
    This represents the music track data. This is copied to RAM at 0x13E64...0x13FFB.

    This chunk contains the various music tracks, as composed of 51 bytes where trailing zeros are removed, the structure is as follows

    1-48 	FFFFFFSSSSSSTTTTTTQQQQQQ 	The bytes here are arranged in triplets where
    F is the number of the pattern on the first channel
    S is the number of the pattern on the second channel
    T is the number of the pattern on the third channel
    Q is the number of the pattern on the fourth channel
    49 	SSSSSSSS 	S is the speed of the track
    50 	RRRRRRRR 	R is the number of rows in each pattern
    51 	TTTTTTTT 	T is the tempo of the track

    Although the individual notes are stored as 6 bits in the editor the maximum number that can be used is 60 (may be possible to insert illegal pattern in music tracks?)
    To get the correct speed of the track do: (S + 6) % 255
    To get the correct number of rows of the track do: 64 - R
    To get the correct tempo of the track do: T + 150.

    - tempo is a signed byte. it's stored as the delta from the default tempo of 150 bpm.
    so to get the actual tempo, you do: T + 150

   */

   // fill tracks with our double-buffering strategy.
   // we will fill all 16 steps, intended to alternate between front and back "buffer"s of pattern data.
   // in order to keep swaps single-op, each pattern "buffer" is 4 patterns long (one per channel).

   const buf = new Uint8Array(3 * Tic80Caps.song.maxSongLength + 3); // 48 bytes positions + speed/rows/tempo
   for (let i = 0; i < Tic80Caps.song.maxSongLength; i++) {
      const isFrontBuffer = (i % 2) === 0; // 0 or 1
      // pattern id 0 is a "no pattern". they are 1-based in the track data.
      const channelPatterns: [number, number, number, number] = isFrontBuffer ? [1, 2, 3, 4] : [5, 6, 7, 8];
      const [b0, b1, b2] = packTrackFrame(channelPatterns);
      const base = i * 3;
      buf[base + 0] = b0;
      buf[base + 1] = b1;
      buf[base + 2] = b2;
   }

   // Speed: decode is (S + 6) % 255; clamp to 0..254
   //const speedByte = (song.speed - 6 + 255) % 255;
   // peek(81556)
   buf[50] = encodeTrackSpeed(song.speed); //speedByte & 0xff;

   // Rows: decode is 64 - R (so encode is the same op)
   // peek(81557)
   buf[49] = 64 - song.rowsPerPattern;

   // peek(81558)
   buf[48] = encodeTempo(song.tempo);

   //return writeChunk(CHUNK.MUSIC_TRACKS, buf);
   return buf;
}

function encodeWaveforms(song: Song, count: number): Uint8Array {
   // refer to https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
   // for a text description of the format.

   // This represents the sound wave-table data. This is copied to RAM at0x0FFE4...0x100E3.

   // This chunk stores the various waveforms used by sound effects. Due to the fact that waveforms heights go from 0 to 15 is is possible to store 2 height in 1 byte, this is why waveforms are 16 bytes but in the editor there are 32 points you can edit.
   const bytesPerWave = Tic80Caps.waveform.pointCount / 2; // 32 samples, 4 bits each, packed 2 per byte
   const buf = new Uint8Array(Tic80Caps.waveform.count * bytesPerWave);

   //const usedWaveformCount = getMaxWaveformUsedIndex(song) + 1;

   for (let w = 0; w < count; w++) {
      const waveform = song.waveforms[w];
      // serialize 32 samples (4 bits each, packed 2 per byte)
      for (let i = 0; i < 16; i++) {
         const sampleA = clamp(waveform.amplitudes[i * 2] ?? 0, 0, 15);
         const sampleB = clamp(waveform.amplitudes[i * 2 + 1] ?? 0, 0, 15);
         buf[w * bytesPerWave + i] = (sampleB << 4) | sampleA;
      }
   }
   return buf;
   //return writeChunk(CHUNK.WAVEFORMS, buf);
}

function encodeSfx(song: Song, count: number): Uint8Array {
   const packLoop = (start: number, length: number): number => {
      const loopStart = clamp(start, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      const loopSize = clamp(
         length,
         0,
         Tic80Caps.sfx.envelopeFrameCount - 1); // don't care about logical correctness; just that we don't overflow
      return (loopSize << 4) | loopStart;
   };

   const encodeInstrumentSpeed = (speed: number): number => {
      // speed is an 3-bit value; in the editor it's 0..7
      // but stored differently:
      // "The sample speed bytes should added to 4 and then you should preform the modulus operation with 8 on it ((S + 4) % 8)"
      // so effectively minus 4 with wrapping.
      let val = speed - 4;
      if (val < 0) {
         val += 8;
      }
      return val & 0x07;
   };

   const encodeInstrument = (inst: Tic80Instrument): Uint8Array => {
      const out = new Uint8Array(SFX_BYTES_PER_SAMPLE);

      for (let tick = 0; tick < Tic80Caps.sfx.envelopeFrameCount; tick++) {
         const vol = Tic80Caps.sfx.volumeMax - clamp(inst.volumeFrames[tick], 0, Tic80Caps.sfx.volumeMax);
         const wave = clamp(inst.waveFrames[tick], 0, 15);
         const chord = clamp(inst.arpeggioFrames[tick], 0, 15);
         const pitch = clamp(
            inst.pitchFrames[tick] + Tic80Caps.sfx.pitchMin,
            Tic80Caps.sfx.pitchMin,
            Tic80Caps.sfx.pitchMax); // incoming is 0-15; map to -8..+7

         out[tick * 2 + 0] = ((wave & 0x0f) << 4) | (vol & 0x0f);
         out[tick * 2 + 1] = ((pitch & 0x0f) << 4) | (chord & 0x0f);
      }

      const reverse = inst.arpeggioDown ? 1 : 0;
      const speedBits = encodeInstrumentSpeed(inst.speed);
      const octave = clamp(inst.octave ?? 0, 0, 7);
      const pitch16x = inst.pitch16x ? 1 : 0;
      out[60] = (octave & 0x07) | (pitch16x << 3) | (speedBits << 4) | (reverse ? 0x80 : 0);

      const baseNote = clamp(inst.baseNote ?? 0, 0, 11);
      const stereoLeft = inst.stereoLeft ? 0 : 1;
      const stereoRight = inst.stereoRight ? 0 : 1;
      out[61] = (baseNote & 0x0f) | (stereoLeft << 4) | (stereoRight << 5);

      out[62] = packLoop(inst.waveLoopStart, inst.waveLoopLength);
      out[63] = packLoop(inst.volumeLoopStart, inst.volumeLoopLength);
      out[64] = packLoop(inst.arpeggioLoopStart, inst.arpeggioLoopLength);
      out[65] = packLoop(inst.pitchLoopStart, inst.pitchLoopLength);

      return out;
   };

   // 66 bytes per SFX (up to 64 entries in RAM). We only fill instruments (1..INSTRUMENT_COUNT).
   //const sfxCount = getMaxSfxUsedIndex(song);
   const buf = new Uint8Array(count * SFX_BYTES_PER_SAMPLE);

   for (let i = 1; i < count; i++) {
      const encoded = encodeInstrument(song.instruments?.[i]);
      buf.set(encoded, i * SFX_BYTES_PER_SAMPLE);
   }

   return buf;
}

// bakes some things into a copy of the song for playback.

export interface Tic80SerializeSongArgs {
   song: Song;
   loopMode: LoopMode;
   cursorSongOrder: number,                  //
      cursorChannelIndex: Tic80ChannelIndex, //
      cursorRowIndex: number,
      patternSelection: SelectionRect2D|null, //
      audibleChannels: Set<Tic80ChannelIndex>,
      startPosition: number, //
      startRow: number,      //
      songOrderSelection: SelectionRect2D|null,
}

// upon sending to the tic80, we send a payload which includes all the song data in a single chunk.
// that chunk is meant to be copied to RAM at 0x0FFE4, and includes the following data:
// | 0FFE4 | WAVEFORMS            | 256   |
// | 100E4 | SFX                  | 4224  |
// | 11164 | MUSIC PATTERNS       | 11520 |
// | 13E64 | MUSIC TRACKS         | 408   | <-- for the 8 tracks. but we only need 1, so size=51
//
// but we also pass a separate pattern data chunk which is used for playback because we
// copy pattern data ourselves to work around tic80 length limitations.
export interface Tic80SerializedSong {
   bakedSong: BakedSong;
   optimizeResult: OptimizeResult;
   waveformData: Uint8Array;
   sfxData: Uint8Array;
   trackData: Uint8Array;

   // Packed morphing instrument config for the bridge cart.
   morphMapData: Uint8Array;

   // length + order itself
   songOrderData: Uint8Array;

   // each somatic pattern is actually 4 patterns (channel A, B, C, D) in series. allows copying patterns in 1 go for all 4 channels.
   patternData: Uint8Array;
}

export function serializeSongForTic80Bridge(args: Tic80SerializeSongArgs): Tic80SerializedSong {
   // first, bake loop info into the song.
   const bakedSong = BakeSong(args);

   // NB: do not optimize waveforms / instruments.
   // it changes indices that the editor is using. so for example we optimize out an instrument that's not used in the song,
   // and the user can't hear any changes made to that instrument.
   // but we are free to optimize pattern data, because it gets ALWAYS updated whenever it's invoked from the playroutine.
   //const optimizeResult = OptimizeSong(song);
   //song = optimizeResult.optimizedSong;

   const waveformData = encodeWaveforms(
      bakedSong.bakedSong, bakedSong.bakedSong.waveforms.length); // always send all waveforms even if unused
   const sfxData = encodeSfx(bakedSong.bakedSong, bakedSong.bakedSong.instruments.length);
   const trackData = encodeTrack(bakedSong.bakedSong);
   const morphMapData = encodeMorphMapForBridge(bakedSong.bakedSong);

   const songOrderData = new Uint8Array(1 + SomaticCaps.maxSongLength);
   songOrderData[0] = bakedSong.bakedSong.songOrder.length;
   for (let i = 0; i < SomaticCaps.maxSongLength; i++) {
      const patternIndex = bakedSong.bakedSong.songOrder[i] ?? 0;
      songOrderData[1 + i] = patternIndex & 0xff;
   }

   const realPatternData = encodeRealPatterns(bakedSong.bakedSong); // separate pattern data for playback use
   return {
      bakedSong,
      //requireSongLoop: bakedSong.wantSongLoop,
      optimizeResult: {
         ...MakeOptimizeResultEmpty(bakedSong.bakedSong),
         usedPatternCount: getMaxPatternUsedIndex(bakedSong.bakedSong) + 1,
         usedSfxCount: getMaxSfxUsedIndex(bakedSong.bakedSong) + 1,
         usedWaveformCount: getMaxWaveformUsedIndex(bakedSong.bakedSong) + 1,
      },
      waveformData,
      sfxData,
      trackData,
      morphMapData,
      songOrderData,
      patternData: ch_serializePatterns(realPatternData),
   };
}

// for each pattern blob, serialize as:
// [0..1] length of the pattern blob (u16 little-endian)
// [2..N] the blob
// it means to find pattern i, you have to walk the struct.
function ch_serializePatterns(patterns: Uint8Array[]): Uint8Array {
   // Calculate total size needed
   let totalSize = 0;
   for (const pattern of patterns) {
      totalSize += 2 + pattern.length; // 2 bytes for length + pattern data
   }

   // assert(
   //    patterns[0].length === 768,
   //    `ch_serializePatterns: unexpected pattern length ${patterns[0].length}, expected 768`);

   const output = new Uint8Array(totalSize);
   let writePos = 0;

   const stats: {checksum: number; length: number; firstBytes: string;}[] = [];

   for (const pattern of patterns) {
      const length = pattern.length & 0xffff;

      // Write length as u16 little-endian
      output[writePos++] = length & 0xff;
      output[writePos++] = (length >> 8) & 0xff;

      // Write pattern data
      output.set(pattern, writePos);
      writePos += pattern.length;


      // calculate a sum of all bytes in this pattern
      let runningTotal = 0;
      for (let i = 0; i < pattern.length; i++) {
         runningTotal += pattern[i];
      }
      runningTotal &= 0xFFFFFFFF; // keep it within 32-bit range
      const firstBytes = Array.from(pattern.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" ");
      stats.push({checksum: runningTotal, length: pattern.length, firstBytes});
   }

   //console.log(`ch_serializePatterns: serialized ${patterns.length} patterns, total size ${totalSize} bytes`);
   //console.log(stats);

   return output;
}

function removeTrailingZerosFn(data: Uint8Array): Uint8Array {
   if (data.length === 0) {
      return data;
   }
   let endIndex = data.length;
   while (endIndex > 0 && data[endIndex - 1] === 0) {
      endIndex--;
   }
   // ensure at least 1 byte remains; i don't know what happens if we send a zero-length chunk.
   return data.slice(0, Math.max(1, endIndex));
}

function createChunk(type: number, payload: Uint8Array, removeTrailingZeros: boolean, bank = 0): Uint8Array {
   // most chunks can have trailing zeros removed to save space.
   if (removeTrailingZeros) {
      payload = removeTrailingZerosFn(payload);
   }

   const chunk = new Uint8Array(4 + payload.length);
   chunk[0] = ((bank & 0x07) << 5) | (type & 0x1f);
   chunk[1] = payload.length & 0xff;
   chunk[2] = (payload.length >> 8) & 0xff;
   chunk[3] = 0; // reserved
   chunk.set(payload, 4);
   return chunk;
};

function stringToAsciiPayload(str: string): Uint8Array {
   const codeBytes = new Uint8Array(str.length);
   for (let i = 0; i < str.length; i++) {
      codeBytes[i] = str.charCodeAt(i) & 0x7F; // ensure ASCII
   }
   return codeBytes;
};

function getPlayroutineCode(variant: "debug"|"release"): string {
   return variant === "debug" ? playroutineDebug : playroutineRelease;
};

function getCode(song: Song, variant: "debug"|"release", audibleChannels: Set<Tic80ChannelIndex>):
   {code: string, generatedCode: string, patternChunks: Uint8Array[]} {
   // Generate the SOMATIC_MUSIC_DATA section
   const songOrder = song.songOrder.map(idx => idx.toString()).join(",");
   const morphMapLua = makeMorphMapLua(song);

   const maxPattern = getMaxPatternUsedIndex(song);
   const patternChunks: Uint8Array[] = [];
   const patternLengths: number[] = []; // size of the base85-decoded (still compressed) pattern data

   const patternStringContents = song.patterns.slice(0, maxPattern + 1).map((pattern, patternIndex) => {
      const encodedPattern = encodePatternCombined(pattern);
      patternChunks.push(encodedPattern);

      //const fingerprint = getBufferFingerprint(encodedPattern);
      //console.log(`Pattern ${patternIndex} fingerprint:`, fingerprint);

      // { TestBase85Encoding("04 00 42 00 00 00 0d 00 81"); }

      const compressed = lzCompress(encodedPattern, gSomaticLZDefaultConfig);
      patternLengths.push(compressed.length);

      const patternStr = base85Encode(compressed);

      return patternStr;
   });
   const patternArray = patternStringContents.map(p => toLuaStringLiteral(p)).join(",\n\t\t");

   const musicDataSection = `-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
 songOrder = { ${songOrder} },
 instrumentMorphMap = ${morphMapLua},
 patternLengths = { ${patternLengths.join(", ")} },
 patterns = {
  ${patternArray}
 },
}
-- END_SOMATIC_MUSIC_DATA`;

   // Replace the SOMATIC_MUSIC_DATA section in the template
   const playroutineTemplate = getPlayroutineCode(variant);
   const markerIndex = playroutineTemplate.indexOf("-- END_SOMATIC_MUSIC_DATA");
   if (markerIndex === -1) {
      throw new Error("Template marker \"-- END_SOMATIC_MUSIC_DATA\" not found in playroutine-min.lua");
   }

   const musicDataStart = playroutineTemplate.indexOf("-- BEGIN_SOMATIC_MUSIC_DATA");
   if (musicDataStart === -1) {
      throw new Error("Could not find \"BEGIN_SOMATIC_MUSIC_DATA\" in template");
   }

   // Replace from musicDataStart to end of marker line
   const markerLineEnd = playroutineTemplate.indexOf("\n", markerIndex);
   const beforeMusicData = playroutineTemplate.substring(0, musicDataStart);
   const afterMarker = playroutineTemplate.substring(markerLineEnd + 1);

   return {
      code: beforeMusicData + musicDataSection + "\n" + afterMarker,
      generatedCode: musicDataSection,
      patternChunks,
   };
}

export type SongCartDetails = {
   elapsedMillis: number;     //
   waveformChunk: Uint8Array; //
   sfxChunk: Uint8Array;      //
   patternChunk: Uint8Array;  //
   trackChunk: Uint8Array;    //

   realPatternChunks: Uint8Array[]; // before turning into literals

   // how much of the code chunk is generated code.
   generatedCode: string;
   codeChunk: Uint8Array; //

   optimizeResult: OptimizeResult;

   cartridge: Uint8Array;
}

export function serializeSongToCartDetailed(
   song: Song, optimize: boolean, variant: "debug"|"release", audibleChannels: Set<Tic80ChannelIndex>):
   SongCartDetails //
{
   const startTime = performance.now();
   let optimizeResult: OptimizeResult = MakeOptimizeResultEmpty(song);
   if (optimize) {
      const result = OptimizeSong(song);
      song = result.optimizedSong;
      optimizeResult = result;
   }

   const bakeResult = BakeSong({
      song,
      audibleChannels: gAllChannelsAudible,
      cursorSongOrder: 0,
      cursorChannelIndex: 0,
      cursorRowIndex: 0,
      patternSelection: null,
      loopMode: "off",
      songOrderSelection: null,
      startPosition: 0,
      startRow: 0,
   });
   song = bakeResult.bakedSong;

   // e.g., remove unused instruments, waveforms, patterns, shift to pack etc.

   // cartridges are a simple concatenation of chunks.
   // each chunk has a 4-byte header, followed by payload.
   // the header is:
   // byte 0: bank (3 bits) + chunk type (5 bits)
   // byte 1-2: payload length (u16 little-endian)
   // byte 3: reserved (0)

   const waveformChunk = createChunk(CHUNK.WAVEFORMS, encodeWaveforms(song, getMaxWaveformUsedIndex(song) + 1), true);
   const sfxChunk = createChunk(CHUNK.SFX, encodeSfx(song, getMaxSfxUsedIndex(song) + 1), true);
   const patternChunk = createChunk(CHUNK.MUSIC_PATTERNS, new Uint8Array(1), true); // all zeros
   const trackChunk = createChunk(CHUNK.MUSIC_TRACKS, encodeTrack(song), true);
   const {code, generatedCode, patternChunks} = getCode(song, variant, audibleChannels);
   const codePayload = stringToAsciiPayload(code);
   const codeChunk = createChunk(CHUNK.CODE, codePayload, false, 0);

   const chunks: Uint8Array[] = [
      codeChunk,
      waveformChunk,
      sfxChunk,
      patternChunk,
      trackChunk,
   ];

   const totalSize = chunks.reduce((sum, p) => sum + p.length, 0);
   const cartridge = new Uint8Array(totalSize);
   let offset = 0;
   for (const p of chunks) {
      cartridge.set(p, offset);
      offset += p.length;
   }

   const elapsedMillis = performance.now() - startTime;

   return {
      waveformChunk,
      sfxChunk,
      patternChunk,
      realPatternChunks: patternChunks,
      trackChunk,
      codeChunk,
      generatedCode,
      optimizeResult,
      cartridge,
      elapsedMillis,
   };
}


export function serializeSongToCart(
   song: Song, optimize: boolean, variant: "debug"|"release", audibleChannels: Set<Tic80ChannelIndex>): Uint8Array {
   const details = serializeSongToCartDetailed(song, optimize, variant, audibleChannels);
   return details.cartridge;
}
