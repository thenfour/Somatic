import {isNoteCut, Pattern, PatternCell} from "../models/pattern";
import {SubsystemBackend} from "../models/song";
import {InterpolateTarget} from "../ui/PatternAdvancedPanel";
import {clamp, lerp} from "./utils";


export type RowRange = {
   start: number; //
   end: number
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

   //const channelMax = Tic80Caps.song.audioChannelsXXX - 1;
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

   //const channelMax = Tic80Caps.song.audioChannelsXXX - 1;
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
