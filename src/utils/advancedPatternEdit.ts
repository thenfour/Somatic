import {isNoteCut, Pattern, PatternCell} from "../models/pattern";
import {SubsystemBackend} from "../models/song";
import {kTic80EffectCommand} from "../models/tic80Capabilities";
import {InterpolateTarget} from "../ui/PatternAdvancedPanel";
import {
   TIC80_EFFECT_DURATION_MAX_TICKS,
   tic80RowsToEffectTicks,
   Tic80Timing,
} from "./music/tic80Music";
import {clamp, lerp} from "./utils";


export type RowRange = {
   start: number; //
   end: number
};

export type EvenlyDistributeNotesResult = {
   mutated: boolean;
   eligibleNoteCount: number;
   processedChannelCount: number;
   fixedNoteCollisionChannelCount: number;
   unrepresentableDelayChannelCount: number;
};

type DistributedNotePlacement = {
   sourceRow: number;
   targetRow: number;
   delayTicks: number;
   cell: PatternCell;
};

const cellsEqual = (a: PatternCell, b: PatternCell): boolean =>
   a.midiNote === b.midiNote &&
   a.modPeriod === b.modPeriod &&
   a.instrumentIndex === b.instrumentIndex &&
   a.volumeU8 === b.volumeU8 &&
   a.panU8 === b.panU8 &&
   a.noteOff === b.noteOff &&
   a.tic80Effect === b.tic80Effect &&
   a.tic80EffectX === b.tic80EffectX &&
   a.tic80EffectY === b.tic80EffectY &&
   a.somaticEffect === b.somaticEffect &&
   a.somaticParam === b.somaticParam;

const compactPatternCell = (cell: PatternCell): PatternCell =>
   Object.fromEntries(Object.entries(cell).filter(([, value]) => value !== undefined)) as PatternCell;

const hasTicEffectData = (cell: PatternCell): boolean =>
   cell.tic80Effect !== undefined ||
   cell.tic80EffectX !== undefined ||
   cell.tic80EffectY !== undefined;

const hasSomaticEffectData = (cell: PatternCell): boolean =>
   cell.somaticEffect !== undefined || cell.somaticParam !== undefined;

/**
 * Places a complete note-bearing source cell onto a destination row. Data that
 * was already on a note-less destination row remains in place unless the moved
 * note carries a value in that field. Effect command/parameter pairs move as a
 * unit so stale destination parameters cannot leak into the moved command.
 */
const mergeMovedNoteCell = (destination: PatternCell, source: PatternCell): PatternCell => {
   const merged: PatternCell = {...destination, ...source};

   // These fields belong to the note event even when their value is absent.
   merged.midiNote = source.midiNote;
   merged.modPeriod = source.modPeriod;
   merged.noteOff = source.noteOff;
   merged.instrumentIndex = source.instrumentIndex;

   if (hasTicEffectData(source)) {
      merged.tic80Effect = source.tic80Effect;
      merged.tic80EffectX = source.tic80EffectX;
      merged.tic80EffectY = source.tic80EffectY;
   }
   if (hasSomaticEffectData(source)) {
      merged.somaticEffect = source.somaticEffect;
      merged.somaticParam = source.somaticParam;
   }

   return compactPatternCell(merged);
};

const applyDistributedNoteDelay = (cell: PatternCell, delayTicks: number): PatternCell => {
   if (delayTicks > 0) {
      return compactPatternCell({
         ...cell,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: (delayTicks >> 4) & 0x0f,
         tic80EffectY: delayTicks & 0x0f,
      });
   }

   // An existing Dxx would invalidate an onset that now belongs on the row
   // boundary. Other co-located effects continue to travel with the note.
   if (cell.tic80Effect === kTic80EffectCommand.key.D) {
      return compactPatternCell({
         ...cell,
         tic80Effect: undefined,
         tic80EffectX: undefined,
         tic80EffectY: undefined,
      });
   }

   return cell;
};

export const evenlyDistributeNotesInPattern = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   timing: Tic80Timing,
   instrumentIndex?: number|null,
): EvenlyDistributeNotesResult => {
   const result: EvenlyDistributeNotesResult = {
      mutated: false,
      eligibleNoteCount: 0,
      processedChannelCount: 0,
      fixedNoteCollisionChannelCount: 0,
      unrepresentableDelayChannelCount: 0,
   };
   const maxRow = clamp(rowsPerPattern - 1, 0, subsystem.maxRowsPerPattern - 1);
   const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
   const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);
   const rowCount = rowEnd - rowStart + 1;
   if (rowCount <= 0)
      return result;

   for (const channelIndex of channels) {
      const notes: Array<{sourceRow: number; cell: PatternCell}> = [];
      for (let row = rowStart; row <= rowEnd; row++) {
         const cell = pattern.peekCell(channelIndex, row) ?? {};
         if (cell.midiNote === undefined || isNoteCut(cell))
            continue;
         if (instrumentIndex != null && cell.instrumentIndex !== instrumentIndex)
            continue;
         notes.push({sourceRow: row, cell: {...cell}});
      }

      result.eligibleNoteCount += notes.length;
      if (notes.length === 0)
         continue;

      const placements: DistributedNotePlacement[] = notes.map((note, noteIndex) => {
         const idealRowOffset = noteIndex * rowCount / notes.length;
         const nearestRowOffset = Math.round(idealRowOffset);
         const isRowBoundary = Math.abs(idealRowOffset - nearestRowOffset) <= 1e-9;
         const targetRowOffset = isRowBoundary ? nearestRowOffset : Math.floor(idealRowOffset);
         const fractionalRows = isRowBoundary ? 0 : idealRowOffset - targetRowOffset;
         return {
            ...note,
            targetRow: rowStart + targetRowOffset,
            delayTicks: Math.round(tic80RowsToEffectTicks(fractionalRows, timing)),
         };
      });

      if (placements.some((placement) =>
         placement.delayTicks < 0 || placement.delayTicks > TIC80_EFFECT_DURATION_MAX_TICKS)) {
         result.unrepresentableDelayChannelCount++;
         continue;
      }

      const sourceRows = new Set(notes.map((note) => note.sourceRow));
      const collidesWithFixedNoteEvent = placements.some((placement) => {
         if (sourceRows.has(placement.targetRow))
            return false;
         const targetCell = pattern.peekCell(channelIndex, placement.targetRow) ?? {};
         return targetCell.midiNote !== undefined || isNoteCut(targetCell);
      });
      if (collidesWithFixedNoteEvent) {
         result.fixedNoteCollisionChannelCount++;
         continue;
      }

      const nextCells = new Map<number, PatternCell>();
      for (let row = rowStart; row <= rowEnd; row++)
         nextCells.set(row, {...(pattern.peekCell(channelIndex, row) ?? {})});
      for (const note of notes)
         nextCells.set(note.sourceRow, {});

      for (const placement of placements) {
         const destination = nextCells.get(placement.targetRow) ?? {};
         const moved = mergeMovedNoteCell(destination, placement.cell);
         nextCells.set(placement.targetRow, applyDistributedNoteDelay(moved, placement.delayTicks));
      }

      let channelMutated = false;
      for (let row = rowStart; row <= rowEnd; row++) {
         const oldCell = pattern.peekCell(channelIndex, row) ?? {};
         const nextCell = nextCells.get(row) ?? {};
         if (cellsEqual(oldCell, nextCell))
            continue;
         pattern.setCell(channelIndex, row, nextCell);
         channelMutated = true;
      }

      result.processedChannelCount++;
      result.mutated ||= channelMutated;
   }

   return result;
};

const mutatePatternCells = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   instrumentIndex: number|null|undefined,
   mutator: (cell: PatternCell, channelIndex: number, rowIndex: number) => PatternCell | null,
   ): boolean => {
   const maxRow = clamp(rowsPerPattern - 1, 0, subsystem.maxRowsPerPattern - 1);
   const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
   const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);
   if (rowStart > rowEnd)
      return false;

   let mutated = false;

   for (let row = rowStart; row <= rowEnd; row++) {
      for (const channelIndex of channels) {
         const cell = pattern.getCell(channelIndex, row);

         if (instrumentIndex != null) {
            if (cell.instrumentIndex === undefined || cell.instrumentIndex !== instrumentIndex) {
               continue;
            }
         }

         const updatedCell = mutator(cell, channelIndex, row);
         if (updatedCell) {
            pattern.setCell(channelIndex, row, updatedCell);
            mutated = true;
         }
      }
   }

   return mutated;
};

export const transposeCellsInPattern = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   amount: number,
   instrumentIndex?: number|null,
   ): boolean => mutatePatternCells(subsystem, pattern, channels, rowRange, rowsPerPattern, instrumentIndex, (cell) => {
   if (cell.midiNote === undefined)
      return null;
   if (isNoteCut(cell))
      return null;
   const nextNote = cell.midiNote + amount;
   if (nextNote < subsystem.minPatternMidiNote || nextNote > subsystem.maxPatternMidiNote)
      return null;
   if (nextNote === cell.midiNote)
      return null;
   return {...cell, midiNote: nextNote};
});

export const setInstrumentInPattern = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   instrumentValue: number,
   instrumentIndex?: number|null,
   ): boolean => mutatePatternCells(subsystem, pattern, channels, rowRange, rowsPerPattern, instrumentIndex, (cell) => {
   if (cell.instrumentIndex == null)
      return null;
   if (isNoteCut(cell))
      return null;
   if (cell.instrumentIndex === instrumentValue)
      return null;
   return {...cell, instrumentIndex: instrumentValue};
});

export const changeInstrumentInPattern = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   fromInstrument: number,
   toInstrument: number,
   instrumentIndex?: number|null,
   ): boolean => mutatePatternCells(subsystem, pattern, channels, rowRange, rowsPerPattern, instrumentIndex, (cell) => {
   if (cell.instrumentIndex == null)
      return null;
   if (isNoteCut(cell))
      return null;
   if (cell.instrumentIndex !== fromInstrument)
      return null;
   if (fromInstrument === toInstrument)
      return null;
   return {...cell, instrumentIndex: toInstrument};
});

export const nudgeInstrumentInPattern = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   amount: number,
   instrumentIndex?: number|null,
   ): boolean => mutatePatternCells(subsystem, pattern, channels, rowRange, rowsPerPattern, instrumentIndex, (cell) => {
   if (cell.instrumentIndex == null)
      return null;
   if (isNoteCut(cell))
      return null;
   const nextInstrument = clamp(cell.instrumentIndex + amount, 0, Math.max(0, subsystem.maxInstruments - 1));
   if (nextInstrument === cell.instrumentIndex)
      return null;
   return {...cell, instrumentIndex: nextInstrument};
});


type CellValueAccessor = {
   min: number;                                     //
   max: number;                                     //
   read: (cell: PatternCell) => number | undefined; //
   write: (cell: PatternCell, value: number) => PatternCell | null;
};

function makeInterpolationAccessors(subsystem: SubsystemBackend): Record<InterpolateTarget, CellValueAccessor> {
   return {
      notes: {
         min: subsystem.minPatternMidiNote,
         max: subsystem.maxPatternMidiNote,
         read: (cell) => {
            if (cell.midiNote === undefined)
               return undefined;
            if (isNoteCut(cell))
               return undefined;
            return cell.midiNote;
         },
         write: (cell, value) => {
            if (isNoteCut(cell))
               return null;
            const clamped = clamp(Math.round(value), subsystem.minPatternMidiNote, subsystem.maxPatternMidiNote);
            if (cell.midiNote === clamped)
               return null;
            return {...cell, midiNote: clamped};
         },
      },
      volume: {
         min: 0,
         max: 0xff,
         read: (cell) => cell.volumeU8,
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0xff);
            if (cell.volumeU8 === clamped)
               return null;
            return {...cell, volumeU8: clamped};
         },
      },
      pan: {
         min: 0,
         max: 0xff,
         read: (cell) => cell.panU8,
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0xff);
            if (cell.panU8 === clamped)
               return null;
            return {...cell, panU8: clamped};
         },
      },
      paramX: {
         min: 0,
         max: 0x0f,
         read: (cell) => {
            if (cell.tic80EffectX === undefined)
               return undefined;
            return cell.tic80EffectX;
         },
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0x0f);
            if (cell.tic80EffectX === clamped)
               return null;
            return {...cell, tic80EffectX: clamped};
         },
      },
      paramY: {
         min: 0,
         max: 0x0f,
         read: (cell) => {
            if (cell.tic80EffectY === undefined)
               return undefined;
            return cell.tic80EffectY;
         },
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0x0f);
            if (cell.tic80EffectY === clamped)
               return null;
            return {...cell, tic80EffectY: clamped};
         },
      },
      paramXY: {
         min: 0,
         max: 0xff,
         read: (cell) => {
            if (cell.tic80EffectX === undefined || cell.tic80EffectY === undefined)
               return undefined;
            return (cell.tic80EffectX << 4) | cell.tic80EffectY;
         },
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0xff);
            const newX = (clamped >> 4) & 0x0f;
            const newY = clamped & 0x0f;
            if (cell.tic80EffectX === newX && cell.tic80EffectY === newY)
               return null;
            return {...cell, tic80EffectX: newX, tic80EffectY: newY};
         },
      },
      somaticParamXY: {
         min: 0,
         max: 0xff,
         read: (cell) => {
            if (cell.somaticParam === undefined)
               return undefined;
            return cell.somaticParam & 0xff;
         },
         write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0xff);
            if (cell.somaticParam === clamped)
               return null;
            return {...cell, somaticParam: clamped};
         },
      },
   };
}



type InterpolationResult = {
   mutated: boolean; anchorPairs: number;
};

export const interpolatePatternValues = (
   subsystem: SubsystemBackend,
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   target: InterpolateTarget,
   instrumentIndex?: number|null,
   ): InterpolationResult => {
   const accessor = makeInterpolationAccessors(subsystem)[target];
   const maxRow = clamp(rowsPerPattern - 1, 0, subsystem.maxRowsPerPattern - 1);
   if (maxRow < 0)
      return {mutated: false, anchorPairs: 0};
   const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
   const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);

   let mutated = false;
   let anchorPairs = 0;

   const matchesInstrument = (cell: PatternCell): boolean => {
      if (instrumentIndex == null)
         return true;
      return cell.instrumentIndex !== undefined && cell.instrumentIndex === instrumentIndex;
   };

   for (const channelIndex of channels) {
      let startRow = -1;
      let startValue: number|null = null;
      for (let row = rowStart; row <= rowEnd; row++) {
         const cell = pattern.getCell(channelIndex, row);
         if (!matchesInstrument(cell))
            continue;
         const value = accessor.read(cell);
         if (value === undefined)
            continue;
         startRow = row;
         startValue = value;
         break;
      }

      if (startRow === -1 || startValue === null)
         continue;

      let endRow = -1;
      let endValue: number|null = null;
      for (let row = rowEnd; row >= rowStart; row--) {
         const cell = pattern.getCell(channelIndex, row);
         if (!matchesInstrument(cell))
            continue;
         const value = accessor.read(cell);
         if (value === undefined)
            continue;
         endRow = row;
         endValue = value;
         break;
      }

      if (endRow === -1 || endValue === null)
         continue;
      if (endRow <= startRow)
         continue;
      anchorPairs++;

      const span = endRow - startRow;
      for (let row = startRow + 1; row < endRow; row++) {
         const t = (row - startRow) / span;
         const interpolated = lerp(startValue, endValue, t);
         const clampedValue = clamp(Math.round(interpolated), accessor.min, accessor.max);
         const cell = pattern.getCell(channelIndex, row);
         if (!matchesInstrument(cell))
            continue;
         const updated = accessor.write(cell, clampedValue);
         if (!updated)
            continue;
         pattern.setCell(channelIndex, row, updated);
         mutated = true;
      }
   }

   return {mutated, anchorPairs};
};
