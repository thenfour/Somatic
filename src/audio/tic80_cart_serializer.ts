import playroutineDebug from "../../bridge/playroutine-debug.lua";
import playroutineRelease from "../../bridge/playroutine-release.lua";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import type {ModSource, SomaticEffectKind, SomaticInstrumentWaveEngine, Tic80Instrument} from "../models/instruments";
import type {Song} from "../models/song";
import {gAllChannelsAudible, SomaticCaps, Tic80Caps, Tic80ChannelIndex, TicMemoryMap} from "../models/tic80Capabilities";
import {BakedSong, BakeSong} from "../utils/bakeSong";
import {analyzePlaybackFeatures, getMaxSfxUsedIndex, getMaxWaveformUsedIndex, MakeOptimizeResultEmpty, OptimizeResult, OptimizeSong, PlaybackFeatureUsage} from "../utils/SongOptimizer";
import bridgeConfig from "../../bridge/bridge_config.jsonc";
import {assert, clamp, parseAddress, removeLuaBlockMarkers, replaceLuaBlock, toLuaStringLiteral, typedKeys} from "../utils/utils";
import {LoopMode} from "./backend";
import {base85Encode, gSomaticLZDefaultConfig, lzCompress} from "./encoding";
import {encodePatternChannelDirect} from "./pattern_encoding";
import {PreparedSong, prepareSongColumns} from "./prepared_song";

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

type MorphEffectKind = SomaticEffectKind;

type Tic80MorphInstrumentConfig = {
   waveEngine: SomaticInstrumentWaveEngine; //
   waveEngineId: number;
   sourceWaveformIndex: number; // 0-15
   morphWaveB: number;          // 0-15
   renderWaveformSlot: number;  // 0-15 also for PWM!

   morphDurationTicks12: number; // 0-4095
   morphCurveS6: number;         // signed 6-bit (-32..31)

   pwmDuty5: number;  // 0-31
   pwmDepth5: number; // 0-31

   lowpassEnabled: boolean;
   lowpassDurationTicks12: number; // 0-4095
   lowpassCurveS6: number;         // signed 6-bit
   lowpassModSource: number;       // 0=envelope,1=lfo

   effectKind: MorphEffectKind;
   effectAmtU8: number;           // 0-255 (wavefold amount or hardSync strength)
   effectDurationTicks12: number; // 0-4095
   effectCurveS6: number;         // signed 6-bit
   effectModSource: number;       // 0=envelope,1=lfo

   lfoCycleTicks12: number; // 0-4095
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

function curveN11ToS6(curveN11: number|null|undefined): number {
   const x0 = Number.isFinite(curveN11 as number) ? (curveN11 as number) : 0;
   const x = clamp(x0, -1, 1);
   // Map -1..1 to signed 6-bit (-32..31).
   return clamp(Math.round(x * 31), -32, 31);
}

function durationSecondsToTicks12(seconds: number): number {
   // Match the UI's convention (floor), and keep it integer.
   const s = Math.max(0, seconds ?? 0);
   return clamp(Math.floor(s * Tic80Caps.frameRate), 0, 0x0fff);
}

function hardSyncStrengthToU8(strength: number|null|undefined): number {
   const s = clamp(strength ?? 1, 1, 8);
   // Map 1..8 -> 0..255 (0 means 1x, 255 means 8x)
   return clamp(Math.round(((s - 1) / 7) * 255), 0, 255);
}

function modSourceToU8(src: ModSource|undefined|null): number {
   return src === "lfo" ? 1 : 0;
}

function RateInHzToTicks60HzAllowZero(rateHz: number): number {
   if (!Number.isFinite(rateHz) || rateHz <= 0)
      return 0;
   const ticks = Math.floor(Tic80Caps.frameRate / rateHz);
   return clamp(ticks, 1, 0xffff);
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
      const effectKind: MorphEffectKind = inst.effectKind ?? "none";
      const needsRuntimeConfig = waveEngine !== "native" || lowpassEnabled || effectKind !== "none";
      if (!needsRuntimeConfig)
         continue;

      const morphDurationTicks12 = durationSecondsToTicks12(inst.morphDurationSeconds);
      const lowpassDurationTicks12 = durationSecondsToTicks12(inst.lowpassDurationSeconds);
      const effectDurationTicks12 = durationSecondsToTicks12(inst.effectDurationSeconds);
      const lfoCycleTicks12 = clamp(RateInHzToTicks60HzAllowZero(inst.lfoRateHz ?? 0), 0, 0x0fff);
      const effectModSource = modSourceToU8(inst.effectModSource);
      const effectCurveS6 = curveN11ToS6(inst.effectCurveN11);
      const effectAmtU8 =
         effectKind === "hardSync" ? hardSyncStrengthToU8(inst.effectAmount) : clamp(inst.effectAmount | 0, 0, 255);
      entries.push({
         instrumentId,
         cfg: {
            sourceWaveformIndex: clamp(inst.sourceWaveformIndex | 0, 0, Tic80Caps.waveform.count - 1),
            morphWaveB: clamp(inst.morphWaveB | 0, 0, Tic80Caps.waveform.count - 1),
            renderWaveformSlot: clamp(inst.renderWaveformSlot | 0, 0, Tic80Caps.waveform.count - 1),

            morphDurationTicks12,
            morphCurveS6: curveN11ToS6(inst.morphCurveN11),
            waveEngine,
            pwmDuty5: clamp(inst.pwmDuty | 0, 0, 31),
            pwmDepth5: clamp(inst.pwmDepth | 0, 0, 31),

            lowpassEnabled,
            lowpassDurationTicks12,
            lowpassCurveS6: curveN11ToS6(inst.lowpassCurveN11),
            lowpassModSource: modSourceToU8(inst.lowpassModSource),

            effectKind,
            effectAmtU8,
            effectDurationTicks12,
            effectCurveS6,
            effectModSource,

            waveEngineId: ToWaveEngineId(waveEngine),
            lfoCycleTicks12,
         }
      });
   }

   // Sort to keep output stable.
   entries.sort((a, b) => a.instrumentId - b.instrumentId);
   return entries;
}

const MORPH_BYTES_PER_ENTRY = 14;
const MORPH_HEADER_BYTES = 1;
// Packed as:
// [0] = entryCount (u8)
// per entry (14 bytes):
// 0: instrumentId (u8)
// 1: flags (bits: waveEngineId[0..1], lowpassEnabled[2], effectKind[3..4], lowpassModSrc[5], effectModSrc[6], reserved[7])
// 2: wave indices: sourceWaveformIndex[0..3] | morphWaveB[4..7]
// 3-6: packedG0 (LE32): renderWaveformSlot[0..3], pwmDuty5[4..8], pwmDepth5[9..13], morphDurationTicks12[14..25], morphCurveS6[26..31]
// 7-10: packedG1 (LE32): lowpassDurationTicks12[0..11], lowpassCurveS6[12..17], effectAmtU8[18..25], effectDurationTicks12_low6[26..31]
// 11-13: packedG2 (LE24): effectDurationTicks12_high6[0..5], effectCurveS6[6..11], lfoCycleTicks12[12..23]
// total payload = 1 + entryCount * 14 bytes
function effectKindToId(k: MorphEffectKind): number {
   switch (k) {
      case "none":
         return 0;
      case "wavefold":
         return 1;
      case "hardSync":
         return 2;
   }
   return 0;
}

function packMorphEntries(
   entries: {instrumentId: number; cfg: Tic80MorphInstrumentConfig;}[],
   totalBytes?: number,
   ): Uint8Array {
   const entryCount = entries.length;
   const neededBytes = MORPH_HEADER_BYTES + entryCount * MORPH_BYTES_PER_ENTRY;
   if (typeof totalBytes === "number") {
      assert(neededBytes <= totalBytes, `SOMATIC_SFX_CONFIG overflow: need ${neededBytes} bytes, have ${totalBytes}`);
   }
   const out = new Uint8Array(totalBytes ?? neededBytes);
   out[0] = entryCount & 0xff;

   let w = 1;
   for (let i = 0; i < entryCount; i++) {
      const {instrumentId, cfg} = entries[i];
      const effectDuration = cfg.effectDurationTicks12 & 0x0fff;

      const flags = (cfg.waveEngineId & 0x03) | ((cfg.lowpassEnabled ? 1 : 0) << 2) |
         ((effectKindToId(cfg.effectKind) & 0x03) << 3) | ((cfg.lowpassModSource & 0x01) << 5) |
         ((cfg.effectModSource & 0x01) << 6);

      const waves = (cfg.sourceWaveformIndex & 0x0f) | ((cfg.morphWaveB & 0x0f) << 4);

      const packedG0 = (cfg.renderWaveformSlot & 0x0f) | ((cfg.pwmDuty5 & 0x1f) << 4) | ((cfg.pwmDepth5 & 0x1f) << 9) |
         ((cfg.morphDurationTicks12 & 0x0fff) << 14) | ((cfg.morphCurveS6 & 0x3f) << 26);

      const packedG1 = (cfg.lowpassDurationTicks12 & 0x0fff) | ((cfg.lowpassCurveS6 & 0x3f) << 12) |
         ((cfg.effectAmtU8 & 0xff) << 18) | ((effectDuration & 0x3f) << 26);

      const packedG2 =
         ((effectDuration >> 6) & 0x3f) | ((cfg.effectCurveS6 & 0x3f) << 6) | ((cfg.lfoCycleTicks12 & 0x0fff) << 12);

      out[w++] = clamp(instrumentId | 0, 0, 255);
      out[w++] = flags & 0xff;
      out[w++] = waves & 0xff;

      out[w++] = packedG0 & 0xff;
      out[w++] = (packedG0 >> 8) & 0xff;
      out[w++] = (packedG0 >> 16) & 0xff;
      out[w++] = (packedG0 >> 24) & 0xff;

      out[w++] = packedG1 & 0xff;
      out[w++] = (packedG1 >> 8) & 0xff;
      out[w++] = (packedG1 >> 16) & 0xff;
      out[w++] = (packedG1 >> 24) & 0xff;

      out[w++] = packedG2 & 0xff;
      out[w++] = (packedG2 >> 8) & 0xff;
      out[w++] = (packedG2 >> 16) & 0xff;
   }
   return out;
}

function encodeMorphMapForBridge(song: Song): Uint8Array {
   const entries = getMorphMap(song);
   const totalBytes = getSomaticSfxConfigBytes();
   const maxEntryCount = Math.floor((totalBytes - MORPH_HEADER_BYTES) / MORPH_BYTES_PER_ENTRY);
   assert(entries.length <= 255, `SOMATIC_SFX_CONFIG overflow: too many entries (${entries.length})`);
   assert(
      entries.length <= maxEntryCount,
      `SOMATIC_SFX_CONFIG overflow: need ${MORPH_HEADER_BYTES + entries.length * MORPH_BYTES_PER_ENTRY} bytes, have ${
         totalBytes} bytes`);

   // Fixed-size buffer so we always fully overwrite the region (avoids stale entries)
   // and never overwrite the marker/mailboxes above it.
   return packMorphEntries(entries, totalBytes);
}

function makeMorphMapLua(song: Song): string {
   const entries = getMorphMap(song);
   const packed = packMorphEntries(entries);
   const compressed = lzCompress(packed, gSomaticLZDefaultConfig);
   const b85 = base85Encode(compressed);

   return `{ morphMapB85=${toLuaStringLiteral(b85)}, morphMapCLen=${compressed.length} }`;
}


// Each channel column is serialized independently so columns can be deduped across patterns.
function encodePreparedPatternColumns(prepared: PreparedSong): Uint8Array[] {
   return prepared.patternColumns.map((col) => {
      const encoded = encodePatternChannelDirect(col.channel);
      return lzCompress(encoded, gSomaticLZDefaultConfig);
   });
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
   const frontBase = Tic80Caps.pattern.buffers.front.index as number;
   const backBase = Tic80Caps.pattern.buffers.back.index as number;
   for (let i = 0; i < Tic80Caps.song.maxSongLength; i++) {
      const isFrontBuffer = (i % 2) === 0; // 0 or 1
      const patternBase = isFrontBuffer ? frontBase : backBase;
      const channelPatterns: [number, number, number, number] =
         [patternBase, patternBase + 1, patternBase + 2, patternBase + 3];
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
   preparedSong: PreparedSong;
   waveformData: Uint8Array;
   sfxData: Uint8Array;
   trackData: Uint8Array;

   // Packed morphing instrument config for the bridge cart.
   morphMapData: Uint8Array;

   // length + order itself
   songOrderData: Uint8Array;

   // column-based payload; each entry is one channel column (192 bytes before compression)
   patternData: Uint8Array;
}

export function serializeSongForTic80Bridge(args: Tic80SerializeSongArgs): Tic80SerializedSong {
   // first, bake loop info into the song.
   const bakedSong = BakeSong(args);
   const preparedSong = prepareSongColumns(bakedSong.bakedSong);

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

   const songOrderData = new Uint8Array(1 + SomaticCaps.maxSongLength * Tic80Caps.song.audioChannels);
   songOrderData[0] = preparedSong.songOrder.length;
   for (let i = 0; i < preparedSong.songOrder.length; i++) {
      const entry = preparedSong.songOrder[i];
      const base = 1 + i * Tic80Caps.song.audioChannels;
      songOrderData[base + 0] = entry.patternColumnIndices[0] & 0xff;
      songOrderData[base + 1] = entry.patternColumnIndices[1] & 0xff;
      songOrderData[base + 2] = entry.patternColumnIndices[2] & 0xff;
      songOrderData[base + 3] = entry.patternColumnIndices[3] & 0xff;
   }

   const preparedPatternData = encodePreparedPatternColumns(preparedSong); // separate pattern data for playback use
   return {
      bakedSong,
      preparedSong,
      //requireSongLoop: bakedSong.wantSongLoop,
      optimizeResult: {
         ...MakeOptimizeResultEmpty(bakedSong.bakedSong),
         usedPatternColumnCount: preparedSong.patternColumns.length,
         usedSfxCount: getMaxSfxUsedIndex(bakedSong.bakedSong) + 1,
         usedWaveformCount: getMaxWaveformUsedIndex(bakedSong.bakedSong) + 1,
         featureUsage: analyzePlaybackFeatures(bakedSong.bakedSong),
      },
      waveformData,
      sfxData,
      trackData,
      morphMapData,
      songOrderData,
      patternData: ch_serializePatterns(preparedPatternData),
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

function stripUnusedFeatureBlocks(template: string, usage: PlaybackFeatureUsage): string {
   const featureTags: Record<keyof PlaybackFeatureUsage, string> = {
      waveMorph: "FEATURE_WAVEMORPH",
      pwm: "FEATURE_PWM",
      lowpass: "FEATURE_LOWPASS",
      wavefold: "FEATURE_WAVEFOLD",
      hardSync: "FEATURE_HARDSYNC",
      lfo: "FEATURE_LFO",
   };

   let out = template;
   typedKeys(featureTags).forEach((key) => {
      const tag = featureTags[key];
      const begin = `-- BEGIN_${tag}`;
      const end = `-- END_${tag}`;
      if (usage[key]) {
         out = removeLuaBlockMarkers(out, [begin, end]); // keep block contents but remove the marker lines
      } else {
         out = replaceLuaBlock(out, begin, end, ""); // drop block entirely
      }
   });
   return out;
}

function getPlayroutineCode(variant: "debug"|"release"): string {
   return variant === "debug" ? playroutineDebug : playroutineRelease;
};

function getCode(song: Song, variant: "debug"|"release", featureUsage?: PlaybackFeatureUsage): {
   code: string,                //
   generatedCode: string,       //
   patternChunks: Uint8Array[], // raw, uncompressed patterns for debugging/inspection
   patternRamData: Uint8Array,  // packed compressed columns to seed into TIC-80 pattern memory
} {
   // Generate the SOMATIC_MUSIC_DATA section
   const features = featureUsage ?? analyzePlaybackFeatures(song);
   const preparedSong = prepareSongColumns(song);
   const songOrder =
      preparedSong.songOrder.map((entry) => `{${entry.patternColumnIndices.map((v) => v.toString()).join(",")}}`)
         .join(",");
   const morphMapLua = makeMorphMapLua(song);

   const patternChunks: Uint8Array[] = [];
   const patternLengths: number[] = []; // size of the base85-decoded (still compressed) pattern data

   const patternMemoryCapacity = Math.max(0, Tic80Caps.pattern.memory.limit - Tic80Caps.pattern.memory.start);
   const patternRamBuffer = new Uint8Array(patternMemoryCapacity);
   let patternRamCursor = 0; // relative to pattern memory start

   const patternEntries = preparedSong.patternColumns.map((col) => {
      const encodedPattern = encodePatternChannelDirect(col.channel);
      patternChunks.push(encodedPattern);

      const compressed = lzCompress(encodedPattern, gSomaticLZDefaultConfig);
      patternLengths.push(compressed.length);

      const fitsInPatternRam = (patternRamCursor + compressed.length) <= patternMemoryCapacity;
      if (fitsInPatternRam) {
         patternRamBuffer.set(compressed, patternRamCursor);
         const absAddr = /*Tic80Caps.pattern.memory.start + */ patternRamCursor;
         patternRamCursor += compressed.length;
         //return `0x${absAddr.toString(16)}`; // numeric Lua literal for memory-backed column
         return `${absAddr.toString()}`; // numeric Lua literal for memory-backed column
      }

      // Spill to base85 string when RAM is full.
      const patternStr = base85Encode(compressed);
      return toLuaStringLiteral(patternStr);
   });

   const patternRamData = patternRamBuffer.subarray(0, patternRamCursor);
   const patternArray = patternEntries.join(",");

   const musicDataSection = `-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
 songOrder = { ${songOrder} },
 instrumentMorphMap = ${morphMapLua},
 patternLengths = { ${patternLengths.join(",")} },
 patterns = {
  ${patternArray}
 },
}
-- END_SOMATIC_MUSIC_DATA`;

   // Replace the SOMATIC_MUSIC_DATA section in the template
   const playroutineTemplate = stripUnusedFeatureBlocks(getPlayroutineCode(variant), features);
   let code = replaceLuaBlock(
      playroutineTemplate, "-- BEGIN_SOMATIC_MUSIC_DATA", "-- END_SOMATIC_MUSIC_DATA", musicDataSection);

   // Replace tokens __AUTOGEN_TEMP_PTR_A and __AUTOGEN_TEMP_PTR_B to be replaced in the lua code.
   // with numeric hex literals like 0x1234
   code = code.replace(/__AUTOGEN_TEMP_PTR_A/g, `0x${TicMemoryMap.__AUTOGEN_TEMP_PTR_A.toString(16)}`)
             .replace(/__AUTOGEN_TEMP_PTR_B/g, `0x${TicMemoryMap.__AUTOGEN_TEMP_PTR_B.toString(16)}`)
             .replace(/__AUTOGEN_BUF_PTR_A/g, `0x${TicMemoryMap.__AUTOGEN_BUF_PTR_A.toString(16)}`)
             .replace(/__AUTOGEN_BUF_PTR_B/g, `0x${TicMemoryMap.__AUTOGEN_BUF_PTR_B.toString(16)}`);

   return {
      code,
      generatedCode: musicDataSection,
      patternChunks,
      patternRamData,
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
   wholePlayroutineCode: string;
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
   } else {
      const prepared = prepareSongColumns(song);
      optimizeResult = {
         ...optimizeResult,
         usedPatternColumnCount: prepared.patternColumns.length,
         usedSfxCount: getMaxSfxUsedIndex(song) + 1,
         usedWaveformCount: getMaxWaveformUsedIndex(song) + 1,
         featureUsage: analyzePlaybackFeatures(song),
      };
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

   const {code, generatedCode, patternChunks, patternRamData} = getCode(song, variant, optimizeResult.featureUsage);
   const waveformChunk = createChunk(CHUNK.WAVEFORMS, encodeWaveforms(song, getMaxWaveformUsedIndex(song) + 1), true);
   const sfxChunk = createChunk(CHUNK.SFX, encodeSfx(song, getMaxSfxUsedIndex(song) + 1), true);
   const patternChunkPayload = patternRamData.length > 0 ? patternRamData : new Uint8Array(1); // all zeros when unused
   const patternChunk = createChunk(CHUNK.MUSIC_PATTERNS, patternChunkPayload, true);
   const trackChunk = createChunk(CHUNK.MUSIC_TRACKS, encodeTrack(song), true);
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
      wholePlayroutineCode: code,
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
