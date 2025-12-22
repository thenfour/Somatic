
export type LoopMode =|"off"|"song"|"selection"|"pattern"|"wholePattern"|"halfPattern"|"quarterPattern";

export type MusicState = {
   //somaticPatternIndex: number; //
   somaticSongPosition: number; //
   isPlaying: boolean;          //
   tic80TrackIndex: number;     //
   tic80FrameIndex: number;     //
   tic80RowIndex: number;       //
   isLooping: boolean;          //
};

export function MakeEmptyMusicState(): MusicState{
   return {
      somaticSongPosition: 0, //
         isPlaying: false,    //
         tic80TrackIndex: -1, //
         tic80FrameIndex: 0,  //
         tic80RowIndex: 0,    //
         isLooping: false,    //
   }
};
