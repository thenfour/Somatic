import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";
import {gTic80AllChannelsAudible} from "../src/models/tic80Capabilities";
import {decodeTrackSpeed, encodeTrackSpeed} from "../src/subsystem/tic80/tic80_serialization";
import {Tic80Constants, Tic80MemoryMap} from "../bridge/memory_layout";

const testRequire = createRequire(import.meta.url);
(testRequire as any).extensions[".lua"] = (module: NodeModule, filename: string) => {
   (module as any).exports = fs.readFileSync(filename, "utf8");
};

describe("TIC-80 track speed serialization", () => {
   it("encodes display speeds as signed deltas from TIC-80's default speed", () => {
      const expectedBytes = [
         [1, 251],
         [2, 252],
         [3, 253],
         [4, 254],
         [5, 255],
         [6, 0],
         [7, 1],
      ] as const;

      for (const [displaySpeed, expectedByte] of expectedBytes) {
         const encoded = encodeTrackSpeed(displaySpeed);
         const signedDelta = encoded >= 128 ? encoded - 256 : encoded;

         assert.equal(encoded, expectedByte, `encoded byte for speed ${displaySpeed}`);
         assert.equal(signedDelta + 6, displaySpeed, `TIC-80 runtime speed for ${displaySpeed}`);
         assert.equal(decodeTrackSpeed(encoded), displaySpeed, `round trip for speed ${displaySpeed}`);
      }
   });
});

describe("TIC-80 k-rate waveform rendering", () => {
   it("renders into per-channel sound registers without consuming a destination waveform slot", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const instrument = song.instruments[0];
      instrument.waveEngine = "native";
      instrument.sourceWaveformIndex = 3;
      instrument.lowpassEnabled = true;
      (instrument as any).renderWaveformSlot = 15;
      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 0});

      assert.equal(
         Tic80MemoryMap.SoundRegisters.size,
         Tic80Constants.MUSIC_CHANNELS * Tic80Constants.BYTES_PER_SOUND_REGISTER,
      );
      assert.deepEqual([...instrument.getUsedWaveformIndices()], [3]);

      const details = serializeSongToCartDetailed(song, false, "debug", gTic80AllChannelsAudible);
      assert.match(
         details.wholePlayroutineCode,
         new RegExp(`local\\s+SOUND_REGISTERS_BASE\\s*=\\s*${Tic80MemoryMap.SoundRegisters.address}`),
      );
      assert.match(
         details.wholePlayroutineCode,
         /SOUND_REGISTERS_BASE\s*\+\s*channel\s*\*\s*SOUND_REGISTER_BYTES\s*\+\s*SOUND_REGISTER_WAVEFORM_OFFSET/,
      );
      assert.match(details.wholePlayroutineCode, /write_channel_waveform\(ch,\s*render_out\)/);
      assert.doesNotMatch(details.wholePlayroutineCode, /renderWaveformSlot/);
   });
});
