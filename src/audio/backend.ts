
export type LoopMode =     //
   |"off"                  //
   |"song"                 //
   |"selectionInPattern"   //
   |"selectionInSongOrder" //
   |"pattern"              //
   |"halfPattern"          //
   |"quarterPattern"       //
   ;

// this is a high-frequency polled state of the music playback so don't include much
// this is the state as reported by the TIC-80 backend and needs to be converted to frontend state.
export type Tic80TransportState = {
   reportedSongPosition:
      number; // this is NOT the one in our arrangement editor; it's the one that the TIC80 is reporting from our playroutine.
   isPlaying: boolean;
   tic80RowIndex: number; //
};


export function MakeEmptyTic80TransportState(): Tic80TransportState{
   return {
      reportedSongPosition: 0, //
         isPlaying: false,     //
         tic80RowIndex: 0,     //
   }
};


export type SomaticTransportState = {
   backendState: Tic80TransportState; //
   isPlaying: boolean;                //
   somaticSongOrderLoop: null |
      {
         beginSongOrder: number;
         length: number;
      },
   somaticPatternRowLoop: null |
      {
         beginPatternRow: number;
         length: number;
      },
   currentSomaticSongPosition: number | null; //
   currentSomaticRowIndex: number | null;     //
};

export const MakeEmptySomaticTransportState = (): SomaticTransportState => {
   return {
      backendState: MakeEmptyTic80TransportState(), //
      isPlaying: false,                             //
      somaticSongOrderLoop: null,
      somaticPatternRowLoop: null,
      currentSomaticSongPosition: null, //
      currentSomaticRowIndex: null,     //
   };
}