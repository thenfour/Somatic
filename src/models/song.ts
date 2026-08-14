import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../subsystem/base/SubsystemBackendBase";
import {Tic80SubsystemBackend} from "../subsystem/tic80/tic80SubsystemBackend";
import {AmigaModSubsystemBackend} from "../subsystem/AmigaMod/AmigaModSubsystemBackend";
import {SidSubsystemBackend} from "../subsystem/Sid/SidSubsystemBackend";
import {assert, clamp, CoalesceBoolean, NormalizeClampedFloat, SanitizeFilename} from "../utils/utils";

import {makeDefaultInstrumentForIndex, SomaticInstrument, SomaticInstrumentDto} from "./instruments";
import {isNoteCut, Pattern, PatternDto} from "./pattern";
import {SongOrderDto, SongOrderItem} from "./songOrder";
import {Tic80Waveform, Tic80WaveformDto} from "./waveform";
import {Tic80Caps} from "./tic80Capabilities";
import {buildInfo} from "../buildInfo";
import {getSomaticVersionString} from "../utils/versionString";
import {OptimizationRuleOptions} from "../utils/lua/lua_processor";
import {getTic80SongStateAccumulator} from "../subsystem/tic80/tic80_song_state";
import {
   CueSheetField,
   CueSheetFieldValues,
   ExportConfiguration,
   ExportConfigurationDto,
   makeDefaultExportConfigurations,
} from "./exportConfiguration";

// changing this, document in readme which changes occurred, create a upgrade fn from previous
const kSomaticSchemaVersion = 2;

function upgradeSongDtoToLatest(input: SongDto): SongDto {
   let schemaVersion = (input as any).schemaVersion ?? 0;
   if (schemaVersion >= kSomaticSchemaVersion)
      return input;

   const next = {...input} as SongDto;

   if (schemaVersion < 1) {
      // v0 -> v1 migration:
      // - Instrument indices become Somatic-owned (0..N-1), excluding TIC-80 reserved 0/1.
      // - Note cut/off becomes an explicit boolean flag (noteOff).
      // - Legacy instrument 1 (off) becomes noteOff=true.
      // - Legacy instrument indices >=2 are shifted down by 2.
      // - Legacy instrument 0 becomes null (no instrument).

      // legacy may not specify subsystem.
      next.subsystemType = next.subsystemType || kSubsystem.key.TIC80;

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

      next.schemaVersion = 1;
      schemaVersion = 1;
   }

   if (schemaVersion < 2) {
      // v1 -> v2 migration:
      // - Replace hard-coded Debug/Release exports with ordered export configurations.
      // - Preserve the old shared custom entrypoint in both configurations.
      next.exportConfigurations = makeDefaultExportConfigurations({
         releaseMinificationOptions: next.releaseMinificationOptions,
         useCustomEntrypointLua: next.useCustomEntrypointLua,
         customEntrypointLua: next.customEntrypointLua,
         exportCueSheet: next.exportCueSheet,
         cueSheetFields: next.cueSheetFields,
      }).map((configuration) => configuration.toData());
      delete next.releaseMinificationOptions;
      delete next.useCustomEntrypointLua;
      delete next.customEntrypointLua;
      delete next.exportCueSheet;
      delete next.cueSheetFields;
      next.schemaVersion = 2;
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

export const AudioRenderFormatValues = ["wav", "mp3", "flac"] as const;
export type AudioRenderFormat = typeof AudioRenderFormatValues[number];

export const AudioRenderNormalizationTarget = {
   defaultDbfs: -1,
   minDbfs: -12,
   maxDbfs: 0,
} as const;

export const AudioRenderSilencePadding = {
   defaultMs: 0,
   minMs: 0,
   maxMs: 5000,
} as const;

export type AudioRenderMetadata = {
   title: string;
   artist: string;
   album: string;
   year: string;
   genre: string;
   comment: string;
};

export type AudioRenderSettings = {
   format: AudioRenderFormat;
   normalizePeak: boolean;
   normalizationTargetDbfs: number;
   trimSilence: boolean;
   leadingSilenceMs: number;
   trailingSilenceMs: number;
   metadata: AudioRenderMetadata;
};

function normalizeAudioRenderSettings(
   settings: Partial<AudioRenderSettings> | undefined,
   fallbackTitle: string,
): AudioRenderSettings {
   const format = AudioRenderFormatValues.includes(settings?.format as AudioRenderFormat)
      ? settings!.format as AudioRenderFormat
      : "wav";
   const metadata = settings?.metadata;
   const stringOrEmpty = (value: unknown) => typeof value === "string" ? value : "";
   const booleanOrDefault = (value: unknown, defaultValue: boolean) => (
      typeof value === "boolean" ? value : defaultValue
   );

   return {
      format,
      normalizePeak: booleanOrDefault(settings?.normalizePeak, false),
      normalizationTargetDbfs: NormalizeClampedFloat(
         settings?.normalizationTargetDbfs,
         AudioRenderNormalizationTarget.defaultDbfs,
         AudioRenderNormalizationTarget.minDbfs,
         AudioRenderNormalizationTarget.maxDbfs,
      ),
      trimSilence: booleanOrDefault(settings?.trimSilence, false),
      // A default leadin (~150ms) is sensible for audio export in general, esp for chiptune that may have a strong sharp attack
      // right off the bat. to allow players to start up, bluetooth to connect, volume to ramp up, that kind of thincg.
      // however, you are often exporting for the purpose of synchronizing animations etc, where leadin would only cause
      // confusion / problems.
      leadingSilenceMs: NormalizeClampedFloat(
         settings?.leadingSilenceMs,
         AudioRenderSilencePadding.defaultMs,
         AudioRenderSilencePadding.minMs,
         AudioRenderSilencePadding.maxMs,
      ),
      trailingSilenceMs: NormalizeClampedFloat(
         settings?.trailingSilenceMs,
         AudioRenderSilencePadding.defaultMs,
         AudioRenderSilencePadding.minMs,
         AudioRenderSilencePadding.maxMs,
      ),
      metadata: {
         title: typeof metadata?.title === "string" ? metadata.title : fallbackTitle,
         artist: stringOrEmpty(metadata?.artist),
         album: stringOrEmpty(metadata?.album),
         year: stringOrEmpty(metadata?.year),
         genre: stringOrEmpty(metadata?.genre),
         comment: stringOrEmpty(metadata?.comment),
      },
   };
}

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

   exportConfigurations?: ExportConfigurationDto[];

   // Legacy v1 export settings, consumed only by schema migration.
   useCustomEntrypointLua?: boolean;
   customEntrypointLua?: string;
   releaseMinificationOptions?: OptimizationRuleOptions;

   arrangementThumbnailSize: ArrangementThumbnailSize;

   // Legacy v1 cue-sheet settings, consumed only by schema migration.
   exportCueSheet?: boolean;
   cueSheetFields?: CueSheetField[];

   audioRenderSettings?: AudioRenderSettings;

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

export type InstrumentRangeDeletionImpact = Readonly<{
   instrumentCount: number;
   referenceCellCount: number;
   clearedCellCount: number;
}>;

export type InstrumentRangeDuplicationAnalysis = Readonly<{
   canDuplicate: boolean;
   hasCapacity: boolean;
   blockingTailIndices: number[];
}>;

export type DuplicatedInstrumentRange = Readonly<{
   firstIndex: number;
   count: number;
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

   exportConfigurations: ExportConfiguration[];

   arrangementThumbnailSize: ArrangementThumbnailSize;

   audioRenderSettings: AudioRenderSettings;

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
      this.highlightRowCount = clamp(data.highlightRowCount ?? 4, 1, 64);
      this.patternEditStep = clamp(data.patternEditStep ?? 1, 0, 32);
      this.exportConfigurations = Array.isArray(data.exportConfigurations) && data.exportConfigurations.length > 0
         ? data.exportConfigurations.map((configuration) => new ExportConfiguration(configuration))
         : makeDefaultExportConfigurations({
            releaseMinificationOptions: data.releaseMinificationOptions,
            useCustomEntrypointLua: data.useCustomEntrypointLua,
            customEntrypointLua: data.customEntrypointLua,
            exportCueSheet: data.exportCueSheet,
            cueSheetFields: data.cueSheetFields,
         });

      // Default to showing thumbnails (matches previous behavior).
      this.arrangementThumbnailSize = (data.arrangementThumbnailSize as ArrangementThumbnailSize) ?? "normal";
      this.audioRenderSettings = normalizeAudioRenderSettings(data.audioRenderSettings, this.name);

      this.subsystem.onInitOrSubsystemTypeChange(this);
   }

   addExportConfiguration(): ExportConfiguration {
      const configuration = new ExportConfiguration({name: "New export config"});
      this.exportConfigurations.push(configuration);
      return configuration;
   }

   deleteExportConfiguration(index: number): boolean {
      if (this.exportConfigurations.length <= 1) {
         throw new Error("Cannot delete the last export configuration.");
      }
      this.exportConfigurations.splice(index, 1);
      return true;
   }

   setTempo(value: number) {
      this.tempo = clamp(value, 1, 255);
   }

   setName(value: string) {
      const previousName = this.name;
      this.name = value;
      if (this.audioRenderSettings.metadata.title === previousName) {
         this.audioRenderSettings.metadata.title = value;
      }
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

   getAudioRenderFilename(extensionWithDot: string): string {
      const safeName = SanitizeFilename(this.audioRenderSettings.metadata.title, this.name || "untitled");
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

   resetInstrumentSlotsToDefaults(instrumentIndices: Iterable<number>) {
      for (const instrumentIndex of new Set(instrumentIndices)) {
         if (!Number.isInteger(instrumentIndex) || instrumentIndex < 0 || instrumentIndex >= this.instruments.length)
            continue;
         this.instruments[instrumentIndex] = makeDefaultInstrumentForIndex(instrumentIndex);
      }
   }

   moveInstrumentRange(firstIndex: number, count: number, delta: -1|1): boolean {
      const lastIndex = firstIndex + count - 1;
      if (count <= 0 || firstIndex < 0 || lastIndex >= this.instruments.length)
         return false;
      if (delta < 0 && firstIndex === 0)
         return false;
      if (delta > 0 && lastIndex === this.instruments.length - 1)
         return false;

      if (delta < 0) {
         for (let sourceIndex = firstIndex; sourceIndex <= lastIndex; sourceIndex += 1) {
            const targetIndex = sourceIndex - 1;
            const tmp = this.instruments[sourceIndex];
            this.instruments[sourceIndex] = this.instruments[targetIndex];
            this.instruments[targetIndex] = tmp;
            this.swapInstrumentIndicesInPatterns(sourceIndex, targetIndex);
         }
      } else {
         for (let sourceIndex = lastIndex; sourceIndex >= firstIndex; sourceIndex -= 1) {
            const targetIndex = sourceIndex + 1;
            const tmp = this.instruments[sourceIndex];
            this.instruments[sourceIndex] = this.instruments[targetIndex];
            this.instruments[targetIndex] = tmp;
            this.swapInstrumentIndicesInPatterns(sourceIndex, targetIndex);
         }
      }
      return true;
   }

   // effectively a clamp / normalization. can return null if the range is invalid.
   private getValidInstrumentRange(firstIndex: number, count: number): {
      firstIndex: number;
      lastIndex: number;
      count: number;
   } | null {
      const safeFirst = Math.trunc(firstIndex);
      const safeCount = Math.trunc(count);
      const lastIndex = safeFirst + safeCount - 1;
      if (safeCount <= 0 || safeFirst < 0 || lastIndex >= this.instruments.length)
         return null;
      return {firstIndex: safeFirst, lastIndex, count: safeCount};
   }

   private collectInstrumentRangeDeletion(firstIndex: number, count: number): {
      impact: InstrumentRangeDeletionImpact;
      rowsByPatternAndChannel: Map<Pattern, Map<number, Set<number>>>;
   } {
      const range = this.getValidInstrumentRange(firstIndex, count);
      const rowsByPatternAndChannel = new Map<Pattern, Map<number, Set<number>>>();
      if (!range) {
         return {
            impact: {instrumentCount: 0, referenceCellCount: 0, clearedCellCount: 0},
            rowsByPatternAndChannel,
         };
      }

      let referenceCellCount = 0;
      let clearedCellCount = 0;
      for (const pattern of this.patterns) {
         const rowsByChannel = new Map<number, Set<number>>();
         for (let channelIndex = 0; channelIndex < this.subsystem.channelCount; channelIndex += 1) {
            const rows = new Set<number>();
            for (let rowIndex = 0; rowIndex < this.rowsPerPattern; rowIndex += 1) {
               const instrumentIndex = pattern.peekCell(channelIndex, rowIndex)?.instrumentIndex;
               if (instrumentIndex === undefined ||
                  instrumentIndex < range.firstIndex || instrumentIndex > range.lastIndex) {
                  continue;
               }
               referenceCellCount += 1;
               for (const dependentRow of pattern.getNoteCellAndDependentRows(
                  channelIndex, rowIndex, this.rowsPerPattern)) {
                  rows.add(dependentRow);
               }
            }
            if (rows.size > 0) {
               rowsByChannel.set(channelIndex, rows);
               clearedCellCount += rows.size;
            }
         }
         if (rowsByChannel.size > 0)
            rowsByPatternAndChannel.set(pattern, rowsByChannel);
      }

      return {
         impact: {instrumentCount: range.count, referenceCellCount, clearedCellCount},
         rowsByPatternAndChannel,
      };
   }

   analyzeInstrumentRangeDeletion(firstIndex: number, count: number): InstrumentRangeDeletionImpact {
      return this.collectInstrumentRangeDeletion(firstIndex, count).impact;
   }

   deleteInstrumentRange(firstIndex: number, count: number): InstrumentRangeDeletionImpact {
      const range = this.getValidInstrumentRange(firstIndex, count);
      const collected = this.collectInstrumentRangeDeletion(firstIndex, count);
      if (!range)
         return collected.impact;

      for (const [pattern, rowsByChannel] of collected.rowsByPatternAndChannel) {
         for (const [channelIndex, rows] of rowsByChannel) {
            for (const rowIndex of rows)
               pattern.setCell(channelIndex, rowIndex, {});
         }
      }

      const finalSourceIndex = this.instruments.length - range.count - 1;
      for (let targetIndex = range.firstIndex; targetIndex <= finalSourceIndex; targetIndex += 1)
         this.instruments[targetIndex] = this.instruments[targetIndex + range.count];
      for (let tailIndex = this.instruments.length - range.count; tailIndex < this.instruments.length; tailIndex += 1)
         this.instruments[tailIndex] = makeDefaultInstrumentForIndex(tailIndex);

      for (const pattern of this.patterns) {
         for (let channelIndex = 0; channelIndex < this.subsystem.channelCount; channelIndex += 1) {
            for (let rowIndex = 0; rowIndex < this.rowsPerPattern; rowIndex += 1) {
               const cell = pattern.peekCell(channelIndex, rowIndex);
               if (!cell)
                  continue;
               if (cell.instrumentIndex !== undefined && cell.instrumentIndex > range.lastIndex)
                  cell.instrumentIndex -= range.count;
            }
         }
      }
      return collected.impact;
   }

   // returns a list of all instrument indices that are referenced in the song's patterns (including unused patterns, including unreachable rows)
   private getStoredInstrumentReferenceSet(): Set<number> {
      const references = new Set<number>();
      for (const pattern of this.patterns) {
         for (let channelIndex = 0; channelIndex < this.subsystem.channelCount; channelIndex += 1) {
            for (let rowIndex = 0; rowIndex < this.rowsPerPattern; rowIndex += 1) {
               const instrumentIndex = pattern.peekCell(channelIndex, rowIndex)?.instrumentIndex;
               if (instrumentIndex !== undefined)
                  references.add(instrumentIndex);
            }
         }
      }
      return references;
   }

   // duplication not always possible so analyze first.
   // returns the tail indices blocking duplication.
   analyzeInstrumentRangeDuplication(firstIndex: number, count: number): InstrumentRangeDuplicationAnalysis {
      const range = this.getValidInstrumentRange(firstIndex, count);
      if (!range)
         return {canDuplicate: false, hasCapacity: false, blockingTailIndices: []};

      const insertIndex = range.lastIndex + 1;
      if (insertIndex + range.count > this.instruments.length)
         return {canDuplicate: false, hasCapacity: false, blockingTailIndices: []};

      const references = this.getStoredInstrumentReferenceSet();
      const firstTailIndex = this.instruments.length - range.count;
      const blockingTailIndices: number[] = [];
      for (let instrumentIndex = firstTailIndex; instrumentIndex < this.instruments.length; instrumentIndex += 1) {
         if (references.has(instrumentIndex))
            blockingTailIndices.push(instrumentIndex);
      }
      return {canDuplicate: blockingTailIndices.length === 0, hasCapacity: true, blockingTailIndices};
   }

   duplicateInstrumentRange(firstIndex: number, count: number): DuplicatedInstrumentRange | null {
      const range = this.getValidInstrumentRange(firstIndex, count);
      if (!range || !this.analyzeInstrumentRangeDuplication(firstIndex, count).canDuplicate)
         return null;

      const copies = this.instruments.slice(range.firstIndex, range.lastIndex + 1)
         .map((instrument) => instrument.clone());
      const insertIndex = range.lastIndex + 1;
      for (let targetIndex = this.instruments.length - 1;
         targetIndex >= insertIndex + range.count;
         targetIndex -= 1) {
         this.instruments[targetIndex] = this.instruments[targetIndex - range.count];
      }
      for (let offset = 0; offset < copies.length; offset += 1)
         this.instruments[insertIndex + offset] = copies[offset];

      const finalRemappableIndex = this.instruments.length - range.count - 1;
      for (const pattern of this.patterns) {
         for (let channelIndex = 0; channelIndex < this.subsystem.channelCount; channelIndex += 1) {
            for (let rowIndex = 0; rowIndex < this.rowsPerPattern; rowIndex += 1) {
               const cell = pattern.peekCell(channelIndex, rowIndex);
               if (!cell)
                  continue;
               if (cell.instrumentIndex !== undefined &&
                  cell.instrumentIndex >= insertIndex && cell.instrumentIndex <= finalRemappableIndex) {
                  cell.instrumentIndex += range.count;
               }
            }
         }
      }
      return {firstIndex: insertIndex, count: range.count};
   }

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

   // only counts enabled song orders
   getSongLengthRows(): number {
      return this.songOrder.reduce((sum, orderItem, orderIndex) =>
         sum + (orderItem.enabled ? this.getOrderEffectiveRowCount(orderIndex) : 0), 0);
   }

   getEnabledSongOrderIndices(): number[] {
      const result: number[] = [];
      for (let orderIndex = 0; orderIndex < this.songOrder.length; orderIndex++) {
         if (this.songOrder[orderIndex]!.enabled) {
            result.push(orderIndex);
         }
      }
      return result;
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

   getChannelNoteContext(
      songPosition: number,
      channelIndex: number,
      rowIndex: number,
      ): SongChannelNoteContext {
      return getTic80SongStateAccumulator(this).getChannelNoteContext(
         songPosition,
         channelIndex,
         rowIndex,
      );
   }

   // skips disabled orders, mimicing real playback.
   getAbsRowAtSongPosition(songPosition: number, rowIndex = 0): number {
      const safePosition = clamp(songPosition | 0, 0, Math.max(0, this.songOrder.length - 1));
      let absRow = 0;
      for (let i = 0; i < safePosition; i++) {
         if (this.songOrder[i]!.enabled) {
            absRow += this.getOrderEffectiveRowCount(i);
         }
      }
      if (!this.songOrder[safePosition]?.enabled)
         return absRow;
      const rowsInOrder = this.getOrderEffectiveRowCount(safePosition);
      return absRow + clamp(rowIndex | 0, 0, Math.max(0, rowsInOrder - 1));
   }

   getSongPositionAtAbsRow(absRow: number): {songPosition: number; rowIndex: number;} {
      const orderCount = this.songOrder.length;
      if (orderCount <= 0) {
         return {songPosition: 0, rowIndex: 0};
      }
      const enabledOrderIndices = this.getEnabledSongOrderIndices();
      if (enabledOrderIndices.length === 0) {
         return {songPosition: 0, rowIndex: 0};
      }
      let remaining = clamp(Math.floor(absRow), 0, Math.max(0, this.getSongLengthRows() - 1));
      for (let orderIndex = 0; orderIndex < orderCount; orderIndex++) {
         if (!this.songOrder[orderIndex]!.enabled)
            continue;
         const rows = this.getOrderEffectiveRowCount(orderIndex);
         if (remaining < rows) {
            return {songPosition: orderIndex, rowIndex: remaining};
         }
         remaining -= rows;
      }
      const lastEnabledOrderIndex = enabledOrderIndices[enabledOrderIndices.length - 1]!;
      return {
         songPosition: lastEnabledOrderIndex,
         rowIndex: Math.max(0, this.getOrderEffectiveRowCount(lastEnabledOrderIndex) - 1),
      };
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
         exportConfigurations: this.exportConfigurations.map((configuration) => configuration.toData()),

         arrangementThumbnailSize: this.arrangementThumbnailSize,
         audioRenderSettings: {
            ...this.audioRenderSettings,
            metadata: {...this.audioRenderSettings.metadata},
         },
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


export type CueSheetEntry = Partial<{
   icon: string;
   pi: number;
   beat: number;
   rows: number;
   note: string;
}>;

export function buildCueSheet(song: Song, cueSheetFields: readonly CueSheetField[]): CueSheetEntry[] {
   const entries: CueSheetEntry[] = [];
   const fields = new Set(cueSheetFields);
   const maxPatternIndex = song.patterns.length - 1;
   for (let orderIndex = 0; orderIndex < song.songOrder.length; orderIndex++) {
      const orderItem = song.songOrder[orderIndex]!;
      if (!orderItem.enabled)
         continue;
      const patternIndex = clamp(orderItem.patternIndex ?? 0, 0, maxPatternIndex);
      const patternName = song.patterns[patternIndex]?.name ?? "";
      const entry: CueSheetEntry = {};
      if (fields.has("pi"))
         entry.pi = patternIndex; // order index != pattern index; this is necessary.
      if (fields.has("beat"))
         entry.beat = song.getAbsRowAtSongPosition(orderIndex, 0) / song.getRowsPerBeat();
      if (fields.has("rows"))
         entry.rows = song.getOrderEffectiveRowCount(orderIndex);
      if (fields.has("icon"))
         entry.icon = orderItem.markerVariant;
      if (fields.has("note"))
         entry.note = patternName;
      entries.push(entry);
   }

   return entries;
}

export function buildSongMetadataPayload(song: Song, fields: readonly CueSheetField[]) {
   return {
      transport: song.buildTransportConfig(),
      cueSheet: fields.length > 0 ? buildCueSheet(song, fields) : undefined,
   };
}


export const formatPatternIndex = (index: number) => index.toString().padStart(2, "0");

export type SubsystemBackend = SomaticSubsystemBackend<Song, SongDto>;
