// TIC80 specific

import {PatternChannel} from "../../models/pattern";
import {Song} from "../../models/song";
import {SomaticCaps, Tic80Caps, TicMemoryMap} from "../../models/tic80Capabilities";
import {assert, clamp} from "../../utils/utils";

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

// converts a frontend Song model into a column-oriented representation for the playroutines
export function prepareSongColumns(song: Song): PreparedSong {
   const patternColumns: PreparedPatternColumn[] = [];
   const signatureToIndex = new Map<string, number>();

   const getColumnIndex = (patternIndex: number, channel: number): number => {
      const pattern = song.patterns[patternIndex]!;
      const channelObj = pattern.getChannel(channel);
      if (!channelObj) {
         return 0;
      }
      const signature = pattern.contentSignatureForColumn(channel);
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
      const patternIndex = clamp(orderEntry.patternIndex, 0, maxPatternIndex);
      const columnIndices: [number, number, number, number] = [0, 0, 0, 0];
      for (let ch = 0; ch < Tic80Caps.song.audioChannels; ch++) {
         columnIndices[ch] = getColumnIndex(patternIndex, ch);
      }
      songOrder.push({
         patternColumnIndices: columnIndices,
         effectiveRows: song.getPatternEffectiveRowCount(patternIndex),
      });
   }

   return {
      baseSong: song,
      patternColumns,
      songOrder,
      rowsPerPattern: song.rowsPerPattern,
      channelCount: song.subsystem.channelCount,
   };
}

export function encodePreparedSongOrderForBridge(prepared: PreparedSong): Uint8Array {
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
         const idx = entry.patternColumnIndices[ch] | 0;
         assert(idx >= 0 && idx < SomaticCaps.maxPatternCount, `songOrderData: column index out of range: ${idx}`);
         assert(
            idx < prepared.patternColumns.length,
            `songOrderData: column index ${idx} >= patternColumns.length ${prepared.patternColumns.length}`);
         payload[base + ch] = idx;
      }
      payload[rowsOffset + i] = clamp(entry.effectiveRows | 0, 1, prepared.rowsPerPattern);
   }

   return payload;
}
