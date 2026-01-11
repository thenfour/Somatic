import {assert, clamp} from "../utils/utils";
import {SomaticCaps, SomaticEffectCommand, SomaticPatternCommand, SOMATIC_PATTERN_COMMAND_DESCRIPTIONS, SOMATIC_PATTERN_COMMAND_LETTERS, TIC80_EFFECT_DESCRIPTIONS, TIC80_EFFECT_LETTERS, Tic80Caps, Tic80ChannelIndex} from "./tic80Capabilities";
import type {Song} from "./song";


export type PatternCell = {
   midiNote?: number; // (when serializde to tic80, N is the note number (4-15 for notes and <4 for stops))
   instrumentIndex?:
      number; // 0-based internal instrument index. When serialized to tic80, this is +1 (1-based; 0 means no instrument).
   effect?: number;  // 0-7. 0 is the same as null / no effect. 1-7 = MCJSPVD
   effectX?: number; // 0-15
   effectY?: number; // 0-15

   // Somatic-specific pattern effects (not part of TIC-80's native playroutine).
   // Stored as a 0-based command index (similar to `effect`), or undefined for no command.
   somaticEffect?: number;
   // Somatic-specific param byte, 0..255 (typed in as two hex nibbles), or undefined.
   somaticParam?: number;
};


// Re-export TIC-80 and Somatic command metadata from tic80Capabilities for convenience
export {
   TIC80_EFFECT_LETTERS,
   TIC80_EFFECT_DESCRIPTIONS,
   SOMATIC_PATTERN_COMMAND_LETTERS,
   SOMATIC_PATTERN_COMMAND_DESCRIPTIONS as SOMATIC_EFFECT_DESCRIPTIONS
};


export const MakeEmptyPatternCell = (): PatternCell => ({});

export function isNoteCut(cell: PatternCell): boolean {
   return cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex;
}

export type PatternChannelDto = {
   rows: PatternCell[];
};

export class PatternChannel implements PatternChannelDto {
   rows: PatternCell[];

   constructor(data?: PatternChannelDto) {
      this.rows = data ? [...data.rows] : [];
      // ensure we have all rows. the reason is that upon render we can weed out; for editing just make sure we always have data.
      this.ensureRows(Tic80Caps.pattern.maxRows);
   }

   setRow(index: number, cellValue: PatternCell) {
      if (index < 0 || index >= this.rows.length)
         return;
      this.ensureRows(index + 1);
      this.rows[index] = {...cellValue};
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
export type PatternDto = {
   name: string; channels: [PatternChannelDto, PatternChannelDto, PatternChannelDto, PatternChannelDto];
};

export class Pattern implements PatternDto {
   name: string;
   channels: [PatternChannel, PatternChannel, PatternChannel, PatternChannel];

   constructor(data?: PatternDto) {
      if (data) {
         assert(data.channels.length === Tic80Caps.song.audioChannels);
         this.name = data.name ?? "";
         this.channels = [
            new PatternChannel(data.channels[0]),
            new PatternChannel(data.channels[1]),
            new PatternChannel(data.channels[2]),
            new PatternChannel(data.channels[3]),
         ];
      } else {
         this.name = "";
         this.channels = [
            new PatternChannel(),
            new PatternChannel(),
            new PatternChannel(),
            new PatternChannel(),
         ];
      }
   }

   toData(): PatternDto {
      return {
         name: this.name, channels: [
            this.channels[0].toData(),
            this.channels[1].toData(),
            this.channels[2].toData(),
            this.channels[3].toData(),
         ]
      }
   }

   setCell(channelIndex: Tic80ChannelIndex, rowIndex: number, cellValue: PatternCell) {
      this.channels[channelIndex].setRow(rowIndex, cellValue);
   }

   getCell(channelIndex: Tic80ChannelIndex, rowIndex: number): PatternCell {
      this.channels[channelIndex].ensureRows(rowIndex + 1);
      return this.channels[channelIndex].rows[rowIndex];
   }

   static fromData(data: PatternDto): Pattern {
      return new Pattern(data);
   }

   clone(): Pattern {
      return Pattern.fromData(this.toData());
   }

   contentSignature(): string {
      const dto = this.toData();
      return JSON.stringify({channels: dto.channels});
   }

   contentSignatureForColumn(channelIndex: Tic80ChannelIndex): string {
      const dto = this.toData();
      return JSON.stringify({channel: dto.channels[channelIndex]});
   }
}

export type PatternEffectCarryState = {
   // Map from effect command index to its last non-zero XY values in this pattern.
   commandStates: Map<
      number,
      {
         effectX: number;
         effectY: number
      }>;

   // Map from Somatic pattern command index to its carry-over param byte.
   // Only includes values that are considered non-nominal and should be warned about.
   somaticCommandStates: Map<number, {paramU8: number}>;
};

export type PatternPlaybackAnalysis = {
   // For each channel, leftover effect state at the end of this pattern only
   // (does not consider previous patterns).
   fxCarryByChannel: PatternEffectCarryState[];

   // For each row, whether two or more channels are simultaneously rendering
   // into the same k-rate waveform slot.
   kRateRenderSlotConflictByRow: boolean[];
};

export function analyzePatternPlaybackForGrid(song: Song, patternIndex: number): PatternPlaybackAnalysis {
   const safePatternIndex = clamp(patternIndex | 0, 0, song.patterns.length - 1);
   const pattern = song.patterns[safePatternIndex];
   const rowCount = song.rowsPerPattern;
   const channelCount = pattern.channels.length;

   // Precompute which instruments will actually render into a k-rate waveform slot during playback.
   // array indexed by instrument index -> slot index or null.
   const kRateRenderSlotByInstrument: (number|null)[] = song.instruments.map((inst) => {
      if (!inst.isKRateProcessing())
         return null;
      return inst.renderWaveformSlot;
   });

   // Effect carry state per channel.
   const fxCarryByChannel: PatternEffectCarryState[] =
      Array.from({length: channelCount}, () => ({
                                            commandStates: new Map<
                                               number, // command
                                               {
                                                  effectX: number;
                                                  effectY: number;
                                               }>(),
                                            somaticCommandStates: new Map<
                                               number, // somatic command index
                                               {paramU8: number}>(),
                                         }));

   // Somatic command semantics
   const SOMATIC_CMD_EFFECT_STRENGTH_SCALE_NOMINAL = 0xff;
   const SOMATIC_CMD_FILTER_FREQUENCY_NOMINAL = 0;

   // init k-rate render slot per channel (for sustaining notes).
   const activeKRateSlotByChannel: (number|null)[] = Array.from({length: channelCount}, () => null);
   const kRateRenderSlotConflictByRow: boolean[] = Array.from({length: rowCount}, () => false);

   for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      // Track conflicts for this row while we update note / effect state.
      const slotCounts = new Map<number, number>();

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
         const cell = pattern.channels[channelIndex].rows[rowIndex] ?? {};

         // Effect carry
         if (cell.effect !== undefined && cell.effect !== null) {
            const cmd = cell.effect | 0;
            // Only track valid Somatic effect commands (0..D).
            if (cmd >= SomaticEffectCommand.M && cmd <= SomaticEffectCommand.D) {
               const x = cell.effectX ?? 0;
               const y = cell.effectY ?? 0;
               const stateMap = fxCarryByChannel[channelIndex].commandStates;
               // Carry-over warnings are about *non-nominal* end-of-pattern state.
               // Most TIC-80 effects are nominal when set to 00 (clears carry state),
               // but the 'M' effect is nominal at FF.
               const isNominal = (cmd === SomaticEffectCommand.M) ? (x === 0xF && y === 0xF) : (x === 0 && y === 0);

               if (isNominal) {
                  stateMap.delete(cmd);
               } else {
                  stateMap.set(cmd, {effectX: x, effectY: y});
               }
            }
         }

         // Somatic effect carry (separate command space from TIC-80 effect commands)
         if (cell.somaticEffect !== undefined && cell.somaticEffect !== null) {
            const somCmd = cell.somaticEffect | 0;
            const paramU8 = (cell.somaticParam ?? SOMATIC_CMD_EFFECT_STRENGTH_SCALE_NOMINAL) & 0xff;
            const stateMap = fxCarryByChannel[channelIndex].somaticCommandStates;

            // Currently only the 'E' command is tracked for carry-over warnings.
            if (somCmd === SomaticPatternCommand.EffectStrengthScale) {
               // 0xFF is the nominal value; we do not warn about carrying this over.
               if (paramU8 === SOMATIC_CMD_EFFECT_STRENGTH_SCALE_NOMINAL) {
                  stateMap.delete(somCmd);
               } else {
                  stateMap.set(somCmd, {paramU8});
               }
            } else if (somCmd === SomaticPatternCommand.FilterFrequency) {
               // 0xFF is the nominal value (bypass).
               if (paramU8 === SOMATIC_CMD_FILTER_FREQUENCY_NOMINAL) {
                  stateMap.delete(somCmd);
               } else {
                  stateMap.set(somCmd, {paramU8});
               }
            }
         }

         // K-rate render slot
         if (isNoteCut(cell)) {
            // Explicit note cut: end any sustaining note on this channel.
            activeKRateSlotByChannel[channelIndex] = null;
         } else if (cell.midiNote) {
            // New note: update active slot for this channel.
            const instId = cell.instrumentIndex;
            if (instId != null) {
               const slot = kRateRenderSlotByInstrument[instId] ?? null;
               activeKRateSlotByChannel[channelIndex] = slot;
            } else {
               activeKRateSlotByChannel[channelIndex] = null;
            }
         }

         const activeSlot = activeKRateSlotByChannel[channelIndex];
         if (activeSlot != null) {
            slotCounts.set(activeSlot, (slotCounts.get(activeSlot) ?? 0) + 1);
         }
      }

      if (Array.from(slotCounts.values()).some((count) => count >= 2)) {
         kRateRenderSlotConflictByRow[rowIndex] = true;
      }
   }

   return {
      fxCarryByChannel,
      kRateRenderSlotConflictByRow,
   };
}
