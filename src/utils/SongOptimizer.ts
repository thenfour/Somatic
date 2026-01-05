import {gSomaticLZDefaultConfig, lzCompress} from "../audio/encoding";
import {encodePatternChannelDirect} from "../audio/pattern_encoding";
import {prepareSongColumns} from "../audio/prepared_song";
import {SomaticEffectKind, Tic80Instrument} from "../models/instruments";
import {Pattern} from "../models/pattern";
import {Song} from "../models/song";
import {SongOrderItem} from "../models/songOrder";
import {Tic80Caps} from "../models/tic80Capabilities";
import {Tic80Waveform} from "../models/waveform";
import {clamp} from "./utils";

export type SongUsage = {
   usedPatterns: Set<number>;       // whole-pattern usage
   usedPatternColumns: Set<number>; // column-oriented usage
   usedInstruments: Set<number>;    //
   usedWaveforms: Set<number>;      //
   maxPattern: number;              // whole-pattern max index
   maxPatternColumn: number;        // max column index
   maxInstrument: number;           //
   maxWaveform: number;             //
};

// Traverses song order -> patterns -> instruments -> waveforms to find what is actually referenced.
export function calculateSongUsage(song: Song): SongUsage {
   const usedPatterns = new Set<number>();
   const usedInstruments = new Set<number>();
   const usedWaveforms = new Set<number>();

   // patterns that appear in the order list
   const maxPatternIndex = Math.max(song.patterns.length - 1, 0);
   for (let i = 0; i < song.songOrder.length; i++) {
      const idx = clamp(song.songOrder[i].patternIndex, 0, maxPatternIndex);
      usedPatterns.add(idx);
   }

   // instruments referenced by the used patterns
   const maxInstrumentIndex = Math.max(song.instruments.length - 1, 0);
   usedPatterns.forEach((patIdx) => {
      const pat = song.patterns[patIdx];
      if (!pat)
         return;
      pat.channels.forEach((channel) => {
         channel.rows.forEach((cell) => {
            if (cell.instrumentIndex === undefined || cell.instrumentIndex === null)
               return;
            const instIdx = clamp(cell.instrumentIndex, 0, maxInstrumentIndex);
            usedInstruments.add(instIdx);
         });
      });
   });

   // waveforms referenced by used instruments
   usedInstruments.forEach((instIdx) => {
      const inst = song.instruments[instIdx];
      const u = inst.getUsedWaveformIndices();
      u.forEach((waveIdx) => {
         usedWaveforms.add(waveIdx);
      });
   });

   const maxPattern = usedPatterns.size === 0 ? 0 : Math.max(...usedPatterns);
   const prepared = prepareSongColumns(song);
   const usedPatternColumns = new Set<number>(
      prepared.patternColumns.map((_, idx) => idx),
   );
   const maxPatternColumn = usedPatternColumns.size === 0 ? 0 : Math.max(...usedPatternColumns);
   const maxInstrument = usedInstruments.size === 0 ? 0 : Math.max(...usedInstruments);
   const maxWaveform = usedWaveforms.size === 0 ? 0 : Math.max(...usedWaveforms);

   return {
      usedPatterns,
      usedPatternColumns,
      usedInstruments,
      usedWaveforms,
      maxPattern,
      maxPatternColumn,
      maxInstrument,
      maxWaveform,
   };
}

// returns the 0-based index of the waveform with the highest index that is used by
// USED instruments in the song.
export function getMaxWaveformUsedIndex(song: Song): number {
   //return Tic80Caps.waveform.count - 1;
   return calculateSongUsage(song).maxWaveform;
}
export function getMaxSfxUsedIndex(song: Song): number {
   //return Tic80Caps.sfx.count - 1;
   return calculateSongUsage(song).maxInstrument;
}
export function getMaxPatternUsedIndex(song: Song): number {
   //return Tic80Caps.pattern.count - 1;
   return calculateSongUsage(song).maxPattern;
}

export interface PatternPayloadEstimate {
   rawBytes: number;
   compressedBytes: number;
   //luaStringBytes: number;
}

export interface PatternColumnAnalysisResult {
   totalColumns: number;
   distinctColumns: number;
   columnPayload: PatternPayloadEstimate;
}
;

export function analyzePatternColumns(song: Song): PatternColumnAnalysisResult {
   // each pattern has 4 columns (channels).
   // currently we serilaize patterns as one atomic unit.
   // the idea is to analyze how much space we can save if we serialize pattern-columns
   // separately and dedupe by column.
   //
   // NB: do this only for USED patterns in the song.
   // use contentSignatureForColumn for per-column signature.
   const usage = calculateSongUsage(song);
   const usedPatterns = usage.usedPatterns;
   const totalColumns = usedPatterns.size * Tic80Caps.song.audioChannels;

   const prepared = prepareSongColumns(song);
   const columnDataBySignature = new Map<string, Uint8Array>();
   prepared.patternColumns.forEach((col) => {
      const sig = JSON.stringify({channel: col.channel.toData()});
      if (columnDataBySignature.has(sig))
         return;
      columnDataBySignature.set(sig, encodePatternChannelDirect(col.channel));
   });

   let rawBytes = 0;
   let compressedBytes = 0;
   //let luaStringBytes = 0;

   columnDataBySignature.forEach((columnData) => {
      rawBytes += columnData.length;
      const compressed = lzCompress(columnData, gSomaticLZDefaultConfig);
      compressedBytes += compressed.length;
      //luaStringBytes += base85Encode(compressed).length;
   });

   return {
      totalColumns,
      distinctColumns: columnDataBySignature.size,
      columnPayload: {
         rawBytes,
         compressedBytes,
         //luaStringBytes,
      },
   };
};

export interface OptimizeResult {
   optimizedSong: Song;
   usedPatternColumnCount: number;
   usedWaveformCount: number;
   // includes 0 and 1 sfx so this will always be at least 1 for instrument#0, and 2 if you only have a note cut in your whole song (weird), and >=3 for normal cases.
   usedSfxCount: number;
   featureUsage: PlaybackFeatureUsage;

   // hold explanations of what changed (moving patterns, deduping etc)
   changeLog: string[];
   resultingStats: SongUsage;
}

export function MakeOptimizeResultEmpty(song: Song): OptimizeResult {
   return {
      optimizedSong: song,
      usedPatternColumnCount: 0,
      usedWaveformCount: 0,
      usedSfxCount: 0,
      featureUsage: makeFeatureUsage(),
      changeLog: [],
      resultingStats: {
         usedPatterns: new Set(),
         usedPatternColumns: new Set(),
         usedInstruments: new Set(),
         usedWaveforms: new Set(),
         maxPattern: 0,
         maxPatternColumn: 0,
         maxInstrument: 0,
         maxWaveform: 0,
      },
   };
}

export type PlaybackFeatureUsage = {
   waveMorph: boolean; //
   pwm: boolean;
   lowpass: boolean; //
   wavefold: boolean;
   hardSync: boolean;
   lfo: boolean;
};

const makeFeatureUsage = (): PlaybackFeatureUsage => ({
   waveMorph: false,
   pwm: false,
   lowpass: false,
   wavefold: false,
   hardSync: false,
   lfo: false,
});

export function OptimizeSong(song: Song): OptimizeResult {
   // clone so callers keep their original instance untouched.
   const working = song.clone();
   const changeLog: string[] = [];
   const featureUsage = makeFeatureUsage();

   const patternSignature = (pattern: Pattern): string => pattern.contentSignature();

   // Step 1: dedupe patterns by content and remap song order.
   const patternSigToIndex = new Map<string, number>();
   const patternRemap = new Map<number, number>();

   working.patterns.forEach((p, idx) => {
      const sig = patternSignature(p);
      const first = patternSigToIndex.get(sig);
      if (first !== undefined) {
         patternRemap.set(idx, first);
         changeLog.push(`Pattern ${idx} duplicated pattern ${first}; remapped usage.`);
      } else {
         patternSigToIndex.set(sig, idx);
         patternRemap.set(idx, idx);
      }
   });

   const usedPatternSet = new Set<number>();
   working.songOrder = working.songOrder.map((item, orderPos) => {
      // keep indexes inside bounds before remapping.
      const clamped = clamp(item.patternIndex, 0, Math.max(working.patterns.length - 1, 0));
      if (clamped !== item.patternIndex) {
         changeLog.push(`Song order entry ${orderPos} clamped from ${item.patternIndex} to ${clamped}.`);
      }
      const mapped = patternRemap.get(clamped) ?? clamped;
      usedPatternSet.add(mapped);
      return new SongOrderItem({patternIndex: mapped});
   });

   // Step 2: move used patterns to the front; keep unused after.
   const newPatterns: Pattern[] = [];
   const newPatternIndex = new Map<number, number>();
   const appendPattern = (oldIndex: number) => {
      newPatternIndex.set(oldIndex, newPatterns.length);
      newPatterns.push(working.patterns[oldIndex].clone());
   };

   working.patterns.forEach((_, idx) => {
      if (usedPatternSet.has(idx)) {
         appendPattern(idx);
      }
   });
   working.patterns.forEach((_, idx) => {
      if (!usedPatternSet.has(idx)) {
         appendPattern(idx);
      }
   });

   working.songOrder =
      working.songOrder.map((item) => new SongOrderItem({patternIndex: newPatternIndex.get(item.patternIndex) ?? 0}));
   working.patterns = newPatterns;
   const usedPatternCount = usedPatternSet.size;
   changeLog.push(`Moved ${usedPatternCount} used patterns to the front out of ${newPatterns.length}.`);

   // Step 3: find used instruments (SFX) from used patterns. Always keep 0 and 1 reserved slots.
   const usedInstrumentSet = new Set<number>([0, 1]);
   usedPatternSet.forEach((patternIdx) => {
      const pat = working.patterns[newPatternIndex.get(patternIdx) ?? patternIdx];
      pat.channels.forEach((channel) => {
         channel.rows.forEach((cell) => {
            if (cell.instrumentIndex !== undefined && cell.instrumentIndex !== null) {
               const inst = clamp(cell.instrumentIndex, 0, working.instruments.length - 1);
               usedInstrumentSet.add(inst);
            }
         });
      });
   });

   const newInstruments: Tic80Instrument[] = [];
   const instrumentRemap = new Map<number, number>();
   const appendInstrument = (oldIndex: number) => {
      instrumentRemap.set(oldIndex, newInstruments.length);
      newInstruments.push(working.instruments[oldIndex].clone());
   };

   working.instruments.forEach((_, idx) => {
      if (usedInstrumentSet.has(idx)) {
         appendInstrument(idx);
      }
   });
   working.instruments.forEach((_, idx) => {
      if (!usedInstrumentSet.has(idx)) {
         appendInstrument(idx);
      }
   });

   // update pattern cells with new instrument indexes across all patterns (used + unused) to keep data consistent.
   working.patterns.forEach((pattern) => {
      pattern.channels.forEach((channel) => {
         channel.rows.forEach((cell) => {
            if (cell.instrumentIndex !== undefined && cell.instrumentIndex !== null) {
               const clamped = clamp(cell.instrumentIndex, 0, newInstruments.length - 1);
               const mapped = instrumentRemap.get(clamped) ?? 0;
               cell.instrumentIndex = mapped;
            }
         });
      });
   });

   working.instruments = newInstruments;
   const usedSfxCount = usedInstrumentSet.size;
   changeLog.push(`Packed instruments: ${usedSfxCount} used (including reserved 0/1) of ${newInstruments.length}.`);

   // find used waveforms from used instruments and pack.
   const usedWaveformSet = new Set<number>();
   usedInstrumentSet.forEach((oldIndex) => {
      const mappedIndex = instrumentRemap.get(oldIndex);
      if (mappedIndex === undefined) {
         return;
      }
      const inst = newInstruments[mappedIndex];
      const u = inst.getUsedWaveformIndices();
      u.forEach((waveIdx) => {
         usedWaveformSet.add(waveIdx);
      });
   });
   if (usedWaveformSet.size === 0) {
      usedWaveformSet.add(0);
   }

   const newWaveforms: Tic80Waveform[] = [];
   const waveformRemap = new Map<number, number>();
   const appendWave = (oldIndex: number) => {
      waveformRemap.set(oldIndex, newWaveforms.length);
      newWaveforms.push(working.waveforms[oldIndex].clone());
   };

   working.waveforms.forEach((_, idx) => {
      if (usedWaveformSet.has(idx)) {
         appendWave(idx);
      }
   });
   working.waveforms.forEach((_, idx) => {
      if (!usedWaveformSet.has(idx)) {
         appendWave(idx);
      }
   });

   // remap waveform references inside all instruments.
   working.instruments.forEach((inst) => {
      inst.remapWaveformIndices(waveformRemap);
   });

   // Analyze features and zero unused params for size.
   newInstruments.forEach((inst) => {
      // Track usage before zeroing fields.
      if (inst.waveEngine === "morph") {
         featureUsage.waveMorph = true;
      } else {
         // not morphing: clear morph gradient data
         inst.morphGradientNodes = [];
      }

      if (inst.waveEngine === "pwm") {
         featureUsage.pwm = true;
      } else {
         inst.pwmDuty = 0;
         inst.pwmDepth = 0;
      }

      if (inst.lowpassEnabled) {
         featureUsage.lowpass = true;
      } else {
         inst.lowpassDurationSeconds = 0;
         inst.lowpassCurveN11 = 0;
         inst.lowpassModSource = "envelope";
      }

      if (inst.effectKind === SomaticEffectKind.wavefold && inst.effectAmount > 0) {
         featureUsage.wavefold = true;
      } else if (inst.effectKind === SomaticEffectKind.hardSync && inst.effectAmount > 0) {
         featureUsage.hardSync = true;
      } else {
         inst.effectKind = SomaticEffectKind.none;
         inst.effectAmount = 0;
         inst.effectDurationSeconds = 0;
         inst.effectCurveN11 = 0;
         inst.effectModSource = "envelope";
      }

      const lfoUsed = inst.lfoRateHz > 0 &&
         (inst.lowpassModSource === "lfo" || inst.effectModSource === "lfo" || inst.waveEngine === "pwm");
      if (lfoUsed) {
         featureUsage.lfo = true;
      } else {
         inst.lfoRateHz = 0;
         if (inst.lowpassModSource === "lfo")
            inst.lowpassModSource = "envelope";
         if (inst.effectModSource === "lfo")
            inst.effectModSource = "envelope";
      }
   });

   working.waveforms = newWaveforms;
   const usedWaveformCount = usedWaveformSet.size;
   changeLog.push(`Packed waveforms: ${usedWaveformCount} used of ${newWaveforms.length}.`);

   // clamp song order length to capability if it somehow got longer; ensure at least one position.
   // if (working.songOrder.length > Tic80Caps.arrangement.count) {
   //    working.songOrder = working.songOrder.slice(0, Tic80Caps.arrangement.count);
   //    changeLog.push(`Trimmed song order to ${Tic80Caps.arrangement.count} entries.`);
   // }
   if (working.songOrder.length === 0) {
      working.songOrder = [new SongOrderItem({patternIndex: 0})];
      changeLog.push("Song order was empty; added pattern 0.");
   }

   const preparedUsage = prepareSongColumns(working);

   return {
      optimizedSong: working,                                         //
         usedPatternColumnCount: preparedUsage.patternColumns.length, //
         usedWaveformCount,                                           //
         usedSfxCount,                                                //
         featureUsage,                                                //
         changeLog,                                                   //
         resultingStats: calculateSongUsage(working),                 //
   }
};

export function analyzePlaybackFeatures(song: Song): PlaybackFeatureUsage {
   const usage = makeFeatureUsage();
   song.instruments.forEach((inst) => {
      if (inst.waveEngine === "morph")
         usage.waveMorph = true;
      if (inst.waveEngine === "pwm") {
         usage.pwm = true;
         usage.lfo = true;
      }
      if (inst.lowpassEnabled)
         usage.lowpass = true;
      if (inst.effectKind === SomaticEffectKind.wavefold && inst.effectAmount > 0)
         usage.wavefold = true;
      if (inst.effectKind === SomaticEffectKind.hardSync && inst.effectAmount > 0)
         usage.hardSync = true;
      const lfoUsed = inst.lfoRateHz > 0 && (inst.lowpassModSource === "lfo" || inst.effectModSource === "lfo");
      if (lfoUsed)
         usage.lfo = true;
   });
   return usage;
}