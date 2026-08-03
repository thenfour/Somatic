import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";
import {SomaticInstrument} from "../src/models/instruments";
import {gTic80AllChannelsAudible, kSomaticPatternCommand} from "../src/models/tic80Capabilities";
import {decodeInstrumentFromBytes66, decodeTrackSpeed, encodeInstrument, encodeTrackSpeed} from "../src/subsystem/tic80/tic80_serialization";
import {Tic80Constants, Tic80MemoryMap} from "../bridge/memory_layout";
import {MORPH_ENTRY_BYTES, SOMATIC_EXTRA_SONG_HEADER_BYTES, SOMATIC_PATTERN_ENTRY_BYTES} from "../bridge/morphSchema";

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

describe("legacy instrument stereo migration", () => {
   it("maps legacy L/R gates to pan and no longer persists or emits them", () => {
      const makeLegacy = (stereoLeft: boolean, stereoRight: boolean) =>
         new SomaticInstrument({stereoLeft, stereoRight} as any);

      assert.equal(makeLegacy(true, true).pan, 0);
      assert.equal(makeLegacy(true, false).pan, -1);
      assert.equal(makeLegacy(false, true).pan, 1);
      assert.equal(makeLegacy(false, false).pan, 0);

      const explicitPan = new SomaticInstrument({pan: 0.25, stereoLeft: true, stereoRight: false} as any);
      assert.equal(explicitPan.pan, 0.25, "current pan wins over load-only legacy fields");
      assert.equal("stereoLeft" in (explicitPan.toData() as any), false);
      assert.equal("stereoRight" in (explicitPan.toData() as any), false);

      const encoded = encodeInstrument(new SomaticInstrument({pan: -1}));
      assert.equal(encoded[61] & 0x30, 0, "both TIC-80 stereo gates stay enabled");

      const imported = new Uint8Array(Tic80Constants.BYTES_PER_SFX);
      imported[61] = 0x20; // left enabled, right disabled
      assert.equal(decodeInstrumentFromBytes66(imported).pan, -1);
      imported[61] = 0x10; // left disabled, right enabled
      assert.equal(decodeInstrumentFromBytes66(imported).pan, 1);
      imported[61] = 0x30; // both disabled: legacy fallback is center
      assert.equal(decodeInstrumentFromBytes66(imported).pan, 0);
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

describe("TIC-80 per-channel panning", () => {
   it("serializes instrument pan and applies channel overrides to TIC-80's final stereo gains", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const instrument = song.instruments[0];
      instrument.pan = 0.25;
      instrument.panLfoDepth = 0.5;
      song.patterns[0].setCell(0, 0, {
         midiNote: 60,
         instrumentIndex: 0,
         somaticEffect: kSomaticPatternCommand.key.Pan,
         somaticParam: 0,
      });
      song.patterns[0].setCell(1, 0, {
         midiNote: 64,
         instrumentIndex: 0,
         somaticEffect: kSomaticPatternCommand.key.Pan,
         somaticParam: 255,
      });

      const cloned = song.clone().instruments[0];
      assert.equal(cloned.pan, 0.25);
      assert.equal(cloned.panLfoDepth, 0.5);

      const details = serializeSongToCartDetailed(song, false, "debug", gTic80AllChannelsAudible);
      assert.equal(kSomaticPatternCommand.infoByKey.Pan.tic80SerializedValue, 5);
      assert.equal(details.extraSongDataDetails.krateInstruments.length, 1);
      assert.equal(details.extraSongDataDetails.krateInstruments[0].cfg.panU8, 159);
      assert.equal(details.extraSongDataDetails.krateInstruments[0].cfg.panLfoDepthU8, 128);

      const payload = details.extraSongDataDetails.binaryPayload;
      assert.equal(payload[1], 2, "one Somatic pattern column per panned channel");
      const firstPattern = SOMATIC_EXTRA_SONG_HEADER_BYTES + MORPH_ENTRY_BYTES;
      const secondPattern = firstPattern + SOMATIC_PATTERN_ENTRY_BYTES;
      const readFirstCell = (patternOffset: number) => {
         const b0 = payload[patternOffset + 1];
         const b1 = payload[patternOffset + 2];
         return {effectId: b0 & 0x0f, paramU8: (b0 >> 4) | ((b1 & 0x0f) << 4)};
      };
      assert.deepEqual(readFirstCell(firstPattern), {effectId: 5, paramU8: 0});
      assert.deepEqual(readFirstCell(secondPattern), {effectId: 5, paramU8: 255});

      assert.match(
         details.wholePlayroutineCode,
         new RegExp(`local\\s+STEREO_VOLUME_BASE\\s*=\\s*${Tic80MemoryMap.StereoVolume.address}`),
      );
      assert.match(details.wholePlayroutineCode, /local\s+engineVolume\s*=\s*peek\(addr\)/);
      assert.match(details.wholePlayroutineCode, /poke\(addr,\s*left\s*\|\s*right\s*<<\s*4\)/);
      assert.match(details.wholePlayroutineCode, /cell\.effectId\s*==\s*5/);
      assert.match(details.wholePlayroutineCode, /write_channel_pan\(ch,/);
      assert.match(details.wholePlayroutineCode, /cfg\s+and\s+cfg\.panU8\s+or\s+128/);

      const optimized = serializeSongToCartDetailed(song, true, "debug", gTic80AllChannelsAudible);
      assert.equal(optimized.extraSongDataDetails.krateInstruments.length, 1);
      assert.match(optimized.wholePlayroutineCode, /local\s+depth\s*=\s*clamp01/);

      const overrideOnlySong = new Song();
      overrideOnlySong.patterns[0].setCell(0, 0, {
         midiNote: 60,
         instrumentIndex: 0,
         somaticEffect: kSomaticPatternCommand.key.Pan,
         somaticParam: 64,
      });
      const overrideOnly = serializeSongToCartDetailed(
         overrideOnlySong,
         false,
         "debug",
         gTic80AllChannelsAudible,
      );
      assert.equal(overrideOnly.extraSongDataDetails.krateInstruments.length, 0);
      assert.match(overrideOnly.wholePlayroutineCode, /write_channel_pan\(/);
      assert.match(overrideOnly.wholePlayroutineCode, /cfg\s+and\s+cfg\.panU8\s+or\s+128/);
   });
});
