import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   calculateAudioRenderMetrics,
   formatAudioRenderDuration,
} from "../src/audio/audio_render_metrics";

describe("audio render progress metrics", () => {
   it("calculates cumulative realtime rate and estimated remaining wall time", () => {
      const metrics = calculateAudioRenderMetrics({
         fraction01: 0.5,
         totalAudioSeconds: 60,
         elapsedSeconds: 2.5,
      });

      assert.equal(metrics.renderedAudioSeconds, 30);
      assert.equal(metrics.realtimeRate, 12);
      assert.equal(metrics.remainingSeconds, 2.5);
   });

   it("waits for measurable progress before estimating rate and remaining time", () => {
      const metrics = calculateAudioRenderMetrics({
         fraction01: 0,
         totalAudioSeconds: 60,
         elapsedSeconds: 1,
      });

      assert.equal(metrics.realtimeRate, null);
      assert.equal(metrics.remainingSeconds, null);
   });

   it("formats elapsed and remaining durations as clocks", () => {
      assert.equal(formatAudioRenderDuration(5.9), "0:05");
      assert.equal(formatAudioRenderDuration(5.1, "ceil"), "0:06");
      assert.equal(formatAudioRenderDuration(65), "1:05");
      assert.equal(formatAudioRenderDuration(3661), "1:01:01");
   });
});
