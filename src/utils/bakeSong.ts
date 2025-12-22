import {LoopMode} from "../audio/backend";
import {Tic80SerializeSongArgs} from "../audio/tic80_cart_serializer";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {Song} from "../models/song";
import {Tic80ChannelIndex} from "../models/tic80Capabilities";

export interface BakeSongArgs {
   song: Song;
   loopMode: LoopMode;
   cursorSongOrder: number,                  //
      cursorChannelIndex: Tic80ChannelIndex, //
      cursorRowIndex: number,
      patternSelection: SelectionRect2D|null, //
      audibleChannels: Set<Tic80ChannelIndex>,
      startPosition: number, //
      startRow: number,
}

export type BakedSong = {
   bakedSong: Song;       //
   wantSongLoop: boolean; // true in order to honor the song loop mode
   startPosition: number;
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
