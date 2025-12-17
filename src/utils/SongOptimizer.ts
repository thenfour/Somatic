import {Song} from "../models/song";

interface OptimizeResult {
   optimizedSong: Song;
   usedPatternCount: number;
   usedWaveformCount: number;
   // includes 0 and 1 sfx so this will always be at least 1 for instrument#0, and 2 if you only have a note cut in your whole song (weird), and >=3 for normal cases.
   usedSfxCount: number;

   // hold explanations of what changed (moving patterns, deduping etc)
   changeLog: string[];
}

export function OptimizeSong(song: Song): OptimizeResult{
   // TODO.
   // the idea is to remove unused things, deal with duplicates etc.
   // 1. detect duplicate patterns and remap positions to use the same pattern
   // 2. move used patterns to the start of the pattern list, updating positions (so unused patterns are at the end)
   // 3. move used waveforms to the start of the waveform list, updating references in sfx (so unused waveforms are at the end)
   // 4. move used sfx to the start of the instrument list, updating references in patterns (so unused sfx are at the end)

   // placeholder.
   return {
      optimizedSong: song,                                 //
         usedPatternCount: song.patterns.length,           //
         usedWaveformCount: song.waveforms.length,         //
         usedSfxCount: song.instruments.length,            //
         changeLog: ["Optimization not yet implemented."], //
   }
};