// tracks per-row state for a song.
// is not per-pattern; it's for the whole song because state carries across patterns.

import type {Song, SongChannelNoteContext, SongChannelNoteOccurrence} from "../../models/song";
import {isNoteCut, type Pattern, type PatternCell} from "../../models/pattern";
import {
   kSomaticPatternCommand,
   kTic80EffectCommand,
   type SomaticPatternCommand,
   type Tic80EffectCommand,
} from "../../models/tic80Capabilities";
import {clamp} from "../../utils/utils";

export type Tic80EffectCommandState = Readonly<{
   effectX: number;
   effectY: number;
   songPosition: number;
   rowIndex: number;
}>;

export type SomaticCommandState = Readonly<{
   paramU8: number;
   songPosition: number;
   rowIndex: number;
}>;

export type Tic80SongChannelState = Readonly<{
   activeNote?: SongChannelNoteOccurrence;
   tic80EffectCommandStates: ReadonlyMap<Tic80EffectCommand, Tic80EffectCommandState>;
   somaticCommandStates: ReadonlyMap<SomaticPatternCommand, SomaticCommandState>;
}>;

// whole song state is just channel state per channel
export type Tic80SongState = readonly Tic80SongChannelState[];

export type Tic80SongRowState = Readonly<{
   rowReachable: boolean;
   beforeRow: Tic80SongState;
   afterNoteColumn: Tic80SongState;
   afterRow: Tic80SongState;
}>;

// the effect state that's carried from 1 song order to the next, for displaying as warnings/info
// this represents 1 channel's state.
export type Tic80EffectCarryState = Pick<Tic80SongChannelState, "tic80EffectCommandStates"|"somaticCommandStates">;

type OrderRowCache = {
   effectiveRowCount: number;
   pattern: Pattern | undefined;
   rows: Tic80SongRowState[];
   unreachableRows: Array<Tic80SongRowState | undefined>;
   stateAfterRows: Tic80SongState;
};

function makeEmptySongState(channelCount: number): Tic80SongState {
   return Array.from({length: channelCount}, () => ({
      tic80EffectCommandStates: new Map<Tic80EffectCommand, Tic80EffectCommandState>(),
      somaticCommandStates: new Map<SomaticPatternCommand, SomaticCommandState>(),
   }));
}

function replaceChannel(
   state: Tic80SongState,
   channelIndex: number,
   channel: Tic80SongChannelState,
): Tic80SongState {
   if (state[channelIndex] === channel)
      return state;
   const next = [...state];
   next[channelIndex] = channel;
   return next;
}

function applyNoteColumn(
   state: Tic80SongState,
   cell: PatternCell,
   channelIndex: number,
   songPosition: number,
   rowIndex: number,
): Tic80SongState {
   const channel = state[channelIndex]!;
   if (isNoteCut(cell)) {
      if (!channel.activeNote)
         return state;
      return replaceChannel(state, channelIndex, {...channel, activeNote: undefined});
   }
   if (cell.midiNote === undefined)
      return state;
   return replaceChannel(state, channelIndex, {
      ...channel,
      activeNote: {midiNote: cell.midiNote, songPosition, rowIndex},
   });
}

function applyTic80Effect(
   state: Tic80SongState,
   cell: PatternCell,
   channelIndex: number,
   songPosition: number,
   rowIndex: number,
): Tic80SongState {
   if (!kTic80EffectCommand.isValidKey(cell.tic80Effect))
      return state;

   // given a cell in a song, "plays" it and updates state for the channel.

   const command = cell.tic80Effect;
   const info = kTic80EffectCommand.infoByKey[command];
   if (info.nominalX === undefined || info.nominalY === undefined)
      return state;

   const channel = state[channelIndex]!;
   const currentStates = channel.tic80EffectCommandStates;
   const effectX = cell.tic80EffectX ?? 0;
   const effectY = cell.tic80EffectY ?? 0;
   const isNominal = effectX === info.nominalX && effectY === info.nominalY;
   const current = currentStates.get(command);

   if (isNominal && !current)
      return state;
   const nextStates = new Map(currentStates);
   if (isNominal)
      nextStates.delete(command);
   else
      nextStates.set(command, {effectX, effectY, songPosition, rowIndex});
   return replaceChannel(state, channelIndex, {
      ...channel,
      tic80EffectCommandStates: nextStates,
   });
}

function applySomaticEffect(
   state: Tic80SongState,
   cell: PatternCell,
   channelIndex: number,
   songPosition: number,
   rowIndex: number,
): Tic80SongState {
   if (!kSomaticPatternCommand.isValidKey(cell.somaticEffect))
      return state;

   const command = cell.somaticEffect;
   const nominalValue = kSomaticPatternCommand.infoByKey[command].nomivalValue;
   if (nominalValue === undefined)
      return state;

   const channel = state[channelIndex]!;
   const currentStates = channel.somaticCommandStates;
   const paramU8 = cell.somaticParam ?? 0;
   const isNominal = paramU8 === nominalValue;
   const current = currentStates.get(command);

   if (isNominal && !current)
      return state;
   const nextStates = new Map(currentStates);
   if (isNominal)
      nextStates.delete(command);
   else
      nextStates.set(command, {paramU8, songPosition, rowIndex});
   return replaceChannel(state, channelIndex, {
      ...channel,
      somaticCommandStates: nextStates,
   });
}

export class Tic80SongStateAccumulator {
   private readonly emptyState: Tic80SongState;
   private readonly orderStartStates: Array<Tic80SongState | undefined> = [];
   private readonly orderEndStates: Array<Tic80SongState | undefined> = [];
   private readonly orderRowCaches: Array<OrderRowCache | undefined> = [];

   constructor(private readonly song: Song) {
      this.emptyState = makeEmptySongState(song.subsystem.channelCount);
      if (song.songOrder.length > 0)
         this.orderStartStates[0] = this.emptyState;
   }

   private getOrderPattern(songPosition: number): Pattern | undefined {
      const patternIndex = this.song.songOrder[songPosition]?.patternIndex;
      return patternIndex === undefined ? undefined : this.song.patterns[patternIndex];
   }

   private getEffectiveRowCount(pattern: Pattern | undefined): number {
      return pattern?.getEffectiveRowCount(
         this.song.rowsPerPattern,
         this.song.subsystem.channelCount,
      ) ?? 0;
   }

   private ensureOrderStartState(songPosition: number): Tic80SongState {
      if (songPosition <= 0)
         return this.emptyState;
      const cached = this.orderStartStates[songPosition];
      if (cached)
         return cached;

      const previousStart = this.ensureOrderStartState(songPosition - 1);
      const previousOrder = this.song.songOrder[songPosition - 1];
      // Disabled orders remain queryable in isolation, but do not alter the
      // canonical state entering later song positions.
      const state = previousOrder?.enabled
         ? this.getOrderEndStateInternal(songPosition - 1)
         : previousStart;
      this.orderStartStates[songPosition] = state;
      return state;
   }

   private advanceRow(
      songPosition: number,
      rowIndex: number,
      pattern: Pattern,
      beforeRow: Tic80SongState,
      rowReachable: boolean,
   ): Tic80SongRowState {
      const cells = Array.from(
         {length: this.song.subsystem.channelCount},
         (_, channelIndex) => pattern.getCell(channelIndex, rowIndex),
      );

      let afterNoteColumn = beforeRow;
      for (let channelIndex = 0; channelIndex < cells.length; channelIndex++) {
         afterNoteColumn = applyNoteColumn(
            afterNoteColumn,
            cells[channelIndex]!,
            channelIndex,
            songPosition,
            rowIndex,
         );
      }

      let afterRow = afterNoteColumn;
      for (let channelIndex = 0; channelIndex < cells.length; channelIndex++) {
         const cell = cells[channelIndex]!;
         afterRow = applyTic80Effect(
            afterRow,
            cell,
            channelIndex,
            songPosition,
            rowIndex,
         );
         afterRow = applySomaticEffect(
            afterRow,
            cell,
            channelIndex,
            songPosition,
            rowIndex,
         );
      }

      return {rowReachable, beforeRow, afterNoteColumn, afterRow};
   }

   // returns the row state cache for the given song position.
   // creates if necessary. does not advance rows / calculate state.
   private getOrderRowCache(songPosition: number): OrderRowCache {
      const cached = this.orderRowCaches[songPosition];
      if (cached)
         return cached;
      const pattern = this.getOrderPattern(songPosition);
      const created: OrderRowCache = {
         effectiveRowCount: this.getEffectiveRowCount(pattern),
         pattern,
         rows: [],
         unreachableRows: [],
         stateAfterRows: this.ensureOrderStartState(songPosition),
      };
      this.orderRowCaches[songPosition] = created;
      return created;
   }

   // plays rows, adding to the cache, until the requested rowCount or pattern end.
   private ensureReachableRows(songPosition: number, rowCount: number): OrderRowCache {
      const cache = this.getOrderRowCache(songPosition);
      const targetRowCount = Math.min(rowCount, cache.effectiveRowCount);
      if (!cache.pattern)
         return cache;
      while (cache.rows.length < targetRowCount) {
         const rowIndex = cache.rows.length;
         const rowState = this.advanceRow(
            songPosition,
            rowIndex,
            cache.pattern,
            cache.stateAfterRows,
            true,
         );
         cache.rows.push(rowState);
         cache.stateAfterRows = rowState.afterRow;
      }
      return cache;
   }

   private getOrderEndStateInternal(songPosition: number): Tic80SongState {
      const cached = this.orderEndStates[songPosition];
      if (cached)
         return cached;
      const rowCache = this.getOrderRowCache(songPosition);
      this.ensureReachableRows(songPosition, rowCache.effectiveRowCount);
      this.orderEndStates[songPosition] = rowCache.stateAfterRows;
      return rowCache.stateAfterRows;
   }

   getRowState(songPosition: number, rowIndex: number): Tic80SongRowState {
      if (this.song.songOrder.length === 0) {
         return {
            rowReachable: false,
            beforeRow: this.emptyState,
            afterNoteColumn: this.emptyState,
            afterRow: this.emptyState,
         };
      }

      const safeSongPosition = clamp(songPosition | 0, 0, this.song.songOrder.length - 1);
      const safeRowIndex = clamp(rowIndex | 0, 0, Math.max(0, this.song.rowsPerPattern - 1));
      const rowCache = this.getOrderRowCache(safeSongPosition);
      if (safeRowIndex < rowCache.effectiveRowCount) {
         this.ensureReachableRows(safeSongPosition, safeRowIndex + 1);
         return rowCache.rows[safeRowIndex]!;
      }

      const cached = rowCache.unreachableRows[safeRowIndex];
      if (cached)
         return cached;

      const beforeRow = this.getOrderEndStateInternal(safeSongPosition);
      if (!rowCache.pattern) {
         const rowState = {
            rowReachable: false,
            beforeRow,
            afterNoteColumn: beforeRow,
            afterRow: beforeRow,
         };
         rowCache.unreachableRows[safeRowIndex] = rowState;
         return rowState;
      }
      const rowState = this.advanceRow(
         safeSongPosition,
         safeRowIndex,
         rowCache.pattern,
         beforeRow,
         false,
      );
      rowCache.unreachableRows[safeRowIndex] = rowState;
      return rowState;
   }

   getChannelNoteContext(
      songPosition: number,
      channelIndex: number,
      rowIndex: number,
   ): SongChannelNoteContext {
      if (this.song.songOrder.length === 0)
         return {source: "none", rowReachable: false};

      const safeSongPosition = clamp(songPosition | 0, 0, this.song.songOrder.length - 1);
      const safeChannelIndex = clamp(
         channelIndex | 0,
         0,
         Math.max(0, this.song.subsystem.channelCount - 1),
      );
      const safeRowIndex = clamp(rowIndex | 0, 0, Math.max(0, this.song.rowsPerPattern - 1));
      const pattern = this.getOrderPattern(safeSongPosition);
      const rowState = this.getRowState(safeSongPosition, safeRowIndex);
      const activeBeforeRow = rowState.beforeRow[safeChannelIndex]?.activeNote;
      if (!pattern)
         return {activeBeforeRow, source: "none", rowReachable: false};

      const cell = pattern.getCell(safeChannelIndex, safeRowIndex);
      if (isNoteCut(cell))
         return {activeBeforeRow, source: "none", rowReachable: rowState.rowReachable};
      if (cell.midiNote !== undefined) {
         return {
            activeBeforeRow,
            activeAfterNoteColumn: rowState.afterNoteColumn[safeChannelIndex]?.activeNote,
            source: "current-cell",
            rowReachable: rowState.rowReachable,
         };
      }
      const activeAfterNoteColumn = rowState.afterNoteColumn[safeChannelIndex]?.activeNote;
      return {
         activeBeforeRow,
         activeAfterNoteColumn,
         source: activeAfterNoteColumn ? "sustained" : "none",
         rowReachable: rowState.rowReachable,
      };
   }

   // returns 1 per channel. songPosition = songOrder.
   getEffectCarryAtOrderEnd(songPosition: number): readonly Tic80EffectCarryState[] {
      if (this.song.songOrder.length === 0)
         return this.emptyState;
      const safeSongPosition = clamp(songPosition | 0, 0, this.song.songOrder.length - 1);
      return this.getOrderEndStateInternal(safeSongPosition);
   }
}

// song edits create a new Song object. Keying by identity makes the cache
// generation-scoped
const accumulatorBySong = new WeakMap<Song, Tic80SongStateAccumulator>();

export function getTic80SongStateAccumulator(song: Song): Tic80SongStateAccumulator {
   const cached = accumulatorBySong.get(song);
   if (cached)
      return cached;
   const accumulator = new Tic80SongStateAccumulator(song);
   accumulatorBySong.set(song, accumulator);
   return accumulator;
}
