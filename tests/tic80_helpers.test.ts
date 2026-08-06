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
import {formatTiming, formatToDecimalPlaces} from "../src/utils/utils";
import {
   semitonesBetweenFrequencies,
   tic80AnalyzePitchOffset,
   tic80FrequencyRegisterForPatternMidiNote,
   tic80PitchOffsetFromParam,
   tic80WrapFrequencyRegister,
} from "../src/utils/music/tic80Pitch";

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
