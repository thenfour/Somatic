import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand, SomaticCaps, TicMemoryMap} from "../src/models/tic80Capabilities";
import {encodePreparedSongOrderForBridge, prepareSongColumns} from "../src/subsystem/tic80/tic80_prepared_song";

describe("Somatic pattern end command", () => {
   it("uses the first Somatic C row as the effective pattern length", () => {
      const pattern = new Pattern();
      pattern.setCell(2, 5, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      pattern.setCell(0, 7, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});

      assert.equal(pattern.getPatternEndRow(8, 4), 5);
      assert.equal(pattern.getEffectiveRowCount(8, 4), 6);
      assert.equal(pattern.isRowReachable(5, 8, 4), true);
      assert.equal(pattern.isRowReachable(6, 8, 4), false);
   });

   it("treats a last-row Somatic C as full length", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 7, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});

      assert.equal(pattern.getPatternEndRow(8, 4), 7);
      assert.equal(pattern.getEffectiveRowCount(8, 4), 8);
   });

   it("maps song timing through effective order row counts", () => {
      const shortPattern = new Pattern();
      shortPattern.setCell(0, 3, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      const fullPattern = new Pattern();

      const song = new Song({
         rowsPerPattern: 8,
         patterns: [shortPattern.toData(), fullPattern.toData()],
         songOrder: [0, 1],
      });

      assert.equal(song.getOrderEffectiveRowCount(0), 4);
      assert.equal(song.getOrderEffectiveRowCount(1), 8);
      assert.equal(song.getSongLengthRows(), 12);
      assert.deepEqual(song.getSongPositionAtAbsRow(5), {songPosition: 1, rowIndex: 1});
      assert.equal(song.getAbsRowAtSongPosition(1, 2), 6);

      const prepared = prepareSongColumns(song);
      assert.equal(prepared.songOrder[0].effectiveRows, 4);
      assert.equal(prepared.songOrder[1].effectiveRows, 8);

      const payload = encodePreparedSongOrderForBridge(prepared);
      const rowsOffset = TicMemoryMap.TF_ORDER_LIST_ROWS - TicMemoryMap.TF_ORDER_LIST;
      assert.equal(SomaticCaps.maxSongLength, 255);
      assert.equal(TicMemoryMap.TF_ORDER_LIST_CAPACITY, 256);
      assert.equal(payload.length, TicMemoryMap.TF_PATTERN_DATA - TicMemoryMap.TF_ORDER_LIST);
      assert.equal(payload[rowsOffset], 4);
      assert.equal(payload[rowsOffset + 1], 8);
   });

   it("prepares only rows reachable through the first Somatic C", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 3, {
         midiNote: 60,
         instrumentIndex: 0,
         somaticEffect: kSomaticPatternCommand.key.PatternEnd,
         somaticParam: 0x12,
      });
      pattern.setCell(0, 4, {midiNote: 72, instrumentIndex: 1, panU8: 32});

      const song = new Song({
         rowsPerPattern: 8,
         patterns: [pattern.toData()],
         songOrder: [0],
      });
      const prepared = prepareSongColumns(song);
      const columnIndex = prepared.songOrder[0].patternColumnIndices[0];
      const preparedChannel = prepared.patternColumns[columnIndex].channel;

      assert.deepEqual(preparedChannel.getCell(3), {midiNote: 60, instrumentIndex: 0});
      assert.deepEqual(preparedChannel.getCell(4), {});
      assert.deepEqual(
         song.patterns[0].getCell(0, 4),
         {midiNote: 72, instrumentIndex: 1, panU8: 32},
         "preparation must not mutate the editor song",
      );
   });
});
