// Create a new Song object from a ProTracker/Amiga 4-channel MOD file.
// Initial import scope:
// - pattern sequence (order table)
// - pattern notes + instruments (no effects yet)
// - instrument names (no sample data)

import {Song} from "../../models/song";
import {Pattern, type PatternCell} from "../../models/pattern";
import {SongOrderItem} from "../../models/songOrder";
import {IsNullOrWhitespace, stripExtension} from "../../utils/utils";
import {NoteRegistry} from "../../utils/music/noteRegistry";
import {kSubsystem} from "../base/SubsystemBackendBase";
import {decodeModFile, ModConstants, type ModFile} from "./ModFileModels";
import {ProtrackerFinetune} from "../../utils/music/modMusic";

export type AmigaModImportWarning = {
   message: string;
};

export type ImportAmigaModResult = {
   song: Song; warnings: AmigaModImportWarning[];
};

function coerceFinetune(finetune: number): ProtrackerFinetune {
   // MOD finetune is stored as a signed nibble -8..+7.
   const ft = Math.max(-8, Math.min(7, finetune | 0));
   return ft as any;
}

function importPatterns(modFile: ModFile, warnings: AmigaModImportWarning[]): Pattern[] {
   const patterns: Pattern[] = [];
   const pitches: Set<string> = new Set();

   for (let patIndex = 0; patIndex < modFile.patterns.length; patIndex++) {
      const modPattern = modFile.patterns[patIndex]!;
      const pat = new Pattern({name: "", channels: []});

      for (let row = 0; row < ModConstants.rowCountPerPattern; row++) {
         const modRow = modPattern.rows[row];
         if (!modRow)
            continue;

         for (let ch = 0; ch < ModConstants.channelCount; ch++) {
            const modCell = modRow.channels[ch];
            if (!modCell)
               continue;

            const cell: PatternCell = {};

            if (modCell.sampleIndex1b != null && modCell.sampleIndex1b > 0) {
               cell.instrumentIndex = modCell.sampleIndex1b; // TODO: zero-based?
            }

            if (modCell.period != null && modCell.period > 0) {
               const finetune = 0;
               const decoded = NoteRegistry.mod.decodePeriod(modCell.period, coerceFinetune(finetune));
               pitches.add(`[${modCell.period}, ${finetune}] => kind=${decoded.kind} midi=${decoded.midi ?? "(none)"}`);
               console.log(
                  `Pattern ${patIndex} row ${row} ch ${ch}: MOD period ${modCell.period} finetune ${finetune} =>`,
                  decoded);

               if (decoded.kind === "table") {
                  cell.midiNote = decoded.midi;
                  cell.modPeriod = decoded.period;
               } else {
                  warnings.push({
                     message: `Pattern ${patIndex} row ${row} ch ${ch}: unsupported MOD period ${modCell.period}`,
                  });
               }
            }

            //if (cell.midiNote !== undefined || cell.instrumentIndex !== undefined) {
            pat.setCell(ch, row, cell);
            //}
         }
      }

      patterns.push(pat);
   }

   console.log("Imported MOD pitches used:", Array.from(pitches));
   console.log(`Imported ${patterns.length} patterns from MOD file.`, patterns);

   return patterns.length > 0 ? patterns : [new Pattern()];
}

// TODO: instruments + samples
function importInstruments(song: Song, modFile: ModFile) {
   for (let i = 0; i < modFile.header.samples.length; i++) {
      const sampleHeader = modFile.header.samples[i]!;
      if (IsNullOrWhitespace(sampleHeader.name))
         continue;

      const sampleIndex0b = i;
      const instIndex = sampleIndex0b;
      const inst = song.instruments[instIndex];
      if (!inst)
         continue;

      inst.name = sampleHeader.name;
   }
}

export function importSongFromAmigaModBytes(
   modBytes: Uint8Array,
   opts?: {fileName?: string},
   ): ImportAmigaModResult {
   const warnings: AmigaModImportWarning[] = [];
   const modFile = decodeModFile(modBytes);

   const songName = (() => {
      if (!IsNullOrWhitespace(modFile.header.title))
         return modFile.header.title;
      if (opts?.fileName)
         return stripExtension(opts.fileName);
      return "Imported MOD";
   })();

   const song = new Song({
      subsystemType: kSubsystem.key.AMIGAMOD,
      name: songName,
      tempo: 125, // TODO
      speed: 6,   // TODO
      // todo: other mod specific props
      rowsPerPattern: ModConstants.rowCountPerPattern,
   });

   importInstruments(song, modFile);

   const patterns = importPatterns(modFile, warnings);
   song.patterns = patterns;

   // Pattern order / sequence.
   const orderUsed = modFile.header.patternOrder.slice(0, modFile.header.songLength);
   const maxPatternIndex = Math.max(0, song.patterns.length - 1);

   const orderClamped = orderUsed.map((p) => {
      const idx = (p | 0);
      if (idx < 0 || idx > maxPatternIndex) {
         warnings.push({message: `Order table references out-of-range pattern ${idx}; clamped.`});
         return Math.max(0, Math.min(maxPatternIndex, idx));
      }
      return idx;
   });

   song.songOrder = orderClamped.map((idx) => new SongOrderItem(idx));

   return {song, warnings};
}
