// TIC80 specific

import {PatternChannel} from "../models/pattern";
import {Song} from "../models/song";
import {SomaticCaps, Tic80Caps} from "../models/tic80Capabilities";
import {clamp} from "../utils/utils";

export type PreparedPatternColumn = {
   sourcePatternIndex: number; //
   channelIndex: number;       //
   channel: PatternChannel;
};

export type PreparedSongOrderItem = {
   patternColumnIndices: [number, number, number, number];
};

export type PreparedSong = {
   baseSong: Song;                          //
   patternColumns: PreparedPatternColumn[]; //
   songOrder: PreparedSongOrderItem[];
};

// converts a frontend Song model into a column-oriented representation for the playroutines
export function prepareSongColumns(song: Song): PreparedSong {
   const patternColumns: PreparedPatternColumn[] = [];
   const signatureToIndex = new Map<string, number>();

   const getColumnIndex = (patternIndex: number, channel: number): number => {
      const pattern = song.patterns[patternIndex];
      const channelObj = pattern?.channels[channel];
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
      songOrder.push({patternColumnIndices: columnIndices});
   }

   return {
      baseSong: song,
      patternColumns,
      songOrder,
   };
}
