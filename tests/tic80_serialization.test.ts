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

   it("serializes the editor BPM and exposes the resolved-target PlayRoutine API", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song({tempo: 120, speed: 6, highlightRowCount: 8});
      const details = serializeSongToCartDetailed(
         song,
         false,
         debugConfiguration(song),
         gTic80AllChannelsAudible,
      );
      const source = fs.readFileSync(new URL("../bridge/playroutine.lua", import.meta.url), "utf8");

      assert.equal(song.getBpm(), 60);
      assert.match(details.wholePlayroutineCode, /\bbpm\s*=\s*60/);
      assert.doesNotMatch(source, /somatic_get_bpm/);
      for (const publicFunction of [
         "somatic_get_state",
         "somatic_get_raw_state",
         "somatic_set_sync_offset",
         "somatic_resolve_timing",
         "somatic_seek",
      ]) {
         assert.match(source, new RegExp(`function\\s+${publicFunction}\\s*\\(`));
      }
      assert.doesNotMatch(
         source,
         /function\s+somatic_(?:get_time|get_raw_time|project_time|position_to_beat|seek_position)\s*\(/,
      );
      assert.doesNotMatch(source, /function\s+somatic_timing_from_/);
      assert.match(source, /target\.songBeat/);
      assert.doesNotMatch(source, /state\.patternIndex/);
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
