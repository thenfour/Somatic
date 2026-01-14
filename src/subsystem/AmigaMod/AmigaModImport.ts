
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

   const sample1bToInstrumentIndex = (sampleIndex1b: number) => (sampleIndex1b | 0) - 1;

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
               cell.instrumentIndex = sample1bToInstrumentIndex(modCell.sampleIndex1b);
            }

            if (modCell.period != null && modCell.period > 0) {
               // fine tune is relevant for playback not note entry.
               const decoded = NoteRegistry.mod.decodePeriod(modCell.period, coerceFinetune(0));

               cell.midiNote = decoded.midi;
               cell.modPeriod = decoded.period;

               if (decoded.kind === "table" || decoded.kind === "raw") {
               } else {
                  warnings.push({
                     message: `Pattern ${patIndex} row ${row} ch ${ch}: unsupported MOD period ${modCell.period}`,
                  });
               }
            }

            // Only write cells that contain meaningful data.
            //if (cell.midiNote !== undefined || cell.instrumentIndex !== undefined || cell.noteOff) {
            pat.setCell(ch, row, cell);
            //}
         }
      }

      patterns.push(pat);
   }

   return patterns.length > 0 ? patterns : [new Pattern()];
}

// TODO: instruments + samples
function importInstruments(song: Song, modFile: ModFile) {
   // Map MOD sample index 1..31 to Somatic instrument index 0..31.
   const sample1bToInstrumentIndex = (sampleIndex1b: number) => (sampleIndex1b | 0) - 1;

   for (let i = 0; i < modFile.header.samples.length; i++) {
      const sampleHeader = modFile.header.samples[i]!;
      if (IsNullOrWhitespace(sampleHeader.name))
         continue;

      const sampleIndex1b = i + 1;
      const instIndex = sample1bToInstrumentIndex(sampleIndex1b);
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
