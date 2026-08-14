import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   getPatternSideChannelValidationIssues,
   Pattern,
   PATTERN_SIDE_CHANNEL_MAX_LENGTH,
} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand} from "../src/models/tic80Capabilities";
import {OptimizeSong} from "../src/subsystem/tic80/SongOptimizer";
import {prepareSongColumns} from "../src/subsystem/tic80/tic80_prepared_song";

describe("pattern side-channel data", () => {
   it("round-trips sparse pattern-row strings and defaults older patterns to empty", () => {
      const pattern = new Pattern();
      pattern.setSideChannelCell(3, "bomb");
      pattern.setSideChannelCell(7, "");

      assert.equal(pattern.getSideChannelCell(0), "");
      assert.equal(pattern.peekSideChannelCell(3), "bomb");
      assert.deepEqual(pattern.toData().privateSideChannelData, {rows: ["", "", "", "bomb"]});
      assert.equal(pattern.clone().getSideChannelCell(3), "bomb");

      const olderPattern = new Pattern({name: "legacy", channels: []});
      assert.equal(olderPattern.getSideChannelCell(3), "");
   });

   it("enforces printable ASCII and a 1 KiB cell limit", () => {
      assert.deepEqual(getPatternSideChannelValidationIssues("bomb [01]"), []);
      assert.match(getPatternSideChannelValidationIssues("line\nbreak")[0], /printable 7-bit ASCII/);
      assert.match(
         getPatternSideChannelValidationIssues("x".repeat(PATTERN_SIDE_CHANNEL_MAX_LENGTH + 1))[0],
         /1024 characters/,
      );
   });

   it("keeps patterns distinct during optimization when only side-channel data differs", () => {
      const first = new Pattern();
      const second = first.clone();
      first.setSideChannelCell(0, "bomb");
      second.setSideChannelCell(0, "flicker");
      const song = new Song({
         rowsPerPattern: 8,
         patterns: [first.toData(), second.toData()],
         songOrder: [0, 1],
      });

      const optimized = OptimizeSong(song).optimizedSong;
      const prepared = prepareSongColumns(song);

      assert.notEqual(optimized.songOrder[0].patternIndex, optimized.songOrder[1].patternIndex);
      assert.equal(prepared.patternColumns.length, 1, "audio-column dedup remains audio-only");
      assert.equal(
         optimized.patterns[optimized.songOrder[0].patternIndex].getSideChannelCell(0),
         "bomb",
      );
      assert.equal(
         optimized.patterns[optimized.songOrder[1].patternIndex].getSideChannelCell(0),
         "flicker",
      );
   });

   it("prepares one sparse pattern-row map for repeated enabled pattern uses", () => {
      const repeated = new Pattern();
      repeated.setSideChannelCell(0, "bomb");
      repeated.setSideChannelCell(3, "last-visible");
      repeated.setSideChannelCell(4, "after-end");
      repeated.setCell(0, 3, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      const disabled = new Pattern();
      disabled.setSideChannelCell(0, "disabled");
      const song = new Song({
         rowsPerPattern: 8,
         patterns: [repeated.toData(), disabled.toData()],
         songOrder: [0, 0, 1],
      });
      song.songOrder[2].enabled = false;

      const prepared = prepareSongColumns(song);

      assert.deepEqual(prepared.songOrder.map((entry) => entry.patternIndex), [0, 0]);
      assert.deepEqual(Array.from(prepared.sideChannelData.keys()), [0]);
      assert.deepEqual(Array.from(prepared.sideChannelData.get(0)!), [
         [0, "bomb"],
         [3, "last-visible"],
      ]);
   });
});
