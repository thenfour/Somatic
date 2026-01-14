import {assert, clamp} from "../utils/utils";
import type {Song} from "./song";
import {kSomaticPatternCommand, kTic80EffectCommand, SomaticPatternCommand, Tic80EffectCommand} from "./tic80Capabilities";


export type PatternCell = {

   midiNote?: number; // (when serializde to tic80, N is the note number (4-15 for notes and <4 for stops))

   // for MOD, the raw period value. period is more fundamental than midi note in MOD format.
   // so when importing, this preserves the value for proper round-tripping.
   // midiNote and period are populated both together for MOD subsystem (never just 1)
   modPeriod?: number;

   // 0-based Somatic instrument index, or undefined for no instrument.
   instrumentIndex?: number | undefined;

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

export function isNoteCut(cell: PatternCell): boolean {
   return !!cell.noteOff;
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
   name: string; //
   channels: PatternChannelDto[];
};

export class Pattern {
   name: string;

   // private so that we can enforce channel counts / creations via accessors
   private channels: PatternChannel[];

   constructor(data?: PatternDto) {
      if (data) {
         this.name = data.name ?? "";
         this.channels = data.channels.map((ch) => new PatternChannel(ch));
      } else {
         this.name = "";
         this.channels = [];
      }
   }

   toData(): PatternDto {
      return {
         name: this.name, //
            channels: this.channels.map(ch => ch.toData()),
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

   contentSignatureForColumn(channelIndex: number): string {
      const dto = this.toData();
      assert(
         channelIndex >= 0 && channelIndex < dto.channels.length,
         `contentSignatureForColumn: channelIndex out of range: ${channelIndex}`);
      return JSON.stringify({channel: dto.channels[channelIndex]});
   }
}

export type PatternEffectCarryState = {
   // Map from effect command index to its last non-zero XY values in this pattern.
   tic80EffectCommandStates: Map<
      Tic80EffectCommand,
      {
         effectX: number;
         effectY: number
      }>;

   // Map from Somatic pattern command index to its carry-over param byte.
   // Only includes values that are considered non-nominal and should be warned about.
   somaticCommandStates: Map<SomaticPatternCommand, {paramU8: number}>;
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
   const channelCount = song.subsystem.channelCount;

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
                                            tic80EffectCommandStates: new Map<
                                               Tic80EffectCommand, // command
                                               {
                                                  effectX: number;
                                                  effectY: number;
                                               }>(),
                                            somaticCommandStates: new Map<
                                               SomaticPatternCommand, // somatic command index
                                               {paramU8: number}>(),
                                         }));

   // init k-rate render slot per channel (for sustaining notes).
   const activeKRateSlotByChannel: (number|null)[] = Array.from({length: channelCount}, () => null);
   const kRateRenderSlotConflictByRow: boolean[] = Array.from({length: rowCount}, () => false);

   for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      // Track conflicts for this row while we update note / effect state.
      const slotCounts = new Map<number, number>();

      for (let channelIndex = 0; channelIndex < channelCount; channelIndex++) {
         const cell = pattern.getCell(channelIndex, rowIndex);

         // Effect carry
         //if (cell.tic80Effect !== undefined && cell.tic80Effect !== null) {
         if (kTic80EffectCommand.isValidKey(cell.tic80Effect)) {
            const cmd = cell.tic80Effect;

            const effectMeta = kTic80EffectCommand.infoByKey[cmd];
            const nominalX = effectMeta.nominalX;
            const nominalY = effectMeta.nominalY;
            if (nominalX === undefined || nominalY === undefined)
               continue; // ignore carry state for this command

            const x = cell.tic80EffectX ?? 0;
            const y = cell.tic80EffectY ?? 0;
            const stateMap = fxCarryByChannel[channelIndex].tic80EffectCommandStates;

            const isNominal = (x === nominalX && y === nominalY);

            if (isNominal) {
               stateMap.delete(cmd);
            } else {
               stateMap.set(cmd, {effectX: x, effectY: y});
            }
         }

         // Somatic effect carry (separate command space from TIC-80 effect commands)
         //if ( cell.somaticEffect !== undefined && cell.somaticEffect !== null) {
         if (kSomaticPatternCommand.isValidKey(cell.somaticEffect)) {
            const somCmd = cell.somaticEffect;

            const nominalValue = kSomaticPatternCommand.infoByKey[somCmd].nomivalValue;
            if (nominalValue === undefined)
               continue; // ignore carry state for this command

            //const paramU8 = (cell.somaticParam ?? SOMATIC_CMD_EFFECT_STRENGTH_SCALE_NOMINAL) & 0xff;
            const stateMap = fxCarryByChannel[channelIndex].somaticCommandStates;
            const cellValue = cell.somaticParam ?? 0;

            const isNominal = (cellValue === nominalValue);

            if (isNominal) {
               stateMap.delete(somCmd);
            } else {
               stateMap.set(somCmd, {paramU8: cellValue});
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
