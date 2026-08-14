import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";
import {SomaticInstrument} from "../src/models/instruments";
import {BRIDGE_EXTRA_SONG_DATA_HEADER_BYTES, BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES} from "../bridge/extraSongBridgeTransaction";
import {gTic80AllChannelsAudible, kSomaticPatternCommand, TicMemoryMap} from "../src/models/tic80Capabilities";
import {decodeInstrumentFromBytes66, decodeTrackSpeed, encodeInstrument, encodeTrackSpeed} from "../src/subsystem/tic80/tic80_serialization";
import {SomaticMemoryLayout, Tic80Constants, Tic80MemoryMap} from "../bridge/memory_layout";
import {decodeSomaticExtraSongDataPayload} from "../bridge/morphSchema";
import {lzDecompress} from "../src/utils/encoding";
import {
   encodePreparedSongOrderForBridge,
   prepareSongColumns,
} from "../src/subsystem/tic80/tic80_prepared_song";

const testRequire = createRequire(import.meta.url);
(testRequire as any).extensions[".lua"] = (module: NodeModule, filename: string) => {
   (module as any).exports = fs.readFileSync(filename, "utf8");
};

function decodePatternExtras(payload: Uint8Array) {
   return decodeSomaticExtraSongDataPayload(payload).patterns;
}

function debugConfiguration(song: Song) {
   return song.exportConfigurations[0];
}

function releaseConfiguration(song: Song) {
   return song.exportConfigurations[1];
}

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

describe("playroutine generated-data contract", () => {
   it("normalizes rows-per-beat at the Song model boundary", () => {
      assert.equal(new Song({highlightRowCount: 0}).highlightRowCount, 1);
      assert.equal(new Song({highlightRowCount: 100}).highlightRowCount, 64);
   });

   it("rejects invalid song data before generating Lua", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const invalidCases: {label: string; mutate: (song: Song) => void;}[] = [
         {label: "tempo", mutate: song => { song.tempo = 0; }},
         {label: "speed", mutate: song => { song.speed = 1.5; }},
         {label: "rowsPerBeat", mutate: song => { song.highlightRowCount = 0; }},
         {label: "rowsPerPattern", mutate: song => { song.rowsPerPattern = 65; }},
         {label: "song order length", mutate: song => { song.songOrder = []; }},
         {label: "invalid pattern index", mutate: song => { song.songOrder[0].patternIndex = 99; }},
         {label: "printable 7-bit ASCII", mutate: song => {song.patterns[0].setSideChannelCell(0, "bad\nvalue");}},
         {label: "1024 characters", mutate: song => {song.patterns[0].setSideChannelCell(0, "x".repeat(1025));}},
      ];

      for (const testCase of invalidCases) {
         const song = new Song();
         testCase.mutate(song);
         assert.throws(
            () => serializeSongToCartDetailed(
               song,
               false,
               debugConfiguration(song),
               gTic80AllChannelsAudible,
            ),
            new RegExp(testCase.label),
         );
      }
   });

   it("rejects malformed prepared rows and indices instead of clamping them", () => {
      const badRows = prepareSongColumns(new Song());
      badRows.songOrder[0].effectiveRows = 0;
      assert.throws(
         () => encodePreparedSongOrderForBridge(badRows),
         /effectiveRows must be an integer/,
      );

      const badIndex = prepareSongColumns(new Song());
      badIndex.songOrder[0].patternColumnIndices[0] = badIndex.patternColumns.length;
      assert.throws(
         () => encodePreparedSongOrderForBridge(badIndex),
         /invalid column index/,
      );
   });

   it("keeps payload sanity errors in debug output but strips them from release", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const debug = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      const release = serializeSongToCartDetailed(
         song,
         false,
         releaseConfiguration(song),
         gTic80AllChannelsAudible,
      );

      assert.match(debug.wholePlayroutineCode, /invalid LZ match distance/);
      assert.doesNotMatch(release.wholePlayroutineCode, /invalid LZ match distance/);

      const playroutineSource = fs.readFileSync(new URL("../bridge/playroutine.lua", import.meta.url), "utf8");
      const sharedSource = fs.readFileSync(
         new URL("../bridge/playroutine_shared.inc.lua", import.meta.url),
         "utf8",
      );
      assert.doesNotMatch(playroutineSource, /SOMATIC_MUSIC_DATA\.orderRows and/);
      assert.doesNotMatch(playroutineSource, /cell\.paramU8 or/);
      assert.doesNotMatch(sharedSource, /baseVolumeU8 or|bytes\[pos\] or 0/);
   });

   it("exports position seeking through the effective order-row conversion", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song({rowsPerPattern: 8, highlightRowCount: 4, songOrder: [0, 0]});
      song.patterns[0].setCell(0, 3, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      assert.equal(song.getAbsRowAtSongPosition(1, 0), 4, "fixture must use the shortened first order");

      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      assert.match(
         details.wholePlayroutineCode,
         /function somatic_position_to_beat\(songOrderIndex,\s*row\)[\s\S]*?song_position_to_abs_row\(songOrderIndex,\s*row\)/,
      );
      assert.match(
         details.wholePlayroutineCode,
         /function somatic_seek_position\(songOrderIndex,\s*row,\s*syncOffsetMS\)[\s\S]*?return somatic_seek\(somatic_position_to_beat\(songOrderIndex,\s*row\),\s*syncOffsetMS\)/,
      );
   });
});

describe("playroutine export reachability", () => {
   it("does not serialize a Somatic instrument or waveform for an empty song", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const details = serializeSongToCartDetailed(
         song,
         true,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );

      assert.equal(details.optimizeResult.usedSfxCount, 0);
      assert.equal(details.optimizeResult.usedWaveformCount, 0);
      assert.equal(details.memoryRegions.sfx.name, "0 SFX");
      assert.equal(details.memoryRegions.waveforms.name, "0 waveforms");
      assert.equal(details.extraSongDataDetails.krateInstruments.length, 0);
   });

   it("excludes post-C pattern data and the instruments and features reachable only from it", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song({rowsPerPattern: 8});
      const reachableInstrument = 5;
      const unreachableInstrument = 6;
      song.instruments[unreachableInstrument].waveEngine = "pwm";
      song.instruments[unreachableInstrument].pwmDuty = 12;
      song.instruments[unreachableInstrument].pwmDepth = 4;
      song.instruments[unreachableInstrument].lfoRateHz = 2;

      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: reachableInstrument});
      song.patterns[0].setCell(2, 0, {instrumentIndex: unreachableInstrument});
      song.patterns[0].setCell(1, 1, {somaticEffect: kSomaticPatternCommand.key.PatternEnd});
      song.patterns[0].setCell(0, 2, {
         midiNote: 72,
         instrumentIndex: unreachableInstrument,
         panU8: 32,
      });

      const details = serializeSongToCartDetailed(
         song,
         true,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );

      assert.equal(details.optimizeResult.usedSfxCount, 1);
      assert.equal(details.optimizeResult.featureUsage.pwm, false);
      assert.equal(details.optimizeResult.featureUsage.lfo, false);
      assert.equal(details.extraSongDataDetails.krateInstruments.length, 0);
      assert.deepEqual(decodePatternExtras(details.extraSongDataDetails.binaryPayload), []);
      assert.ok(
         details.patternSerializationPlan.patternChunks.every(
            patternBytes => patternBytes.slice(2 * 3, 3 * 3).every(byte => byte === 0),
         ),
         "the encoded pattern columns must clear rows after C",
      );
      assert.doesNotMatch(details.wholePlayroutineCode, /render_waveform_pwm/);
   });

   it("excludes patterns, instruments, and features reachable only through disabled orders", async () => {
      const {
         serializeSongForTic80Bridge,
         serializeSongToCartDetailed,
      } = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song({rowsPerPattern: 8});
      song.patterns.push(song.patterns[0].clone());
      const experimentalOrder = song.songOrder[0].clone();
      experimentalOrder.patternIndex = 1;
      experimentalOrder.enabled = false;
      song.songOrder.push(experimentalOrder);

      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 0});
      song.patterns[1].setCell(0, 0, {midiNote: 72, instrumentIndex: 7});
      song.instruments[7].waveEngine = "pwm";
      song.instruments[7].pwmDuty = 12;
      song.instruments[7].pwmDepth = 4;
      song.instruments[7].lfoRateHz = 2;

      const bridge = serializeSongForTic80Bridge({
         song,
         loopMode: "off",
         cursorSongOrder: 0,
         cursorChannelIndex: 0,
         cursorRowIndex: 0,
         patternSelection: null,
         audibleChannels: gTic80AllChannelsAudible,
         startPosition: 0,
         startRow: 0,
         songOrderSelection: null,
         auditionSongOrder: null,
      });
      assert.equal(bridge.bakedSong.bakedSong.songOrder.length, 1);
      assert.deepEqual(bridge.bakedSong.transportConversion.sourceSongOrderIndices, [0]);
      assert.equal(bridge.preparedSong.patternColumns.some((column) => column.sourcePatternIndex === 1), false);

      for (const optimize of [false, true]) {
         const details = serializeSongToCartDetailed(
            song,
            optimize,
            debugConfiguration(song),
            gTic80AllChannelsAudible,
         );
         assert.equal(details.optimizeResult.usedSfxCount, 1);
         assert.equal(details.optimizeResult.featureUsage.pwm, false);
         assert.equal(details.optimizeResult.featureUsage.lfo, false);
         assert.doesNotMatch(details.wholePlayroutineCode, /render_waveform_pwm/);
      }
   });
});

describe("TIC-80 bridge extra-song transaction", () => {
   it("serializes the startup ping before reporting bridge readiness", () => {
      // important to prevent a traffic jam at app startup before bridge is ready.
      const bridgeHostSource = fs.readFileSync(
         new URL("../src/subsystem/tic80/Tic80Bridged.tsx", import.meta.url),
         "utf8",
      );
      const handshakeStart = bridgeHostSource.indexOf("const completeStartupHandshake");
      const handshakeEnd = bridgeHostSource.indexOf("function readOutboxCommands", handshakeStart);
      const handshakeSource = bridgeHostSource.slice(handshakeStart, handshakeEnd);

      assert.ok(handshakeStart >= 0 && handshakeEnd > handshakeStart);
      assert.ok(handshakeSource.indexOf("await ping()") < handshakeSource.indexOf("onReady(handle)"));
      assert.doesNotMatch(handshakeSource, /sendMailboxCommandRaw/);
      assert.match(
         bridgeHostSource,
         /async function ping\(\)\s*{\s*return invokeExclusive\("ping", \(tx\) => tx\.ping\(\)\);/,
      );
   });

   it("keeps Base85 export-only and has one table-backed Lua codec path", () => {
      const bridgeSource = fs.readFileSync(new URL("../bridge/bridge.lua", import.meta.url), "utf8");
      const sharedSource = fs.readFileSync(
         new URL("../bridge/playroutine_shared.inc.lua", import.meta.url),
         "utf8",
      );
      assert.doesNotMatch(bridgeSource + sharedSource, /base85/i);
      assert.match(sharedSource, /local function lzDecode\(src, srcLen, out\)/);
      assert.doesNotMatch(sharedSource, /\blzdm\b|lzToTable|_bp_make_table_reader/);
   });

   it("uploads one length-prefixed LZ block to the contiguous Tiles+Sprites arena", async () => {
      const {serializeSongForTic80Bridge} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      song.patterns[0].setCell(0, 0, {volumeU8: 0, panU8: 128});
      const serialized = serializeSongForTic80Bridge({
         song,
         loopMode: "off",
         cursorSongOrder: 0,
         cursorChannelIndex: 0,
         cursorRowIndex: 0,
         patternSelection: null,
         audibleChannels: gTic80AllChannelsAudible,
         startPosition: 0,
         startRow: 0,
         songOrderSelection: null,
         auditionSongOrder: null,
      });

      const block = serialized.bridgeBlocksToTransmit.find(
         entry => entry.region.address === TicMemoryMap.BRIDGE_TRANSFER_BUFFER_ADDR,
      );
      assert.ok(block);
      const compressedLength = block.payload[0] | block.payload[1] << 8;
      assert.equal(compressedLength, block.payload.length - BRIDGE_EXTRA_SONG_DATA_HEADER_BYTES);
      assert.ok(compressedLength <= BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES);
      const decoded = decodeSomaticExtraSongDataPayload(
         lzDecompress(block.payload.subarray(BRIDGE_EXTRA_SONG_DATA_HEADER_BYTES)),
      );
      assert.deepEqual(decoded.patterns, [{
         patternIndex: 0,
         cells: [{rowIndex: 0, volumeU8: 0, panU8: 128}],
      }]);
   });

   it("keeps Map bridge state and tracker pattern data within the real Map boundary", () => {
      assert.equal(Tic80MemoryMap.Map.endAddress(), 0xff80);
      assert.equal(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION, TicMemoryMap.REGISTERS_ADDR);
      assert.equal(TicMemoryMap.FPS, TicMemoryMap.REGISTERS_ADDR + 1);
      assert.equal(TicMemoryMap.TF_PATTERN_DATA + 30975, TicMemoryMap.MARKER_ADDR);
      assert.equal(TicMemoryMap.PATTERN_MEM_LIMIT, SomaticMemoryLayout.patternBufferA.address);
      assert.equal(SomaticMemoryLayout.compressedPatterns.size, 9984);
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

      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
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
         panU8: 32,
         somaticEffect: kSomaticPatternCommand.key.Pan,
         somaticParam: 0,
      });
      song.patterns[0].setCell(1, 0, {
         midiNote: 64,
         instrumentIndex: 0,
         panU8: 255,
      });

      const cloned = song.clone().instruments[0];
      assert.equal(cloned.pan, 0.25);
      assert.equal(cloned.panLfoDepth, 0.5);
      assert.equal(song.clone().patterns[0].getCell(0, 0).panU8, 32);

      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      assert.equal(kSomaticPatternCommand.infoByKey.Pan.tic80SerializedValue, 5);
      assert.equal(details.extraSongDataDetails.krateInstruments.length, 1);
      assert.equal(details.extraSongDataDetails.krateInstruments[0].cfg.panU8, 159);
      assert.equal(details.extraSongDataDetails.krateInstruments[0].cfg.panLfoDepthU8, 128);

      const payload = details.extraSongDataDetails.binaryPayload;
      const patternExtras = decodePatternExtras(payload);
      assert.equal(patternExtras.length, 2, "one Somatic pattern event group per panned channel");
      assert.deepEqual(patternExtras[0], {
         patternIndex: 0,
         cells: [{rowIndex: 0, panU8: 32, effectId: 5, paramU8: 0}],
      });
      assert.deepEqual(patternExtras[1], {
         patternIndex: 1,
         cells: [{rowIndex: 0, panU8: 255}],
      });

      assert.match(
         details.wholePlayroutineCode,
         new RegExp(`local\\s+STEREO_VOLUME_BASE\\s*=\\s*${Tic80MemoryMap.StereoVolume.address}`),
      );
      assert.match(details.wholePlayroutineCode, /local\s+engineVolume\s*=\s*peek\(addr\)/);
      assert.match(details.wholePlayroutineCode, /poke\(addr,\s*left\s*\|\s*right\s*<<\s*4\)/);
      assert.match(details.wholePlayroutineCode, /cell\.effectId\s*==\s*5/);
      assert.match(details.wholePlayroutineCode, /cell\.panU8\s*~=\s*nil/);
      assert.match(details.wholePlayroutineCode, /ch_pan_override_u8\[ch\s*\+\s*1\]\s*=\s*cell\.panU8/);
      assert.match(details.wholePlayroutineCode, /write_channel_mix\(ch,/);
      assert.match(details.wholePlayroutineCode, /cfg\s+and\s+cfg\.panU8\s+or\s+128/);

      const optimized = serializeSongToCartDetailed(
         song,
         true,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
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
         debugConfiguration(overrideOnlySong),
         gTic80AllChannelsAudible,
      );
      assert.equal(overrideOnly.extraSongDataDetails.krateInstruments.length, 0);
      assert.match(overrideOnly.wholePlayroutineCode, /write_channel_mix\(/);
      assert.match(overrideOnly.wholePlayroutineCode, /cfg\s+and\s+cfg\.panU8\s+or\s+128/);
   });
});

describe("TIC-80 per-instrument volume", () => {
   it("persists and applies instrument volume in the final channel mix", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const instrument = song.instruments[0];
      instrument.volume = 0.5;
      song.patterns[0].setCell(0, 0, {midiNote: 60, instrumentIndex: 0});

      assert.equal(song.clone().instruments[0].volume, 0.5);

      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      assert.equal(details.extraSongDataDetails.krateInstruments.length, 1);
      assert.equal(details.extraSongDataDetails.krateInstruments[0].cfg.volumeU8, 128);
      assert.match(details.wholePlayroutineCode, /write_channel_mix\(ch,/);
      assert.match(details.wholePlayroutineCode, /baseVolume\s*=\s*clamp01/);
      assert.match(details.wholePlayroutineCode, /volumeScaleU8\s*=\s*ch_volume_scale_u8\[[^\]]+\]\s+or\s+255/);
      assert.match(details.wholePlayroutineCode, /volume\s*=\s*baseVolume\s*\*\s*volumeScale/);
      assert.match(details.wholePlayroutineCode, /left\s*\*\s*leftGain\s*\*\s*volume/);
      assert.match(details.wholePlayroutineCode, /right\s*\*\s*rightGain\s*\*\s*volume/);

      const optimized = serializeSongToCartDetailed(
         song,
         true,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      assert.equal(optimized.extraSongDataDetails.krateInstruments[0].cfg.volumeU8, 128);
   });

   it("serializes channel-volume gain events and multiplies them by instrument volume", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      song.patterns[0].setCell(0, 0, {
         midiNote: 60,
         instrumentIndex: 0,
         volumeU8: 0,
         panU8: 128,
         somaticEffect: kSomaticPatternCommand.key.Pan,
         somaticParam: 64,
      });
      song.patterns[0].setCell(0, 4, {volumeU8: 255});

      assert.equal(song.clone().patterns[0].getCell(0, 0).volumeU8, 0);

      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      assert.match(details.wholePlayroutineCode, /local function base85Plus1Decode\(s,\s*out\)/);
      assert.match(details.wholePlayroutineCode, /local function lzDecode\(src,\s*srcLen,\s*out\)/);
      assert.doesNotMatch(
         details.wholePlayroutineCode,
         /\blzdm\b|lzToTable|base85Plus1DecodeToTable|_bp_make_table_reader|__AUTOGEN_TEMP/,
      );
      const patternExtras = decodePatternExtras(details.extraSongDataDetails.binaryPayload);
      assert.deepEqual(patternExtras, [{
         patternIndex: 0,
         cells: [
            {rowIndex: 0, volumeU8: 0, panU8: 128, effectId: 5, paramU8: 64},
            {rowIndex: 4, volumeU8: 255},
         ],
      }]);
      assert.match(details.wholePlayroutineCode, /decodeSomaticExtraSongBytes/);
      assert.match(details.wholePlayroutineCode, /cell\.volumeU8\s*~=\s*nil/);
      assert.match(details.wholePlayroutineCode, /ch_volume_scale_u8\[ch\s*\+\s*1\]\s*=\s*cell\.volumeU8/);
      assert.match(details.wholePlayroutineCode, /baseVolume\s*=\s*clamp01/);
      assert.match(details.wholePlayroutineCode, /volumeScale\s*=\s*clamp01/);
      assert.match(details.wholePlayroutineCode, /volume\s*=\s*baseVolume\s*\*\s*volumeScale/);
   });
});
