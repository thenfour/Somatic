import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Pattern} from "../src/models/pattern";
import {buildCueSheet, Song} from "../src/models/song";
import {kSomaticPatternCommand} from "../src/models/tic80Capabilities";
import {calculateSongUsage, OptimizeSong} from "../src/subsystem/tic80/SongOptimizer";
import {prepareSongColumns} from "../src/subsystem/tic80/tic80_prepared_song";

function makeTimingSong(): Song {
   const shortPattern = new Pattern();
   shortPattern.name = "Short";
   shortPattern.setCell(0, 3, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
   const disabledPattern = new Pattern();
   disabledPattern.name = "Experiment";
   const finalPattern = new Pattern();
   finalPattern.name = "Final";

   const song = new Song({
      rowsPerPattern: 8,
      highlightRowCount: 4,
      patterns: [shortPattern.toData(), disabledPattern.toData(), finalPattern.toData()],
      songOrder: [0, 1, 2],
   });
   song.songOrder[1].enabled = false;
   return song;
}

describe("disabled song orders", () => {
   it("persists the enabled flag and defaults legacy orders to enabled", () => {
      const song = makeTimingSong();
      assert.equal(song.clone().songOrder[1].enabled, false);
      assert.equal(song.toData().songOrder[1].enabled, false);

      const legacyData = song.toData() as any;
      delete legacyData.songOrder[1].enabled;
      assert.equal(Song.fromData(legacyData).songOrder[1].enabled, true);
   });

   it("excludes disabled orders from length and absolute-row conversions", () => {
      const song = makeTimingSong();

      assert.equal(song.getOrderEffectiveRowCount(1), 8, "editing still sees the physical pattern length");
      assert.equal(song.getSongLengthRows(), 12);
      assert.equal(song.buildTransportConfig().songBeatCount, 3);
      assert.equal(song.getAbsRowAtSongPosition(1, 6), 4, "a disabled order occupies no absolute rows");
      assert.equal(song.getAbsRowAtSongPosition(2, 2), 6);
      assert.deepEqual(song.getSongPositionAtAbsRow(4), {songPosition: 2, rowIndex: 0});
      assert.deepEqual(song.getSongPositionAtAbsRow(11), {songPosition: 2, rowIndex: 7});

      song.songOrder.forEach((item) => { item.enabled = false; });
      assert.equal(song.getSongLengthRows(), 0);
      assert.deepEqual(song.getSongPositionAtAbsRow(100), {songPosition: 0, rowIndex: 0});
   });

   it("prepares only enabled orders and emits silence when all are disabled", () => {
      const song = makeTimingSong();
      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 0});
      song.patterns[1].setCell(0, 0, {midiNote: 61, instrumentIndex: 1});
      song.patterns[2].setCell(0, 0, {midiNote: 62, instrumentIndex: 2});

      const prepared = prepareSongColumns(song);
      assert.equal(prepared.songOrder.length, 2);
      assert.deepEqual(prepared.songOrder.map((entry) => entry.effectiveRows), [4, 8]);
      assert.equal(prepared.patternColumns.some((column) => column.sourcePatternIndex === 1), false);

      song.songOrder.forEach((item) => { item.enabled = false; });
      const silent = prepareSongColumns(song);
      assert.equal(silent.songOrder.length, 1);
      assert.equal(silent.songOrder[0].effectiveRows, 1);
      assert.deepEqual(silent.patternColumns[0].channel.getCell(0), {});
   });

   it("omits disabled entries from cue sheets while retaining physical editor assets", () => {
      const song = makeTimingSong();
      const exportConfiguration = song.exportConfigurations[0];
      exportConfiguration.cueSheetFields = ["beat", "note"];
      song.patterns[1].setCell(0, 0, {midiNote: 61, instrumentIndex: 7});

      assert.deepEqual(buildCueSheet(song, exportConfiguration.cueSheetFields), [
         {beat: 0, note: "Short"},
         {beat: 1, note: "Final"},
      ]);
      assert.equal(song.getInstrumentUsageMap().has(7), true);
      assert.equal(calculateSongUsage(song).usedInstruments.has(7), false);
   });

   it("preserves disabled state and markers while optimizing playback reachability", () => {
      const song = makeTimingSong();
      song.songOrder[1].markerVariant = "star";
      song.patterns[1].setCell(0, 0, {midiNote: 61, instrumentIndex: 7});

      const optimized = OptimizeSong(song).optimizedSong;
      assert.equal(optimized.songOrder[1].enabled, false);
      assert.equal(optimized.songOrder[1].markerVariant, "star");
      assert.equal(calculateSongUsage(optimized).usedInstruments.has(7), false);
   });
});
