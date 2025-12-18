import {Song} from "../models/song";
import {Pattern} from "../models/pattern";
import {Tic80Caps} from "../models/tic80Capabilities";
import {Tic80Instrument} from "../models/instruments";
import {Tic80Waveform} from "../models/waveform";
import {clamp} from "./utils";

type SongUsage = {
   usedPatterns: Set<number>;    //
   usedInstruments: Set<number>; //
   usedWaveforms: Set<number>;   //
   maxPattern: number;           //
   maxInstrument: number;        //
   maxWaveform: number;          //
};

// Traverses song order -> patterns -> instruments -> waveforms to find what is actually referenced.
export function calculateSongUsage(song: Song): SongUsage {
   const usedPatterns = new Set<number>();
   const usedInstruments = new Set<number>();
   const usedWaveforms = new Set<number>();

   // patterns that appear in the order list
   const maxPatternIndex = Math.max(song.patterns.length - 1, 0);
   for (let i = 0; i < song.songOrder.length; i++) {
      const idx = clamp(song.songOrder[i], 0, maxPatternIndex);
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
   const maxWaveIndex = Math.max(song.waveforms.length - 1, 0);
   usedInstruments.forEach((instIdx) => {
      const inst = song.instruments[instIdx];
      if (!inst)
         return;
      inst.waveFrames.forEach((waveIdx) => {
         usedWaveforms.add(clamp(waveIdx, 0, maxWaveIndex));
      });
   });

   const maxPattern = usedPatterns.size === 0 ? 0 : Math.max(...usedPatterns);
   const maxInstrument = usedInstruments.size === 0 ? 0 : Math.max(...usedInstruments);
   const maxWaveform = usedWaveforms.size === 0 ? 0 : Math.max(...usedWaveforms);

   return {usedPatterns, usedInstruments, usedWaveforms, maxPattern, maxInstrument, maxWaveform};
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


export interface OptimizeResult {
   optimizedSong: Song;
   usedPatternCount: number;
   usedWaveformCount: number;
   // includes 0 and 1 sfx so this will always be at least 1 for instrument#0, and 2 if you only have a note cut in your whole song (weird), and >=3 for normal cases.
   usedSfxCount: number;

   // hold explanations of what changed (moving patterns, deduping etc)
   changeLog: string[];
   resultingStats: SongUsage;
}

export function MakeOptimizeResultEmpty(song: Song): OptimizeResult {
   return {
      optimizedSong: song,
      usedPatternCount: 0,
      usedWaveformCount: 0,
      usedSfxCount: 0,
      changeLog: [],
      resultingStats: {
         usedPatterns: new Set(),
         usedInstruments: new Set(),
         usedWaveforms: new Set(),
         maxPattern: 0,
         maxInstrument: 0,
         maxWaveform: 0,
      },
   };
}

export function OptimizeSong(song: Song): OptimizeResult {
   // clone so callers keep their original instance untouched.
   const working = song.clone();
   const changeLog: string[] = [];

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
   working.songOrder = working.songOrder.map((idx, orderPos) => {
      // keep indexes inside bounds before remapping.
      const clamped = clamp(idx, 0, Math.max(working.patterns.length - 1, 0));
      if (clamped !== idx) {
         changeLog.push(`Song order entry ${orderPos} clamped from ${idx} to ${clamped}.`);
      }
      const mapped = patternRemap.get(clamped) ?? clamped;
      usedPatternSet.add(mapped);
      return mapped;
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

   working.songOrder = working.songOrder.map((idx) => newPatternIndex.get(idx) ?? 0);
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

   // Step 4: find used waveforms from used instruments and pack.
   const usedWaveformSet = new Set<number>();
   usedInstrumentSet.forEach((oldIndex) => {
      const mappedIndex = instrumentRemap.get(oldIndex);
      if (mappedIndex === undefined) {
         return;
      }
      const inst = newInstruments[mappedIndex];
      inst.waveFrames.forEach((waveIdx) => {
         usedWaveformSet.add(clamp(waveIdx, 0, working.waveforms.length - 1));
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
      inst.waveFrames = new Int8Array(inst.waveFrames.map((waveIdx) => {
         const clamped = clamp(waveIdx, 0, newWaveforms.length - 1);
         return waveformRemap.get(clamped) ?? 0;
      }));
   });

   working.waveforms = newWaveforms;
   const usedWaveformCount = usedWaveformSet.size;
   changeLog.push(`Packed waveforms: ${usedWaveformCount} used of ${newWaveforms.length}.`);

   // clamp song order length to capability if it somehow got longer; ensure at least one position.
   if (working.songOrder.length > Tic80Caps.arrangement.count) {
      working.songOrder = working.songOrder.slice(0, Tic80Caps.arrangement.count);
      changeLog.push(`Trimmed song order to ${Tic80Caps.arrangement.count} entries.`);
   }
   if (working.songOrder.length === 0) {
      working.songOrder = [0];
      changeLog.push("Song order was empty; added pattern 0.");
   }

   return {
      optimizedSong: working,                         //
         usedPatternCount,                            //
         usedWaveformCount,                           //
         usedSfxCount,                                //
         changeLog,                                   //
         resultingStats: calculateSongUsage(working), //
   }
};