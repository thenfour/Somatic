import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {AudioRenderDcFilter} from "../src/audio/audio_render_dc_filter";

describe("audio render DC filter", () => {
   it("matches Maj7 DC filter response", () => {
      const filter = new AudioRenderDcFilter();
      const actual = [1, 1, 1, 0].map((sample) => filter.processSample(sample));
      const expected = [1, 0.998, 0.996004, -0.005988008];

      for (let i = 0; i < expected.length; i++) {
         assert.ok(Math.abs(actual[i]! - expected[i]!) < 1e-12);
      }
   });

   it("keeps channel state independent", () => {
      const left = new AudioRenderDcFilter();
      const right = new AudioRenderDcFilter();

      assert.equal(left.processSample(100), 100);
      assert.equal(right.processSample(0), 0);
      assert.equal(left.processSample(100), 99.8);
      assert.equal(right.processSample(50), 50);
   });
});
