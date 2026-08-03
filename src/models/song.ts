import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../subsystem/base/SubsystemBackendBase";
import {Tic80SubsystemBackend} from "../subsystem/tic80/tic80SubsystemBackend";
import {AmigaModSubsystemBackend} from "../subsystem/AmigaMod/AmigaModSubsystemBackend";
import {SidSubsystemBackend} from "../subsystem/Sid/SidSubsystemBackend";
import {clamp, CoalesceBoolean, SanitizeFilename} from "../utils/utils";

import {makeDefaultInstrumentForIndex, SomaticInstrument, SomaticInstrumentDto} from "./instruments";
import {isNoteCut, Pattern, PatternDto} from "./pattern";
import {SongOrderDto, SongOrderItem} from "./songOrder";
import {Tic80Waveform, Tic80WaveformDto} from "./waveform";
import {Tic80Caps} from "./tic80Capabilities";
import {buildInfo} from "../buildInfo";
import {getSomaticVersionString} from "../utils/versionString";
import {OptimizationRuleOptions} from "../utils/lua/lua_processor";
import {MorphEntryFieldNamesToRename} from "../../bridge/morphSchema";

export const kDefaultReleaseMinificationOptions: OptimizationRuleOptions = {
   stripComments: true,
   stripDebugBlocks: true,
   maxIndentLevel: 1,
   lineBehavior: "tight",
   maxLineLength: 180,
   aliasRepeatedExpressions: true,
   renameLocalVariables: true,
   aliasLiterals: true,
   packLocalDeclarations: true,
   simplifyExpressions: true,
   removeUnusedLocals: true,
   removeUnusedFunctions: false,
   functionNamesToKeep: [],
   renameTableFields: true,
   tableEntryKeysToRename: [...MorphEntryFieldNamesToRename],
} as const;

// changing this, document in readme which changes occurred, create a upgrade fn from previous
const kSomaticSchemaVersion = 1;

function upgradeSongDtoToLatest(input: SongDto): SongDto {
   const schemaVersion = (input as any).schemaVersion ?? 0;
   if (schemaVersion >= kSomaticSchemaVersion)
      return input;

   // v0 -> v1 migration:
   // - Instrument indices become Somatic-owned (0..N-1), excluding TIC-80 reserved 0/1.
   // - Note cut/off becomes an explicit boolean flag (noteOff).
   // - Legacy instrument 1 (off) becomes noteOff=true.
   // - Legacy instrument indices >=2 are shifted down by 2.
   // - Legacy instrument 0 becomes null (no instrument).

   const next: SongDto = {
      ...input,
      schemaVersion: kSomaticSchemaVersion,
   };

   // legacy may not specify subsystem.
   next.subsystemType = input.subsystemType || kSubsystem.key.TIC80;

   if (next.subsystemType === kSubsystem.key.TIC80) {
      // Strip reserved instruments 0/1 from the instrument list.
      const legacyInstruments = Array.isArray(next.instruments) ? next.instruments : [];
      const somaticMax = Math.max(0, Tic80Caps.sfx.maxSupported);
      next.instruments = legacyInstruments.slice(2, 2 + somaticMax);

      // Remap pattern cell instrument indices and legacy note-cut encoding.
      for (const pat of next.patterns ?? []) {
         for (const ch of pat.channels ?? []) {
            const rows: any[] = (ch as any).rows ?? [];
            for (const cell of rows) {
               if (!cell || typeof cell !== "object")
                  continue;
               const inst = (cell as any).instrumentIndex;

               if (inst === 1) {
                  (cell as any).noteOff = true;
                  (cell as any).instrumentIndex = undefined;
               } else if (inst === 0) {
                  (cell as any).instrumentIndex = undefined;
               } else if (typeof inst === "number" && Number.isFinite(inst) && inst >= 2) {
                  (cell as any).instrumentIndex = inst - 2;
               }

               // we could also correct other stuff like effect vs. tic80Effect here; it's handled elsewhere for now.
            }
         }
      }
   }

   // no matter what, this song is now been created by this build.
   next.somaticBuild = getSomaticBuildMetadataForSongSave();

   return next;
}

export type SomaticBuildMetadata = {
   gitCommit: string|null; //
   versionString: string;  //
   utcDate: string;
   url: string | null;
};

export type SongDto = {
   schemaVersion: number; //
   somaticBuild: SomaticBuildMetadata;

   subsystemType: SubsystemTypeKey; //
   name: string;                    //

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
   exportCueSheet?: boolean;

   releaseMinificationOptions?: OptimizationRuleOptions;
};

function getSomaticBuildMetadataForSongSave(): SomaticBuildMetadata {
   const url = (typeof window !== "undefined" && window?.location?.href) ? String(window.location.href) : null;
   return {
      gitCommit: buildInfo.commitHash ?? null,
      versionString: getSomaticVersionString(buildInfo),
      utcDate: new Date().toISOString(),
      url,
   };
}

export type ArrangementThumbnailSize = "off"|"small"|"normal"|"large";

export type SongChannelNoteOccurrence = Readonly<{
   midiNote: number;
   songPosition: number;
   rowIndex: number;
}>;

export type SongChannelNoteContext = Readonly<{
   // The note sounding as the row begins, before applying this row's note column.
   activeBeforeRow?: SongChannelNoteOccurrence;

   // The nominal note after applying this row's note/note-off column. Effect timing
   // (for example TIC-80 Dxx note delay) is intentionally left to the subsystem.
   activeAfterNoteColumn?: SongChannelNoteOccurrence;
   // Describes how activeAfterNoteColumn was resolved.
   source: "current-cell"|"sustained"|"none";
   rowReachable: boolean;
}>;

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
   exportCueSheet: boolean;

   releaseMinificationOptions: OptimizationRuleOptions;

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
      this.exportCueSheet = CoalesceBoolean(data.exportCueSheet, true);

      if (!data.releaseMinificationOptions) {
         console.log(`gonna use default minification options!`);
      }

      this.releaseMinificationOptions = data.releaseMinificationOptions || kDefaultReleaseMinificationOptions;

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
      const rowLimit = this.getPatternEffectiveRowCount(patternIndex);
      let count = 0;

      const channelCount = this.subsystem.channelCount;

      for (let ch = 0; ch < channelCount; ch += 1) {
         for (let r = 0; r < rowLimit; r += 1) {
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
         const rowLimit = this.getPatternEffectiveRowCount(patternIndex);
         const channelCount = this.subsystem.channelCount;
         for (let ch = 0; ch < channelCount; ++ch) {
            for (let r = 0; r < rowLimit; ++r) {
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
   }

   getSongLengthRows(): number {
      return this.songOrder.reduce((sum, _, orderIndex) => sum + this.getOrderEffectiveRowCount(orderIndex), 0);
   }

   getRowsPerBeat(): number {
      return this.highlightRowCount;
   }

   getPatternEffectiveRowCount(patternIndex: number): number {
      const maxPatternIndex = Math.max(0, this.patterns.length - 1);
      const safePatternIndex = clamp(patternIndex | 0, 0, maxPatternIndex);
      const pattern = this.patterns[safePatternIndex];
      if (!pattern) {
         return this.rowsPerPattern;
      }
      return pattern.getEffectiveRowCount(this.rowsPerPattern, this.subsystem.channelCount);
   }

   getOrderEffectiveRowCount(orderIndex: number): number {
      if (this.songOrder.length === 0) {
         return this.rowsPerPattern;
      }
      const safeOrderIndex = clamp(orderIndex | 0, 0, this.songOrder.length - 1);
      const orderItem = this.songOrder[safeOrderIndex];
      return this.getPatternEffectiveRowCount(orderItem.patternIndex);
   }

   private findActiveNoteBeforeRow(
      songPosition: number,
      channelIndex: number,
      rowIndex: number,
      ): SongChannelNoteOccurrence|undefined {
      for (let orderIndex = songPosition; orderIndex >= 0; orderIndex--) {
         const orderItem = this.songOrder[orderIndex];
         const pattern = orderItem ? this.patterns[orderItem.patternIndex] : undefined;
         if (!pattern)
            continue;

         const effectiveRows = this.getOrderEffectiveRowCount(orderIndex);
         const rowExclusive = orderIndex === songPosition ? Math.min(rowIndex, effectiveRows) : effectiveRows;
         for (let candidateRow = rowExclusive - 1; candidateRow >= 0; candidateRow--) {
            const cell = pattern.getCell(channelIndex, candidateRow);
            if (isNoteCut(cell))
               return undefined;
            if (cell.midiNote !== undefined) {
               return {
                  midiNote: cell.midiNote,
                  songPosition: orderIndex,
                  rowIndex: candidateRow,
               };
            }
         }
      }
      return undefined;
   }

   getChannelNoteContext(
      songPosition: number,
      channelIndex: number,
      rowIndex: number,
      ): SongChannelNoteContext {
      if (this.songOrder.length === 0) {
         return {source: "none", rowReachable: false};
      }

      const safeSongPosition = clamp(songPosition | 0, 0, this.songOrder.length - 1);
      const safeChannelIndex = clamp(channelIndex | 0, 0, Math.max(0, this.subsystem.channelCount - 1));
      const safeRowIndex = clamp(rowIndex | 0, 0, Math.max(0, this.rowsPerPattern - 1));
      const orderItem = this.songOrder[safeSongPosition];
      const pattern = orderItem ? this.patterns[orderItem.patternIndex] : undefined;
      const activeBeforeRow = this.findActiveNoteBeforeRow(
         safeSongPosition, safeChannelIndex, safeRowIndex);

      if (!pattern) {
         return {activeBeforeRow, source: "none", rowReachable: false};
      }

      const cell = pattern.getCell(safeChannelIndex, safeRowIndex);
      const rowReachable = safeRowIndex < this.getOrderEffectiveRowCount(safeSongPosition);
      if (isNoteCut(cell)) {
         return {activeBeforeRow, source: "none", rowReachable};
      }
      if (cell.midiNote !== undefined) {
         return {
            activeBeforeRow,
            activeAfterNoteColumn: {
               midiNote: cell.midiNote,
               songPosition: safeSongPosition,
               rowIndex: safeRowIndex,
            },
            source: "current-cell",
            rowReachable,
         };
      }
      return {
         activeBeforeRow,
         activeAfterNoteColumn: activeBeforeRow,
         source: activeBeforeRow ? "sustained" : "none",
         rowReachable,
      };
   }

   getAbsRowAtSongPosition(songPosition: number, rowIndex = 0): number {
      const safePosition = clamp(songPosition | 0, 0, Math.max(0, this.songOrder.length - 1));
      let absRow = 0;
      for (let i = 0; i < safePosition; i++) {
         absRow += this.getOrderEffectiveRowCount(i);
      }
      const rowsInOrder = this.getOrderEffectiveRowCount(safePosition);
      return absRow + clamp(rowIndex | 0, 0, Math.max(0, rowsInOrder - 1));
   }

   getSongPositionAtAbsRow(absRow: number): {songPosition: number; rowIndex: number;} {
      const orderCount = this.songOrder.length;
      if (orderCount <= 0) {
         return {songPosition: 0, rowIndex: 0};
      }
      let remaining = clamp(Math.floor(absRow), 0, Math.max(0, this.getSongLengthRows() - 1));
      for (let orderIndex = 0; orderIndex < orderCount; orderIndex++) {
         const rows = this.getOrderEffectiveRowCount(orderIndex);
         if (remaining < rows) {
            return {songPosition: orderIndex, rowIndex: remaining};
         }
         remaining -= rows;
      }
      return {songPosition: orderCount - 1, rowIndex: Math.max(0, this.getOrderEffectiveRowCount(orderCount - 1) - 1)};
   }

   //  "transport": {
   //    "tempo": 120,
   //    "speed": 6,
   //    "rowsPerBeat": 4,
   //    "rowsPerPattern": 64,
   //    "songBeatCount": 90,
   //  },
   buildTransportConfig() {
      return {
         tempo: this.tempo,
         speed: this.speed,
         rowsPerPattern: this.rowsPerPattern,
         rowsPerBeat: this.getRowsPerBeat(),
         songBeatCount: this.getSongLengthRows() / this.getRowsPerBeat(),
      };
   }

   toData(): SongDto {
      const buildInfo = getSomaticBuildMetadataForSongSave();
      //console.log("Saving song with build info:", buildInfo);
      return {
         schemaVersion: kSomaticSchemaVersion,
         somaticBuild: buildInfo,
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
         releaseMinificationOptions: this.releaseMinificationOptions,
         exportCueSheet: this.exportCueSheet,
      };
   }

   toJSON(): string {
      return JSON.stringify(this.toData(), null, 2);
   }

   static fromData(data?: SongDto|null): Song {
      const raw = (data || {}) as SongDto;
      const upgraded = upgradeSongDtoToLatest(raw);
      return new Song(upgraded);
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


export type CueSheetEntry = {
   icon: string;
   pi: number;
   beat: number;
   rows: number;
   note: string;
};

export function buildCueSheet(song: Song): CueSheetEntry[] | null {
   if (!song.exportCueSheet) {
      return null;
   }

   const entries: CueSheetEntry[] = [];
   const maxPatternIndex = song.patterns.length - 1;
   for (let orderIndex = 0; orderIndex < song.songOrder.length; orderIndex++) {
      const orderItem = song.songOrder[orderIndex]!;
      const patternIndex = clamp(orderItem.patternIndex ?? 0, 0, maxPatternIndex);
      const patternName = song.patterns[patternIndex]?.name ?? "";
      entries.push({
         icon: orderItem.markerVariant,
         pi: patternIndex, // order index != pattern index; this is necessary.
         beat: song.getAbsRowAtSongPosition(orderIndex, 0) / song.getRowsPerBeat(),
         rows: song.getOrderEffectiveRowCount(orderIndex),
         note: patternName,
      });
   }

   return entries;
}


export const formatPatternIndex = (index: number) => index.toString().padStart(2, "0");

export type SubsystemBackend = SomaticSubsystemBackend<Song, SongDto>;
