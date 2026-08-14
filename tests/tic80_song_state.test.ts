import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {kSomaticPatternCommand, kTic80EffectCommand} from "../src/models/tic80Capabilities";
import {getTic80SongStateAccumulator} from "../src/subsystem/tic80/tic80_song_state";

describe("TIC-80 lazy song state", () => {
   it("reuses one accumulator per song generation", () => {
      const song = new Song();

      assert.equal(getTic80SongStateAccumulator(song), getTic80SongStateAccumulator(song));
      assert.notEqual(getTic80SongStateAccumulator(song), getTic80SongStateAccumulator(song.clone()));
   });

   it("accumulates effect state across order entries and applies nominal resets", () => {
      const first = new Pattern();
      first.setCell(0, 1, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 8,
         tic80EffectY: 15,
      });
      first.setCell(1, 2, {
         somaticEffect: kSomaticPatternCommand.key.EffectStrengthScale,
         somaticParam: 128,
      });
      const second = new Pattern();
      second.setCell(0, 2, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 15,
         tic80EffectY: 15,
      });
      const song = new Song({
         rowsPerPattern: 4,
         patterns: [first.toData(), second.toData()],
         songOrder: [0, 1],
      });
      const analysis = getTic80SongStateAccumulator(song);

      const beforeReset = analysis.getRowState(1, 2).beforeRow;
      assert.deepEqual(
         beforeReset[0].tic80EffectCommandStates.get(kTic80EffectCommand.key.M),
         {effectX: 8, effectY: 15, songPosition: 0, rowIndex: 1},
      );
      assert.deepEqual(
         beforeReset[1].somaticCommandStates.get(kSomaticPatternCommand.key.EffectStrengthScale),
         {paramU8: 128, songPosition: 0, rowIndex: 2},
      );

      const afterReset = analysis.getRowState(1, 2).afterRow;
      assert.equal(afterReset[0].tic80EffectCommandStates.has(kTic80EffectCommand.key.M), false);
      assert.deepEqual(
         afterReset[1].somaticCommandStates.get(kSomaticPatternCommand.key.EffectStrengthScale),
         {paramU8: 128, songPosition: 0, rowIndex: 2},
      );
   });

   it("keeps disabled orders local to editor queries without carrying them forward", () => {
      const first = new Pattern();
      first.setCell(0, 0, {midiNote: 60});
      const disabled = new Pattern();
      disabled.setCell(0, 0, {midiNote: 65});
      disabled.setCell(0, 1, {
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 9,
         tic80EffectY: 0,
      });
      const final = new Pattern();
      const song = new Song({
         rowsPerPattern: 2,
         patterns: [first.toData(), disabled.toData(), final.toData()],
         songOrder: [0, 1, 2],
      });
      song.songOrder[1].enabled = false;
      const analysis = getTic80SongStateAccumulator(song);

      assert.equal(analysis.getRowState(1, 1).beforeRow[0].activeNote?.midiNote, 65);
      assert.deepEqual(
         analysis.getEffectCarryAtOrderEnd(1)[0].tic80EffectCommandStates.get(kTic80EffectCommand.key.P),
         {effectX: 9, effectY: 0, songPosition: 1, rowIndex: 1},
      );
      assert.equal(analysis.getRowState(2, 0).beforeRow[0].activeNote?.midiNote, 60);
      assert.equal(
         analysis.getRowState(2, 0).beforeRow[0].tic80EffectCommandStates.has(kTic80EffectCommand.key.P),
         false,
      );
   });

   it("returns stable cached state when positions are queried out of order", () => {
      const first = new Pattern();
      first.setCell(0, 0, {midiNote: 60});
      const second = new Pattern();
      second.setCell(0, 1, {midiNote: 65});
      const song = new Song({
         rowsPerPattern: 4,
         patterns: [first.toData(), second.toData()],
         songOrder: [0, 1],
      });
      const analysis = getTic80SongStateAccumulator(song);

      const later = analysis.getRowState(1, 3);
      const earlier = analysis.getRowState(1, 0);

      assert.equal(later.afterRow[0].activeNote?.midiNote, 65);
      assert.equal(earlier.beforeRow[0].activeNote?.midiNote, 60);
      assert.equal(analysis.getRowState(1, 0), earlier);
      assert.equal(analysis.getRowState(1, 3), later);
   });

   it("stops canonical accumulation at pattern end and records the latest command source", () => {
      const first = new Pattern();
      first.setCell(0, 0, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 8,
         tic80EffectY: 15,
      });
      first.setCell(0, 1, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 8,
         tic80EffectY: 15,
      });
      first.setCell(1, 1, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      first.setCell(0, 3, {
         tic80Effect: kTic80EffectCommand.key.M,
         tic80EffectX: 7,
         tic80EffectY: 15,
      });
      const song = new Song({
         rowsPerPattern: 4,
         patterns: [first.toData(), new Pattern().toData()],
         songOrder: [0, 1],
      });
      const analysis = getTic80SongStateAccumulator(song);

      const inherited = analysis.getRowState(1, 0).beforeRow[0]
         .tic80EffectCommandStates.get(kTic80EffectCommand.key.M);
      assert.deepEqual(inherited, {
         effectX: 8,
         effectY: 15,
         songPosition: 0,
         rowIndex: 1,
      });

      const unreachable = analysis.getRowState(0, 3);
      assert.equal(unreachable.rowReachable, false);
      assert.deepEqual(
         unreachable.afterRow[0].tic80EffectCommandStates.get(kTic80EffectCommand.key.M),
         {effectX: 7, effectY: 15, songPosition: 0, rowIndex: 3},
      );
      assert.equal(analysis.getRowState(0, 3), unreachable);
      assert.equal(
         analysis.getEffectCarryAtOrderEnd(0),
         analysis.getEffectCarryAtOrderEnd(0),
      );
   });
});
