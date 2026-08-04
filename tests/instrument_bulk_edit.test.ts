import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand, kTic80EffectCommand} from "../src/models/tic80Capabilities";

describe("Pattern note dependency clearing", () => {
   it("clears a note, its effect rows, and its note cut without crossing the note boundary", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 1, {midiNote: 60, instrumentIndex: 2});
      pattern.setCell(0, 2, {
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 8,
         tic80EffectY: 1,
      });
      pattern.setCell(0, 3, {volumeU8: 128});
      pattern.setCell(0, 4, {
         somaticEffect: kSomaticPatternCommand.key.FilterFrequency,
         somaticParam: 64,
      });
      pattern.setCell(0, 5, {noteOff: true, midiNote: 60});
      pattern.setCell(0, 6, {tic80Effect: kTic80EffectCommand.key.V, tic80EffectX: 2, tic80EffectY: 3});

      assert.deepEqual(pattern.clearNoteCellAndDependents(0, 1, 8), [1, 2, 3, 4, 5]);

      for (const rowIndex of [1, 2, 3, 4, 5]) {
         assert.deepEqual(pattern.getCell(0, rowIndex), {});
      }
      assert.equal(pattern.getCell(0, 6).tic80Effect, kTic80EffectCommand.key.V);
   });

   it("stops before the next note and leaves its dependent cells intact", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 1, {panU8: 32});
      pattern.setCell(0, 2, {midiNote: 64, instrumentIndex: 3});
      pattern.setCell(0, 3, {panU8: 224});

      assert.deepEqual(pattern.clearNoteCellAndDependents(0, 0, 4), [0, 1]);
      assert.deepEqual(pattern.getCell(0, 0), {});
      assert.deepEqual(pattern.getCell(0, 1), {});
      assert.equal(pattern.getCell(0, 2).midiNote, 64);
      assert.equal(pattern.getCell(0, 3).panU8, 224);
   });

   it("preserves global playback commands while clearing later note-local controls", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {midiNote: 60, instrumentIndex: 1});
      pattern.setCell(0, 1, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 15,
         tic80EffectY: 15,
      });
      pattern.setCell(0, 2, {
         somaticEffect: kSomaticPatternCommand.key.PatternEnd,
      });
      pattern.setCell(0, 3, {panU8: 32});

      assert.deepEqual(pattern.clearNoteCellAndDependents(0, 0, 4), [0, 3]);
      assert.equal(pattern.getCell(0, 1).tic80Effect, kTic80EffectCommand.key.M);
      assert.equal(pattern.getCell(0, 2).somaticEffect, kSomaticPatternCommand.key.PatternEnd);
      assert.deepEqual(pattern.getCell(0, 3), {});
   });
});

describe("instrument range deletion", () => {
   it("clears referencing note chains, compacts instruments, and remaps every stored pattern", () => {
      const arranged = new Pattern();
      arranged.setCell(0, 0, {midiNote: 60, instrumentIndex: 1});
      arranged.setCell(0, 1, {tic80Effect: kTic80EffectCommand.key.P, tic80EffectX: 8, tic80EffectY: 1});
      arranged.setCell(0, 2, {noteOff: true, midiNote: 60});
      arranged.setCell(0, 4, {midiNote: 67, instrumentIndex: 3});

      const unarranged = new Pattern();
      unarranged.setCell(0, 0, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      unarranged.setCell(1, 4, {midiNote: 62, instrumentIndex: 2});
      unarranged.setCell(1, 5, {volumeU8: 100});
      unarranged.setCell(1, 6, {midiNote: 69, instrumentIndex: 4});

      const song = new Song({
         rowsPerPattern: 8,
         patterns: [arranged.toData(), unarranged.toData()],
         songOrder: [0],
      });
      ["A", "B", "C", "D", "E"].forEach((name, index) => song.instruments[index].name = name);

      assert.deepEqual(song.analyzeInstrumentRangeDeletion(1, 2), {
         instrumentCount: 2,
         referenceCellCount: 2,
         clearedCellCount: 5,
      });
      assert.deepEqual(song.deleteInstrumentRange(1, 2), {
         instrumentCount: 2,
         referenceCellCount: 2,
         clearedCellCount: 5,
      });

      assert.deepEqual(song.instruments.slice(0, 3).map((instrument) => instrument.name), ["A", "D", "E"]);
      assert.equal(song.instruments.length, song.subsystem.maxInstruments);
      assert.deepEqual(song.patterns[0].getCell(0, 0), {});
      assert.deepEqual(song.patterns[0].getCell(0, 1), {});
      assert.deepEqual(song.patterns[0].getCell(0, 2), {});
      assert.equal(song.patterns[0].getCell(0, 4).instrumentIndex, 1);
      assert.deepEqual(song.patterns[1].getCell(1, 4), {});
      assert.deepEqual(song.patterns[1].getCell(1, 5), {});
      assert.equal(song.patterns[1].getCell(1, 6).instrumentIndex, 2);
   });
});

describe("instrument range duplication", () => {
   it("inserts independent copies after the source block and preserves existing references", () => {
      const song = new Song({rowsPerPattern: 4});
      song.instruments[1].name = "B";
      song.instruments[2].name = "C";
      song.instruments[3].name = "D";
      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 1});
      song.patterns[0].setCell(0, 1, {midiNote: 62, instrumentIndex: 3});

      assert.deepEqual(song.analyzeInstrumentRangeDuplication(1, 2), {
         canDuplicate: true,
         hasCapacity: true,
         blockingTailIndices: [],
      });
      assert.deepEqual(song.duplicateInstrumentRange(1, 2), {firstIndex: 3, count: 2});

      assert.deepEqual(song.instruments.slice(1, 6).map((instrument) => instrument.name), ["B", "C", "B", "C", "D"]);
      assert.equal(song.patterns[0].getCell(0, 0).instrumentIndex, 1);
      assert.equal(song.patterns[0].getCell(0, 1).instrumentIndex, 5);
      song.instruments[1].name = "changed original";
      assert.equal(song.instruments[3].name, "B");
   });

   it("rejects duplication when a discarded tail slot is referenced", () => {

      const referenced = new Song();
      const lastIndex = referenced.instruments.length - 1;
      referenced.patterns[0].setCell(0, referenced.rowsPerPattern - 1, {
         midiNote: 60,
         instrumentIndex: lastIndex,
      });
      assert.deepEqual(referenced.analyzeInstrumentRangeDuplication(1, 1), {
         canDuplicate: false,
         hasCapacity: true,
         blockingTailIndices: [lastIndex],
      });
   });

   it("rejects a selection too close to the end to fit the full copied block", () => {
      const song = new Song();
      const firstIndex = song.instruments.length - 3;

      assert.deepEqual(song.analyzeInstrumentRangeDuplication(firstIndex, 2), {
         canDuplicate: false,
         hasCapacity: false,
         blockingTailIndices: [],
      });
      assert.equal(song.duplicateInstrumentRange(firstIndex, 2), null);
      assert.equal(song.instruments.length, song.subsystem.maxInstruments);
   });

   it("analyzes deletion and duplication without materializing sparse pattern cells", () => {
      const song = new Song({patterns: [new Pattern().toData()]});
      const before = JSON.stringify(song.patterns.map((pattern) => pattern.toData()));

      song.analyzeInstrumentRangeDeletion(1, 2);
      song.analyzeInstrumentRangeDuplication(1, 2);

      assert.equal(JSON.stringify(song.patterns.map((pattern) => pattern.toData())), before);
   });
});
