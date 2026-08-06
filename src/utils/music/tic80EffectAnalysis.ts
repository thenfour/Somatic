import {linearGainToDecibels} from "./dsp";
import {
   TIC80_EFFECT_TICK_RATE_HZ,
   tic80EffectTicksToSeconds,
} from "./tic80Music";
import {
   tic80AnalyzePitchOffset,
   tic80FrequencyRegisterForPatternMidiNote,
} from "./tic80Pitch";


export const TIC80_STEREO_VOLUME_MAX = 15;

export type Tic80StereoVolumeAnalysis = Readonly<{
   leftGain: number;
   rightGain: number;
   leftDecibels: number;
   rightDecibels: number;
}>;

/**
 * Mxy stores x and y as the channel's independent left/right stereo gains:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L339-L342
 * The native mixer applies each value as a linear amplitude multiplier / 15:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L106-L112
 */
export function tic80AnalyzeStereoVolume(left: number, right: number): Tic80StereoVolumeAnalysis {
   const leftGain = left / TIC80_STEREO_VOLUME_MAX;
   const rightGain = right / TIC80_STEREO_VOLUME_MAX;
   return {
      leftGain,
      rightGain,
      leftDecibels: linearGainToDecibels(leftGain),
      rightDecibels: linearGainToDecibels(rightGain),
   };
}

export type Tic80ArpeggioAnalysis = Readonly<{
   noteOffsets: readonly number[];
   cycleTicks: number;
   cycleSeconds: number;
}>;

/**
 * Cxy cycles [0, x, y], except y=0 deliberately selects the two-step [0, x] form:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L382-L392
 */
export function tic80AnalyzeArpeggio(x: number, y: number): Tic80ArpeggioAnalysis {
   const noteOffsets = y === 0 ? [0, x] : [0, x, y];
   const cycleTicks = noteOffsets.length;
   return {
      noteOffsets,
      cycleTicks,
      cycleSeconds: tic80EffectTicksToSeconds(cycleTicks),
   };
}

export type Tic80SlideAnalysis = Readonly<{
   fromMidiNote: number;
   toMidiNote: number;
   intervalSemitones: number;
   fromFrequencyRegister: number;
   toFrequencyRegister: number;
   frequencyRegisterDelta: number;
   durationTicks: number;
}>;

/**
 * Sxx interpolates from the previous note to the new note in integer NoteFreqs units:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L402-L407
 */
export function tic80AnalyzeSlide(
   fromMidiNote: number,
   toMidiNote: number,
   durationTicks: number,
   ): Tic80SlideAnalysis|undefined {
   const fromFrequencyRegister = tic80FrequencyRegisterForPatternMidiNote(fromMidiNote);
   const toFrequencyRegister = tic80FrequencyRegisterForPatternMidiNote(toMidiNote);
   if (fromFrequencyRegister === undefined || toFrequencyRegister === undefined || durationTicks <= 0)
      return undefined;

   return {
      fromMidiNote,
      toMidiNote,
      intervalSemitones: toMidiNote - fromMidiNote,
      fromFrequencyRegister,
      toFrequencyRegister,
      frequencyRegisterDelta: toFrequencyRegister - fromFrequencyRegister,
      durationTicks,
   };
}

// Signed form of TIC-80's 32-entry 16.16 fixed-point native vibrato waveform.
const TIC80_VIBRATO_WAVEFORM = [
   0x0000, 0x31f1, 0x61f8, 0x8e3a, 0xb505, 0xd4db, 0xec83, 0xfb15,
   0x10000, 0xfb15, 0xec83, 0xd4db, 0xb505, 0x8e3a, 0x61f8, 0x31f1,
   0x0000, -0x31f1, -0x61f8, -0x8e3a, -0xb505, -0xd4db, -0xec83, -0xfb15,
   -0x10000, -0xfb15, -0xec83, -0xd4db, -0xb505, -0x8e3a, -0x61f8, -0x31f1,
] as const;

export type Tic80VibratoAnalysis = Readonly<{
   cycleTicks: number;
   cycleSeconds: number;
   cyclesPerSecond: number;
   depth: number;
   pitchOffsets: readonly number[];
   minPitchOffset: number;
   maxPitchOffset: number;
   minCents: number|null;
   maxCents: number|null;
   wrapped: boolean;
}>;

/** Returns the exact integer register offset produced at a native vibrato tick. */
export function tic80VibratoPitchOffsetAtTick(period: number, depth: number, tick: number): number {
   if (period <= 0 || depth <= 0)
      return 0;

   const cycleTicks = period * 2;
   const tickInCycle = ((tick % cycleTicks) + cycleTicks) % cycleTicks;
   const waveformIndex = Math.floor(tickInCycle * TIC80_VIBRATO_WAVEFORM.length / cycleTicks);
   return (TIC80_VIBRATO_WAVEFORM[waveformIndex] * depth) >> 16;
}

export function tic80VibratoPitchOffsets(period: number, depth: number): readonly number[] {
   if (period <= 0 || depth <= 0)
      return [];
   return Array.from(
      {length: period * 2},
      (_, tick) => tic80VibratoPitchOffsetAtTick(period, depth, tick),
   );
}

/**
 * Vxy samples TIC-80's fixed waveform over x*2 ticks, multiplies it by y, and
 * arithmetic-shifts the result into an integer frequency-register offset:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L393-L400
 */
export function tic80AnalyzeVibrato(
   period: number,
   depth: number,
   baseMidiNote?: number,
   ): Tic80VibratoAnalysis|undefined {
   const pitchOffsets = tic80VibratoPitchOffsets(period, depth);
   if (pitchOffsets.length === 0)
      return undefined;

   const minPitchOffset = Math.min(...pitchOffsets);
   const maxPitchOffset = Math.max(...pitchOffsets);
   const minPitch = baseMidiNote === undefined ? undefined :
      tic80AnalyzePitchOffset(baseMidiNote, minPitchOffset);
   const maxPitch = baseMidiNote === undefined ? undefined :
      tic80AnalyzePitchOffset(baseMidiNote, maxPitchOffset);
   const wrapped = !!minPitch?.wrapped || !!maxPitch?.wrapped;
   const canExpressCents = !wrapped &&
      minPitch?.relativeSemitones !== null && minPitch?.relativeSemitones !== undefined &&
      maxPitch?.relativeSemitones !== null && maxPitch?.relativeSemitones !== undefined;
   const cycleTicks = period * 2;

   return {
      cycleTicks,
      cycleSeconds: tic80EffectTicksToSeconds(cycleTicks),
      cyclesPerSecond: TIC80_EFFECT_TICK_RATE_HZ / cycleTicks,
      depth,
      pitchOffsets,
      minPitchOffset,
      maxPitchOffset,
      minCents: canExpressCents ? minPitch.relativeSemitones * 100 : null,
      maxCents: canExpressCents ? maxPitch.relativeSemitones * 100 : null,
      wrapped,
   };
}
