// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
import {clamp, CoalesceBoolean} from "../utils/utils";
import {Tic80Caps} from "./tic80Capabilities";

// per frame
// u8 volume:4;
// u8 wave index:4;
// u8 chord:4; // aka arpeggio
// s8 pitch:4;

// sfx data layout (after frames)
// u8 octave:3;
// u8 pitch16x:1; // pitch factor
// s8 speed:SFX_SPEED_BITS;
// u8 reverse:1; // chord reverse
// u8 note:4;
// u8 stereo_left:1;
// u8 stereo_right:1;
// u8 temp:2;


//export const SFX_FRAME_COUNT = 30;

export interface Tic80InstrumentDto {
   name: string;

   speed: number; // 0-7

   // this is tic_sample.note in tic.h
   // 0-11, semitones within the octave. this is combined with 'octave' to get the actual note played.
   // 0 = note C, 1 = C#, ... 11 = B.
   baseNote: number;
   octave: number; // 0-7
   stereoLeft: boolean;
   stereoRight: boolean;

   // volume envelope
   volumeFrames: number[];   // volume frames (0-15)
   volumeLoopStart: number;  // 0-29
   volumeLoopLength: number; // 0-29

   // arpeggio frames
   arpeggioFrames: number[];   // arpeggio frames (0-15)
   arpeggioLoopStart: number;  // 0-29
   arpeggioLoopLength: number; // 0-29
   arpeggioDown: boolean;      // aka "reverse"

   // waveform id frames
   waveFrames: number[];   // waveform id frames (0-15)
   waveLoopStart: number;  // 0-29
   waveLoopLength: number; // 0-29

   // pitch frames
   pitchFrames: number[];   // pitch frames (-8 to +7)
   pitchLoopStart: number;  // 0-29
   pitchLoopLength: number; // 0-29
   pitch16x: boolean;
}
;

// aka "SFX" aka "sample" (from tic.h / sound.c)
export class Tic80Instrument {
   name: string;

   speed: number;    // 0-7
   baseNote: number; // 0-15
   octave: number;   // 0-7
   stereoLeft: boolean;
   stereoRight: boolean;

   // volume envelope
   volumeFrames: Int8Array;  // volume frames (0-15)
   volumeLoopStart: number;  // 0-29
   volumeLoopLength: number; // 0-29

   // arpeggio frames
   arpeggioFrames: Int8Array;  // arpeggio frames (0-15)
   arpeggioLoopStart: number;  // 0-29
   arpeggioLoopLength: number; // 0-29
   arpeggioDown: boolean;

   // waveform id frames
   waveFrames: Int8Array;
   waveLoopStart: number;  // 0-29
   waveLoopLength: number; // 0-29

   // pitch frames
   pitchFrames: Int8Array;
   pitchLoopStart: number;  // 0-29
   pitchLoopLength: number; // 0-29
   pitch16x: boolean;

   // editor-only...
   constructor(data: Partial<Tic80InstrumentDto> = {}) {
      this.name = data.name ?? "";

      this.speed = clamp(data.speed ?? 3, 0, Tic80Caps.sfx.speedMax);

      // because this is a tracker, you'll never trigger an sfx using its base note. it's always specified
      // in pattern data. therefore baseNote & octave are actually ignored.
      this.baseNote = clamp(data.baseNote ?? 0, 0, 11);
      this.octave = clamp(data.octave ?? 4, 0, 7);

      this.stereoLeft = CoalesceBoolean(data.stereoLeft, true);
      this.stereoRight = CoalesceBoolean(data.stereoRight, true);

      this.volumeFrames =
         data.volumeFrames ? new Int8Array(data.volumeFrames) : new Int8Array(Tic80Caps.sfx.envelopeFrameCount);
      // sanitize volume frames.
      // ensure correct # of frames
      if (this.volumeFrames.length < Tic80Caps.sfx.envelopeFrameCount) {
         const newFrames = new Int8Array(Tic80Caps.sfx.envelopeFrameCount);
         newFrames.set(this.volumeFrames);
         this.volumeFrames = newFrames;
      }
      // if data.volumeFrames is not specified, seed with defaults (all max volume sustaining pitch).
      if (!data.volumeFrames) {
         for (let i = 0; i < Tic80Caps.sfx.envelopeFrameCount; i++) {
            this.volumeFrames[i] = 15;
         }
      }

      this.volumeLoopStart = clamp(data.volumeLoopStart ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.volumeLoopLength = clamp(data.volumeLoopLength ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);

      this.arpeggioFrames =
         data.arpeggioFrames ? new Int8Array(data.arpeggioFrames) : new Int8Array(Tic80Caps.sfx.envelopeFrameCount);
      this.arpeggioLoopStart = clamp(data.arpeggioLoopStart ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.arpeggioLoopLength = clamp(data.arpeggioLoopLength ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.arpeggioDown = CoalesceBoolean(data.arpeggioDown, false);

      this.waveFrames =
         data.waveFrames ? new Int8Array(data.waveFrames) : new Int8Array(Tic80Caps.sfx.envelopeFrameCount);
      this.waveLoopStart = clamp(data.waveLoopStart ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.waveLoopLength = clamp(data.waveLoopLength ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);

      this.pitchFrames =
         data.pitchFrames ? new Int8Array(data.pitchFrames) : new Int8Array(Tic80Caps.sfx.envelopeFrameCount);
      // default values for pitch frames
      if (!data.pitchFrames) {
         for (let i = 0; i < Tic80Caps.sfx.envelopeFrameCount; i++) {
            this.pitchFrames[i] = -Tic80Caps.sfx.pitchMin;
         }
      }
      this.pitchLoopStart = clamp(data.pitchLoopStart ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.pitchLoopLength = clamp(data.pitchLoopLength ?? 0, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      this.pitch16x = CoalesceBoolean(data.pitch16x, false);
   }

   static fromData(data?: Partial<Tic80InstrumentDto>): Tic80Instrument {
      return new Tic80Instrument(data || {});
   }

   toData(): Tic80InstrumentDto {
      return {
         name: this.name,

         speed: this.speed,
         baseNote: this.baseNote,
         octave: this.octave,
         stereoLeft: this.stereoLeft,
         stereoRight: this.stereoRight,
         volumeFrames: [...this.volumeFrames],
         volumeLoopStart: this.volumeLoopStart,
         volumeLoopLength: this.volumeLoopLength,
         arpeggioFrames: [...this.arpeggioFrames],
         arpeggioLoopStart: this.arpeggioLoopStart,
         arpeggioLoopLength: this.arpeggioLoopLength,
         arpeggioDown: this.arpeggioDown,
         waveFrames: [...this.waveFrames],
         waveLoopStart: this.waveLoopStart,
         waveLoopLength: this.waveLoopLength,
         pitchFrames: [...this.pitchFrames],
         pitchLoopStart: this.pitchLoopStart,
         pitchLoopLength: this.pitchLoopLength,
         pitch16x: this.pitch16x,
      };
   };

   clone(): Tic80Instrument {
      return new Tic80Instrument(this.toData());
   }

   contentSignature(): string {
      const dto = this.toData();
      const {name, ...content} = dto;
      return JSON.stringify(content);
   }

   getCaption(myIndex: number): string {
      return `${myIndex.toString(16).toUpperCase()}: ${this.name}`;
   }
}
