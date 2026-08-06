import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   tic80AnalyzeRuntimeCadence,
   tic80EffectTicksToRows,
   tic80EffectTicksToSeconds,
   tic80MeasureRowDuration,
   tic80RowsToEffectTicks,
   tic80RowsToSeconds,
   tic80RuntimeTicksForRows,
   tic80TempoSpeedToBpm,
} from "../src/utils/music/tic80Music";
import {kTic80EffectCommand} from "../src/models/tic80Capabilities";
import {
   describeTic80Effect,
   formatTic80EffectInsight,
   formatTic80EffectTooltip,
} from "../src/subsystem/tic80/tic80_effect_insight";
import {CharMap, formatTiming, formatToDecimalPlaces} from "../src/utils/utils";
import {
   semitonesBetweenFrequencies,
   tic80AnalyzePitchOffset,
   tic80FrequencyRegisterForPatternMidiNote,
   tic80PitchOffsetFromParam,
   tic80WrapFrequencyRegister,
} from "../src/utils/music/tic80Pitch";
import {linearGainToDecibels} from "../src/utils/music/dsp";
import {
   tic80AnalyzeArpeggio,
   tic80AnalyzeSlide,
   tic80AnalyzeStereoVolume,
   tic80AnalyzeVibrato,
   tic80VibratoPitchOffsets,
} from "../src/utils/music/tic80EffectAnalysis";
import {
   tic80AnalyzeEnvelopeColumnTiming,
   tic80AnalyzeEnvelopeRate,
   tic80AnalyzeEnvelopeRowGuides,
   tic80ArpeggioEnvelopeSemitones,
   tic80EnvelopeColumnAtTick,
   tic80EnvelopeSemanticToStoredValue,
   tic80EnvelopeStoredToSemanticValue,
   tic80EnvelopeVolumeDecibels,
   tic80InstrumentSpeedToNativeSpeed,
   tic80PitchEnvelopeFrequencyOffset,
} from "../src/utils/music/tic80Envelope";

describe("TIC-80 timing", () => {
   it("formats decimal values and second-based timing values", () => {
      assert.equal(formatToDecimalPlaces(7.2, 2), "7.2");
      assert.equal(formatTiming(7.2 / 60), "120ms");
      assert.equal(formatTiming(28.8 / 60), "480ms");
      assert.equal(formatTiming(460.8 / 60), "7.68s");
   });

   it("converts rows to 60 Hz effect ticks at the default tempo", () => {
      assert.equal(tic80RowsToEffectTicks(4, {tempo: 150, speed: 6}), 24);
      assert.equal(tic80RowsToSeconds(4, {tempo: 150, speed: 6}), 0.4);
   });

   it("accounts for tempo when converting rows to effect ticks", () => {
      assert.equal(tic80RowsToEffectTicks(1, {tempo: 120, speed: 6}), 7.5);
      assert.equal(tic80RowsToEffectTicks(8, {tempo: 120, speed: 6}), 60);
      assert.equal(tic80RowsToSeconds(8, {tempo: 120, speed: 6}), 1);
   });

   it("reports TIC-80's integer runtime cadence", () => {
      assert.deepEqual(tic80AnalyzeRuntimeCadence({tempo: 120, speed: 6}), {
         nominalTicksPerRow: 7.5,
         periodRows: 2,
         ticksPerRow: [8, 7],
         worstRowErrorTicks: 0.5,
      });
      assert.equal(tic80RuntimeTicksForRows(64, {tempo: 120, speed: 6}), 480);

      const cadence125 = tic80AnalyzeRuntimeCadence({tempo: 125, speed: 6});
      assert.equal(cadence125.nominalTicksPerRow, 7.2);
      assert.equal(cadence125.periodRows, 5);
      assert.deepEqual(cadence125.ticksPerRow, [8, 7, 7, 7, 7]);
      assert.ok(Math.abs(cadence125.worstRowErrorTicks - 0.8) < 1e-12);
      assert.equal(tic80RuntimeTicksForRows(64, {tempo: 125, speed: 6}), 461);
   });

   it("reports a one-row period when rows align exactly to runtime ticks", () => {
      assert.deepEqual(tic80AnalyzeRuntimeCadence({tempo: 150, speed: 6}), {
         nominalTicksPerRow: 6,
         periodRows: 1,
         ticksPerRow: [6],
         worstRowErrorTicks: 0,
      });
   });

   it("limits the runtime cadence to the rows encountered before a pattern reset", () => {
      const cadence = tic80AnalyzeRuntimeCadence({tempo: 254, speed: 1}, 4);
      assert.equal(cadence.periodRows, 4);
      assert.deepEqual(cadence.ticksPerRow, [1, 1, 0, 1]);
      assert.ok(Math.abs(cadence.worstRowErrorTicks - 150 / 254) < 1e-12);
   });

   it("converts effect ticks to seconds at TIC-80's 60 Hz tick rate", () => {
      assert.equal(tic80EffectTicksToSeconds(1), 1 / 60);
      assert.equal(tic80EffectTicksToSeconds(60), 1);
   });

   it("converts effect ticks back to rows at the current tempo and speed", () => {
      assert.equal(tic80EffectTicksToRows(7.5, {tempo: 120, speed: 6}), 1);
      assert.equal(tic80EffectTicksToRows(60, {tempo: 120, speed: 6}), 8);
   });

   it("suggests the nearest authorable Sxx/Dxx duration", () => {
      assert.deepEqual(tic80MeasureRowDuration(1, {tempo: 120, speed: 6}), {
         rowCount: 1,
         nominalEffectTicks: 7.5,
         nearestEffectTicks: 8,
         approximate: true,
         seconds: 0.125,
         effectParam: 8,
      });
      assert.deepEqual(tic80MeasureRowDuration(8, {tempo: 120, speed: 6}), {
         rowCount: 8,
         nominalEffectTicks: 60,
         nearestEffectTicks: 60,
         approximate: false,
         seconds: 1,
         effectParam: 60,
      });
   });

   it("reports durations beyond the one-byte Sxx/Dxx range", () => {
      const measurement = tic80MeasureRowDuration(64, {tempo: 32, speed: 7});
      assert.equal(measurement.nearestEffectTicks, 2100);
      assert.equal(measurement.effectParam, null);
   });

   it("expresses tempo and speed at an arbitrary row grouping", () => {
      assert.equal(tic80TempoSpeedToBpm({tempo: 120, speed: 6}, 4), 120);
      assert.equal(tic80TempoSpeedToBpm({tempo: 120, speed: 6}, 8), 60);
   });
});

describe("TIC-80 instrument envelope timing", () => {
   it("maps Somatic instrument speed to TIC-80's signed speed", () => {
      assert.deepEqual(
         Array.from({length: 8}, (_, speed) => tic80InstrumentSpeedToNativeSpeed(speed)),
         [-4, -3, -2, -1, 0, 1, 2, 3],
      );
   });

   it("reports the native column rate for slow, normal, and skipping speeds", () => {
      assert.deepEqual(tic80AnalyzeEnvelopeRate(0), {
         instrumentSpeed: 0,
         nativeSpeed: -4,
         columnsPerTick: 0.2,
         ticksPerColumn: 5,
         secondsPerColumn: 1 / 12,
      });
      assert.deepEqual(tic80AnalyzeEnvelopeRate(4), {
         instrumentSpeed: 4,
         nativeSpeed: 0,
         columnsPerTick: 1,
         ticksPerColumn: 1,
         secondsPerColumn: 1 / 60,
      });
      assert.deepEqual(tic80AnalyzeEnvelopeRate(7), {
         instrumentSpeed: 7,
         nativeSpeed: 3,
         columnsPerTick: 4,
         ticksPerColumn: 0.25,
         secondsPerColumn: 1 / 240,
      });
   });

   it("matches TIC-80's exact unlooped column selection", () => {
      assert.deepEqual(
         Array.from({length: 7}, (_, tick) => tic80EnvelopeColumnAtTick(0, tick)),
         [0, 0, 0, 0, 0, 1, 1],
      );
      assert.deepEqual(
         Array.from({length: 4}, (_, tick) => tic80EnvelopeColumnAtTick(3, tick)),
         [0, 0, 1, 1],
      );
      assert.deepEqual(
         Array.from({length: 4}, (_, tick) => tic80EnvelopeColumnAtTick(7, tick)),
         [0, 4, 8, 12],
      );
   });

   it("maps a column to nominal TIC, elapsed-time, and song-row coordinates", () => {
      const analysis = tic80AnalyzeEnvelopeColumnTiming(7, 3, {tempo: 120, speed: 6});
      assert.equal(analysis.columnIndex, 7);
      assert.equal(analysis.nominalTicks, 14);
      assert.equal(analysis.seconds, 14 / 60);
      assert.ok(Math.abs(analysis.rows - 1.8666666666666667) < 1e-12);
   });

   it("projects actual integer row boundaries onto the first-pass envelope axis", () => {
      const guides = tic80AnalyzeEnvelopeRowGuides(30, 3, {tempo: 120, speed: 6}, 4, 64);
      assert.deepEqual(guides.map(guide => ({
         rowOffset: guide.rowOffset,
         runtimeTick: guide.runtimeTick,
         columnPosition: guide.columnPosition,
         beatBoundary: guide.beatBoundary,
      })), [
         {rowOffset: 1, runtimeTick: 8, columnPosition: 4, beatBoundary: false},
         {rowOffset: 2, runtimeTick: 15, columnPosition: 7.5, beatBoundary: false},
         {rowOffset: 3, runtimeTick: 23, columnPosition: 11.5, beatBoundary: false},
         {rowOffset: 4, runtimeTick: 30, columnPosition: 15, beatBoundary: true},
         {rowOffset: 5, runtimeTick: 38, columnPosition: 19, beatBoundary: false},
         {rowOffset: 6, runtimeTick: 45, columnPosition: 22.5, beatBoundary: false},
         {rowOffset: 7, runtimeTick: 53, columnPosition: 26.5, beatBoundary: false},
         {rowOffset: 8, runtimeTick: 60, columnPosition: 30, beatBoundary: true},
      ]);
   });

   it("round-trips biased pitch rows through semantic -8..+7 values", () => {
      assert.equal(tic80EnvelopeStoredToSemanticValue(0, -8, 7), -8);
      assert.equal(tic80EnvelopeStoredToSemanticValue(8, -8, 7), 0);
      assert.equal(tic80EnvelopeStoredToSemanticValue(15, -8, 7), 7);
      assert.equal(tic80EnvelopeSemanticToStoredValue(-8, -8, 7), 0);
      assert.equal(tic80EnvelopeSemanticToStoredValue(0, -8, 7), 8);
      assert.equal(tic80EnvelopeSemanticToStoredValue(7, -8, 7), 15);
   });

   it("analyzes volume, arpeggio, and pitch envelope values", () => {
      assert.equal(tic80EnvelopeVolumeDecibels(15), 0);
      assert.ok(Math.abs(tic80EnvelopeVolumeDecibels(8) - -5.460025441274753) < 1e-12);
      assert.equal(tic80EnvelopeVolumeDecibels(0), Number.NEGATIVE_INFINITY);
      assert.equal(tic80ArpeggioEnvelopeSemitones(7, false), 7);
      assert.equal(tic80ArpeggioEnvelopeSemitones(7, true), -7);
      assert.equal(tic80PitchEnvelopeFrequencyOffset(4, false), 4);
      assert.equal(tic80PitchEnvelopeFrequencyOffset(4, true), 64);
      assert.equal(tic80PitchEnvelopeFrequencyOffset(-8, true), -128);
   });
});

describe("TIC-80 timed effect insights", () => {
   const timing = {tempo: 120, speed: 6};

   it("describes slide ticks in rows and elapsed time", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.S,
         tic80EffectX: 0,
         tic80EffectY: 8,
      }, undefined, timing);

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "S08: Slide: duration 8 ticks (1.07 rows, 133ms)",
      );
   });

   it("describes delayed notes in rows and elapsed time", () => {
      const insight = describeTic80Effect({
         midiNote: 60,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 8,
      }, undefined, timing);

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "D08: Delay: C-4 after 8 ticks (1.07 rows, 133ms)",
      );
   });

   it("keeps zero-duration effect wording unchanged", () => {
      const slide = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.S,
         tic80EffectX: 0,
         tic80EffectY: 0,
      }, undefined, timing);
      const delay = describeTic80Effect({
         midiNote: 60,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 0,
      }, undefined, timing);

      assert.ok(slide);
      assert.ok(delay);
      assert.equal(formatTic80EffectInsight(slide), "S00: Slide off");
      assert.equal(formatTic80EffectInsight(delay), "D00: Delay: C-4 immediately");
   });
});

describe("TIC-80 musical effect insights", () => {
   const timing = {tempo: 120, speed: 6};

   function contextForCurrentNote(midiNote: number, activeBeforeMidiNote?: number) {
      return {
         activeBeforeRow: activeBeforeMidiNote === undefined ? undefined :
            {midiNote: activeBeforeMidiNote, songPosition: 0, rowIndex: 0},
         activeAfterNoteColumn: {midiNote, songPosition: 0, rowIndex: 0},
         source: "current-cell" as const,
         rowReachable: true,
      };
   }

   it("shows independent M gains as linear levels and decibels", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 8,
         tic80EffectY: 15,
      });

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "M8F: Volume: L 8/15 (-5.5dB), R 15/15 (0dB)",
      );
      assert.match(formatTic80EffectTooltip(insight) ?? "", /linear gains independently/);
   });

   it("shows silence as negative infinity dB", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 0,
         tic80EffectY: 15,
      });

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "M0F: Volume: L 0/15 (silence), R 15/15 (0dB)",
      );
   });

   it("shows C notes and native cadence", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.C,
         tic80EffectX: 3,
         tic80EffectY: 7,
      }, contextForCurrentNote(60));

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "C37: Arpeggio: C-4 D#4 G-4 (3 TIC cycle, 50ms)",
      );
      assert.match(formatTic80EffectTooltip(insight) ?? "", /one step per 60 Hz TIC/);
   });

   it("shows Cy0 as TIC-80's two-step arpeggio", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.C,
         tic80EffectX: 3,
         tic80EffectY: 0,
      }, contextForCurrentNote(60));

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "C30: Arpeggio: C-4 D#4 (2 TIC cycle, 33ms)",
      );
   });

   it("shows S endpoints, interval, and duration", () => {
      const insight = describeTic80Effect({
         midiNote: 67,
         tic80Effect: kTic80EffectCommand.key.S,
         tic80EffectX: 0,
         tic80EffectY: 8,
      }, contextForCurrentNote(67, 60), timing);

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         `S08: Slide: C-4 ${CharMap.RightArrow} G-4 (+7 st) over 8 ticks (1.07 rows, 133ms)`,
      );
      assert.match(formatTic80EffectTooltip(insight) ?? "", /not semitones/);
   });

   it("shows V cadence and its actual note-dependent sampled range", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.V,
         tic80EffectX: 3,
         tic80EffectY: 4,
      }, contextForCurrentNote(60));

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "V34: Vibrato: 6 TIC cycle (100ms, 10Hz), depth 4 (-27/+20c)",
      );
      const tooltip = formatTic80EffectTooltip(insight);
      assert.match(tooltip ?? "", /32-point native vibrato waveform/);
      assert.match(tooltip ?? "", /offsets -4 to \+3/);
   });

   it("reveals vibrato periods that sample no pitch movement", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.V,
         tic80EffectX: 1,
         tic80EffectY: 4,
      }, contextForCurrentNote(60));

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "V14: Vibrato: 2 TIC cycle (33ms, 30Hz), depth 4 (0c)",
      );
   });
});

describe("TIC-80 pitch effect insights", () => {
   function contextFor(midiNote: number) {
      return {
         activeAfterNoteColumn: {midiNote, songPosition: 0, rowIndex: 0},
         source: "current-cell" as const,
         rowReachable: true,
      };
   }

   it("shows raw, relative, and P-only target pitch", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 4,
         tic80EffectY: 4,
      }, contextFor(60));

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "P44: Pitch: -60 (-4.5 st → G-3 +50c)",
      );
      const tooltip = formatTic80EffectTooltip(insight);
      assert.match(tooltip ?? "", /P commands do not accumulate/);
      assert.match(tooltip ?? "", /At base C-4/);
      assert.match(tooltip ?? "", /P-only target of G-3 \+50c/);
   });

   it("keeps P80 musically neutral", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 8,
         tic80EffectY: 0,
      }, contextFor(60));

      assert.ok(insight);
      assert.equal(formatTic80EffectInsight(insight), "P80: Pitch: 0 (0 st → C-4)");
   });

   it("requires a base note for the musical conversion", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 4,
         tic80EffectY: 4,
      });

      assert.ok(insight);
      assert.equal(formatTic80EffectInsight(insight), "P44: Pitch: -60");
      assert.match(formatTic80EffectTooltip(insight) ?? "", /base note is needed/i);
      assert.match(formatTic80EffectTooltip(insight) ?? "", /No known base note/);
   });

   it("does not report a conventional note when the frequency register wraps", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 4,
         tic80EffectY: 4,
      }, contextFor(12));

      assert.ok(insight);
      assert.equal(formatTic80EffectInsight(insight), "P44: Pitch: -60");
      assert.match(formatTic80EffectTooltip(insight) ?? "", /Overflows and wraps!/);
   });

   it("shows that the same P offset has a note-dependent interval", () => {
      const lowInsight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 4,
         tic80EffectY: 4,
      }, contextFor(48));
      const highInsight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 4,
         tic80EffectY: 4,
      }, contextFor(96));

      assert.ok(lowInsight);
      assert.ok(highInsight);
      assert.match(formatTic80EffectInsight(lowInsight), /-10\.6 st/);
      assert.match(formatTic80EffectInsight(highInsight), /-0\.5 st/);
   });
});

describe("TIC-80 native pitch calculations", () => {
   it("matches representative values from TIC-80's native NoteFreqs table", () => {
      assert.equal(tic80FrequencyRegisterForPatternMidiNote(12), 0x10); // C-0
      assert.equal(tic80FrequencyRegisterForPatternMidiNote(60), 0x106); // C-4
      assert.equal(tic80FrequencyRegisterForPatternMidiNote(69), 0x1b8); // A-4
      assert.equal(tic80FrequencyRegisterForPatternMidiNote(11), undefined);
      assert.equal(tic80FrequencyRegisterForPatternMidiNote(108), undefined);
   });

   it("decodes Pxx around neutral P80", () => {
      assert.equal(tic80PitchOffsetFromParam(0x44), -60);
      assert.equal(tic80PitchOffsetFromParam(0x80), 0);
      assert.equal(tic80PitchOffsetFromParam(0xff), 127);
   });

   it("models TIC-80's 12-bit frequency register", () => {
      assert.equal(tic80WrapFrequencyRegister(-1), 4095);
      assert.equal(tic80WrapFrequencyRegister(4095), 4095);
      assert.equal(tic80WrapFrequencyRegister(4096), 0);
   });

   it("converts frequency ratios to semitone intervals", () => {
      assert.equal(semitonesBetweenFrequencies(440, 880), 12);
      assert.equal(semitonesBetweenFrequencies(440, 220), -12);
   });

   it("analyzes P44 from C-4 without wrapping", () => {
      const analysis = tic80AnalyzePitchOffset(60, -60);
      assert.ok(analysis);
      assert.equal(analysis.baseFrequencyRegister, 262);
      assert.equal(analysis.unwrappedTargetFrequencyRegister, 202);
      assert.equal(analysis.targetFrequencyRegister, 202);
      assert.equal(analysis.wrapped, false);
      assert.ok(Math.abs((analysis.relativeSemitones ?? 0) - -4.502538225427868) < 1e-12);
      assert.ok(Math.abs((analysis.effectiveMidiNote ?? 0) - 55.49746177457213) < 1e-12);
   });

   it("reports native register underflow separately from musical conversion", () => {
      const analysis = tic80AnalyzePitchOffset(12, -60);
      assert.ok(analysis);
      assert.equal(analysis.baseFrequencyRegister, 16);
      assert.equal(analysis.unwrappedTargetFrequencyRegister, -44);
      assert.equal(analysis.targetFrequencyRegister, 4052);
      assert.equal(analysis.wrapped, true);
   });
});

describe("TIC-80 native effect calculations", () => {
   it("converts linear gain to amplitude decibels", () => {
      assert.equal(linearGainToDecibels(1), 0);
      assert.ok(Math.abs(linearGainToDecibels(8 / 15) - -5.460025441274753) < 1e-12);
      assert.equal(linearGainToDecibels(0), Number.NEGATIVE_INFINITY);
   });

   it("analyzes TIC-80's independent stereo volume", () => {
      const analysis = tic80AnalyzeStereoVolume(8, 15);
      assert.equal(analysis.leftGain, 8 / 15);
      assert.equal(analysis.rightGain, 1);
      assert.ok(Math.abs(analysis.leftDecibels - -5.460025441274753) < 1e-12);
      assert.equal(analysis.rightDecibels, 0);
   });

   it("analyzes three-step and two-step native arpeggios", () => {
      assert.deepEqual(tic80AnalyzeArpeggio(3, 7), {
         noteOffsets: [0, 3, 7],
         cycleTicks: 3,
         cycleSeconds: 0.05,
      });
      assert.deepEqual(tic80AnalyzeArpeggio(3, 0), {
         noteOffsets: [0, 3],
         cycleTicks: 2,
         cycleSeconds: 1 / 30,
      });
   });

   it("analyzes native slide endpoints in frequency-register units", () => {
      assert.deepEqual(tic80AnalyzeSlide(60, 67, 8), {
         fromMidiNote: 60,
         toMidiNote: 67,
         intervalSemitones: 7,
         fromFrequencyRegister: 262,
         toFrequencyRegister: 392,
         frequencyRegisterDelta: 130,
         durationTicks: 8,
      });
   });

   it("matches TIC-80's sampled, asymmetric V34 offsets", () => {
      assert.deepEqual(tic80VibratoPitchOffsets(3, 4), [0, 3, 3, 0, -4, -4]);
      const analysis = tic80AnalyzeVibrato(3, 4, 60);
      assert.ok(analysis);
      assert.equal(analysis.cycleTicks, 6);
      assert.equal(analysis.cycleSeconds, 0.1);
      assert.equal(analysis.cyclesPerSecond, 10);
      assert.equal(analysis.minPitchOffset, -4);
      assert.equal(analysis.maxPitchOffset, 3);
      assert.ok(Math.abs((analysis.minCents ?? 0) - -26.634895337035434) < 1e-12);
      assert.ok(Math.abs((analysis.maxCents ?? 0) - 19.710657495733628) < 1e-12);
   });

   it("matches the zero-crossings sampled by a one-tick vibrato period", () => {
      assert.deepEqual(tic80VibratoPitchOffsets(1, 4), [0, 0]);
   });
});
