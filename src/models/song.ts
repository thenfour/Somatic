import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../subsystem/base/SubsystemBackendBase";
import {Tic80SubsystemBackend} from "../subsystem/tic80/tic80SubsystemBackend";
import {AmigaModSubsystemBackend} from "../subsystem/AmigaMod/AmigaModSubsystemBackend";
import {SidSubsystemBackend} from "../subsystem/Sid/SidSubsystemBackend";
import {clamp, CoalesceBoolean, SanitizeFilename} from "../utils/utils";

import {makeDefaultInstrumentForIndex, SomaticInstrument, SomaticInstrumentDto} from "./instruments";
import {isNoteCut, Pattern, PatternDto} from "./pattern";
import {SongOrderDto, SongOrderItem} from "./songOrder";
import {Tic80Waveform, Tic80WaveformDto} from "./waveform";
import {SomaticCaps} from "./tic80Capabilities";

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-tracks

export type SongDto = {
   subsystemType: SubsystemTypeKey; name: string; //

   tempo: number; //
   speed: number;
   rowsPerPattern: number;

   highlightRowCount: number;
   patternEditStep: number;

   instruments: SomaticInstrumentDto[]; //
   waveforms: Tic80WaveformDto[];
   patterns: PatternDto[];
   songOrder: (number|SongOrderDto)[]; // index into patterns

   // replaces the BEGIN_CUSTOM_ENTRYPOINT block in the exported playroutine.
   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;

   arrangementThumbnailSize: ArrangementThumbnailSize;
};

export type ArrangementThumbnailSize = "off"|"small"|"normal"|"large";

const makePatternList = (data: PatternDto[]): Pattern[] => {
   const ret = data.map((patternData) => Pattern.fromData(patternData));
   // ensure at least 1 pattern.
   if (ret.length === 0) {
      ret.push(new Pattern());
   }
   return ret;
};

export class Song {
   instruments: SomaticInstrument[];
   waveforms: Tic80Waveform[];
   patterns: Pattern[];
   songOrder: SongOrderItem[]; // index into patterns
   rowsPerPattern: number;
   // positions: number[];

   // tic80 music editor shows a range of 40-250. theoretically it's 32-255 apparently https://github.com/nesbox/TIC-80/issues/2153
   tempo: number;
   speed: number;

   // editor-specific
   subsystemType: SubsystemTypeKey;
   subsystem: SomaticSubsystemBackend<Song, SongDto>;
   name: string;
   highlightRowCount: number;
   patternEditStep: number;

   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;

   arrangementThumbnailSize: ArrangementThumbnailSize;

   constructor(data: Partial<SongDto> = {}) {
      this.subsystemType = data.subsystemType || kSubsystem.key.TIC80;
      this.subsystem = (() => {
         switch (this.subsystemType) {
            case kSubsystem.key.TIC80:
               return new Tic80SubsystemBackend();
            case kSubsystem.key.AMIGAMOD:
               return new AmigaModSubsystemBackend();
            case kSubsystem.key.SID:
               return new SidSubsystemBackend();
            default:
               throw new Error(`Unsupported subsystem type: ${this.subsystemType}`);
         }
      })();

      this.instruments = [];
      this.waveforms = [];
      this.subsystem.initWaveformsAndInstruments(this, data);

      this.patterns = makePatternList(data.patterns || []);
      this.songOrder = (data.songOrder || [0]).map((item) => new SongOrderItem(item)); // default to first pattern
      // this.instruments = makeInstrumentList(data.instruments || []);
      // this.waveforms = makeWaveformList(data.waveforms || []);
      this.rowsPerPattern =
         clamp(data.rowsPerPattern ?? this.subsystem.defaultRowsPerPattern, 1, this.subsystem.maxRowsPerPattern);
      this.tempo = clamp(data.tempo ?? 120, 1, 255);
      this.speed = clamp(data.speed ?? 6, 1, 31);
      this.name = data.name ?? "New song";
      this.highlightRowCount = data.highlightRowCount ?? 4;
      this.patternEditStep = clamp(data.patternEditStep ?? 1, 0, 32);
      this.useCustomEntrypointLua = CoalesceBoolean(data.useCustomEntrypointLua, false);
      this.customEntrypointLua = data.customEntrypointLua || "";

      // Default to showing thumbnails (matches previous behavior).
      this.arrangementThumbnailSize = (data.arrangementThumbnailSize as ArrangementThumbnailSize) ?? "normal";

      this.subsystem.onInitOrSubsystemTypeChange(this);
   }

   setTempo(value: number) {
      this.tempo = clamp(value, 1, 255);
   }

   setSpeed(value: number) {
      this.speed = clamp(value, 1, 31);
   }

   setHighlightRowCount(value: number) {
      this.highlightRowCount = clamp(value, 1, 64);
   }

   setPatternEditStep(value: number) {
      this.patternEditStep = clamp(value, 0, 32);
   }

   setRowsPerPattern(value: number) {
      this.rowsPerPattern = clamp(value, 1, this.subsystem.maxRowsPerPattern);
   }

   countInstrumentNotesInPattern(patternIndex: number, instrumentIndex: number): number {
      const pattern = this.patterns[patternIndex];
      const rowLimit = this.rowsPerPattern;
      let count = 0;

      const channelCount = this.subsystem.channelCount;

      for (let ch = 0; ch < channelCount; ch += 1) {
         for (let r = 0; r < this.rowsPerPattern; r += 1) {
            const cell = pattern.getCell(ch, r);
            if (cell.instrumentIndex === instrumentIndex && cell.midiNote !== undefined && !isNoteCut(cell)) {
               count += 1;
            }
         }
      }

      return count;
   }

   getInstrument(index: number): SomaticInstrument|null {
      if (index < 0 || index >= this.instruments.length)
         return null;
      return this.instruments[index]!;
   }

   getFilename(extensionWithDot: string): string {
      const safeName = SanitizeFilename(this.name, "untitled");
      return `${safeName}${extensionWithDot}`;
   }

   countInstrumentNotesInSong(instrumentIndex: number): number {
      let total = 0;
      for (const orderItem of this.songOrder) {
         const patternIndex = clamp(orderItem.patternIndex ?? 0, 0, this.patterns.length - 1);
         total += this.countInstrumentNotesInPattern(patternIndex, instrumentIndex);
      }
      return total;
   }

   getInstrumentUsageMap(): Map<number, boolean> {
      const usageMap = new Map<number, boolean>();
      for (const orderItem of this.songOrder) {
         const patternIndex = clamp(orderItem.patternIndex ?? 0, 0, this.patterns.length - 1);
         const pattern = this.patterns[patternIndex];
         const rowLimit = this.rowsPerPattern;
         const channelCount = this.subsystem.channelCount;
         for (let ch = 0; ch < channelCount; ++ch) {
            for (let r = 0; r < this.rowsPerPattern; ++r) {
               const cell = pattern.getCell(ch, r);
               if (cell.instrumentIndex !== undefined && cell.instrumentIndex !== null) {
                  usageMap.set(cell.instrumentIndex, true);
               }
            }
         }
      }
      return usageMap;
   }

   swapInstrumentIndicesInPatterns(a: number, b: number) {
      const maxInstrumentIndex = Math.max(this.instruments.length - 1, 0);
      const channelCount = this.subsystem.channelCount;
      for (const pattern of this.patterns) {
         for (let ch = 0; ch < channelCount; ++ch) {
            //const channel = pattern.getChannel(ch);
            for (let r = 0; r < this.rowsPerPattern; ++r) {
               const cell = pattern.getCell(ch, r);
               //for (const cell of channel.rows) {
               if (cell.instrumentIndex === undefined || cell.instrumentIndex === null)
                  continue;
               const clamped = clamp(cell.instrumentIndex, 0, maxInstrumentIndex);
               // keep index sane even if song was loaded with out-of-range references
               cell.instrumentIndex = clamped;
               if (cell.instrumentIndex === a)
                  cell.instrumentIndex = b;
               else if (cell.instrumentIndex === b)
                  cell.instrumentIndex = a;
            }
         }
      }
   };

   // Insert at `insertIndex` by shifting instruments down one slot (dropping the last slot).
   // Remaps pattern instrument indices so playback is unchanged.
   insertInstrumentSlotAtIndex(insertIndex: number) {
      const lastIndex = this.instruments.length - 1;
      if (insertIndex < 0 || insertIndex > lastIndex)
         return;
      if (insertIndex <= SomaticCaps.noteCutInstrumentIndex)
         return;

      // Shift instruments down, dropping the last.
      for (let i = lastIndex; i > insertIndex; i -= 1) {
         this.instruments[i] = this.instruments[i - 1]!;
      }
      this.instruments[insertIndex] = makeDefaultInstrumentForIndex(insertIndex);

      // Remap instrument indices in patterns: anything at/after insertIndex shifts +1.
      // We intentionally do NOT remap references to the last slot, because the caller
      // must ensure that slot is unused (otherwise we'd lose an instrument).
      const maxInstrumentIndex = Math.max(this.instruments.length - 1, 0);
      const channelCount = this.subsystem.channelCount;
      for (const pattern of this.patterns) {
         for (let ch = 0; ch < channelCount; ++ch) {
            //const channel = pattern.getChannel(ch);
            for (let r = 0; r < this.rowsPerPattern; ++r) {
               const cell = pattern.getCell(ch, r);
               if (cell.instrumentIndex === undefined || cell.instrumentIndex === null)
                  continue;
               const clamped = clamp(cell.instrumentIndex, 0, maxInstrumentIndex);
               cell.instrumentIndex = clamped;
               if (clamped >= insertIndex && clamped < lastIndex) {
                  cell.instrumentIndex = clamped + 1;
               }
            }
         }
      }
   };


   toData(): Required<SongDto> {
      return {
         subsystemType: this.subsystemType,
         instruments: this.instruments.map((inst) => inst.toData()),
         patterns: this.patterns.map((pattern) => pattern.toData()),
         waveforms: this.waveforms.map((wave) => wave.toData()),
         songOrder: this.songOrder.map((item) => item.toData()),
         tempo: this.tempo,
         speed: this.speed,
         rowsPerPattern: this.rowsPerPattern,
         name: this.name,
         highlightRowCount: this.highlightRowCount,
         patternEditStep: this.patternEditStep,
         useCustomEntrypointLua: this.useCustomEntrypointLua,
         customEntrypointLua: this.customEntrypointLua,

         arrangementThumbnailSize: this.arrangementThumbnailSize,
      };
   }

   toJSON(): string {
      return JSON.stringify(this.toData(), null, 2);
   }

   static fromData(data?: SongDto|null): Song {
      return new Song(data || {});
   }

   static fromJSON(json: string): Song {
      try {
         const data: SongDto = JSON.parse(json);
         return Song.fromData(data);
      } catch (err) {
         console.error("Failed to parse song JSON", err);
         return new Song();
      }
   }

   clone(): Song {
      return Song.fromData(this.toData());
   }
}


export const formatPatternIndex = (index: number) => index.toString().padStart(2, "0");

export type SubsystemBackend = SomaticSubsystemBackend<Song, SongDto>;