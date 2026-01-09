import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {replaceLuaBlock} from "../src/utils/utils";

describe("replaceLuaBlock", () => {
   it("preserves the last replacement line when there is following content", () => {
      const src = [
         "a",
         "-- BEGIN_BLOCK",
         "old1",
         "old2",
         "-- END_BLOCK",
         "b",
         "",
      ].join("\n");

      const replacement = [
         "new1",
         "new2", // note: no trailing newline in the string literal below
      ].join("\n");

      const out = replaceLuaBlock(src, "-- BEGIN_BLOCK", "-- END_BLOCK", replacement);

      const expected = [
         "a",
         "new1",
         "new2",
         "b",
         "",
      ].join("\n");

      assert.equal(out, expected);
   });

   it("does not force a trailing newline when the block is at EOF", () => {
      const src = [
         "a",
         "-- BEGIN_BLOCK",
         "old",
         "-- END_BLOCK",
      ].join("\n"); // no final newline

      const replacement = ["new1", "new2"].join("\n");
      const out = replaceLuaBlock(src, "-- BEGIN_BLOCK", "-- END_BLOCK", replacement);

      const expected = ["a", "new1", "new2"].join("\n");
      assert.equal(out, expected);
   });

   it("handles CRLF sources", () => {
      const src = [
         "a",
         "-- BEGIN_BLOCK",
         "old",
         "-- END_BLOCK",
         "b",
         "",
      ].join("\r\n");

      const replacement = ["new1", "new2"].join("\n");
      const out = replaceLuaBlock(src, "-- BEGIN_BLOCK", "-- END_BLOCK", replacement);

      const expected = [
         "a",
         "new1",
         "new2",
         "b",
         "",
      ].join("\r\n");

      assert.equal(out, expected);
   });
});
