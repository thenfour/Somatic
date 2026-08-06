import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";
import {calculateSongUsage} from "../src/subsystem/tic80/SongOptimizer";

describe("song usage", () => {
   it("collects the used instruments that reference each waveform", () => {
      const song = new Song();
      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 3});
      song.patterns[0].setCell(1, 0, {midiNote: 64, instrumentIndex: 1});

      song.instruments[1].waveFrames.fill(5);
      song.instruments[1].waveFrames[0] = 7;
      song.instruments[3].waveFrames.fill(5);
      song.instruments[4].waveFrames.fill(5);

      const usage = calculateSongUsage(song);

      assert.deepEqual(usage.usedWaveforms.get(5), [1, 3]);
      assert.deepEqual(usage.usedWaveforms.get(7), [1]);
      assert.equal(usage.usedWaveforms.has(0), false);
      assert.equal(usage.usedWaveforms.get(5)?.includes(4), false);
   });
});
