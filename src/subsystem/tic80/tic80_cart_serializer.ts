import playroutineTemplateTxt from "../../../bridge/playroutine.lua";
import playroutineSharedTemplateTxt from "../../../bridge/playroutine_shared.inc.lua";
import {SelectionRect2D} from "../../hooks/useRectSelection2D";
import {modSourceToU8, SomaticEffectKind, SomaticInstrumentWaveEngine, ToWaveEngineId} from "../../models/instruments";
//import {WaveEngineId as WaveEngineIdConst} from "../models/instruments";
import {SomaticMemoryLayout, Tic80Constants, Tic80MemoryMap} from "../../../bridge/memory_layout";
import {encodeBridgeExtraSongDataTransaction} from "../../../bridge/extraSongBridgeTransaction";
import {encodeSomaticExtraSongDataPayload, MORPH_ENTRY_BYTES, MorphEntryCodec, MorphEntryFieldNamesToRename, SOMATIC_PATTERN_CELL_COUNT, SOMATIC_PATTERN_MASK_BYTES, SOMATIC_PATTERN_ROW_COUNT, WAVEFORM_MORPH_GRADIENT_NODE_BYTES, WaveformMorphGradientNodeCodec, type MorphEntryInput, type SomaticPatternEntryPacked, type WaveformMorphGradientNodePacked, } from "../../../bridge/morphSchema";
import {LoopMode} from "../../audio/backend";
import {buildCueSheet, type CueSheetEntry, type Song} from "../../models/song";
import {gTic80AllChannelsAudible, kSomaticPatternCommand, SomaticCaps, Tic80Caps, TicMemoryMap} from "../../models/tic80Capabilities";
import {emitLuaBitpackPrelude, emitLuaDecoder, emitLuaTableBitpackPrelude} from "../../utils/bitpack/emitLuaDecoder";
import {MemoryRegion} from "../../utils/bitpack/MemoryRegion";
import {base85Plus1Encode, gSomaticLZDefaultConfig, lzCompress} from "../../utils/encoding";
import {OptimizationRuleOptions, processLua} from "../../utils/lua/lua_processor";
import {assert, clamp, removeLuaBlockMarkers, replaceLuaBlock, typedKeys} from "../../utils/utils";
import {getSomaticVersionAndCommitString} from "../../utils/versionString";
import {BakedSong, BakeSong} from "./bakeSong";
import {analyzePlaybackFeatures, getMaxSfxUsedIndex, getMaxWaveformUsedIndex, MakeOptimizeResultEmpty, OptimizeResult, OptimizeSong, PlaybackFeatureUsage} from "./SongOptimizer";
import {encodePatternChannelDirect} from "./tic80_pattern_encoding";
import {encodePreparedSongOrderForBridge, PreparedSong, prepareSongColumns} from "./tic80_prepared_song";
import {createChunk, encodeSfx, encodeTempo, encodeTrackSpeed, encodeWaveforms, packTrackFrame, packWaveformSamplesToBytes16, removeTrailingZerosFn, stringToAsciiPayload, TicChunkType} from "./tic80_serialization";
import {toLuaStringLiteral} from "../../utils/lua/lua_fundamentals";


// const releaseOptions: OptimizationRuleOptions = {
//    stripComments: true,
//    stripDebugBlocks: true,
//    maxIndentLevel: 1,
//    lineBehavior: "tight",
//    maxLineLength: 180,
//    aliasRepeatedExpressions: true,
//    renameLocalVariables: true,
//    aliasLiterals: true,
//    packLocalDeclarations: true,
//    simplifyExpressions: true,
//    removeUnusedLocals: true,
//    removeUnusedFunctions: false,
//    functionNamesToKeep: [],
//    renameTableFields: true,
//    tableEntryKeysToRename: [...MorphEntryFieldNamesToRename],
// } as const;

const debugOptions: OptimizationRuleOptions = {
   stripComments: false,
   stripDebugBlocks: false,
   maxIndentLevel: 50,
   lineBehavior: "pretty",
   maxLineLength: 120,
   aliasRepeatedExpressions: false,
   renameLocalVariables: false,
   aliasLiterals: false,
   packLocalDeclarations: false,
   simplifyExpressions: false,
   removeUnusedLocals: false,
   removeUnusedFunctions: false,
   functionNamesToKeep: [],
   renameTableFields: false,
   tableEntryKeysToRename: [],
} as const;


function durationSecondsToTicks10(seconds: number): number {
   const s = Math.max(0, seconds ?? 0);
   return clamp(Math.floor(s * Tic80Caps.frameRate), 0, 0x03ff);
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

function RateInHzToTicks60HzAllowZero(rateHz: number): number {
   if (!Number.isFinite(rateHz) || rateHz <= 0)
      return 0;
   const ticks = Math.floor(Tic80Caps.frameRate / rateHz);
   return clamp(ticks, 1, 0xffff);
}

function panN11ToU8(pan: number): number {
   return clamp(Math.round((clamp(pan ?? 0, -1, 1) + 1) * 0.5 * 0xff), 0, 0xff);
}

function panLfoDepthToU8(depth: number): number {
   return clamp(Math.round(clamp(depth ?? 0, 0, 1) * 0xff), 0, 0xff);
}

function volume01ToU8(volume: number): number {
   return clamp(Math.round(clamp(volume ?? 1, 0, 1) * 0xff), 0, 0xff);
}

// Extract the wave-morphing instrument config from the song.
function getMorphMap(song: Song): MorphEntryInput[] {
   const entries: MorphEntryInput[] = [];
   for (let instrumentId = 0; instrumentId < (song.instruments.length ?? 0); instrumentId++) {
      const inst = song.instruments[instrumentId];

      // Only include instruments that require bridge-side runtime config.
      // This prevents overwriting the bridge marker/mailboxes in RAM.
      const waveEngine: SomaticInstrumentWaveEngine = inst.waveEngine;
      const lowpassEnabled = !!inst.lowpassEnabled;
      const effectKind: SomaticEffectKind = inst.effectKind ?? SomaticEffectKind.none;
      if (!inst.needsPlayroutineConfig())
         continue;

      let morphGradientNodes: WaveformMorphGradientNodePacked[]|undefined;
      if (waveEngine === "morph") {
         const nodes = inst.morphGradientNodes;
         if (!Array.isArray(nodes) || nodes.length <= 0) {
            throw new Error(`Morph instrument ${instrumentId} is missing morphGradientNodes`);
         }
         morphGradientNodes = nodes.map((n) => ({
                                           waveBytes: packWaveformSamplesToBytes16(n.amplitudes),
                                           durationTicks10: durationSecondsToTicks10(n.durationSeconds),
                                           curveS6: curveN11ToS6(n.curveN11),
                                        }));
      }
      const lowpassDurationTicks12 = durationSecondsToTicks12(inst.lowpassDurationSeconds);
      const effectDurationTicks12 = durationSecondsToTicks12(inst.effectDurationSeconds);
      const lfoCycleTicks12 = clamp(RateInHzToTicks60HzAllowZero(inst.lfoRateHz ?? 0), 0, 0x0fff);
      const effectModSource = modSourceToU8(inst.effectModSource);
      const effectCurveS6 = curveN11ToS6(inst.effectCurveN11);
      const effectAmtU8 = effectKind === SomaticEffectKind.hardSync ? hardSyncStrengthToU8(inst.effectAmount) :
                                                                      clamp(inst.effectAmount | 0, 0, 255);
      // Somatic instrument indices are 0-based; TIC-80 serialization uses +2.
      entries.push({
         instrumentId: instrumentId + 2,
         cfg: {
            sourceWaveformIndex: clamp(inst.sourceWaveformIndex | 0, 0, Tic80Caps.waveform.count - 1),
            pwmDuty5: clamp(inst.pwmDuty | 0, 0, 31),
            pwmDepth5: clamp(inst.pwmDepth | 0, 0, 31),

            lowpassEnabled,
            lowpassAmountU8: clamp(inst.lowpassAmountU8, 0, 0xff),
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
            panU8: panN11ToU8(inst.pan),
            panLfoDepthU8: panLfoDepthToU8(inst.panLfoDepth),
            volumeU8: volume01ToU8(inst.volume),
         },
         morphGradientNodes,
      });
   }

   // Sort to keep output stable.
   entries.sort((a, b) => a.instrumentId - b.instrumentId);
   return entries;
}

// extract the somatic pattern EXTRA data from the prepared song
function getSomaticPatternExtraEntries(prepared: PreparedSong): SomaticPatternEntryPacked[] {
   const entries: SomaticPatternEntryPacked[] = [];

   for (let patternIndex0b = 0; patternIndex0b < prepared.patternColumns.length; patternIndex0b++) {
      const col = prepared.patternColumns[patternIndex0b];
      const channel = col.channel;
      const cells: SomaticPatternEntryPacked["cells"] = [];
      for (let row = 0; row < prepared.rowsPerPattern; row++) {
         const cell = channel.getCell(row);
         const extra: SomaticPatternEntryPacked["cells"][number] = {rowIndex: row};
         const somaticEffectInfo = kSomaticPatternCommand.coerceByKey(cell.somaticEffect);
         if (somaticEffectInfo) {
            extra.effectId = somaticEffectInfo.tic80SerializedValue;
            extra.paramU8 = (cell.somaticParam ?? 0) & 0xff;
         }
         if (cell.volumeU8 !== undefined)
            extra.volumeU8 = cell.volumeU8 & 0xff;
         if (cell.panU8 !== undefined)
            extra.panU8 = cell.panU8 & 0xff;
         if (extra.effectId !== undefined || extra.volumeU8 !== undefined || extra.panU8 !== undefined)
            cells.push(extra);
      }
      if (cells.length === 0)
         continue;

      assert(
         patternIndex0b >= 0 && patternIndex0b < SomaticCaps.maxPatternCount,
         `getSomaticPatternExtraEntries: patternIndex0b out of range: ${patternIndex0b}`);
      entries.push({patternIndex: patternIndex0b, cells});
   }

   return entries;
}

function encodeExtraSongDataForBridge(song: Song, prepared: PreparedSong): Uint8Array {
   const instruments = getMorphMap(song);
   const patterns = getSomaticPatternExtraEntries(prepared);
   const raw = encodeSomaticExtraSongDataPayload({instruments, patterns});
   const compressed = lzCompress(raw, gSomaticLZDefaultConfig);
   return encodeBridgeExtraSongDataTransaction(compressed, raw.length);
}

function buildCueSheetLua(cueSheet: CueSheetEntry[] | null): string {
   if (cueSheet == null) {
      return "";
   }

   const entries: string[] = [];
   const cueSheetEntries = cueSheet;
   for (let orderIndex = 0; orderIndex < cueSheetEntries.length; orderIndex++) {
      const entry = cueSheetEntries[orderIndex]!;
      const fields: string[] = [];
      if (entry.pi !== undefined)
         fields.push(`pi = ${entry.pi}`);
      if (entry.beat !== undefined)
         fields.push(`beat = ${entry.beat}`);
      if (entry.rows !== undefined)
         fields.push(`rows = ${entry.rows}`);
      if (entry.icon !== undefined)
         fields.push(`icon = ${toLuaStringLiteral(entry.icon)}`);
      if (entry.note !== undefined)
         fields.push(`note = ${toLuaStringLiteral(entry.note)}`);
      entries.push(fields.length > 0 ? `\t{ ${fields.join(", ")} },` : "\t{},");
   }

   if (entries.length === 0) {
      return "SOMATIC_CUE_SHEET = {}";
   }

   return "SOMATIC_CUE_SHEET = {\n" + entries.join("\n") + "\n}";
}

export interface ExtraSongDataDetails {
   binaryPayload: Uint8Array;
   compressedPayload: Uint8Array;
   base85Payload: string;
   luaStringLiteral: string;
   krateInstruments: MorphEntryInput[];
}
;

function makeExtraSongDataDetails(song: Song, prepared: PreparedSong): ExtraSongDataDetails {
   const instruments = getMorphMap(song);
   const patterns = getSomaticPatternExtraEntries(prepared);
   const packed = encodeSomaticExtraSongDataPayload({instruments, patterns});
   const compressed = lzCompress(packed, gSomaticLZDefaultConfig);
   const b85 = base85Plus1Encode(compressed);

   //const luaTableLiteral = `{ b85=${toLuaStringLiteral(b85)}, payloadCLen=${compressed.length} }`;

   return {
      binaryPayload: packed,
      compressedPayload: compressed,
      base85Payload: b85,
      luaStringLiteral: toLuaStringLiteral(b85),
      krateInstruments: instruments,
   };
}


// Each channel column is serialized independently so columns can be deduped across patterns.
function encodePreparedPatternColumns(prepared: PreparedSong): Uint8Array[] {
   return prepared.patternColumns.map((col) => {
      const encoded = encodePatternChannelDirect(col.channel);
      return lzCompress(encoded, gSomaticLZDefaultConfig);
   });
}


function encodeTrack(song: Song): Uint8Array {
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

   buf[50] = encodeTrackSpeed(song.speed); //speedByte & 0xff;

   // Rows: decode is 64 - R (so encode is the same op)
   // peek(81557)
   buf[49] = 64 - song.rowsPerPattern;
   buf[48] = encodeTempo(song.tempo);

   return buf;
}

// bakes some things into a copy of the song for playback.

export interface Tic80SerializeSongArgs {
   song: Song;
   loopMode: LoopMode;
   cursorSongOrder: number,       //
      cursorChannelIndex: number, //
      cursorRowIndex: number,
      patternSelection: SelectionRect2D|null, //
      audibleChannels: Set<number>,
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
interface TransmissionBlock {
   region: MemoryRegion;
   payload: Uint8Array;
}
;
export interface Tic80SerializedSong {
   bakedSong: BakedSong;
   optimizeResult: OptimizeResult;
   preparedSong: PreparedSong;
   // Identifies everything that affects sequenced playback, while deliberately
   // excluding instrument/waveform configuration that can be updated live.
   playbackFingerprint: string;
   //waveformData: Uint8Array;
   //sfxData: Uint8Array;
   //trackData: Uint8Array;

   // Packed Somatic extra song data for the bridge cart (instruments + patterns).
   //extraSongData: Uint8Array;

   // length + order itself
   //songOrderData: Uint8Array;

   // column-based payload; each entry is one channel column (192 bytes before compression)
   //patternData: Uint8Array;

   standardBlocksToTransmit: TransmissionBlock[], bridgeBlocksToTransmit: TransmissionBlock[],
}

function makePlaybackFingerprint(bakedSong: BakedSong): string {
   const song = bakedSong.bakedSong;
   const sequence = song.songOrder.map((orderEntry, orderIndex) => {
      const patternIndex = clamp(orderEntry.patternIndex | 0, 0, Math.max(0, song.patterns.length - 1));
      const pattern = song.patterns[patternIndex];
      const effectiveRows = song.getOrderEffectiveRowCount(orderIndex);
      const channels = Array.from({length: Tic80Caps.song.audioChannels}, (_, channelIndex) => {
         const rows = pattern?.getChannel(channelIndex).toData().rows ?? [];
         return Array.from({length: effectiveRows}, (_, rowIndex) => rows[rowIndex] ?? {});
      });
      return {effectiveRows, channels};
   });

   return JSON.stringify({
      wantSongLoop: bakedSong.wantSongLoop,
      transportConversion: bakedSong.transportConversion,
      tempo: song.tempo,
      speed: song.speed,
      rowsPerPattern: song.rowsPerPattern,
      sequence,
   });
}

export function serializeSongForTic80Bridge(args: Tic80SerializeSongArgs): Tic80SerializedSong {
   // first, bake loop info into the song.
   const bakedSong = BakeSong(args);
   const preparedSong = prepareSongColumns(bakedSong.bakedSong);
   assert(
      preparedSong.patternColumns.length <= SomaticCaps.maxPatternCount,
      `serializeSongForTic80Bridge: patternColumns=${preparedSong.patternColumns.length} exceeds maxPatternCount=${
         SomaticCaps.maxPatternCount}`);

   // NB: do not optimize waveforms / instruments.
   // it changes indices that the editor is using. so for example we optimize out an instrument that's not used in the song,
   // and the user can't hear any changes made to that instrument.
   // but we are free to optimize pattern data, because it gets ALWAYS updated whenever it's invoked from the playroutine.
   //const optimizeResult = OptimizeSong(song);
   //song = optimizeResult.optimizedSong;
   assert(bakedSong.bakedSong.instruments.length === args.song.instruments.length);

   const waveformData = encodeWaveforms(
      bakedSong.bakedSong, bakedSong.bakedSong.waveforms.length); // always send all waveforms even if unused
   const sfxData = encodeSfx(bakedSong.bakedSong, bakedSong.bakedSong.instruments.length);
   const trackData = encodeTrack(bakedSong.bakedSong);
   const extraSongData = encodeExtraSongDataForBridge(bakedSong.bakedSong, preparedSong);

   const songOrderData = encodePreparedSongOrderForBridge(preparedSong);

   const preparedPatternData = encodePreparedPatternColumns(preparedSong); // separate pattern data for playback use
   const patternData = ch_serializePatterns(preparedPatternData);
   assert(
      patternData.length <= SomaticCaps.maxPatternLengthToBridge,
      `Bridge pattern data overflow: need ${patternData.length} bytes, limit ${SomaticCaps.maxPatternLengthToBridge}`,
   );

   return {
      bakedSong,
      preparedSong,
      playbackFingerprint: makePlaybackFingerprint(bakedSong),
      optimizeResult: {
         ...MakeOptimizeResultEmpty(bakedSong.bakedSong),
         usedPatternColumnCount: preparedSong.patternColumns.length,
         usedSfxCount: getMaxSfxUsedIndex(bakedSong.bakedSong) + 1,
         usedWaveformCount: getMaxWaveformUsedIndex(bakedSong.bakedSong) + 1,
         featureUsage: analyzePlaybackFeatures(bakedSong.bakedSong),
      },
      standardBlocksToTransmit: [
         {
            region: Tic80MemoryMap.Waveforms,
            payload: waveformData,
         },
         {
            region: Tic80MemoryMap.Sfx,
            payload: sfxData,
         },
         {
            region: Tic80MemoryMap.MusicTracks,
            payload: trackData,
         },
      ],
      bridgeBlocksToTransmit: [
         {
            region: new MemoryRegion({
               name: "songOrderData",
               address: TicMemoryMap.TF_ORDER_LIST,
               size: songOrderData.length,
            }),
            payload: songOrderData,
         },
         // pattern data
         {
            region: new MemoryRegion({
               name: "patternData",
               address: TicMemoryMap.TF_PATTERN_DATA,
               size: patternData.length,
            }),
            payload: patternData,
         },
         // extra song data
         {
            region: new MemoryRegion({
               name: "extraSongData",
               address: TicMemoryMap.BRIDGE_EXTRA_SONG_DATA_ADDR,
               size: extraSongData.length,
            }),
            payload: extraSongData,
         },
      ],
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

export function GetRuntimeReservedRegionsInPatternMemory(): MemoryRegion[] {
   return [
      SomaticMemoryLayout.patternBufferA,
      SomaticMemoryLayout.patternBufferB,
      SomaticMemoryLayout.tempBufferA,
      SomaticMemoryLayout.tempBufferB,
   ];
}

export function GetMemoryRegionForCompressedPatternData(): MemoryRegion {
   // patterns are stuffed into TIC-80 pattern memory starting at the beginning of the region.
   // We also use that region for other things, so we need to calculate the available space based on
   // our other uses.
   // - pattern buffer A & B
   // - temp buffer A & B
   // so basically, find the lowest address that's not touched by those buffers, and use that as the limit.
   const reservedRegionsInPatternMem = GetRuntimeReservedRegionsInPatternMemory();
   const minAddress = Math.min(...reservedRegionsInPatternMem.map((r) => r.address));
   return new MemoryRegion({
      name: "CompressedPatternDataCapacity",
      address: Tic80MemoryMap.MusicPatterns.address,
      size: minAddress - Tic80MemoryMap.MusicPatterns.address,
   });
};

// patterns are stuffed into TIC-80 pattern memory, which is limited in size.
// this function will decide how to serialize everything.
interface PatternMemoryPlan {
   // raw, uncompressed patterns for debugging/inspection -- the actual payload that TIC-80 understands.
   patternChunks: Uint8Array[];

   compressedPatterns: Uint8Array[]; // all patterns, compressed, for debugging/inspection
   compressedPatternsInRam: {payload: Uint8Array;
                             memoryRegion: MemoryRegion;}[]; // individual info for each pattern that fits in RAM
   patternsInLuaCount: number;                               // how many patterns were serialized into Lua code vs RAM
   patternRamData: Uint8Array;                               // concatenated compressed patterns that fit in RAM
   //patternLengths: number[];     // size of the base85-decoded (still compressed) pattern data
   //patternCodeEntries: string[]; // Lua code entries for each pattern column

   // Lua code entries for patterns in RAM (in pairs: offset, length) -- where offset is relative to PATTERNS_BASE
   //ramPatternEntries: string[];
   ramPatternLuaString: string;
   codePatternStrings: string[]; // Lua code entries for patterns in code (base85 strings)
}

export function planPatternMemorySerialization(prepared: PreparedSong): PatternMemoryPlan {
   const patternChunks: Uint8Array[] = [];
   const compressedPatterns: Uint8Array[] = [];
   const compressedPatternsInRam: {payload: Uint8Array; memoryRegion: MemoryRegion;}[] = [];
   //const patternLengths: number[] = [];
   //const patternCodeEntries: string[] = [];
   const ramPatternEntries: number[] = []; // this payload is a stream of u16 pairs: offset, length
   const codePatternStrings: string[] = [];

   const capacityRegion = GetMemoryRegionForCompressedPatternData(); //.allocFromBottom(90);
   const patternRamBuffer = new Uint8Array(capacityRegion.size);
   let patternRamCursor = 0; // relative to PATTERNS_BASE
   let ramFull = false;      // once ram is full, all remaining patterns go to code. this is to keep them sequential!
   let patternsInLuaCount = 0;

   for (let columnIndex0b = 0; columnIndex0b < prepared.patternColumns.length; columnIndex0b++) {
      const col = prepared.patternColumns[columnIndex0b];
      const encodedPattern = encodePatternChannelDirect(col.channel);
      assert(encodedPattern.length === Tic80Constants.BYTES_PER_MUSIC_PATTERN);
      patternChunks.push(encodedPattern);

      const compressed = lzCompress(encodedPattern, gSomaticLZDefaultConfig);
      compressedPatterns.push(compressed);

      const fitsInPatternRam = (patternRamCursor + compressed.length) <= patternRamBuffer.length;
      ramFull = ramFull || !fitsInPatternRam;
      if (!ramFull) {
         patternRamBuffer.set(compressed, patternRamCursor);
         //patternLengths.push(compressed.length);

         const offset = patternRamCursor;
         const absAddr = (capacityRegion.address + offset);
         compressedPatternsInRam.push({
            payload: compressed,
            memoryRegion: new MemoryRegion({
               name: `PatternCol${columnIndex0b} (${compressed.length} bytes)`,
               address: absAddr,
               size: compressed.length,
            })
         });

         patternRamCursor += compressed.length;
         // Lua expects an offset relative to PATTERNS_BASE.
         //patternCodeEntries.push(`${offset}`);
         //ramPatternEntries.push(`${offset}, ${compressed.length}`);
         ramPatternEntries.push(offset);
         ramPatternEntries.push(compressed.length);
      } else {
         // Spill to base85 string when RAM is full.
         const patternStr = base85Plus1Encode(compressed);
         //patternCodeEntries.push(toLuaStringLiteral(patternStr));
         codePatternStrings.push(toLuaStringLiteral(patternStr));
         patternsInLuaCount++;
      }
   }

   let patternRamData = patternRamBuffer.subarray(0, patternRamCursor);
   // Avoid producing a zero-length chunk when we have capacity but nothing fit.
   if (patternRamData.length === 0 && patternRamBuffer.length > 0) {
      patternRamData = new Uint8Array(1);
   }

   // serialize the ram pattern entries as a U8 buffer (u16 pairs)
   const ramPatternEntriesBuffer = new Uint8Array(ramPatternEntries.length * 2);
   for (let i = 0; i < ramPatternEntries.length; i++) {
      const v = ramPatternEntries[i] & 0xffff;
      ramPatternEntriesBuffer[i * 2 + 0] = v & 0xff;
      ramPatternEntriesBuffer[i * 2 + 1] = (v >> 8) & 0xff;
   }
   const ramPatternEntryCompressed = lzCompress(ramPatternEntriesBuffer, gSomaticLZDefaultConfig);
   const ramPatternLuaString = toLuaStringLiteral(base85Plus1Encode(ramPatternEntryCompressed));

   return {
      patternChunks,
      compressedPatterns,
      compressedPatternsInRam,
      patternRamData,
      //ramPatternEntries,
      ramPatternLuaString,
      codePatternStrings,
      patternsInLuaCount,
   };
};


//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function getCode(
   song: Song,                                  //
   preparedSong: PreparedSong,                  //
   variant: "debug"|"release",                  //
   patternSerializationPlan: PatternMemoryPlan, //
   features: PlaybackFeatureUsage,              //
   extraSongDataDetails: ExtraSongDataDetails,
   cueSheet: CueSheetEntry[] | null,
   ): //
   {
      code: string,          //
      generatedCode: string, //

      // patternChunks: Uint8Array[], // raw, uncompressed patterns for debugging/inspection
      // patternRamData: Uint8Array,  // packed compressed columns to seed into TIC-80 pattern memory
   } {
   // Generate the SOMATIC_MUSIC_DATA section
   // song order is now a Uint8Array -- a stream of pattern column indices.
   const songOrderPayload = new Uint8Array(preparedSong.songOrder.length * Tic80Caps.song.audioChannels);
   const orderRowsPayload = new Uint8Array(preparedSong.songOrder.length);
   for (let i = 0; i < preparedSong.songOrder.length; i++) {
      const entry = preparedSong.songOrder[i];
      const base = i * Tic80Caps.song.audioChannels;
      for (let ch = 0; ch < Tic80Caps.song.audioChannels; ch++) {
         const idx = entry.patternColumnIndices[ch] | 0;
         songOrderPayload[base + ch] = idx;
      }
      orderRowsPayload[i] = clamp(entry.effectiveRows | 0, 1, song.rowsPerPattern);
   }
   // lz compress & b85+1 encode.
   const songOrderCompressed = lzCompress(songOrderPayload, gSomaticLZDefaultConfig);
   const songOrderB85 = base85Plus1Encode(songOrderCompressed);
   const songOrder = toLuaStringLiteral(songOrderB85);
   const orderRowsCompressed = lzCompress(orderRowsPayload, gSomaticLZDefaultConfig);
   const orderRows = toLuaStringLiteral(base85Plus1Encode(orderRowsCompressed));
   const cueSheetSection = buildCueSheetLua(cueSheet);

   const musicDataSection = `-- BEGIN_SOMATIC_MUSIC_DATA
SOMATIC_MUSIC_DATA = {
 tempo = ${song.tempo},
 speed = ${song.speed},
 rowsPerBeat = ${song.highlightRowCount},
rowsPerPattern = ${song.rowsPerPattern},
so = ${songOrder},
 orows = ${orderRows},
extraSongData = ${extraSongDataDetails.luaStringLiteral},
 -- patterns in RAM
 rp = ${patternSerializationPlan.ramPatternLuaString},
 -- patterns in code
 cp = { ${patternSerializationPlan.codePatternStrings.join(",")} },
}
-- END_SOMATIC_MUSIC_DATA

${cueSheetSection}`;

   // Generate the autogen section with the morph decoder and memory constants
   const autogenSection = `-- AUTO-GENERATED. DO NOT EDIT BY HAND.

-- Memory Constants (generated from memory_layout.ts)
local WAVE_BASE = ${Tic80MemoryMap.Waveforms.address}
local SOUND_REGISTERS_BASE = ${Tic80MemoryMap.SoundRegisters.address}
local SOUND_REGISTER_BYTES = ${Tic80Constants.BYTES_PER_SOUND_REGISTER}
local SOUND_REGISTER_WAVEFORM_OFFSET = ${Tic80Constants.SOUND_REGISTER_WAVEFORM_OFFSET}
local STEREO_VOLUME_BASE = ${Tic80MemoryMap.StereoVolume.address}
local SFX_BASE = ${Tic80MemoryMap.Sfx.address}
local PATTERNS_BASE = ${Tic80MemoryMap.MusicPatterns.address}
local TRACKS_BASE = ${Tic80MemoryMap.MusicTracks.address}
local TEMP_BUFFER_A = ${SomaticMemoryLayout.tempBufferA.address}
local TEMP_BUFFER_B = ${SomaticMemoryLayout.tempBufferB.address}
local PATTERN_BUFFER_A = ${SomaticMemoryLayout.patternBufferA.address}
local PATTERN_BUFFER_B = ${SomaticMemoryLayout.patternBufferB.address}
local MORPH_ENTRY_BYTES = ${MORPH_ENTRY_BYTES}
local WAVEFORM_MORPH_GRADIENT_NODE_BYTES = ${WAVEFORM_MORPH_GRADIENT_NODE_BYTES}
local SOMATIC_PATTERN_MASK_BYTES = ${SOMATIC_PATTERN_MASK_BYTES}
local SOMATIC_PATTERN_CELL_COUNT = ${SOMATIC_PATTERN_CELL_COUNT}
local SOMATIC_PATTERN_ROW_COUNT = ${SOMATIC_PATTERN_ROW_COUNT}

${emitLuaBitpackPrelude({baseArgName: "base"}).trim()}
${emitLuaTableBitpackPrelude().trim()}

${emitLuaDecoder(MorphEntryCodec, {
      functionName: "decode_MorphEntry",
      baseArgName: "base",
      includeLayoutComments: true,
   readerFactoryName: "_bp_make_table_reader",
   }).trim()}

${emitLuaDecoder(WaveformMorphGradientNodeCodec, {
   functionName: "decode_WaveformMorphGradientNode",
      baseArgName: "base",
      includeLayoutComments: false,
   readerFactoryName: "_bp_make_table_reader",
   }).trim()}`;

   // Inject shared code, then strip unused feature blocks (so shared feature markers are handled as usual)
   const playroutineTemplateWithShared = replaceLuaBlock(
      playroutineTemplateTxt,
      "-- BEGIN_SOMATIC_PLAYROUTINE_SHARED",
      "-- END_SOMATIC_PLAYROUTINE_SHARED",
      playroutineSharedTemplateTxt,
   );

   // Replace the SOMATIC_MUSIC_DATA section in the template
   const playroutineTemplate = stripUnusedFeatureBlocks(playroutineTemplateWithShared, features);
   let code = replaceLuaBlock(
      playroutineTemplate, "-- BEGIN_SOMATIC_MUSIC_DATA", "-- END_SOMATIC_MUSIC_DATA", musicDataSection);

   // Inject the autogen section at the top (after the first comment block if present)
   // Look for a marker or just insert it before BEGIN_SOMATIC_MUSIC_DATA
   const autogenMarker = "-- PLAYROUTINE_AUTOGEN_START";
   if (code.includes(autogenMarker)) {
      code = replaceLuaBlock(code, "-- PLAYROUTINE_AUTOGEN_START", "-- PLAYROUTINE_AUTOGEN_END", autogenSection);
   } else {
      // If marker doesn't exist, insert before BEGIN_SOMATIC_MUSIC_DATA
      const musicDataMarker = "-- BEGIN_SOMATIC_MUSIC_DATA";
      const insertPos = code.indexOf(musicDataMarker);
      if (insertPos >= 0) {
         code = code.slice(0, insertPos) + autogenSection + "\n\n" + code.slice(insertPos);
      }
   }

   // Replace tokens __AUTOGEN_TEMP_PTR_A and __AUTOGEN_TEMP_PTR_B to be replaced in the lua code.
   // with numeric hex literals like 0x1234
   code = code.replace(/__AUTOGEN_TEMP_PTR_A/g, `0x${TicMemoryMap.__AUTOGEN_TEMP_PTR_A.toString(16)}`)
             .replace(/__AUTOGEN_TEMP_PTR_B/g, `0x${TicMemoryMap.__AUTOGEN_TEMP_PTR_B.toString(16)}`)
             .replace(/__AUTOGEN_BUF_PTR_A/g, `0x${TicMemoryMap.__AUTOGEN_BUF_PTR_A.toString(16)}`)
             .replace(/__AUTOGEN_BUF_PTR_B/g, `0x${TicMemoryMap.__AUTOGEN_BUF_PTR_B.toString(16)}`);

   if (song.useCustomEntrypointLua) {
      code = replaceLuaBlock(code, "-- BEGIN_CUSTOM_ENTRYPOINT", "-- END_CUSTOM_ENTRYPOINT", song.customEntrypointLua);
   }

   // optimize code
   const optimizationRuleOptions: OptimizationRuleOptions = variant === "release" ? song.releaseMinificationOptions : debugOptions;
   console.log(`Applying optimization rules`, optimizationRuleOptions);
   code = processLua(code, optimizationRuleOptions);

   // show build info in a comment.
   code = `-- ${getSomaticVersionAndCommitString()}\n` +
      `-- Generated on ${new Date().toISOString()}\n` + code;

   return {
      code,
      generatedCode: musicDataSection,
   };
}
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export type SongCartDetails = {
   elapsedMillis: number;     //
   waveformChunk: Uint8Array; //
   sfxChunk: Uint8Array;      //
   //patternChunk: Uint8Array;  //
   trackChunk: Uint8Array; //

   //realPatternChunks: Uint8Array[]; // before turning into literals
   patternSerializationPlan: PatternMemoryPlan;
   extraSongDataDetails: ExtraSongDataDetails;

   // how much of the code chunk is generated code.
   wholePlayroutineCode: string;
   generatedCode: string;
   codeChunk: Uint8Array; //

   optimizeResult: OptimizeResult;

   cartridge: Uint8Array;

   // detailed memory usage / placement
   memoryRegions: {
      waveforms: MemoryRegion;         // Used waveforms region
      sfx: MemoryRegion;               // Used SFX region
      patterns: MemoryRegion[];        // Used patterns region (compressed data)
      patternsRuntime: MemoryRegion[]; // Runtime pattern buffers (A, B, tempA, tempB)
      bridgeMap: MemoryRegion[];       // Bridge-only runtime regions in Map memory
   };
}

export function serializeSongToCartDetailed(
   song: Song,                  //
   optimize: boolean,           //
   variant: "debug"|"release",  //
   audibleChannels: Set<number> //
   ):
   SongCartDetails //
{
   const startTime = performance.now();

   // sanity: check that patternmem regions are actually contained in pattern mem and don't have any overlaps.
   const reservedRegionsInPatternMem = GetRuntimeReservedRegionsInPatternMemory();
   {
      for (const r of reservedRegionsInPatternMem) {
         assert(
            Tic80MemoryMap.MusicPatterns.containsRegion(r),
            `Reserved region ${r.name} is not contained in MusicPatterns`);
         for (const other of reservedRegionsInPatternMem) {
            if (r !== other) {
               assert(
                  !r.containsRegion(other) && !other.containsRegion(r),
                  `Reserved regions ${r.name} and ${other.name} overlap`);
            }
         }
      }
   }

   const cueSheet = buildCueSheet(song);

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
      audibleChannels: gTic80AllChannelsAudible,
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
   const preparedSong = prepareSongColumns(song);
   const patternSerializationPlan = planPatternMemorySerialization(preparedSong);
   const extraSongDataDetails = makeExtraSongDataDetails(song, preparedSong);

   const {code, generatedCode} =
      getCode(song, preparedSong, variant, patternSerializationPlan, optimizeResult.featureUsage, extraSongDataDetails, cueSheet);

   // waveforms
   const waveformCount = getMaxWaveformUsedIndex(song) + 1;
   let waveformPayload = encodeWaveforms(song, waveformCount);
   waveformPayload = removeTrailingZerosFn(waveformPayload);
   const waveformMemoryRegion = new MemoryRegion(
      {name: `${waveformCount} waveforms`, address: Tic80MemoryMap.Waveforms.address, size: waveformPayload.length});
   const waveformChunk = createChunk(TicChunkType.WAVEFORMS, waveformPayload, false);

   // sfx
   const sfxCount = getMaxSfxUsedIndex(song) + 1;
   let sfxPayload = encodeSfx(song, sfxCount);
   sfxPayload = removeTrailingZerosFn(sfxPayload);
   const sfxMemoryRegion =
      new MemoryRegion({name: `${sfxCount} SFX`, address: Tic80MemoryMap.Sfx.address, size: sfxPayload.length});
   const sfxChunk = createChunk(TicChunkType.SFX, sfxPayload, false);

   // patterns
   // const patternChunkPayload = patternRamData.length > 0 ? patternRamData : new Uint8Array(1); // all zeros when unused
   const patternChunk = createChunk(TicChunkType.MUSIC_PATTERNS, patternSerializationPlan.patternRamData, true);

   const trackChunk = createChunk(TicChunkType.MUSIC_TRACKS, encodeTrack(song), true);
   const codePayload = stringToAsciiPayload(code);
   const codeChunk = createChunk(TicChunkType.CODE, codePayload, false, 0);

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

   const memoryRegions = {
      waveforms: waveformMemoryRegion,
      sfx: sfxMemoryRegion,
      patterns: [new MemoryRegion({
         name: `Compressed Patterns`,
         address: Tic80MemoryMap.MusicPatterns.address,
         size: patternSerializationPlan.patternRamData.length,
      })],
      patternsRuntime: reservedRegionsInPatternMem,
      bridgeMap: [
         SomaticMemoryLayout.marker,
         SomaticMemoryLayout.registers,
         SomaticMemoryLayout.inbox,
         SomaticMemoryLayout.outboxHeader,
         SomaticMemoryLayout.outboxLog,
      ],
   };

   return {
      waveformChunk,
      sfxChunk,
      patternSerializationPlan,
      trackChunk,
      codeChunk,
      wholePlayroutineCode: code,
      generatedCode,
      optimizeResult,
      cartridge,
      elapsedMillis,
      memoryRegions,
      extraSongDataDetails,
   };
}


export function serializeSongToCart(
   song: Song, optimize: boolean, variant: "debug"|"release", audibleChannels: Set<number>): Uint8Array {
   const details = serializeSongToCartDetailed(song, optimize, variant, audibleChannels);
   return details.cartridge;
}
