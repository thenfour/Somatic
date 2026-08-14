import {assert, clamp} from "../utils/utils";
import {kSomaticPatternCommand, kTic80EffectCommand, SomaticPatternCommand, Tic80EffectCommand} from "./tic80Capabilities";


export type PatternCell = {

   midiNote?: number; // (when serializde to tic80, N is the note number (4-15 for notes and <4 for stops))

   // for MOD, the raw period value. period is more fundamental than midi note in MOD format.
   // so when importing, this preserves the value for proper round-tripping.
   // midiNote and period are populated both together for MOD subsystem (never just 1)
   modPeriod?: number;

   // 0-based Somatic instrument index, or undefined for no instrument.
   instrumentIndex?: number | undefined;

   // Per-channel volume gain, 00..FF. Multiplied by the instrument's base volume;
   // undefined is full gain (FF).
   volumeU8?: number;

   // Per-channel pan override, 00=left, 80=center, FF=right. Undefined uses
   // the instrument's base pan.
   panU8?: number;

   // When true, this cell represents a note-off / note-cut event.
   // This is Somatic-level and platform-agnostic.
   noteOff?: boolean;
   tic80Effect?: Tic80EffectCommand | undefined; // 0-7. 0 is the same as null / no effect. 1-7 = MCJSPVD
   tic80EffectX?: number | undefined;            // 0-15
   tic80EffectY?: number | undefined;            // 0-15

   // Somatic-specific pattern effects (not part of TIC-80's native playroutine).
   // Stored as a 0-based command index (similar to `effect`), or undefined for no command.
   somaticEffect?: SomaticPatternCommand;
   // Somatic-specific param byte, 0..255 (typed in as two hex nibbles), or undefined.
   somaticParam?: number;
};

// LEGACY support (alpha):
type PatternCellLegacy = {
   effect?: number; // TIC-80 effect command
   effectX?: number;
   effectY?: number;
   somaticEffect?: number; // 0-based value
}

export const MakeEmptyPatternCell = (): PatternCell => ({});

export const PATTERN_SIDE_CHANNEL_MAX_LENGTH = 1024;
const PATTERN_SIDE_CHANNEL_ASCII_PATTERN = /^[\x20-\x7e]*$/; // printable ascii

export function getPatternSideChannelValidationIssues(value: string): string[] {
   const issues: string[] = [];
   if (value.length > PATTERN_SIDE_CHANNEL_MAX_LENGTH) {
      issues.push(`Side-channel data exceeds the limit of ${PATTERN_SIDE_CHANNEL_MAX_LENGTH} characters.`);
   }
   if (!PATTERN_SIDE_CHANNEL_ASCII_PATTERN.test(value)) {
      issues.push("Side-channel data contains characters outside printable 7-bit ASCII.");
   }
   return issues;
}

export function isNoteCut(cell: PatternCell): boolean {
   return !!cell.noteOff;
}

const noteDependentTic80Effects = new Set<Tic80EffectCommand>([
   kTic80EffectCommand.key.C,
   kTic80EffectCommand.key.S,
   kTic80EffectCommand.key.P,
   kTic80EffectCommand.key.V,
   kTic80EffectCommand.key.D,
]);

// Master volume, jump, and pattern-end commands control global playback flow rather
// than the currently sounding note, so removing a note must leave them intact.
const noteDependentSomaticEffects = new Set<SomaticPatternCommand>([
   kSomaticPatternCommand.key.EffectStrengthScale,
   kSomaticPatternCommand.key.SetLFOPhase,
   kSomaticPatternCommand.key.FilterFrequency,
   kSomaticPatternCommand.key.Pan,
]);

function cellDependsOnActiveNote(cell: PatternCell): boolean {
   return cell.volumeU8 !== undefined ||
      cell.panU8 !== undefined ||
      (cell.tic80Effect !== undefined && noteDependentTic80Effects.has(cell.tic80Effect)) ||
      (cell.somaticEffect !== undefined && noteDependentSomaticEffects.has(cell.somaticEffect));
}

// DTO = Data Transfer Object; the serializable representation of the class.
export type PatternChannelDto = {
   rows: PatternCell[];
};

export class PatternChannel {
   private rows: PatternCell[];

   constructor(data?: PatternChannelDto) {
      this.rows = data ? [...data.rows] : [];

      // LEGACY support: migrate legacy effect fields to new tic80Effect fields
      for (let i = 0; i < this.rows.length; i++) {
         const cell = this.rows[i] as Partial<PatternCellLegacy>;
         if (cell.effect !== undefined) {
            const effectInfo = kTic80EffectCommand.infos.find(info => info.value === cell.effect);
            if (effectInfo) {
               this.rows[i].tic80Effect = effectInfo.key;
            }
            delete cell.effect;
         }
         if (cell.effectX !== undefined) {
            this.rows[i].tic80EffectX = cell.effectX;
            delete cell.effectX;
         }
         if (cell.effectY !== undefined) {
            this.rows[i].tic80EffectY = cell.effectY;
            delete cell.effectY;
         }
         if (typeof cell.somaticEffect === "number") {
            const somaticEffectInfo = kSomaticPatternCommand.infos.find(info => info.value === cell.somaticEffect);
            if (somaticEffectInfo) {
               this.rows[i].somaticEffect = somaticEffectInfo.key;
            }
            // delete cell.somaticEffect; -- don't delete; it's still part of PatternCellLegacy
         }
      }
   }

   setCell(index: number, cellValue: PatternCell) {
      if (index < 0)
         return;
      this.ensureRows(index + 1);
      this.rows[index] = {...cellValue};
   }
   getCell(index: number): PatternCell {
      this.ensureRows(index + 1);
      return this.rows[index];
   }
   peekCell(index: number): PatternCell|undefined {
      return index < 0 ? undefined : this.rows[index];
   }
   ensureRows(count: number) {
      while (this.rows.length < count) {
         this.rows.push({});
      }
   }

   toData(): PatternChannelDto {
      return {rows: this.rows.map((row) => ({...row}))};
   }

   static fromData(data: PatternChannelDto): PatternChannel {
      return new PatternChannel(data);
   }

   clone(): PatternChannel {
      return PatternChannel.fromData(this.toData());
   }
}

//////////////////////////////////////////////////////////////////////////////////
// each pattern row can contain 1 small string of user-defined data.
export interface PatternSideChannelDataDto {
   rows: string[];
};
export class PatternSideChannelData {
   private rows: string[];

   constructor(data?: PatternSideChannelDataDto) {
      // gracefully handle old payloads without rows.
      this.rows = Array.isArray(data?.rows)
         ? data.rows.map((value) => typeof value === "string" ? value : "")
         : [];
      this.trimTrailingEmptyRows();
   }

   setCell(index: number, cellValue: string) {
      if (index < 0)
         return;
      this.ensureRows(index + 1);
      this.rows[index] = typeof cellValue === "string" ? cellValue : "";
      this.trimTrailingEmptyRows();
   }
   getCell(index: number): string {
      return this.peekCell(index) ?? "";
   }
   peekCell(index: number): string | undefined {
      return index < 0 ? undefined : this.rows[index];
   }
   ensureRows(count: number) {
      while (this.rows.length < count) {
         this.rows.push("");
      }
   }

   private trimTrailingEmptyRows() {
      while (this.rows.length > 0 && this.rows[this.rows.length - 1] === "") {
         this.rows.pop();
      }
   }

   toData(): PatternSideChannelDataDto {
      return {rows: [...this.rows]};
   }

   static fromData(data: PatternSideChannelDataDto): PatternSideChannelData {
      return new PatternSideChannelData(data);
   }

   clone(): PatternSideChannelData {
      return PatternSideChannelData.fromData(this.toData());
   }
};

//////////////////////////////////////////////////////////////////////////////////
export type PatternDto = {
   name: string; //
   channels: PatternChannelDto[];
   privateSideChannelData?: PatternSideChannelDataDto;
};

export class Pattern {
   name: string;

   // private so that we can enforce channel counts / creations via accessors
   private channels: PatternChannel[];
   private sideChannelData: PatternSideChannelData;

   constructor(data?: PatternDto) {
      if (data) {
         this.name = data.name ?? "";
         this.channels = data.channels.map((ch) => new PatternChannel(ch));
         this.sideChannelData = new PatternSideChannelData(data.privateSideChannelData);
      } else {
         this.name = "";
         this.channels = [];
         this.sideChannelData = new PatternSideChannelData();
      }
   }

   toData(): PatternDto {
      return {
         name: this.name, //
         channels: this.channels.map(ch => ch.toData()),
         privateSideChannelData: this.sideChannelData.toData(),
      }
   }

   private ensureChannelCount(count: number) {
      while (this.channels.length < count) {
         this.channels.push(new PatternChannel());
      }
   }

   getChannel(channelIndex: number): PatternChannel {
      this.ensureChannelCount(channelIndex + 1);
      return this.channels[channelIndex];
   }

   setCell(channelIndex: number, rowIndex: number, cellValue: PatternCell) {
      this.getChannel(channelIndex).setCell(rowIndex, cellValue);
   }

   getCell(channelIndex: number, rowIndex: number): PatternCell {
      const channel = this.getChannel(channelIndex);
      channel.ensureRows(rowIndex + 1);
      return channel.getCell(rowIndex);
   }

   peekCell(channelIndex: number, rowIndex: number): PatternCell|undefined {
      if (channelIndex < 0 || rowIndex < 0)
         return undefined;
      return this.channels[channelIndex]?.peekCell(rowIndex);
   }

   setSideChannelCell(rowIndex: number, value: string) {
      this.sideChannelData.setCell(rowIndex, value);
   }

   getSideChannelCell(rowIndex: number): string {
      return this.sideChannelData.getCell(rowIndex);
   }

   peekSideChannelCell(rowIndex: number): string | undefined {
      return this.sideChannelData.peekCell(rowIndex);
   }

   getNoteCellAndDependentRows(channelIndex: number, noteRowIndex: number, rowLimit: number): number[] {
      const safeRowLimit = Math.max(0, Math.trunc(rowLimit));
      if (channelIndex < 0 || noteRowIndex < 0 || noteRowIndex >= safeRowLimit)
         return [];

      const noteCell = this.peekCell(channelIndex, noteRowIndex);
      const rows = [noteRowIndex];
      if (noteCell?.midiNote === undefined || isNoteCut(noteCell))
         return rows;

      for (let rowIndex = noteRowIndex + 1; rowIndex < safeRowLimit; rowIndex += 1) {
         const cell = this.peekCell(channelIndex, rowIndex);
         if (!cell)
            continue;
         if (isNoteCut(cell)) {
            rows.push(rowIndex);
            break;
         }
         if (cell.midiNote !== undefined)
            break;
         if (cellDependsOnActiveNote(cell))
            rows.push(rowIndex);
      }
      return rows;
   }

   // Clear the originating note cell plus later note-local controls, stopping at
   // (and clearing) its note cut or immediately before the next note starts.
   clearNoteCellAndDependents(channelIndex: number, noteRowIndex: number, rowLimit: number): number[] {
      const rows = this.getNoteCellAndDependentRows(channelIndex, noteRowIndex, rowLimit);
      for (const rowIndex of rows)
         this.setCell(channelIndex, rowIndex, MakeEmptyPatternCell());
      return rows;
   }

   static fromData(data: PatternDto): Pattern {
      return new Pattern(data);
   }

   clone(): Pattern {
      return Pattern.fromData(this.toData());
   }

   contentSignature(): string {
      const dto = this.toData();
      // even though side channel data is not musical content, it's still
      // serialized and needs to be included when de-duplicating pattern data.
      return JSON.stringify({channels: dto.channels, sideChannelData: dto.privateSideChannelData});
   }

   getPatternEndRow(rowLimit: number, channelCount: number): number|null {
      const safeRowLimit = clamp(rowLimit | 0, 1, Number.MAX_SAFE_INTEGER);
      const safeChannelCount = clamp(channelCount | 0, 1, Number.MAX_SAFE_INTEGER);
      for (let rowIndex = 0; rowIndex < safeRowLimit; rowIndex++) {
         for (let channelIndex = 0; channelIndex < safeChannelCount; channelIndex++) {
            const cell = this.getCell(channelIndex, rowIndex);
            if (cell.somaticEffect === kSomaticPatternCommand.key.PatternEnd) {
               return rowIndex;
            }
         }
      }
      return null;
   }

   getEffectiveRowCount(rowLimit: number, channelCount: number): number {
      const safeRowLimit = clamp(rowLimit | 0, 1, Number.MAX_SAFE_INTEGER);
      const endRow = this.getPatternEndRow(safeRowLimit, channelCount);
      if (endRow == null || endRow >= safeRowLimit - 1) {
         return safeRowLimit;
      }
      return endRow + 1;
   }

   isRowReachable(rowIndex: number, rowLimit: number, channelCount: number): boolean {
      return rowIndex < this.getEffectiveRowCount(rowLimit, channelCount);
   }
}

export type PatternRowIssue = {
   rowIndex: number;
   channelIndex?: number;
   sideChannel?: boolean;
   message: string;
   emphasis: "strong"|"marker";
};

export type PatternRowIssueAnalysis = {
   issuesByRow: PatternRowIssue[][];
   issueRowCount: number;
   hasStrongIssues: boolean;
};

export function analyzePatternRowIssues(
   pattern: Pattern,
   rowCount: number, // assumed in range.
   channelCount: number,
): PatternRowIssueAnalysis {
   const patternEndRow = pattern.getPatternEndRow(rowCount, channelCount);
   const patternEndHasFreeTicEffectSlot = patternEndRow == null ||
      Array.from({length: channelCount}, (_, channelIndex) => channelIndex)
         .some((channelIndex) => pattern.getCell(channelIndex, patternEndRow).tic80Effect === undefined);

   let issueRowCount = 0;
   let hasStrongIssues = false;
   const issuesByRow = Array.from({length: rowCount}, (_, rowIndex) => {
      const issues: PatternRowIssue[] = [];

      const sideChannelValue = pattern.peekSideChannelCell(rowIndex) ?? "";
      for (const message of getPatternSideChannelValidationIssues(sideChannelValue)) {
         issues.push({rowIndex, sideChannel: true, message, emphasis: "strong"});
         hasStrongIssues = true;
      }

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
         const cell = pattern.getCell(channelIndex, rowIndex);
         let message = "";

         if (cell.tic80Effect === kTic80EffectCommand.key.J) {
            message = "The 'J' command is not supported in Somatic patterns.";
         }
         if (cell.tic80Effect === undefined &&
            (cell.tic80EffectX !== undefined || cell.tic80EffectY !== undefined)) {
            message = "Effect parameter set without an effect command.";
         }
         if (cell.instrumentIndex !== undefined && cell.midiNote === undefined) {
            message = "Instrument set without a note.";
         }
         if (cell.somaticEffect === undefined && cell.somaticParam !== undefined) {
            message = "Somatic effect parameter set without a Somatic effect command.";
         }

         if (message) {
            issues.push({rowIndex, channelIndex, message, emphasis: "strong"});
            hasStrongIssues = true;
         }
      }

      if (rowIndex === patternEndRow && !patternEndHasFreeTicEffectSlot) {
         issues.push({
            rowIndex,
            message: "Somatic C needs one channel without a TIC effect command.",
            emphasis: "strong",
         });
         hasStrongIssues = true;
      }

      if (issues.length > 0) {
         issueRowCount += 1;
      }
      return issues;
   });

   return {issuesByRow, issueRowCount, hasStrongIssues};
}
