import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {PATTERN_SIDE_CHANNEL_MAX_LENGTH} from "../src/models/pattern";
import {
   describeSideChannelPlaintextAdjustments,
   parseSideChannelPlaintext,
   sanitizeSideChannelCellText,
   serializeSideChannelPlaintext,
} from "../src/utils/sideChannelPlaintextClipboard";

describe("side-channel plain-text clipboard", () => {
   it("serializes one selected pattern row per line, including trailing empty rows", () => {
      assert.equal(serializeSideChannelPlaintext(["value"]).text, "value");
      assert.equal(serializeSideChannelPlaintext(["value", ""]).text, "value\n");
      assert.equal(serializeSideChannelPlaintext(["", "value"]).text, "\nvalue");
      assert.equal(serializeSideChannelPlaintext([""]).text, "");
      assert.equal(serializeSideChannelPlaintext(["", ""]).text, "\n");
   });

   it("parses trailing newlines strictly as empty pattern rows", () => {
      assert.deepEqual(parseSideChannelPlaintext("value", 64).values, ["value"]);
      assert.deepEqual(parseSideChannelPlaintext("value\n", 64).values, ["value", ""]);
      assert.deepEqual(parseSideChannelPlaintext("value\n\n", 64).values, ["value", "", ""]);
      assert.deepEqual(parseSideChannelPlaintext("", 64).values, [""]);
   });

   it("accepts CRLF and lone CR as row delimiters", () => {
      assert.deepEqual(parseSideChannelPlaintext("one\r\ntwo\rthree", 64).values, ["one", "two", "three"]);
      assert.deepEqual(parseSideChannelPlaintext("one\r\n", 64).values, ["one", ""]);
   });

   it("permissively removes unsupported characters, truncates cells, and drops overflow rows", () => {
      const parsed = parseSideChannelPlaintext(
         `valid\n${"x".repeat(PATTERN_SIDE_CHANNEL_MAX_LENGTH + 1)}\nnot\tASCII: é\noverflow`,
         3,
      );

      assert.deepEqual(parsed.values, [
         "valid",
         "x".repeat(PATTERN_SIDE_CHANNEL_MAX_LENGTH),
         "notASCII: ",
      ]);
      assert.deepEqual(parsed.adjustments, {
         removedLineBreaks: false,
         removedUnsupportedCharacters: true,
         truncatedCellCount: 1,
         droppedRowCount: 1,
      });
      assert.equal(
         describeSideChannelPlaintextAdjustments(parsed.adjustments),
         "removed unsupported characters, truncated 1 cell to fit the 1024-character limit, ignored 1 row that did not fit",
      );
   });

   it("removes line breaks from a single-cell paste and reports copy-time repairs", () => {
      assert.deepEqual(sanitizeSideChannelCellText("line\r\nbreak"), {
         value: "linebreak",
         removedLineBreaks: true,
         removedUnsupportedCharacters: false,
         wasTruncated: false,
      });

      const copied = serializeSideChannelPlaintext(["line\nbreak", "ok"]);
      assert.equal(copied.text, "linebreak\nok");
      assert.equal(
         describeSideChannelPlaintextAdjustments(copied.adjustments),
         "removed line breaks",
      );
   });
});
