import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";

describe("instrument slot operations", () => {
   it("resets every requested slot without compacting the fixed instrument bank", () => {
      const song = new Song();
      const originalCount = song.instruments.length;
      song.instruments[1].name = "keep before";
      song.instruments[2].name = "custom two";
      song.instruments[3].name = "custom three";
      song.instruments[4].name = "keep after";

      song.resetInstrumentSlotsToDefaults([2, 3]);

      assert.equal(song.instruments.length, originalCount);
      assert.equal(song.instruments[1].name, "keep before");
      assert.equal(song.instruments[2].name, "new inst 02");
      assert.equal(song.instruments[3].name, "new inst 03");
      assert.equal(song.instruments[4].name, "keep after");
   });

   it("moves a contiguous block and remaps pattern references to preserve instrument identity", () => {
      const song = new Song();
      song.instruments[0].name = "A";
      song.instruments[1].name = "B";
      song.instruments[2].name = "C";
      song.instruments[3].name = "D";
      for (let rowIndex = 0; rowIndex < 4; rowIndex += 1) {
         song.patterns[0].setCell(0, rowIndex, {midiNote: 60, instrumentIndex: rowIndex});
      }

      assert.equal(song.moveInstrumentRange(1, 2, -1), true);

      assert.deepEqual(song.instruments.slice(0, 4).map((instrument) => instrument.name), ["B", "C", "A", "D"]);
      assert.deepEqual(
         Array.from({length: 4}, (_, rowIndex) => song.patterns[0].getCell(0, rowIndex).instrumentIndex),
         [2, 0, 1, 3],
      );

      assert.equal(song.moveInstrumentRange(0, 2, 1), true);
      assert.deepEqual(song.instruments.slice(0, 4).map((instrument) => instrument.name), ["A", "B", "C", "D"]);
      assert.deepEqual(
         Array.from({length: 4}, (_, rowIndex) => song.patterns[0].getCell(0, rowIndex).instrumentIndex),
         [0, 1, 2, 3],
      );
   });
});
