import {isNoteCut, Pattern, PatternCell} from "../models/pattern";
import {SomaticCaps, Tic80Caps, Tic80ChannelIndex, ToTic80ChannelIndex} from "../models/tic80Capabilities";
import {InterpolateTarget} from "../ui/PatternAdvancedPanel";
import {clamp} from "./utils";


export type RowRange = {
   start: number; //
   end: number
};

// Matches defs.ts MIDI_FOR_TIC_NOTE0 mapping (C0) and TIC-80's 8 octaves of pattern range.
const TIC_NOTE_MIDI_BASE = 12;
const MIN_PATTERN_MIDI = TIC_NOTE_MIDI_BASE;
const MAX_PATTERN_MIDI = TIC_NOTE_MIDI_BASE + Tic80Caps.pattern.octaveCount * 12 - 1;



const mutatePatternCells = (
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   mutator: (cell: PatternCell, channelIndex: Tic80ChannelIndex, rowIndex: number) => PatternCell | null,
   ): boolean => {
   const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
   if (maxRow < 0)
      return false;
   const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
   const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);
   if (rowStart > rowEnd)
      return false;

   const channelMax = Tic80Caps.song.audioChannels - 1;
   let mutated = false;

   for (let row = rowStart; row <= rowEnd; row++) {
      for (const channel of channels) {
         if (!Number.isFinite(channel))
            continue;
         const safeChannel = clamp(Math.floor(channel), 0, channelMax);
         const channelIndex = ToTic80ChannelIndex(safeChannel);
         const cell = pattern.getCell(channelIndex, row);
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
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   amount: number,
   ): boolean => mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
   if (cell.midiNote === undefined)
      return null;
   if (isNoteCut(cell))
      return null;
   const nextNote = cell.midiNote + amount;
   if (nextNote < MIN_PATTERN_MIDI || nextNote > MAX_PATTERN_MIDI)
      return null;
   if (nextNote === cell.midiNote)
      return null;
   return {...cell, midiNote: nextNote};
});

export const setInstrumentInPattern = (
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   instrumentValue: number,
   ): boolean => mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
   if (cell.instrumentIndex === undefined)
      return null;
   if (cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex)
      return null;
   if (cell.instrumentIndex === instrumentValue)
      return null;
   return {...cell, instrumentIndex: instrumentValue};
});

export const changeInstrumentInPattern = (
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   fromInstrument: number,
   toInstrument: number,
   ): boolean => mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
   if (cell.instrumentIndex === undefined)
      return null;
   if (cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex)
      return null;
   if (cell.instrumentIndex !== fromInstrument)
      return null;
   if (fromInstrument === toInstrument)
      return null;
   return {...cell, instrumentIndex: toInstrument};
});


type CellValueAccessor = {
   min: number; max: number; read: (cell: PatternCell) => number | undefined;
   write: (cell: PatternCell, value: number) => PatternCell | null;
};

const interpolationAccessors: Record<InterpolateTarget, CellValueAccessor> = {
   notes: {
      min: MIN_PATTERN_MIDI,
      max: MAX_PATTERN_MIDI,
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
         const clamped = clamp(Math.round(value), MIN_PATTERN_MIDI, MAX_PATTERN_MIDI);
         if (cell.midiNote === clamped)
            return null;
         return {...cell, midiNote: clamped};
      },
   },
   paramX: {
      min: 0,
      max: 0x0f,
      read: (cell) => {
         if (cell.effectX === undefined)
            return undefined;
         return cell.effectX;
      },
      write: (cell, value) => {
         const clamped = clamp(Math.round(value), 0, 0x0f);
         if (cell.effectX === clamped)
            return null;
         return {...cell, effectX: clamped};
      },
   },
   paramY: {
      min: 0,
      max: 0x0f,
      read: (cell) => {
         if (cell.effectY === undefined)
            return undefined;
         return cell.effectY;
      },
      write: (cell, value) => {
         const clamped = clamp(Math.round(value), 0, 0x0f);
         if (cell.effectY === clamped)
            return null;
         return {...cell, effectY: clamped};
      },
   },
   paramXY: {
      min: 0,
      max: 0xff,
      read: (cell) => {
         if (cell.effectX === undefined || cell.effectY === undefined)
            return undefined;
         return (cell.effectX << 4) | cell.effectY;
      },
      write: (cell, value) => {
         const clamped = clamp(Math.round(value), 0, 0xff);
         const newX = (clamped >> 4) & 0x0f;
         const newY = clamped & 0x0f;
         if (cell.effectX === newX && cell.effectY === newY)
            return null;
         return {...cell, effectX: newX, effectY: newY};
      },
   },
};



type InterpolationResult = {
   mutated: boolean; anchorPairs: number;
};

export const interpolatePatternValues = (
   pattern: Pattern,
   channels: number[],
   rowRange: RowRange,
   rowsPerPattern: number,
   target: InterpolateTarget,
   ): InterpolationResult => {
   const accessor = interpolationAccessors[target];
   const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
   if (maxRow < 0)
      return {mutated: false, anchorPairs: 0};
   const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
   const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);

   const channelMax = Tic80Caps.song.audioChannels - 1;
   let mutated = false;
   let anchorPairs = 0;

   for (const channel of channels) {
      if (!Number.isFinite(channel))
         continue;
      const safeChannel = clamp(Math.floor(channel), 0, channelMax);
      const channelIndex = ToTic80ChannelIndex(safeChannel);

      let startRow = -1;
      let startValue: number|null = null;
      for (let row = rowStart; row <= rowEnd; row++) {
         const value = accessor.read(pattern.getCell(channelIndex, row));
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
         const value = accessor.read(pattern.getCell(channelIndex, row));
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
         const interpolated = startValue + (endValue - startValue) * t;
         const clampedValue = clamp(Math.round(interpolated), accessor.min, accessor.max);
         const cell = pattern.getCell(channelIndex, row);
         const updated = accessor.write(cell, clampedValue);
         if (!updated)
            continue;
         pattern.setCell(channelIndex, row, updated);
         mutated = true;
      }
   }

   return {mutated, anchorPairs};
};
