import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   tic80EffectTicksToRows,
   tic80EffectTicksToSeconds,
   tic80MeasureRowDuration,
   tic80RowsToEffectTicks,
   tic80RowsToSeconds,
   tic80TempoSpeedToBpm,
} from "../src/utils/music/tic80Music";
import {kTic80EffectCommand} from "../src/models/tic80Capabilities";
import {describeTic80Effect, formatTic80EffectInsight} from "../src/subsystem/tic80/tic80_effect_insight";

describe("TIC-80 timing", () => {
   it("converts rows to 60 Hz effect ticks at the default tempo", () => {
      assert.equal(tic80RowsToEffectTicks(4, {tempo: 150, speed: 6}), 24);
      assert.equal(tic80RowsToSeconds(4, {tempo: 150, speed: 6}), 0.4);
   });

   it("accounts for tempo when converting rows to effect ticks", () => {
      assert.equal(tic80RowsToEffectTicks(1, {tempo: 120, speed: 6}), 7.5);
      assert.equal(tic80RowsToEffectTicks(8, {tempo: 120, speed: 6}), 60);
      assert.equal(tic80RowsToSeconds(8, {tempo: 120, speed: 6}), 1);
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

   it("describes slide ticks in rows and seconds", () => {
      const insight = describeTic80Effect({
         tic80Effect: kTic80EffectCommand.key.S,
         tic80EffectX: 0,
         tic80EffectY: 8,
      }, undefined, timing);

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "S08: Slide: duration 8 ticks (1.067 rows, 0.133 s)",
      );
   });

   it("describes delayed notes in rows and seconds", () => {
      const insight = describeTic80Effect({
         midiNote: 60,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 8,
      }, undefined, timing);

      assert.ok(insight);
      assert.equal(
         formatTic80EffectInsight(insight),
         "D08: Delay: C-4 after 8 ticks (1.067 rows, 0.133 s)",
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
