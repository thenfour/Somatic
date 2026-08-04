import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {SelectionRange1D} from "../src/models/selectionRange1D";

describe("SelectionRange1D", () => {
   it("enumerates forward and reverse selections in document order", () => {
      const forward = new SelectionRange1D({anchor: 2, focus: 5});
      const reverse = new SelectionRange1D({anchor: 5, focus: 2});

      assert.deepEqual(forward.indices(), [2, 3, 4, 5]);
      assert.deepEqual(reverse.indices(), [2, 3, 4, 5]);
      assert.equal(forward.focus, 5);
      assert.equal(reverse.focus, 2);
   });

   it("round-trips the inclusive signed-size representation used by vertical rectangle selections", () => {
      for (const range of [
         SelectionRange1D.single(3),
         new SelectionRange1D({anchor: 3, focus: 7}),
         new SelectionRange1D({anchor: 7, focus: 3}),
      ]) {
         const roundTripped = SelectionRange1D.fromSignedSize(range.anchor, range.signedSize());
         assert.deepEqual(roundTripped.toData(), range.toData());
      }
   });

   it("clamps both endpoints while preserving their direction", () => {
      assert.deepEqual(
         new SelectionRange1D({anchor: 10, focus: -3}).withClampedBounds(0, 7).toData(),
         {anchor: 7, focus: 0},
      );
   });

   it("nudges the whole range without changing its shape", () => {
      const selection = new SelectionRange1D({anchor: 5, focus: 2}).withNudge(3);
      assert.deepEqual(selection.toData(), {anchor: 8, focus: 5});
      assert.deepEqual(selection.indices(), [5, 6, 7, 8]);
   });
});
