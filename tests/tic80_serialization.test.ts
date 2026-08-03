import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {decodeTrackSpeed, encodeTrackSpeed} from "../src/subsystem/tic80/tic80_serialization";

describe("TIC-80 track speed serialization", () => {
   it("encodes display speeds as signed deltas from TIC-80's default speed", () => {
      const expectedBytes = [
         [1, 251],
         [2, 252],
         [3, 253],
         [4, 254],
         [5, 255],
         [6, 0],
         [7, 1],
      ] as const;

      for (const [displaySpeed, expectedByte] of expectedBytes) {
         const encoded = encodeTrackSpeed(displaySpeed);
         const signedDelta = encoded >= 128 ? encoded - 256 : encoded;

         assert.equal(encoded, expectedByte, `encoded byte for speed ${displaySpeed}`);
         assert.equal(signedDelta + 6, displaySpeed, `TIC-80 runtime speed for ${displaySpeed}`);
         assert.equal(decodeTrackSpeed(encoded), displaySpeed, `round trip for speed ${displaySpeed}`);
      }
   });
});
