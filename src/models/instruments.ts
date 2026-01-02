// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
import {clamp, CoalesceBoolean} from "../utils/utils";
import {Tic80Caps} from "./tic80Capabilities";
import {WaveformBaseDto} from "./waveform";

export type SomaticInstrumentWaveEngine = "morph"|"native"|"pwm";

export type ModSource = "envelope"|"lfo";

export type SomaticWaveformEffect = "none"|"lowpass"|"wavefold";

export type SomaticEffectKind = "none"|"wavefold"|"hardSync";

export interface WaveformMorphGradientNodeDto extends WaveformBaseDto {
   durationSeconds: number;
   curveN11: number; // -1..+1
}
;

export type WaveformMorphGradientNode = {
   amplitudes: Uint8Array; // length = 32, values 0-15
   durationSeconds: number;
   curveN11: number;
};

function coerceWaveEngine(v: any): SomaticInstrumentWaveEngine {
   if (v === "morph" || v === "native" || v === "pwm")
      return v;
   if (v === 0)
      return "morph";
   if (v === 1)
      return "native";
   if (v === 2)
      return "pwm";
   return "native";
}

function coerceModSource(v: any): ModSource {
   if (v === "lfo" || v === 1 || v === true)
      return "lfo";
   return "envelope";
}

function coerceEffectKind(v: any, fallback: SomaticEffectKind): SomaticEffectKind {
   if (v === "none" || v === "wavefold" || v === "hardSync")
      return v;
   if (v === 1)
      return "wavefold";
   if (v === 2)
      return "hardSync";
   return fallback;
}

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
   renderWaveformSlot: number;  // 0-15 -- which waveform slot to use for live k-rate processing.

   // Morph wave engine: a per-instrument gradient of waveforms.
   // When waveEngine != "morph", this should be empty or undefined.
   morphGradientNodes?: WaveformMorphGradientNodeDto[];

   pwmDuty: number;  // 0-31
   pwmDepth: number; // 0-31

   lowpassEnabled: boolean;
   lowpassDurationSeconds: number;
   lowpassCurveN11: number;

   effectKind: SomaticEffectKind;
   effectAmount: number; // wavefold: 0-255; hardSync: multiplier 1-8
   effectDurationSeconds: number;
   effectCurveN11: number;
   effectModSource: ModSource;

   lfoRateHz: number;
   lowpassModSource: ModSource;
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
   renderWaveformSlot: number;  // 0-15 -- which waveform slot to use for live k-rate processing. used for PWM as well!
   morphGradientNodes: WaveformMorphGradientNode[];

   pwmDuty: number;  // 0-31
   pwmDepth: number; // 0-31

   lowpassEnabled: boolean;
   lowpassDurationSeconds: number;
   lowpassCurveN11: number;

   effectKind: SomaticEffectKind;
   effectAmount: number; // wavefold: 0-255; hardSync: 1-8 multiplier
   effectDurationSeconds: number;
   effectCurveN11: number;
   effectModSource: ModSource;

   lfoRateHz: number;
   lowpassModSource: ModSource;


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

      this.waveEngine = coerceWaveEngine(data.waveEngine ?? "native");
      this.sourceWaveformIndex = clamp(data.sourceWaveformIndex ?? 0, 0, Tic80Caps.waveform.count - 1);
      this.renderWaveformSlot = clamp(data.renderWaveformSlot ?? 15, 0, Tic80Caps.waveform.count - 1);

      const rawGradient = data.morphGradientNodes ?? [];
      if (!Array.isArray(rawGradient))
         throw new Error("morphGradientNodes must be an array");
      this.morphGradientNodes = rawGradient.map((n) => {
         const ampsIn = Array.isArray(n?.amplitudes) ? n!.amplitudes : [];
         const amps = new Uint8Array(Tic80Caps.waveform.pointCount);
         for (let i = 0; i < amps.length; i++) {
            const v = Number.isFinite(ampsIn[i] as number) ? (ampsIn[i] as number) : 0;
            amps[i] = clamp(Math.trunc(v), 0, Tic80Caps.waveform.amplitudeRange - 1);
         }
         return {
            amplitudes: amps,
            durationSeconds: Math.max(0, n?.durationSeconds ?? 0),
            curveN11: clamp(n?.curveN11 ?? 0, -1, 1),
         };
      });

      this.pwmDuty = clamp(data.pwmDuty ?? 16, 0, 31);
      this.pwmDepth = clamp(data.pwmDepth ?? 10, 0, 31);

      this.lowpassEnabled = CoalesceBoolean(data.lowpassEnabled, false);
      this.lowpassDurationSeconds = Math.max(0, data.lowpassDurationSeconds ?? 0.5);
      this.lowpassCurveN11 = clamp(data.lowpassCurveN11 ?? 0, -1, 1);

      const legacyWavefoldAmt = clamp((data as any).wavefoldAmt ?? 0, 0, 255);
      const legacyWavefoldDur = Math.max(0, (data as any).wavefoldDurationSeconds ?? 0);
      const legacyWavefoldCurve = clamp((data as any).wavefoldCurveN11 ?? 0, -1, 1);
      const legacyHardSyncEnabled = CoalesceBoolean((data as any).hardSyncEnabled, false);
      const legacyHardSyncStrength = clamp((data as any).hardSyncStrength ?? 3, 1, 8);
      const legacyHardSyncDecay = Math.max(0, (data as any).hardSyncDecaySeconds ?? 1.5);
      const legacyHardSyncCurve = clamp((data as any).hardSyncCurveN11 ?? 0, -1, 1);
      const legacyWavefoldModSourceRaw = (data as any).wavefoldModSource;
      const legacyHardSyncModSourceRaw = (data as any).hardSyncModSource;
      const legacyWavefoldModSource =
         legacyWavefoldModSourceRaw === undefined ? undefined : coerceModSource(legacyWavefoldModSourceRaw);
      const legacyHardSyncModSource =
         legacyHardSyncModSourceRaw === undefined ? undefined : coerceModSource(legacyHardSyncModSourceRaw);

      const legacyEffectKind = legacyWavefoldAmt > 0 ? "wavefold" : (legacyHardSyncEnabled ? "hardSync" : "none");
      const requestedEffectKind = coerceEffectKind(data.effectKind, legacyEffectKind);
      this.effectKind = requestedEffectKind;
      if (this.effectKind === "wavefold") {
         this.effectAmount = clamp(data.effectAmount ?? legacyWavefoldAmt ?? 0, 0, 255);
         this.effectDurationSeconds = Math.max(0, data.effectDurationSeconds ?? legacyWavefoldDur ?? 0);
         this.effectCurveN11 = clamp(data.effectCurveN11 ?? legacyWavefoldCurve ?? 0, -1, 1);
         this.effectModSource = coerceModSource(data.effectModSource ?? legacyWavefoldModSource ?? "envelope");
      } else if (this.effectKind === "hardSync") {
         this.effectAmount = clamp(data.effectAmount ?? legacyHardSyncStrength ?? 3, 1, 8);
         this.effectDurationSeconds = Math.max(0, data.effectDurationSeconds ?? legacyHardSyncDecay ?? 1.5);
         this.effectCurveN11 = clamp(data.effectCurveN11 ?? legacyHardSyncCurve ?? 0, -1, 1);
         this.effectModSource = coerceModSource(data.effectModSource ?? legacyHardSyncModSource ?? "lfo");
      } else {
         this.effectAmount = clamp(data.effectAmount ?? 0, 0, 255);
         this.effectDurationSeconds = Math.max(0, data.effectDurationSeconds ?? 0);
         this.effectCurveN11 = clamp(data.effectCurveN11 ?? 0, -1, 1);
         this.effectModSource = coerceModSource(data.effectModSource ?? "envelope");
      }

      const legacyPwmSpeedHz = (data as any).pwmSpeedHz;
      const legacyLfoRate = (data as any).lfoRateHz ?? (data as any).lfoHz;
      const inferredLfoRate = data.lfoRateHz ?? legacyPwmSpeedHz ?? legacyLfoRate ?? 2;
      this.lfoRateHz = Math.max(0, inferredLfoRate);
      this.lowpassModSource = coerceModSource(data.lowpassModSource ?? "envelope");
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
         renderWaveformSlot: this.renderWaveformSlot,
         morphGradientNodes: this.morphGradientNodes.map((n) => ({
                                                            amplitudes: [...n.amplitudes],
                                                            durationSeconds: n.durationSeconds,
                                                            curveN11: n.curveN11,
                                                         })),
         pwmDuty: this.pwmDuty,
         pwmDepth: this.pwmDepth,
         lowpassEnabled: this.lowpassEnabled,
         lowpassDurationSeconds: this.lowpassDurationSeconds,
         lowpassCurveN11: this.lowpassCurveN11,
         effectKind: this.effectKind,
         effectAmount: this.effectAmount,
         effectDurationSeconds: this.effectDurationSeconds,
         effectCurveN11: this.effectCurveN11,
         effectModSource: this.effectModSource,
         lfoRateHz: this.lfoRateHz,
         lowpassModSource: this.lowpassModSource,
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

   getIndexString(myIndex: number): string {
      return myIndex.toString(16).toUpperCase().padStart(2, "0");
   }

   // use <InstrumentChip> to render instrument name in UI.
   getCaption(myIndex: number): string {
      const indexString = this.getIndexString(myIndex);
      return `${indexString}: ${this.name}${this.isKRateProcessing() ? " [K-rate]" : ""}`;
   }

   isKRateProcessing(): boolean {
      if (this.waveEngine === "morph" || this.waveEngine === "pwm") {
         return true;
      }
      if (this.lowpassEnabled) {
         return true;
      }
      if (this.effectKind !== "none") {
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
            // Morph gradients embed their waveforms per-instrument; they do not consume global TIC-80 waveform slots.
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
      this.waveFrames = this.waveFrames.map((waveIdx) => {
         return waveformRemap.get(waveIdx) ?? waveIdx;
      });
   }
}
