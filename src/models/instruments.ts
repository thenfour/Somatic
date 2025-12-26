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

export type SomaticInstrumentWaveEngine = "morph"|"native"|"pwm";

export type SomaticWaveformEffect = "none"|"lowpass"|"wavefold";

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

   waveEngine: SomaticInstrumentWaveEngine;

   sourceWaveformIndex: number; // 0-15 (used as morph A for morph engine; used as source for native+effects)
   morphWaveB: number;          // 0-15
   renderWaveformSlot: number;  // 0-15 -- which waveform slot to use for live k-rate processing.
   morphCurveN11: number;       // -1 to +1; 0 = linear. -1 = fast start, slow end; +1 = slow start, fast end
   morphDurationSeconds: number;

   pwmSpeedHz: number;
   pwmDuty: number;    // 0-31
   pwmDepth: number;   // 0-31
   pwmPhase01: number; // 0-1; phase offset for PWM duty-cycle modulation

   lowpassEnabled: boolean;
   lowpassDurationSeconds: number;
   lowpassCurveN11: number;

   wavefoldAmt: number; // 0-255 amplifies the waveform, folding it back into the valid range
   wavefoldDurationSeconds: number;
   wavefoldCurveN11: number;

   // hardSyncEnabled: boolean;     // not implemented
   // hardSyncStrength: number;     // not implemented
   // hardSyncDecaySeconds: number; // not implemented
   // hardSyncCurveN11: number;
}

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

   waveEngine: SomaticInstrumentWaveEngine;
   sourceWaveformIndex: number; // 0-15
   morphWaveB: number;          // 0-15
   renderWaveformSlot: number;  // 0-15 -- which waveform slot to use for live k-rate processing. used for PWM as well!
   morphCurveN11: number;
   morphDurationSeconds: number;

   pwmSpeedHz: number;
   pwmDuty: number;    // 0-31
   pwmDepth: number;   // 0-31
   pwmPhase01: number; // 0-1

   lowpassEnabled: boolean;
   lowpassDurationSeconds: number;
   lowpassCurveN11: number;

   // wavefold
   wavefoldAmt: number; // 0-255
   wavefoldDurationSeconds: number;
   wavefoldCurveN11: number;


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

      this.waveEngine = data.waveEngine ?? "native";
      // Back-compat: older saved data used 'morphWaveA'.
      const legacyMorphWaveA = (data as any).morphWaveA;
      this.sourceWaveformIndex =
         clamp(data.sourceWaveformIndex ?? legacyMorphWaveA ?? 0, 0, Tic80Caps.waveform.count - 1);
      this.morphWaveB = clamp(data.morphWaveB ?? 1, 0, Tic80Caps.waveform.count - 1);
      this.renderWaveformSlot = clamp(data.renderWaveformSlot ?? 15, 0, Tic80Caps.waveform.count - 1);
      this.morphCurveN11 = clamp(data.morphCurveN11 ?? 0, -1, 1);
      this.morphDurationSeconds = Math.max(0, data.morphDurationSeconds ?? 1.0);

      this.pwmSpeedHz = Math.max(0, data.pwmSpeedHz ?? 0);
      this.pwmDuty = clamp(data.pwmDuty ?? 16, 0, 31);
      this.pwmDepth = clamp(data.pwmDepth ?? 8, 0, 31);
      this.pwmPhase01 = clamp(data.pwmPhase01 ?? 0, 0, 1);

      this.lowpassEnabled = CoalesceBoolean(data.lowpassEnabled, false);
      this.lowpassDurationSeconds = Math.max(0, data.lowpassDurationSeconds ?? 0.5);
      this.lowpassCurveN11 = clamp(data.lowpassCurveN11 ?? 0, -1, 1);

      this.wavefoldAmt = clamp(data.wavefoldAmt ?? 0, 0, 255);
      // 0 means "no decay" (constant max strength), preserving legacy behavior.
      this.wavefoldDurationSeconds = Math.max(0, data.wavefoldDurationSeconds ?? 0);
      this.wavefoldCurveN11 = clamp(data.wavefoldCurveN11 ?? 0, -1, 1);
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
         waveEngine: this.waveEngine,
         sourceWaveformIndex: this.sourceWaveformIndex,
         morphWaveB: this.morphWaveB,
         renderWaveformSlot: this.renderWaveformSlot,
         morphCurveN11: this.morphCurveN11,
         morphDurationSeconds: this.morphDurationSeconds,
         pwmSpeedHz: this.pwmSpeedHz,
         pwmDuty: this.pwmDuty,
         pwmDepth: this.pwmDepth,
         pwmPhase01: this.pwmPhase01,
         lowpassEnabled: this.lowpassEnabled,
         lowpassDurationSeconds: this.lowpassDurationSeconds,
         lowpassCurveN11: this.lowpassCurveN11,
         wavefoldAmt: this.wavefoldAmt,
         wavefoldDurationSeconds: this.wavefoldDurationSeconds,
         wavefoldCurveN11: this.wavefoldCurveN11,
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

   isKRateProcessing(): boolean {
      if (this.waveEngine === "morph" || this.waveEngine === "pwm") {
         return true;
      }
      if (this.lowpassEnabled) {
         return true;
      }
      if (this.wavefoldAmt > 0) {
         return true;
      }
      return false;
   }

   getUsedWaveformIndices(): Set<number> {
      const usedWaveforms = new Set<number>();
      if (this.isKRateProcessing()) {
         usedWaveforms.add(this.renderWaveformSlot);
      }
      switch (this.waveEngine) {
         case "morph":
            usedWaveforms.add(this.sourceWaveformIndex);
            usedWaveforms.add(this.morphWaveB);
            break;
         case "native":
            if (this.isKRateProcessing()) {
               usedWaveforms.add(this.sourceWaveformIndex);
            } else {
               this.waveFrames.forEach((waveIdx) => {
                  usedWaveforms.add(waveIdx);
               });
            }
            break;
         case "pwm":
            break;
      };
      return usedWaveforms;
   }

   remapWaveformIndices(waveformRemap: Map<number, number>) {
      this.renderWaveformSlot = waveformRemap.get(this.renderWaveformSlot) ?? this.renderWaveformSlot;
      this.sourceWaveformIndex = waveformRemap.get(this.sourceWaveformIndex) ?? this.sourceWaveformIndex;
      this.morphWaveB = waveformRemap.get(this.morphWaveB) ?? this.morphWaveB;
      this.waveFrames = this.waveFrames.map((waveIdx) => {
         return waveformRemap.get(waveIdx) ?? waveIdx;
      });
   }
}
