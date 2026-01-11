
// create a new Song object from a tic80 cart.

import {decodeTempo, decodeRowsPerPattern, decodeTrackSpeed, decodeWaveformSamplesFromBytes16, decodeInstrumentFromBytes66, parseTicCartChunks, TicChunkType, unpackTrackFrame, type TicCartChunk} from "./tic80_serialization";
import {decodePatternChannelBytes} from "./pattern_encoding";
import {Song} from "../models/song";
import {Pattern, PatternChannel} from "../models/pattern";
import {Tic80Instrument} from "../models/instruments";
import {Tic80Waveform} from "../models/waveform";
import {SomaticCaps, Tic80Caps} from "../models/tic80Capabilities";
import {SongOrderItem} from "../models/songOrder";

export type Tic80ImportWarning = {
   message: string;
};

export type ImportTicCartResult = {
   song: Song; warnings: Tic80ImportWarning[];
};

function stripExtension(fileName: string): string {
   return fileName.replace(/\.[^./\\]+$/, "");
}

function getChunkBank0OrThrow(
   chunks: TicCartChunk[],
   type: number,
   requiredName: string,
   warnings: Tic80ImportWarning[],
   ): TicCartChunk {
   const bank0 = chunks.find((c) => c.type === type && c.bank === 0);
   if (!bank0) {
      throw new Error(`Missing required chunk: ${requiredName} (type ${type}, bank 0)`);
   }
   const otherBanks = chunks.filter((c) => c.type === type && c.bank !== 0);
   if (otherBanks.length > 0) {
      warnings.push({
         message: `Ignoring ${otherBanks.length} extra ${requiredName} chunk(s) from non-zero bank(s).`,
      });
   }
   return bank0;
}

function decodeWaveforms(payload: Uint8Array): Tic80Waveform[] {
   const waves: Tic80Waveform[] = new Array(Tic80Caps.waveform.count);
   for (let i = 0; i < Tic80Caps.waveform.count; i++) {
      const amps = decodeWaveformSamplesFromBytes16(payload, i * 16);
      waves[i] = new Tic80Waveform({
         name: "",
         amplitudes: amps,
      });
   }
   return waves;
}

function decodeSfx(payload: Uint8Array): Tic80Instrument[] {
   // +2 because instrument 0 is "no instrument" and 1 is "note cut"
   const instruments: Tic80Instrument[] = new Array(Tic80Caps.sfx.count + 2);
   instruments[0] = new Tic80Instrument({name: "No Instrument"});
   instruments[1] = new Tic80Instrument({name: "Note Cut"});
   for (let i = 0; i < Tic80Caps.sfx.count; i++) {
      const partial = decodeInstrumentFromBytes66(payload, i * 66);
      instruments[i + 2] = new Tic80Instrument(partial);
   }
   // Ensure note-cut instrument stays correct.
   instruments[SomaticCaps.noteCutInstrumentIndex]?.volumeFrames?.fill(0);
   return instruments;
}

export function importSongFromTicCartBytes(
   cartBytes: Uint8Array,
   opts?: {fileName?: string},
   ): ImportTicCartResult {
   const warnings: Tic80ImportWarning[] = [];
   const chunks = parseTicCartChunks(cartBytes);

   const waveChunk = getChunkBank0OrThrow(chunks, TicChunkType.WAVEFORMS, "Waveforms", warnings);
   const sfxChunk = getChunkBank0OrThrow(chunks, TicChunkType.SFX, "SFX", warnings);
   const patternsChunk = getChunkBank0OrThrow(chunks, TicChunkType.MUSIC_PATTERNS, "Music Patterns", warnings);
   const tracksChunk = getChunkBank0OrThrow(chunks, TicChunkType.MUSIC_TRACKS, "Music Tracks", warnings);

   // Decode global track params. Missing trailing bytes are treated as 0.
   const tempo = decodeTempo(tracksChunk.payload[48] ?? 0);
   const rowsPerPattern = decodeRowsPerPattern(tracksChunk.payload[49] ?? 0);
   const speed = decodeTrackSpeed(tracksChunk.payload[50] ?? 0);

   const song = new Song({
      name: opts?.fileName ? stripExtension(opts.fileName) : "Imported cart",
      tempo,
      speed,
      rowsPerPattern,
   });

   song.waveforms = decodeWaveforms(waveChunk.payload);
   song.instruments = decodeSfx(sfxChunk.payload);

   // Decode all 60 single-channel patterns.
   const singleChannelPatterns = new Array<PatternChannel>(Tic80Caps.pattern.count);
   for (let patIndex = 0; patIndex < Tic80Caps.pattern.count; patIndex++) {
      singleChannelPatterns[patIndex] = decodePatternChannelBytes(patternsChunk.payload, patIndex * 192);
   }

   // Combine per-channel pattern indices from track frames into Somatic's multi-channel Pattern objects.
   const comboToPatternIndex = new Map<string, number>();
   const combinedPatterns: Pattern[] = [];
   const songOrder: number[] = [];

   for (let pos = 0; pos < Tic80Caps.song.maxSongLength; pos++) {
      const [p0, p1, p2, p3] = unpackTrackFrame(tracksChunk.payload, pos * 3);
      if (
         p0 >= Tic80Caps.pattern.count || p1 >= Tic80Caps.pattern.count || p2 >= Tic80Caps.pattern.count ||
         p3 >= Tic80Caps.pattern.count) {
         throw new Error(`Track frame ${pos} references out-of-range pattern (got [${p0},${p1},${p2},${p3}])`);
      }

      const key = `${p0},${p1},${p2},${p3}`;
      let combinedIndex = comboToPatternIndex.get(key);
      if (combinedIndex === undefined) {
         const pat = new Pattern();
         // the tic80 patterns are single-channel; combine into our multi-channel pattern.
         // tic80 also refers to them 1-based, where 0 means empty.
         if (p0 > 0) {
            pat.channels[0] = singleChannelPatterns[p0 - 1];
         }
         if (p1 > 0) {
            pat.channels[1] = singleChannelPatterns[p1 - 1];
         }
         if (p2 > 0) {
            pat.channels[2] = singleChannelPatterns[p2 - 1];
         }
         if (p3 > 0) {
            pat.channels[3] = singleChannelPatterns[p3 - 1];
         }
         combinedIndex = combinedPatterns.length;
         combinedPatterns.push(pat);
         comboToPatternIndex.set(key, combinedIndex);
      }
      songOrder.push(combinedIndex);
   }

   song.patterns = combinedPatterns.length > 0 ? combinedPatterns : [new Pattern()];
   song.songOrder = songOrder.map((idx) => new SongOrderItem(idx));

   if (comboToPatternIndex.size < Tic80Caps.song.maxSongLength) {
      warnings.push({
         message: `Deduplicated ${
            Tic80Caps.song.maxSongLength - comboToPatternIndex.size} repeated track frame pattern combination(s).`,
      });
   }

   return {song, warnings};
}