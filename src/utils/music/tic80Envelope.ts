import {Tic80Caps} from "../../models/tic80Capabilities";
import {clamp} from "../utils";
import {linearGainToDecibels} from "./dsp";
import {
   TIC80_EFFECT_TICK_RATE_HZ,
   type Tic80Timing,
   tic80EffectTicksToRows,
   tic80EffectTicksToSeconds,
   tic80RuntimeTicksForRows,
} from "./tic80Music";

export type Tic80EnvelopeRateAnalysis = Readonly<{
   instrumentSpeed: number;
   nativeSpeed: number;
   columnsPerTick: number;
   ticksPerColumn: number;
   secondsPerColumn: number;
}>;

export type Tic80EnvelopeColumnTiming = Readonly<{
   columnIndex: number;
   nominalTicks: number;
   seconds: number;
   rows: number;
}>;

export type Tic80EnvelopeRowGuide = Readonly<{
   rowOffset: number;
   runtimeTick: number;
   seconds: number;
   columnPosition: number;
   beatBoundary: boolean;
}>;

/**
 * linear 0..15 amplitude value:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L164-L170
 */
export function tic80EnvelopeVolumeDecibels(volume: number): number {
   const gain = clamp(volume, 0, Tic80Caps.sfx.volumeMax) / Tic80Caps.sfx.volumeMax;
   return linearGainToDecibels(gain);
}

/**
 * reverse flag changes the sign of each arp offset
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L171-L177
 */
export function tic80ArpeggioEnvelopeSemitones(value: number, reverse: boolean): number {
   const semitones = clamp(Math.round(value), 0, Tic80Caps.sfx.arpeggioMax);
   return reverse ? -semitones : semitones;
}

/**
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L176-L178
 */
export function tic80PitchEnvelopeFrequencyOffset(value: number, pitch16x: boolean): number {
   const pitch = clamp(Math.round(value), Tic80Caps.sfx.pitchMin, Tic80Caps.sfx.pitchMax);
   return pitch * (pitch16x ? 16 : 1);
}

/** Somatic displays TIC-80's signed three-bit SFX speed as 0..7. */
export function tic80InstrumentSpeedToNativeSpeed(instrumentSpeed: number): number {
   const normalizedSpeed = Math.trunc(clamp(
      instrumentSpeed,
      Tic80Caps.sfx.speedMin,
      Tic80Caps.sfx.speedMax,
   ));
   return normalizedSpeed - Tic80Caps.sfx.speedSignedBias;
}

/**
 * sfx envelope running:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/tools.h#L24-L27
 */
export function tic80AnalyzeEnvelopeRate(instrumentSpeed: number): Tic80EnvelopeRateAnalysis {
   const normalizedSpeed = tic80InstrumentSpeedToNativeSpeed(instrumentSpeed) +
      Tic80Caps.sfx.speedSignedBias;
   const nativeSpeed = tic80InstrumentSpeedToNativeSpeed(normalizedSpeed);
   const columnsPerTick = nativeSpeed > 0 ? 1 + nativeSpeed : 1 / (1 - nativeSpeed);
   const ticksPerColumn = 1 / columnsPerTick;
   return {
      instrumentSpeed: normalizedSpeed,
      nativeSpeed,
      columnsPerTick,
      ticksPerColumn,
      secondsPerColumn: ticksPerColumn / TIC80_EFFECT_TICK_RATE_HZ,
   };
}

/** Returns the exact unlooped envelope column selected on an integer 60 Hz tick. */
export function tic80EnvelopeColumnAtTick(instrumentSpeed: number, tick: number): number {
   const nativeSpeed = tic80InstrumentSpeedToNativeSpeed(instrumentSpeed);
   const normalizedTick = Math.max(0, Math.floor(tick));
   return nativeSpeed > 0 ?
      normalizedTick * (1 + nativeSpeed) :
      Math.floor(normalizedTick / (1 - nativeSpeed));
}

/** Describes the nominal first-pass time at the _start_ of an envelope X. */
export function tic80AnalyzeEnvelopeColumnTiming(
   columnIndex: number,
   instrumentSpeed: number,
   songTiming: Tic80Timing,
   ): Tic80EnvelopeColumnTiming {
   const normalizedColumnIndex = Math.max(0, Math.floor(columnIndex));
   const rate = tic80AnalyzeEnvelopeRate(instrumentSpeed);
   const nominalTicks = normalizedColumnIndex * rate.ticksPerColumn;
   return {
      columnIndex: normalizedColumnIndex,
      nominalTicks,
      seconds: tic80EffectTicksToSeconds(nominalTicks),
      rows: tic80EffectTicksToRows(nominalTicks, songTiming),
   };
}

/**
 * Projects TIC-80's integer runtime row boundaries onto the envelope's nominal
 * first-pass X axis. Looping and column reachability are intentionally excluded.
 */
export function tic80AnalyzeEnvelopeRowGuides(
   columnCount: number,
   instrumentSpeed: number,
   songTiming: Tic80Timing,
   rowsPerBeat: number,
   maxRows: number,
   ): readonly Tic80EnvelopeRowGuide[] {
   const normalizedColumnCount = Math.max(0, columnCount);
   const normalizedRowsPerBeat = Math.max(1, Math.floor(rowsPerBeat));
   const normalizedMaxRows = Math.max(0, Math.floor(maxRows));
   const rate = tic80AnalyzeEnvelopeRate(instrumentSpeed);
   const guides: Tic80EnvelopeRowGuide[] = [];

   for (let rowOffset = 1; rowOffset <= normalizedMaxRows; rowOffset += 1) {
      const runtimeTick = tic80RuntimeTicksForRows(rowOffset, songTiming);
      const columnPosition = runtimeTick * rate.columnsPerTick;
      if (columnPosition > normalizedColumnCount)
         break;
      guides.push({
         rowOffset,
         runtimeTick,
         seconds: tic80EffectTicksToSeconds(runtimeTick),
         columnPosition,
         beatBoundary: rowOffset % normalizedRowsPerBeat === 0,
      });
   }
   return guides;
}

/** Converts the biased 0-based editor storage (0..range) into an envelope's semantic value (min..max). */
export function tic80EnvelopeStoredToSemanticValue(
   storedValue: number,
   minValue: number,
   maxValue: number,
   ): number {
   const valueRange = Math.max(0, maxValue - minValue);
   return clamp(Math.round(storedValue), 0, valueRange) + minValue;
}

// inverse
export function tic80EnvelopeSemanticToStoredValue(
   semanticValue: number,
   minValue: number,
   maxValue: number,
   ): number {
   return Math.round(clamp(semanticValue, minValue, maxValue) - minValue);
}
