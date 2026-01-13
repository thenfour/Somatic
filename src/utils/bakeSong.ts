import {LoopMode, SomaticTransportState, Tic80TransportState} from "../audio/backend";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {Pattern, PatternCell} from "../models/pattern";
import {Song} from "../models/song";
import {SongOrderItem} from "../models/songOrder";
import {gChannelsArray, Tic80Caps} from "../models/tic80Capabilities";

export interface BakeSongArgs {
   song: Song;              // the full song being edited
   loopMode: LoopMode;      // the style of loop playback requested by the user
   cursorSongOrder: number; // the "current pattern" is the one pointed to by this song order position.

   // if loopMode is "selectionInSongOrder", this indicates the selected song order range (use only the Y(row) selection; there are no columns (x) selected.)
   songOrderSelection: SelectionRect2D|null;

   cursorChannelIndex: number; // which channel the cursor is on (i think this is ignored for baking)
   cursorRowIndex: number;     // which row the cursor is on (used for half/quarter pattern loop modes)

   // if loopMode is "selectionInPattern", this indicates the selected pattern range.
   patternSelection: SelectionRect2D|null;

   audibleChannels: Set<number>; // which channels are audible (not muted)

   // the song order position the user is requesting to start from. this is populated when
   // "play from this pattern" or "play from this row" is used.
   // if you do that with a loop mode, the result is usually obvious.
   // - off: start from here
   // - song: start from here (and loop the whole song)
   // - pattern: start from the start of the pattern containing this position
   //    -> in this case we can bake a new pattern, and set result.startPosition to 0.
   // - selectionInSongOrder: start from the start of the selected song order range
   //   -> same: set result.startPosition to 0, because the baked song is a 1-pattern loop.
   // - halfPattern: start from the start of the half-pattern containing this position
   //   -> same.
   // - quarterPattern: start from the start of the quarter-pattern containing this position
   //   -> same.
   // - selectionInPattern: start from the start of the selected pattern range
   //   -> same.
   startPosition: number; //

   // user has selected "play from this row". let's see how this affects when combined with loop modes.
   // - off: start from this row
   // - song: start from this row
   // - pattern: bake the 1-pattern song (result.startPosition = 0), and result.startRow = args.startRow.
   // - selectionInSongOrder
   //    -> set result.startRow = 0, because there's a chance your cursor is not even in the selected range. just do the simple thing.
   // - halfPattern: start from the start of the half-pattern containing this row
   //    -> set result.startRow = 0; don't get tricky with logic that's so buried it's hard to test.
   // - quarterPattern: start from the start of the quarter-pattern containing this row
   //    -> set result.startRow = 0; don't get tricky.
   // - selectionInPattern: start from the start of the selected pattern range (row 0 of that pattern)
   //    -> set result.startRow = 0.
   startRow: number; //
}

export type BakedSong = {
   // the song that will be transmitted to the TIC-80. the following play params will apply to THIS payload.
   bakedSong: Song;

   // true in order to honor the song loop mode (with baking, this will be true for all non-off loop modes)
   wantSongLoop: boolean;

   // the song order position (of the baked song) to start playback from; see above for details.
   startPosition: number;

   // the pattern row (of the baked song) to start playback from; see above for details.
   startRow: number;

   // describes how to convert transport state from the TIC80 back to Somatic's editor state.
   // for example, if we baked a single-pattern song from a multi-pattern song,
   // we need to know how to map tic80 song position 0 back to the original somatic song position.
   // similarly for pattern rows.
   transportConversion: {
      somaticSongOrderLoop: null |
         {
            beginSomaticSongOrder: number;
            loopLength: number;
         },
      somaticPatternRowLoop: null |
         {
            beginSomaticPatternRow: number;
            loopLength: number;
         },
      songOrderOffset: number;  // tic80 song order 0 maps to somatic song order (0 + offset)
      patternRowOffset: number; // tic80 pattern row 0 maps to somatic pattern row (0 + offset)

      // looping within a pattern gets expanded - repeated to fill a pattern. For example a 4-row loop will
      // be repeated 16 times to fill a 64-row pattern. This field indicates how many somatic rows
      // correspond to one tic80 pattern length.
      somaticRowsPerTic80Pattern: number;
   };
};

// basically takes a raw song + playback options (channel muting, loop mode and its dependencies)
// and outputs a song that bakes in these options, and indicates args to make it play as requested.
/*
the simplest is to respect audibleChannels. if a channel is inaudible, remove pattern data for it for the whole song.

loop modes:

# Off: no changes

# Song: wantSongLoop = true; no other changes

# Pattern:
- wantSongLoop = true
- find the current pattern, and output a song that ONLY contains this 1 pattern.
result: the song loops; the song is just the pattern being looped.

# Selection-in-song-order:
- wantSongLoop = true
- take the selected song order range (pattern pointers)
- generate a new song that contain only these orders
result: the song loops; the song is just the selected orders being looped.

# Half pattern:
- wantSongLoop = true
- find current pattern.
- take the half of the pattern where the cursor pattern row is --- make a new pattern with only that data.
- set song row count to the length of this half-pattern.
- output a song that contains this half-pattern only.
result: the song loops; the song is just the half-pattern being looped.

# Quarter pattern:
similar; find the quarter of the pattern where the cursor pattern row is;
make a new pattern with only that data;
set song row count to length of this quarter-pattern;
output a song that contains this quarter-pattern only.

# Selection-in-pattern
- wantSongLoop = true
- take the selected pattern
- generate a new pattern that contain only the selection (moved to the top, repeated to fill the <=64 row max).
- set song row count to length of generated pattern.
- output a song that contains only this pattern.
result: the song loops; the song is just the selection being looped.

# NOTE: 
in the cases where a single pattern is repeated, attempt to fill the pattern by repeating to fill the <=64 row maximum.
this will avoid extremely short patterns that are likely to glitch out.

*/

function muteInaudibleChannels(song: Song, audibleChannels: Set<number>): void {
   const emptyCell: PatternCell = {};
   for (const pattern of song.patterns) {
      for (const ch of gChannelsArray) {
         if (!audibleChannels.has(ch)) {
            for (let row = 0; row < Tic80Caps.pattern.maxRows; row++) {
               pattern.setCell(ch, row, emptyCell);
            }
         }
      }
   }
}

// copy a range of rows from a source pattern into a new pattern.
function copyPatternRows(
   srcPattern: Pattern,
   srcStartRow: number,
   rowCount: number,
   destPattern: Pattern,
   destStartRow: number,
   ): void {
   for (let r = 0; r < rowCount; r++) {
      for (const ch of gChannelsArray) {
         const cell = srcPattern.getCell(ch, srcStartRow + r);
         destPattern.setCell(ch, destStartRow + r, {...cell});
      }
   }
}

// create a new pattern by extracting a row range from an existing pattern,
// then repeating that slice to fill up to maxRows (always fills all rows even if not evenly divisible)
// but that's fine; extra rows will get unused because of computeRepeatedRowCount
function createSlicedPattern(srcPattern: Pattern, startRow: number, sliceLength: number): Pattern {
   const newPattern = new Pattern();
   const maxRows = Tic80Caps.pattern.maxRows;

   // Repeat the slice to fill as much as possible
   let destRow = 0;
   while (destRow < maxRows) {
      const copyLen = Math.min(sliceLength, maxRows - destRow);
      copyPatternRows(srcPattern, startRow, copyLen, newPattern, destRow);
      destRow += copyLen;
   }
   return newPattern;
}

// compute effective rowsPerPattern when we repeat a slice to fill the max.
// want the largest multiple of sliceLength that fits in maxRows
function computeRepeatedRowCount(sliceLength: number): number {
   const maxRows = Tic80Caps.pattern.maxRows;
   const repeats = Math.floor(maxRows / sliceLength);
   return repeats > 0 ? repeats * sliceLength : sliceLength;
}

// build a song that bakes in the requested playback options.
// that means loop modes, channel muting,
// also instrument wave morphing needs some baking.
export const BakeSong = (args: BakeSongArgs): BakedSong => {
   const {
      song: originalSong,
      loopMode,
      cursorSongOrder,
      cursorRowIndex,
      patternSelection,
      audibleChannels,
      startPosition,
      startRow,
      songOrderSelection,
   } = args;

   let bakedSong = originalSong.clone();

   muteInaudibleChannels(bakedSong, audibleChannels);

   let wantSongLoop = false;
   let resultStartPosition = startPosition;
   let resultStartRow = startRow;

   // default transport conversion assumes a 1:1 mapping between the baked song
   // and the original song, with no special looping beyond what TIC-80 does.
   let somaticSongOrderLoop: BakedSong["transportConversion"]["somaticSongOrderLoop"] = null;
   let somaticPatternRowLoop: BakedSong["transportConversion"]["somaticPatternRowLoop"] = null;
   let songOrderOffset = 0;  // tic80 song order 0 maps to somatic song order 0 by default
   let patternRowOffset = 0; // tic80 row 0 maps to somatic row 0 by default
   let somaticRowsPerTic80Pattern = originalSong.rowsPerPattern;

   switch (loopMode) {
      case "off": {
         wantSongLoop = false;
         break;
      }

      case "song": {
         wantSongLoop = true;
         somaticSongOrderLoop = {
            beginSomaticSongOrder: 0,
            loopLength: originalSong.songOrder.length,
         };
         break;
      }

      case "pattern": {
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder].patternIndex;
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            // Create a song with just this one pattern
            const sliceLength = bakedSong.rowsPerPattern;
            const newPattern = createSlicedPattern(srcPattern, 0, sliceLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [new SongOrderItem({patternIndex: 0})];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(sliceLength);
         }
         resultStartPosition = 0;
         // Loop the single pattern at the current song-order position.
         somaticSongOrderLoop = {
            beginSomaticSongOrder: cursorSongOrder,
            loopLength: 1,
         };
         songOrderOffset = cursorSongOrder;
         somaticRowsPerTic80Pattern = originalSong.rowsPerPattern;
         break;
      }

      case "selectionInSongOrder": {
         wantSongLoop = true;
         if (!songOrderSelection || songOrderSelection.isNull()) {
            // no selection; behave like "song".
            break;
         }
         const rangeStart = songOrderSelection.topInclusive()!;
         const rangeSize = songOrderSelection.rowCount()!;
         if (!rangeSize) {
            break;
         }
         const selectedOrders =
            bakedSong.songOrder.slice(rangeStart, rangeStart + rangeSize).map((item) => item.patternIndex);
         const patternMap = new Map<number, number>();
         const newPatterns: Pattern[] = [];
         const newSongOrder: number[] = [];
         for (const patternIndex of selectedOrders) {
            let mappedIndex = patternMap.get(patternIndex);
            if (mappedIndex === undefined) {
               mappedIndex = newPatterns.length;
               patternMap.set(patternIndex, mappedIndex);
               const srcPattern = bakedSong.patterns[patternIndex];
               newPatterns.push(srcPattern ? srcPattern.clone() : new Pattern());
            }
            newSongOrder.push(mappedIndex);
         }
         bakedSong.patterns = newPatterns;
         bakedSong.songOrder = newSongOrder.map((pi) => new SongOrderItem({patternIndex: pi}));
         resultStartPosition = 0;
         resultStartRow = 0;
         somaticSongOrderLoop = {
            beginSomaticSongOrder: rangeStart,
            loopLength: rangeSize,
         };
         songOrderOffset = rangeStart;
         somaticRowsPerTic80Pattern = originalSong.rowsPerPattern;
         break;
      }

      case "halfPattern": {
         // Loop the half of the pattern containing the cursor row
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder].patternIndex;
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            const rowsPerPattern = bakedSong.rowsPerPattern;
            const halfLength = Math.floor(rowsPerPattern / 2);
            // Determine which half the cursor is in
            const halfIndex = Math.floor(cursorRowIndex / halfLength);
            const halfStart = halfIndex * halfLength;

            const newPattern = createSlicedPattern(srcPattern, halfStart, halfLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [new SongOrderItem({patternIndex: 0})];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(halfLength);
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         somaticSongOrderLoop = {
            beginSomaticSongOrder: cursorSongOrder,
            loopLength: 1,
         };
         somaticPatternRowLoop = {
            beginSomaticPatternRow:
               Math.max(0, cursorRowIndex - (cursorRowIndex % Math.max(1, Math.floor(bakedSong.rowsPerPattern / 2)))),
            loopLength: Math.floor(bakedSong.rowsPerPattern / 2) || originalSong.rowsPerPattern,
         };
         // For half-pattern we loop over a contiguous block starting at halfStart with length halfLength.
         songOrderOffset = cursorSongOrder;
         patternRowOffset = somaticPatternRowLoop.beginSomaticPatternRow;
         somaticRowsPerTic80Pattern = somaticPatternRowLoop.loopLength;
         break;
      }

      case "quarterPattern": {
         // Loop the quarter of the pattern containing the cursor row
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder].patternIndex;
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            const rowsPerPattern = bakedSong.rowsPerPattern;
            const quarterLength = Math.floor(rowsPerPattern / 4);
            // Determine which quarter the cursor is in
            const quarterIndex = Math.floor(cursorRowIndex / quarterLength);
            const quarterStart = quarterIndex * quarterLength;

            const newPattern = createSlicedPattern(srcPattern, quarterStart, quarterLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [new SongOrderItem({patternIndex: 0})];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(quarterLength);
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         somaticSongOrderLoop = {
            beginSomaticSongOrder: cursorSongOrder,
            loopLength: 1,
         };
         somaticPatternRowLoop = {
            beginSomaticPatternRow:
               Math.max(0, cursorRowIndex - (cursorRowIndex % Math.max(1, Math.floor(bakedSong.rowsPerPattern / 4)))),
            loopLength: Math.floor(bakedSong.rowsPerPattern / 4) || originalSong.rowsPerPattern,
         };
         songOrderOffset = cursorSongOrder;
         patternRowOffset = somaticPatternRowLoop.beginSomaticPatternRow;
         somaticRowsPerTic80Pattern = somaticPatternRowLoop.loopLength;
         break;
      }

      case "selectionInPattern": {
         // Loop the selected rows within the pattern
         wantSongLoop = true;
         songOrderOffset = cursorSongOrder;

         const patternIndex = bakedSong.songOrder[cursorSongOrder].patternIndex;
         const srcPattern = bakedSong.patterns[patternIndex];

         if (srcPattern && patternSelection) {
            // Use the Y dimension of the selection for row range
            const selTop = patternSelection.topInclusive() ?? 0;
            const selBottom = patternSelection.bottomInclusive() ?? (bakedSong.rowsPerPattern - 1);
            const selectionRowCount = selBottom - selTop + 1;

            const newPattern = createSlicedPattern(srcPattern, selTop, selectionRowCount);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [new SongOrderItem({patternIndex: 0})];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(selectionRowCount);
            somaticPatternRowLoop = {
               beginSomaticPatternRow: selTop,
               loopLength: selectionRowCount,
            };
            patternRowOffset = selTop;
            somaticRowsPerTic80Pattern = selectionRowCount;
         } else {
            // No selection - fall back to current pattern
            if (srcPattern) {
               const sliceLength = bakedSong.rowsPerPattern;
               const newPattern = createSlicedPattern(srcPattern, 0, sliceLength);
               bakedSong.patterns = [newPattern];
               bakedSong.songOrder = [new SongOrderItem({patternIndex: 0})];
               bakedSong.rowsPerPattern = computeRepeatedRowCount(sliceLength);
            }
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         somaticSongOrderLoop = {
            beginSomaticSongOrder: cursorSongOrder,
            loopLength: 1,
         };
         break;
      }

      default: {
         throw new Error(`Unknown loop mode: ${loopMode}`);
      }
   }

   // for all morphing or PWM waveform instruments, set their native waveform envelope to the "morph wave slot"
   for (const instrument of bakedSong.instruments) {
      if (!instrument.isKRateProcessing()) {
         continue;
      }
      instrument.waveLoopLength = 0;
      instrument.waveLoopStart = 0;
      for (let i = 0; i < Tic80Caps.sfx.envelopeFrameCount; i++) {
         instrument.waveFrames[i] = instrument.renderWaveformSlot;
      }
   }

   return {
      bakedSong,
      wantSongLoop,
      startPosition: resultStartPosition,
      startRow: resultStartRow,
      transportConversion: {
         somaticSongOrderLoop,
         somaticPatternRowLoop,
         songOrderOffset,
         patternRowOffset,
         somaticRowsPerTic80Pattern,
      },
   };
};



export function convertTic80MusicStateToSomatic(
   bakedSong: BakedSong, musicState: Tic80TransportState): SomaticTransportState {
   const backendState = musicState;
   const conv = bakedSong.transportConversion;

   const somaticState: SomaticTransportState = {
      backendState,
      isPlaying: backendState.isPlaying,
      somaticSongOrderLoop: conv.somaticSongOrderLoop ? {
         beginSongOrder: conv.somaticSongOrderLoop.beginSomaticSongOrder,
         length: conv.somaticSongOrderLoop.loopLength,
      } :
                                                        null,
      somaticPatternRowLoop: conv.somaticPatternRowLoop ? {
         beginPatternRow: conv.somaticPatternRowLoop.beginSomaticPatternRow,
         length: conv.somaticPatternRowLoop.loopLength,
      } :
                                                          null, // clang-format why?
      currentSomaticSongPosition: null,
      currentSomaticRowIndex: null,
   };

   if (!backendState.isPlaying) {
      return somaticState;
   }

   const totalOrders = bakedSong.bakedSong.songOrder.length;
   const rowsPerPattern = bakedSong.bakedSong.rowsPerPattern;

   // Map TIC-80 song position back to somatic song order.
   const orderIdx = backendState.reportedSongPosition;
   somaticState.currentSomaticSongPosition = conv.songOrderOffset + orderIdx;

   // Map TIC-80 row index back to somatic pattern row.
   let rowIdx = backendState.tic80RowIndex;
   rowIdx = ((rowIdx % rowsPerPattern) + rowsPerPattern) % rowsPerPattern;

   if (conv.somaticPatternRowLoop) {
      const loopLen = conv.somaticPatternRowLoop.loopLength || conv.somaticRowsPerTic80Pattern || rowsPerPattern;
      const posInLoop = rowIdx % loopLen;
      somaticState.currentSomaticRowIndex = conv.somaticPatternRowLoop.beginSomaticPatternRow + posInLoop;
   } else {
      const baseLen = conv.somaticRowsPerTic80Pattern || rowsPerPattern;
      const posInBase = rowIdx % baseLen;
      somaticState.currentSomaticRowIndex = conv.patternRowOffset + posInBase;
   }

   return somaticState;
};