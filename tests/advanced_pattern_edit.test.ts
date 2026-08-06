import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand, kTic80EffectCommand} from "../src/models/tic80Capabilities";
import {contractPatternRows, evenlyDistributeNotesInPattern, expandPatternRows} from "../src/utils/advancedPatternEdit";

describe("scale pattern rows", () => {
   it("expands complete cells downward and clears every inserted row", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 1, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 3, {midiNote: 62, tic80Effect: kTic80EffectCommand.key.P});
      pattern.setCell(0, 4, {midiNote: 63, somaticParam: 24});
      pattern.setCell(0, 5, {midiNote: 70});
      pattern.setCell(0, 9, {midiNote: 71});
      pattern.setCell(1, 2, {midiNote: 72});

      const result = expandPatternRows(pattern, [0], {start: 1, end: 4}, 10);

      assert.deepEqual(result, {mutated: true, resultingRowRange: {start: 1, end: 8}});
      assert.deepEqual(
         Array.from({length: 8}, (_, offset) => pattern.getCell(0, offset + 1)),
         [
            {midiNote: 60, instrumentIndex: 1},
            {},
            {},
            {},
            {midiNote: 62, tic80Effect: kTic80EffectCommand.key.P},
            {},
            {midiNote: 63, somaticParam: 24},
            {},
         ],
      );
      assert.deepEqual(pattern.getCell(0, 9), {midiNote: 71});
      assert.deepEqual(pattern.getCell(1, 2), {midiNote: 72});
   });

   it("clips expansion and its resulting range at the pattern boundary", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 5, {midiNote: 60});
      pattern.setCell(0, 6, {midiNote: 62});
      pattern.setCell(0, 7, {midiNote: 64});

      const result = expandPatternRows(pattern, [0], {start: 5, end: 7}, 8);

      assert.deepEqual(result.resultingRowRange, {start: 5, end: 7});
      assert.deepEqual(pattern.getCell(0, 5), {midiNote: 60});
      assert.deepEqual(pattern.getCell(0, 6), {});
      assert.deepEqual(pattern.getCell(0, 7), {midiNote: 62});
   });

   it("contracts every other row into the first half and clears the second half", () => {
      const pattern = new Pattern();
      for (let row = 1; row <= 8; row++)
         pattern.setCell(0, row, {midiNote: 59 + row});
      pattern.setCell(0, 9, {midiNote: 80});

      const result = contractPatternRows(pattern, [0], {start: 1, end: 8}, 10);

      assert.deepEqual(result, {mutated: true, resultingRowRange: {start: 1, end: 4}});
      assert.deepEqual(
         [1, 2, 3, 4].map((row) => pattern.getCell(0, row).midiNote),
         [60, 62, 64, 66],
      );
      assert.deepEqual([5, 6, 7, 8].map((row) => pattern.getCell(0, row)), [{}, {}, {}, {}]);
      assert.deepEqual(pattern.getCell(0, 9), {midiNote: 80});
   });

   it("round-trips an odd clipped expansion and contracts its selection with ceiling division", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 3, {midiNote: 60});
      pattern.setCell(0, 4, {midiNote: 62});
      pattern.setCell(0, 5, {midiNote: 64});

      const expanded = expandPatternRows(pattern, [0], {start: 3, end: 5}, 8);
      const contracted = contractPatternRows(pattern, [0], expanded.resultingRowRange!, 8);

      assert.deepEqual(contracted.resultingRowRange, {start: 3, end: 5});
      assert.deepEqual([3, 4, 5].map((row) => pattern.getCell(0, row).midiNote), [60, 62, 64]);
      assert.deepEqual(pattern.getCell(0, 6), {});
      assert.deepEqual(pattern.getCell(0, 7), {});
   });
});

describe("evenly distribute pattern notes", () => {
   it("fills the selected duration and synthesizes row-local Dxx delays", () => {
      const song = new Song({rowsPerPattern: 8, tempo: 150, speed: 6});
      const pattern = song.patterns[0];
      pattern.setCell(0, 0, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 5, {midiNote: 62, instrumentIndex: 2});
      pattern.setCell(0, 6, {midiNote: 64, instrumentIndex: 3});

      const result = evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0],
         {start: 0, end: 7},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
      );

      assert.deepEqual(result, {
         mutated: true,
         eligibleNoteCount: 3,
         processedChannelCount: 1,
         fixedNoteCollisionChannelCount: 0,
         unrepresentableDelayChannelCount: 0,
      });
      assert.deepEqual(pattern.getCell(0, 0), {midiNote: 60, instrumentIndex: 1});
      assert.deepEqual(pattern.getCell(0, 2), {
         midiNote: 62,
         instrumentIndex: 2,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 4,
      });
      assert.deepEqual(pattern.getCell(0, 5), {
         midiNote: 64,
         instrumentIndex: 3,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 2,
      });
      assert.deepEqual(pattern.getCell(0, 6), {});
   });

   it("moves co-located fields while leaving note-less rows fixed", () => {
      const song = new Song({rowsPerPattern: 8, tempo: 150, speed: 6});
      const pattern = song.patterns[0];
      pattern.setCell(0, 0, {
         midiNote: 60,
         instrumentIndex: 1,
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 8,
         tic80EffectY: 1,
      });
      pattern.setCell(0, 2, {
         panU8: 32,
         tic80Effect: kTic80EffectCommand.key.V,
         tic80EffectX: 2,
         tic80EffectY: 3,
      });
      pattern.setCell(0, 3, {volumeU8: 77});
      pattern.setCell(0, 5, {midiNote: 62, instrumentIndex: 2, volumeU8: 128});
      pattern.setCell(0, 6, {
         midiNote: 64,
         instrumentIndex: 3,
         panU8: 224,
         somaticEffect: kSomaticPatternCommand.key.FilterFrequency,
         somaticParam: 64,
      });
      pattern.setCell(0, 7, {midiNote: 64, noteOff: true});

      evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0],
         {start: 0, end: 7},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
      );

      assert.deepEqual(pattern.getCell(0, 0), {
         midiNote: 60,
         instrumentIndex: 1,
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 8,
         tic80EffectY: 1,
      });
      assert.deepEqual(pattern.getCell(0, 2), {
         midiNote: 62,
         instrumentIndex: 2,
         volumeU8: 128,
         panU8: 32,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 4,
      });
      assert.deepEqual(pattern.getCell(0, 3), {volumeU8: 77});
      assert.deepEqual(pattern.getCell(0, 5), {
         midiNote: 64,
         instrumentIndex: 3,
         panU8: 224,
         somaticEffect: kSomaticPatternCommand.key.FilterFrequency,
         somaticParam: 64,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 2,
      });
      assert.deepEqual(pattern.getCell(0, 6), {});
      assert.deepEqual(pattern.getCell(0, 7), {midiNote: 64, noteOff: true});
   });

   it("processes selected channels independently", () => {
      const song = new Song({rowsPerPattern: 8, tempo: 150, speed: 6});
      const pattern = song.patterns[0];
      pattern.setCell(0, 1, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 7, {midiNote: 62, instrumentIndex: 1});
      pattern.setCell(1, 1, {midiNote: 65, instrumentIndex: 2});
      pattern.setCell(1, 2, {midiNote: 67, instrumentIndex: 2});
      pattern.setCell(1, 7, {midiNote: 69, instrumentIndex: 2});

      evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0, 1],
         {start: 0, end: 7},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
      );

      assert.deepEqual([0, 4].map((row) => pattern.getCell(0, row).midiNote), [60, 62]);
      assert.deepEqual([0, 2, 5].map((row) => pattern.getCell(1, row).midiNote), [65, 67, 69]);
      assert.deepEqual(
         [0, 2, 5].map((row) => pattern.getCell(1, row).tic80EffectY),
         [undefined, 4, 2],
      );
   });

   it("leaves note cuts fixed and skips a channel when one occupies a target row", () => {
      const song = new Song({rowsPerPattern: 8, tempo: 150, speed: 6});
      const pattern = new Pattern();
      pattern.setCell(0, 1, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 6, {midiNote: 64, instrumentIndex: 1});
      pattern.setCell(0, 4, {midiNote: 64, noteOff: true});
      const before = pattern.contentSignature();

      const result = evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0],
         {start: 0, end: 7},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
      );

      assert.equal(result.mutated, false);
      assert.equal(result.eligibleNoteCount, 2);
      assert.equal(result.fixedNoteCollisionChannelCount, 1);
      assert.equal(pattern.contentSignature(), before);
   });

   it("honors the advanced-edit instrument filter", () => {
      const song = new Song({rowsPerPattern: 8, tempo: 150, speed: 6});
      const pattern = song.patterns[0];
      pattern.setCell(0, 1, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 3, {midiNote: 62, instrumentIndex: 2});
      pattern.setCell(0, 7, {midiNote: 64, instrumentIndex: 1});

      const result = evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0],
         {start: 0, end: 7},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
         1,
      );

      assert.equal(result.fixedNoteCollisionChannelCount, 0);
      assert.equal(pattern.getCell(0, 0).midiNote, 60);
      assert.equal(pattern.getCell(0, 3).midiNote, 62);
      assert.equal(pattern.getCell(0, 4).midiNote, 64);
      assert.deepEqual(pattern.getCell(0, 1), {});
      assert.deepEqual(pattern.getCell(0, 7), {});
   });

   it("removes an obsolete Dxx when a note lands exactly on a row boundary", () => {
      const song = new Song({rowsPerPattern: 4, tempo: 150, speed: 6});
      const pattern = song.patterns[0];
      pattern.setCell(0, 2, {
         midiNote: 60,
         instrumentIndex: 1,
         tic80Effect: kTic80EffectCommand.key.D,
         tic80EffectX: 0,
         tic80EffectY: 5,
      });

      evenlyDistributeNotesInPattern(
         song.subsystem,
         pattern,
         [0],
         {start: 0, end: 3},
         song.rowsPerPattern,
         {tempo: song.tempo, speed: song.speed},
      );

      assert.deepEqual(pattern.getCell(0, 0), {midiNote: 60, instrumentIndex: 1});
      assert.deepEqual(pattern.getCell(0, 2), {});
   });
});
