import {LoopMode} from "../audio/backend";
import {Tic80SerializeSongArgs} from "../audio/tic80_cart_serializer";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {gChannelsArray, Tic80Caps, Tic80ChannelIndex} from "../models/tic80Capabilities";
import {Pattern, PatternCell} from "../models/pattern";
import {Song} from "../models/song";

export interface BakeSongArgs {
   song: Song;              // the full song being edited
   loopMode: LoopMode;      // the style of loop playback requested by the user
   cursorSongOrder: number; // the "current pattern" is the one pointed to by this song order position.

   // if loopMode is "selectionInSongOrder", this indicates the selected song order range (use only the Y(row) selection; there are no columns (x) selected.)
   songOrderSelection: SelectionRect2D|null;

   cursorChannelIndex: Tic80ChannelIndex; // which channel the cursor is on (i think this is ignored for baking)
   cursorRowIndex: number;                // which row the cursor is on (used for half/quarter pattern loop modes)

   // if loopMode is "selectionInPattern", this indicates the selected pattern range.
   patternSelection: SelectionRect2D|null;

   audibleChannels: Set<Tic80ChannelIndex>; // which channels are audible (not muted)

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

function muteInaudibleChannels(song: Song, audibleChannels: Set<Tic80ChannelIndex>): void {
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

   switch (loopMode) {
      case "off": {
         wantSongLoop = false;
         break;
      }

      case "song": {
         wantSongLoop = true;
         break;
      }

      case "pattern": {
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder];
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            // Create a song with just this one pattern
            const sliceLength = bakedSong.rowsPerPattern;
            const newPattern = createSlicedPattern(srcPattern, 0, sliceLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [0];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(sliceLength);
         }
         resultStartPosition = 0;
         // Keep startRow as requested (user may have clicked "play from row")
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
         const selectedOrders = bakedSong.songOrder.slice(rangeStart, rangeStart + rangeSize);
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
         bakedSong.songOrder = newSongOrder;
         resultStartPosition = 0;
         resultStartRow = 0;
         break;
      }

      case "halfPattern": {
         // Loop the half of the pattern containing the cursor row
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder] ?? 0;
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            const rowsPerPattern = bakedSong.rowsPerPattern;
            const halfLength = Math.floor(rowsPerPattern / 2);
            // Determine which half the cursor is in
            const halfIndex = Math.floor(cursorRowIndex / halfLength);
            const halfStart = halfIndex * halfLength;

            const newPattern = createSlicedPattern(srcPattern, halfStart, halfLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [0];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(halfLength);
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         break;
      }

      case "quarterPattern": {
         // Loop the quarter of the pattern containing the cursor row
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder] ?? 0;
         const srcPattern = bakedSong.patterns[patternIndex];
         if (srcPattern) {
            const rowsPerPattern = bakedSong.rowsPerPattern;
            const quarterLength = Math.floor(rowsPerPattern / 4);
            // Determine which quarter the cursor is in
            const quarterIndex = Math.floor(cursorRowIndex / quarterLength);
            const quarterStart = quarterIndex * quarterLength;

            const newPattern = createSlicedPattern(srcPattern, quarterStart, quarterLength);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [0];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(quarterLength);
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         break;
      }

      case "selectionInPattern": {
         // Loop the selected rows within the pattern
         wantSongLoop = true;

         const patternIndex = bakedSong.songOrder[cursorSongOrder] ?? 0;
         const srcPattern = bakedSong.patterns[patternIndex];

         if (srcPattern && patternSelection) {
            // Use the Y dimension of the selection for row range
            const selTop = patternSelection.topInclusive() ?? 0;
            const selBottom = patternSelection.bottomInclusive() ?? (bakedSong.rowsPerPattern - 1);
            const selectionRowCount = selBottom - selTop + 1;

            const newPattern = createSlicedPattern(srcPattern, selTop, selectionRowCount);
            bakedSong.patterns = [newPattern];
            bakedSong.songOrder = [0];
            bakedSong.rowsPerPattern = computeRepeatedRowCount(selectionRowCount);
         } else {
            // No selection - fall back to current pattern
            if (srcPattern) {
               const sliceLength = bakedSong.rowsPerPattern;
               const newPattern = createSlicedPattern(srcPattern, 0, sliceLength);
               bakedSong.patterns = [newPattern];
               bakedSong.songOrder = [0];
               bakedSong.rowsPerPattern = computeRepeatedRowCount(sliceLength);
            }
         }
         resultStartPosition = 0;
         resultStartRow = 0;
         break;
      }

      default: {
         throw new Error(`Unknown loop mode: ${loopMode}`);
      }
   }

   return {
      bakedSong,
      wantSongLoop,
      startPosition: resultStartPosition,
      startRow: resultStartRow,
   };
};
