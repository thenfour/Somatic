import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand} from "../src/models/tic80Capabilities";


describe("Song channel note context", () => {
   it("resolves sustained notes and their origin across song-order entries", () => {
      const first = new Pattern();
      first.setCell(0, 2, {midiNote: 60});
      const second = new Pattern();
      const song = new Song({
         rowsPerPattern: 4,
         patterns: [first.toData(), second.toData()],
         songOrder: [0, 1],
      });

      assert.deepEqual(song.getChannelNoteContext(1, 0, 0), {
         activeBeforeRow: {midiNote: 60, songPosition: 0, rowIndex: 2},
         activeAfterNoteColumn: {midiNote: 60, songPosition: 0, rowIndex: 2},
         source: "sustained",
         rowReachable: true,
      });
   });

   it("distinguishes the entering note from a current-row note", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {midiNote: 60});
      pattern.setCell(0, 2, {midiNote: 65});
      const song = new Song({rowsPerPattern: 4, patterns: [pattern.toData()], songOrder: [0]});

      assert.deepEqual(song.getChannelNoteContext(0, 0, 2), {
         activeBeforeRow: {midiNote: 60, songPosition: 0, rowIndex: 0},
         activeAfterNoteColumn: {midiNote: 65, songPosition: 0, rowIndex: 2},
         source: "current-cell",
         rowReachable: true,
      });
   });

   it("applies a current-row note cut after preserving the entering note", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {midiNote: 60});
      pattern.setCell(0, 1, {noteOff: true});
      const song = new Song({rowsPerPattern: 4, patterns: [pattern.toData()], songOrder: [0]});

      assert.deepEqual(song.getChannelNoteContext(0, 0, 1), {
         activeBeforeRow: {midiNote: 60, songPosition: 0, rowIndex: 0},
         source: "none",
         rowReachable: true,
      });
      assert.deepEqual(song.getChannelNoteContext(0, 0, 2), {
         activeBeforeRow: undefined,
         activeAfterNoteColumn: undefined,
         source: "none",
         rowReachable: true,
      });
   });

   it("marks note-column context after a Somatic pattern end as unreachable", () => {
      const pattern = new Pattern();
      pattern.setCell(1, 0, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      pattern.setCell(0, 2, {midiNote: 60});
      const song = new Song({rowsPerPattern: 4, patterns: [pattern.toData()], songOrder: [0]});

      assert.deepEqual(song.getChannelNoteContext(0, 0, 2), {
         activeBeforeRow: undefined,
         activeAfterNoteColumn: {midiNote: 60, songPosition: 0, rowIndex: 2},
         source: "current-cell",
         rowReachable: false,
      });
   });
});
