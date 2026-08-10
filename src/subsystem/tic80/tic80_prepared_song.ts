// TIC80 specific

import {PatternChannel} from "../../models/pattern";
import {Song} from "../../models/song";
import {kSomaticPatternCommand, SomaticCaps, Tic80Caps, TicMemoryMap} from "../../models/tic80Capabilities";
import {assert} from "../../utils/utils";

export type PreparedPatternColumn = {
   sourcePatternIndex: number; //
   channelIndex: number;       //
   channel: PatternChannel;
};

export type PreparedSongOrderItem = {
   patternColumnIndices: [number, number, number, number];
   effectiveRows: number;
};

export type PreparedSong = {
   baseSong: Song;                          //
   rowsPerPattern: number;                  //
   channelCount: number;                    //
   patternColumns: PreparedPatternColumn[]; //
   songOrder: PreparedSongOrderItem[];
};

export function assertPreparedSongContract(prepared: PreparedSong): void {
   assert(
      Number.isInteger(prepared.rowsPerPattern)
         && prepared.rowsPerPattern >= 1
         && prepared.rowsPerPattern <= Tic80Caps.pattern.maxRows,
      `Prepared song rowsPerPattern must be an integer in 1..${Tic80Caps.pattern.maxRows}; got ${
         prepared.rowsPerPattern}`,
   );
   assert(
      prepared.channelCount === Tic80Caps.song.audioChannels,
      `Prepared song must have ${Tic80Caps.song.audioChannels} channels; got ${prepared.channelCount}`,
   );
   assert(
      prepared.songOrder.length >= 1 && prepared.songOrder.length <= SomaticCaps.maxSongLength,
      `Prepared song order length must be in 1..${SomaticCaps.maxSongLength}; got ${prepared.songOrder.length}`,
   );
   assert(
      prepared.patternColumns.length >= 1 && prepared.patternColumns.length <= SomaticCaps.maxPatternCount,
      `Prepared pattern column count must be in 1..${SomaticCaps.maxPatternCount}; got ${
         prepared.patternColumns.length}`,
   );

   prepared.songOrder.forEach((entry, orderIndex) => {
      assert(
         Number.isInteger(entry.effectiveRows)
            && entry.effectiveRows >= 1
            && entry.effectiveRows <= prepared.rowsPerPattern,
         `Prepared song order ${orderIndex} effectiveRows must be an integer in 1..${
            prepared.rowsPerPattern}; got ${entry.effectiveRows}`,
      );
      assert(
         entry.patternColumnIndices.length === Tic80Caps.song.audioChannels,
         `Prepared song order ${orderIndex} must have ${Tic80Caps.song.audioChannels} column indices`,
      );
      entry.patternColumnIndices.forEach((columnIndex, channelIndex) => {
         assert(
            Number.isInteger(columnIndex)
               && columnIndex >= 0
               && columnIndex < SomaticCaps.maxPatternCount
               && columnIndex < prepared.patternColumns.length,
            `Prepared song order ${orderIndex} channel ${channelIndex} has invalid column index ${columnIndex}`,
         );
      });
   });
}

// converts a frontend Song model into a column-oriented representation for the playroutines
export function prepareSongColumns(song: Song): PreparedSong {
   const patternColumns: PreparedPatternColumn[] = [];
   const signatureToIndex = new Map<string, number>();

   const getColumnIndex = (patternIndex: number, channel: number, effectiveRows: number): number => {
      const pattern = song.patterns[patternIndex]!;

      // delete patternEnd commands; they are respected elsewhere so can be omitted here.
      const rows = Array.from({length: Tic80Caps.pattern.maxRows}, (_, rowIndex) => {
         if (rowIndex >= effectiveRows) {
            return {};
         }
         const cell = {...(pattern.peekCell(channel, rowIndex) ?? {})};
         if (cell.somaticEffect === kSomaticPatternCommand.key.PatternEnd) {
            delete cell.somaticEffect;
            delete cell.somaticParam;
         }
         return cell;
      });
      const channelObj = new PatternChannel({rows});
      const signature = JSON.stringify({channel: channelObj.toData()});
      const existing = signatureToIndex.get(signature);
      if (existing !== undefined) {
         return existing;
      }
      if (patternColumns.length >= SomaticCaps.maxPatternCount) {
         throw new Error(
            `prepareSongColumns: exceeded SomaticCaps.maxPatternCount=${SomaticCaps.maxPatternCount}. ` +
            `Song requires >${
               SomaticCaps.maxPatternCount} unique pattern columns, which cannot be addressed by 8-bit indices.`);
      }
      const idx = patternColumns.length;
      signatureToIndex.set(signature, idx);
      patternColumns.push({sourcePatternIndex: patternIndex, channelIndex: channel, channel: channelObj.clone()});
      return idx;
   };

   const songOrder: PreparedSongOrderItem[] = [];
   const maxPatternIndex = song.patterns.length - 1;
   for (let i = 0; i < song.songOrder.length; i++) {
      const orderEntry = song.songOrder[i];
      if (!orderEntry.enabled)
         continue;
      const patternIndex = orderEntry.patternIndex;
      assert(
         Number.isInteger(patternIndex) && patternIndex >= 0 && patternIndex <= maxPatternIndex,
         `Song order ${i} has invalid pattern index ${patternIndex}`,
      );
      const effectiveRows = song.getPatternEffectiveRowCount(patternIndex);
      const columnIndices: [number, number, number, number] = [0, 0, 0, 0];
      for (let ch = 0; ch < Tic80Caps.song.audioChannels; ch++) {
         columnIndices[ch] = getColumnIndex(patternIndex, ch, effectiveRows);
      }
      songOrder.push({
         patternColumnIndices: columnIndices,
         effectiveRows,
      });
   }

   // The playroutine requires at least one order. An editor song may legally
   // disable every order, so represent that zero-length song with a one-row
   // silent technical payload rather than leaking a disabled pattern into it.
   if (songOrder.length === 0) {
      const silentColumn = new PatternChannel();
      patternColumns.push({sourcePatternIndex: 0, channelIndex: 0, channel: silentColumn});
      songOrder.push({patternColumnIndices: [0, 0, 0, 0], effectiveRows: 1});
   }

   const prepared: PreparedSong = {
      baseSong: song,
      patternColumns,
      songOrder,
      rowsPerPattern: song.rowsPerPattern,
      channelCount: song.subsystem.channelCount,
   };
   assertPreparedSongContract(prepared);
   return prepared;
}

export function encodePreparedSongOrderForBridge(prepared: PreparedSong): Uint8Array {
   assertPreparedSongContract(prepared);

   const capacity = TicMemoryMap.TF_ORDER_LIST_CAPACITY;
   const entryOffset = 1;
   const rowsOffset = TicMemoryMap.TF_ORDER_LIST_ROWS - TicMemoryMap.TF_ORDER_LIST;
   const payloadLength = TicMemoryMap.TF_PATTERN_DATA - TicMemoryMap.TF_ORDER_LIST;

   assert(SomaticCaps.maxSongLength <= capacity, "bridge song order capacity too small");
   assert(prepared.songOrder.length <= SomaticCaps.maxSongLength, "prepared.songOrder.length <= SomaticCaps.maxSongLength");
   assert(
      rowsOffset === entryOffset + capacity * Tic80Caps.song.audioChannels,
      "Bridge song order row offset does not match serialized capacity");
   assert(payloadLength === rowsOffset + capacity, "Bridge pattern data offset does not follow the song order tables");

   const payload = new Uint8Array(payloadLength);
   payload[0] = prepared.songOrder.length;
   for (let i = 0; i < prepared.songOrder.length; i++) {
      const entry = prepared.songOrder[i];
      const base = entryOffset + i * Tic80Caps.song.audioChannels;
      for (let ch = 0; ch < Tic80Caps.song.audioChannels; ch++) {
         payload[base + ch] = entry.patternColumnIndices[ch];
      }
      payload[rowsOffset + i] = entry.effectiveRows;
   }

   return payload;
}
