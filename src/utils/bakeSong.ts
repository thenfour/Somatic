import {LoopMode} from "../audio/backend";
import {Tic80SerializeSongArgs} from "../audio/tic80_cart_serializer";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {Song} from "../models/song";
import {Tic80ChannelIndex} from "../models/tic80Capabilities";

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
export const BakeSong = (args: Tic80SerializeSongArgs): BakedSong => {
   return {
      bakedSong: args.song,
      wantSongLoop: args.loopMode === "song",
      startPosition: args.startPosition,
      startRow: args.startRow,
   };
};
