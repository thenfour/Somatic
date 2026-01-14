import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {MOD_FINETUNES, PROTRACKER_PERIOD_TABLES} from "../src/utils/music/modMusic";

describe("modMusic / ProTracker period tables", () => {
   it("generates 16×36 tables", () => {
      assert.equal(PROTRACKER_PERIOD_TABLES.length, MOD_FINETUNES.length);
      for (const row of PROTRACKER_PERIOD_TABLES) {
         assert.equal(row.length, 36);
      }
   });
});
