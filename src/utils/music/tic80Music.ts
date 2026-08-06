import {formatTiming, formatToDecimalPlaces} from "../utils";

export const TIC80_EFFECT_TICK_RATE_HZ = 60;
export const TIC80_DEFAULT_TEMPO = 150;
export const TIC80_EFFECT_DURATION_MAX_TICKS = 0xff;

export type Tic80Timing = Readonly<{
   tempo: number;
   speed: number;
}>;

/**
 * Converts a row span to 60 Hz ticks.
 *
 * At the default tempo (150), speed is the number of effect ticks per row.
 * Other tempos rescale the row duration while Sxx/Dxx durations remain in
 * 60 Hz effect ticks.
 */
export function tic80RowsToEffectTicks(rowCount: number, timing: Tic80Timing): number {
   return rowCount * timing.speed * TIC80_DEFAULT_TEMPO / timing.tempo;
}

export function tic80EffectTicksToSeconds(ticks: number): number {
   return ticks / TIC80_EFFECT_TICK_RATE_HZ;
}

export function tic80EffectTicksToRows(ticks: number, timing: Tic80Timing): number {
   return ticks * timing.tempo / (timing.speed * TIC80_DEFAULT_TEMPO);
}

export function tic80RowsToSeconds(rowCount: number, timing: Tic80Timing): number {
   return tic80EffectTicksToSeconds(tic80RowsToEffectTicks(rowCount, timing));
}

function greatestCommonDivisor(a: number, b: number): number {
   a = Math.abs(a);
   b = Math.abs(b);
   while (b !== 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
   }
   return a;
}

/**
 * TIC-80 derives the current row from the accumulated integer 60 Hz tick:
 * floor(tick * tempo / (speed * 150)). A row boundary therefore occurs at
 * ceil(row * speed * 150 / tempo).
 */
export function tic80RuntimeTicksForRows(rowCount: number, timing: Tic80Timing): number {
   return Math.ceil(rowCount * timing.speed * TIC80_DEFAULT_TEMPO / timing.tempo);
}

export type Tic80RuntimeCadence = Readonly<{
   nominalTicksPerRow: number;
   periodRows: number;
   ticksPerRow: readonly number[];
   worstRowErrorTicks: number;
}>;

export function tic80AnalyzeRuntimeCadence(timing: Tic80Timing, maxRows = Number.POSITIVE_INFINITY): Tic80RuntimeCadence {
   const ticksNumerator = timing.speed * TIC80_DEFAULT_TEMPO;
   const basePeriodRows = timing.tempo / greatestCommonDivisor(ticksNumerator, timing.tempo);
   const periodRows = Math.min(basePeriodRows, Math.max(1, Math.floor(maxRows)));
   const ticksPerRow = Array.from({length: periodRows}, (_, rowIndex) =>
      tic80RuntimeTicksForRows(rowIndex + 1, timing) - tic80RuntimeTicksForRows(rowIndex, timing));
   const nominalTicksPerRow = ticksNumerator / timing.tempo;
   const worstRowErrorTicks = ticksPerRow.reduce(
      (worst, runtimeTicks) => Math.max(worst, Math.abs(runtimeTicks - nominalTicksPerRow)),
      0,
   );

   return {
      nominalTicksPerRow,
      periodRows,
      ticksPerRow,
      worstRowErrorTicks,
   };
}

export type Tic80RowDurationMeasurement = Readonly<{
   rowCount: number;
   nominalEffectTicks: number;
   nearestEffectTicks: number;
   approximate: boolean;
   seconds: number;
   effectParam: number | null;
}>;

export function tic80MeasureRowDuration(rowCount: number, timing: Tic80Timing): Tic80RowDurationMeasurement {
   const nominalEffectTicks = tic80RowsToEffectTicks(rowCount, timing);
   const nearestEffectTicks = Math.max(0, Math.round(nominalEffectTicks));
   return {
      rowCount,
      nominalEffectTicks,
      nearestEffectTicks,
      approximate: Math.abs(nominalEffectTicks - nearestEffectTicks) > 1e-9,
      seconds: tic80EffectTicksToSeconds(nominalEffectTicks),
      effectParam: nearestEffectTicks <= TIC80_EFFECT_DURATION_MAX_TICKS ? nearestEffectTicks : null,
   };
}


export function formatTic80Timing(ticks: number, timing: Tic80Timing | undefined): string {
   const tickUnit = ticks === 1 ? "tick" : "ticks";
   const tickText = `${formatToDecimalPlaces(ticks, 2)} ${tickUnit}`;
   if (!timing)
      return tickText;

   const rows = tic80EffectTicksToRows(ticks, timing);
   const seconds = tic80EffectTicksToSeconds(ticks);
   const rowUnit = Math.abs(rows - 1) <= 1e-9 ? "row" : "rows";
   return `${tickText} (${formatToDecimalPlaces(rows, 2)} ${rowUnit}, ${formatTiming(seconds)})`;
}


// https://itch.io/t/197936/music-editor-how-spd-relates-to-tempo-beats-per-minute
// that formula assumes 4 rows per beat.
// so for arbitrary rows per beat,
// bpm = 24 * T / S L
export function tic80TempoSpeedToBpm(timing: Tic80Timing, rowsPerBeat: number): number {
   return (24 * timing.tempo) / (timing.speed * rowsPerBeat);
}

// ------------------------------------------------------------------------------------------------
// TIC-80 pitch codec (octave 0..7, note nibble 4..15)

export type TicPitch = Readonly<{
   absoluteNoteIndex: number; octave: number; // 0..7 if encodable, else -1
   noteNibble: number;                        // 4..15 if encodable, else 0
   isPatternEncodable: boolean;
}>;

type TicCodecConfig = Readonly<{
   midiForTicNote0: number;         // e.g. 12 => C0
   minTicAbsoluteNoteIndex: number; // e.g. 0
   maxTicAbsoluteNoteIndex: number; // e.g. 95
}>;

export const defaultTicNoteConfig: TicCodecConfig = Object.freeze({
   midiForTicNote0: 12, // C0
   minTicAbsoluteNoteIndex: 0,
   maxTicAbsoluteNoteIndex: 95,
});

export function ticPitchFromMidi(midi: number, cfg = defaultTicNoteConfig): TicPitch {
   const absoluteNoteIndex = midi - cfg.midiForTicNote0;
   const isPatternEncodable =
      absoluteNoteIndex >= cfg.minTicAbsoluteNoteIndex && absoluteNoteIndex <= cfg.maxTicAbsoluteNoteIndex;

   if (!isPatternEncodable) {
      return {absoluteNoteIndex, octave: -1, noteNibble: 0, isPatternEncodable: false};
   }

   const octave = Math.floor(absoluteNoteIndex / 12); // 0..7
   const noteInOct = absoluteNoteIndex % 12;          // 0..11
   const noteNibble = noteInOct + 4;                  // 4..15
   return {absoluteNoteIndex, octave, noteNibble, isPatternEncodable: true};
}

export function midiFromTicPitch(octave: number, noteNibble: number, cfg = defaultTicNoteConfig): number|undefined {
   if (!Number.isInteger(octave) || !Number.isInteger(noteNibble))
      return undefined;
   if (octave < 0 || octave > 7)
      return undefined;
   if (noteNibble < 4 || noteNibble > 15)
      return undefined;

   const noteInOct = noteNibble - 4; // 0..11
   const absoluteNoteIndex = octave * 12 + noteInOct;

   if (absoluteNoteIndex < cfg.minTicAbsoluteNoteIndex || absoluteNoteIndex > cfg.maxTicAbsoluteNoteIndex) {
      return undefined;
   }

   return absoluteNoteIndex + cfg.midiForTicNote0;
}
