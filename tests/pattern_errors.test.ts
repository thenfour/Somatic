import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {analyzePatternPlaybackForGrid, analyzePatternRowIssues, Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand, kTic80EffectCommand} from "../src/models/tic80Capabilities";

describe("pattern row issues", () => {
   it("reports the existing cell validation rules and counts distinct rows", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {tic80Effect: kTic80EffectCommand.key.J});
      pattern.setCell(1, 1, {tic80EffectX: 1});
      pattern.setCell(2, 2, {instrumentIndex: 1});
      pattern.setCell(3, 3, {somaticParam: 0x80});

      const analysis = analyzePatternRowIssues(pattern, 8, 4);

      assert.equal(analysis.issueRowCount, 4);
      assert.equal(analysis.hasStrongIssues, true);
      assert.equal(
         analysis.issuesByRow[0][0].message,
         "The 'J' command is not supported in Somatic patterns.",
      );
      assert.equal(
         analysis.issuesByRow[1][0].message,
         "Effect parameter set without an effect command.",
      );
      assert.equal(
         analysis.issuesByRow[2][0].message,
         "Instrument set without a note.",
      );
      assert.equal(
         analysis.issuesByRow[3][0].message,
         "Somatic effect parameter set without a Somatic effect command.",
      );
      assert.deepEqual(
         analysis.issuesByRow.slice(0, 4).map((issues) => issues[0].channelIndex),
         [0, 1, 2, 3],
      );
      assert.ok(analysis.issuesByRow.slice(0, 4).every((issues) => issues[0].emphasis === "strong"));
   });

   it("reports a single row error when Somatic C has no free TIC effect slot", () => {
      const pattern = new Pattern();
      for (let channelIndex = 0; channelIndex < 4; channelIndex++) {
         pattern.setCell(channelIndex, 4, {tic80Effect: kTic80EffectCommand.key.M});
      }
      pattern.setCell(0, 4, {
         tic80Effect: kTic80EffectCommand.key.M,
         somaticEffect: kSomaticPatternCommand.key.PatternEnd,
      });

      const analysis = analyzePatternRowIssues(pattern, 8, 4);

      assert.equal(analysis.issueRowCount, 1);
      assert.equal(analysis.hasStrongIssues, true);
      assert.deepEqual(
         analysis.issuesByRow[4],
         [{
            rowIndex: 4,
            message: "Somatic C needs one channel without a TIC effect command.",
            emphasis: "strong",
         }],
      );
   });

   it("does not report Somatic C when one channel has a free TIC effect slot", () => {
      const pattern = new Pattern();
      for (let channelIndex = 0; channelIndex < 3; channelIndex++) {
         pattern.setCell(channelIndex, 4, {tic80Effect: kTic80EffectCommand.key.M});
      }
      pattern.setCell(0, 4, {
         tic80Effect: kTic80EffectCommand.key.M,
         somaticEffect: kSomaticPatternCommand.key.PatternEnd,
      });

      const analysis = analyzePatternRowIssues(pattern, 8, 4);

      assert.equal(analysis.issueRowCount, 0);
      assert.equal(analysis.hasStrongIssues, false);
      assert.ok(analysis.issuesByRow.flat().length === 0);
   });

   it("counts multiple channel errors on the same row once", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 2, {instrumentIndex: 1});
      pattern.setCell(1, 2, {somaticParam: 0x80});

      const analysis = analyzePatternRowIssues(pattern, 8, 4);

      assert.equal(analysis.issueRowCount, 1);
      assert.equal(analysis.issuesByRow[2].length, 2);
   });

   it("treats waveform render-slot conflicts as marker issues", () => {
      const song = new Song({rowsPerPattern: 8});
      const pattern = song.patterns[0];
      song.instruments[0].waveEngine = "pwm";
      song.instruments[0].renderWaveformSlot = 3;
      pattern.setCell(0, 0, {midiNote: 60, instrumentIndex: 0});
      pattern.setCell(1, 0, {midiNote: 60, instrumentIndex: 0});
      pattern.setCell(0, 1, {noteOff: true});
      pattern.setCell(1, 1, {noteOff: true});

      const {kRateRenderSlotConflictByRow} = analyzePatternPlaybackForGrid(song, 0);
      const analysis = analyzePatternRowIssues(
         pattern,
         song.rowsPerPattern,
         song.subsystem.channelCount,
         kRateRenderSlotConflictByRow,
      );

      assert.equal(kRateRenderSlotConflictByRow[0], true);
      assert.equal(kRateRenderSlotConflictByRow[1], false);
      assert.equal(analysis.issueRowCount, 1);
      assert.equal(analysis.hasStrongIssues, false);
      assert.deepEqual(
         analysis.issuesByRow[0],
         [{
            rowIndex: 0,
            message: "Two or more channels render to the same waveform slot on this row",
            emphasis: "marker",
         }],
      );
   });
});
