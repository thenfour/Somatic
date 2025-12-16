import {Tic80Instrument} from "../models/instruments";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80ChannelIndex} from "../models/tic80Capabilities";

export type BackendEmitters = {
   row: (rowNumber: number, pattern: Pattern) => void; //
   position: (positionNumber: number) => void;         //
   stop: () => void;                                   //
};

export type MusicState = {
   chromaticPatternIndex: number; //
   chromaticSongPosition: number; //
   tic80TrackIndex: number;       //
   tic80FrameIndex: number;       //
   tic80RowIndex: number;         //
   isLooping: boolean;            //
};

export function MakeEmptyMusicState(): MusicState{
   return {
      chromaticPatternIndex: 0,    //
         chromaticSongPosition: 0, //
         tic80TrackIndex: -1,      //
         tic80FrameIndex: 0,       //
         tic80RowIndex: 0,         //
         isLooping: false,         //
   }
};

export interface AudioBackend {
   setSong(song: Song|null): void|Promise<void>;
   getMusicState(): MusicState;
   sfxNoteOn(instrumentIndex: number, instrument: Tic80Instrument, midiNote: number, channel: Tic80ChannelIndex):
      void|Promise<void>;
   sfxNoteOff(channel: Tic80ChannelIndex): void|Promise<void>;
   playRow(pattern: Pattern, rowNumber: number): void|Promise<void>;
   playPattern(pattern: Pattern): void|Promise<void>;
   playSong(startPosition: number): void|Promise<void>;
   stop(): void|Promise<void>;
}

export interface BackendContext {
   emit: BackendEmitters;
}
