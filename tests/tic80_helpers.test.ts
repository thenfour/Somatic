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
import {describeTic80Effect, formatTic80EffectInsight} from "../src/subsystem/tic80/tic80_effect_insight";
import {formatTiming, formatToDecimalPlaces} from "../src/utils/utils";

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
