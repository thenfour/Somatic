import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {SelectionRect2D} from "../src/hooks/useRectSelection2D";
import {Pattern} from "../src/models/pattern";
import {Song} from "../src/models/song";
import {Tic80Caps, TicMemoryMap} from "../src/models/tic80Capabilities";
import {BakeSong, getBakedSongPosition} from "../src/subsystem/tic80/bakeSong";
import type {BackendPlaySongArgs} from "../src/subsystem/tic80/tic80_backend";
import type {Tic80BridgeHandle, Tic80BridgeTransaction} from "../src/subsystem/tic80/Tic80Bridged";
import type {Tic80SerializedSong} from "../src/subsystem/tic80/tic80_cart_serializer";

const testRequire = createRequire(import.meta.url);
(testRequire as any).extensions[".lua"] = (module: NodeModule, filename: string) => {
   (module as any).exports = fs.readFileSync(filename, "utf8");
};

const allChannels = new Set(Array.from({length: Tic80Caps.song.audioChannels}, (_, i) => i));

function makeSong(): Song {
   const patterns = Array.from({length: 3}, (_, patternIndex) => {
      const pattern = new Pattern();
      pattern.setCell(0, patternIndex, {midiNote: 60 + patternIndex, instrumentIndex: 0});
      return pattern.toData();
   });
   return new Song({rowsPerPattern: 64, patterns, songOrder: [0, 1, 2]});
}

function makeArgs(song: Song, overrides: Partial<BackendPlaySongArgs> = {}): BackendPlaySongArgs {
   return {
      reason: "test",
      song,
      cursorSongOrder: 1,
      cursorChannelIndex: 0,
      cursorRowIndex: 20,
      patternSelection: null,
      audibleChannels: allChannels,
      startPosition: 0,
      startRow: 0,
      loopMode: "song",
      songOrderSelection: null,
      ...overrides,
   };
}

describe("hot-restart baked position mapping", () => {
   it("maps song, pattern, order-selection, and row-selection positions back into their bakes", () => {
      const song = makeSong();

      const songLoop = BakeSong(makeArgs(song, {loopMode: "song"}));
      assert.deepEqual(getBakedSongPosition(songLoop, 2, 11), {songPosition: 2, rowIndex: 11});

      const patternLoop = BakeSong(makeArgs(song, {loopMode: "pattern", cursorSongOrder: 1}));
      assert.deepEqual(getBakedSongPosition(patternLoop, 1, 11), {songPosition: 0, rowIndex: 11});

      const orderSelection = new SelectionRect2D({
         start: {x: 0, y: 1},
         size: {width: 1, height: 2},
      });
      const selectedOrders = BakeSong(makeArgs(song, {
         loopMode: "selectionInSongOrder",
         songOrderSelection: orderSelection,
      }));
      assert.deepEqual(getBakedSongPosition(selectedOrders, 2, 9), {songPosition: 1, rowIndex: 9});

      const patternSelection = new SelectionRect2D({
         start: {x: 0, y: 10},
         size: {width: 1, height: 4},
      });
      const selectedRows = BakeSong(makeArgs(song, {
         loopMode: "selectionInPattern",
         cursorSongOrder: 1,
         patternSelection,
      }));
      assert.deepEqual(getBakedSongPosition(selectedRows, 1, 12), {songPosition: 0, rowIndex: 2});
   });

   it("maps half- and quarter-pattern loops relative to their source ranges", () => {
      const song = makeSong();
      const half = BakeSong(makeArgs(song, {loopMode: "halfPattern", cursorRowIndex: 40}));
      assert.deepEqual(getBakedSongPosition(half, 1, 45), {songPosition: 0, rowIndex: 13});

      const quarter = BakeSong(makeArgs(song, {loopMode: "quarterPattern", cursorRowIndex: 20}));
      assert.deepEqual(getBakedSongPosition(quarter, 1, 21), {songPosition: 0, rowIndex: 5});
   });
});

describe("hot-restart playback fingerprint", () => {
   it("ignores instrument-only changes but detects pattern, timing, loop, and audibility changes", async () => {
      const {serializeSongForTic80Bridge} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = makeSong();
      const initial = serializeSongForTic80Bridge(makeArgs(song));

      const instrumentEdit = song.clone();
      instrumentEdit.instruments[0].speed = instrumentEdit.instruments[0].speed === 3
         ? 2
         : instrumentEdit.instruments[0].speed + 1;
      const instrumentOnly = serializeSongForTic80Bridge(makeArgs(instrumentEdit));
      assert.equal(instrumentOnly.playbackFingerprint, initial.playbackFingerprint);

      const patternEdit = song.clone();
      patternEdit.patterns[1].setCell(0, 7, {midiNote: 72, instrumentIndex: 0});
      const changedPattern = serializeSongForTic80Bridge(makeArgs(patternEdit));
      assert.notEqual(changedPattern.playbackFingerprint, initial.playbackFingerprint);

      const timingEdit = song.clone();
      timingEdit.setTempo(song.tempo + 1);
      const changedTiming = serializeSongForTic80Bridge(makeArgs(timingEdit));
      assert.notEqual(changedTiming.playbackFingerprint, initial.playbackFingerprint);

      const loopOff = serializeSongForTic80Bridge(makeArgs(song, {loopMode: "off"}));
      assert.notEqual(loopOff.playbackFingerprint, initial.playbackFingerprint);

      const mutedChannel = serializeSongForTic80Bridge(makeArgs(song, {
         audibleChannels: new Set([1, 2, 3]),
      }));
      assert.notEqual(mutedChannel.playbackFingerprint, initial.playbackFingerprint);
   });
});

type BridgeCall = {
   kind: "transmit"|"play"|"stop";
   data?: Tic80SerializedSong;
};

class FakeBridge {
   calls: BridgeCall[] = [];
   private memory = new Map<number, number>();
   private delayedDescription: string|null = null;
   private releaseDelayedInvoke: (() => void)|null = null;
   private delayedInvokeEntered: (() => void)|null = null;

   readonly transaction: Tic80BridgeTransaction = {
      playSfx: async () => {},
      stopSfx: async () => {},
      transmit: async ({data}) => {
         this.calls.push({kind: "transmit", data});
      },
      transmitAndPlay: async ({data}) => {
         this.calls.push({kind: "play", data});
         this.setPlayingPosition(data.bakedSong.startPosition, data.bakedSong.startRow);
      },
      stop: async () => {
         this.calls.push({kind: "stop"});
         this.memory.set(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION, 0xff);
      },
      ping: async () => {},
   };

   readonly handle = {
      isReady: () => true,
      getModule: () => null,
      getRamBase: () => 0,
      peekS8: (addr: number) => {
         const value = this.memory.get(addr) ?? 0;
         return value > 0x7f ? value - 0x100 : value;
      },
      peekU8: (addr: number) => this.memory.get(addr) ?? 0,
      pokeS8: (addr: number, value: number) => this.memory.set(addr, value & 0xff),
      pokeU8: (addr: number, value: number) => this.memory.set(addr, value & 0xff),
      pokeBlock: () => {},
      peekBlock: (_addr: number, length: number) => new Uint8Array(length),
      invokeExclusive: async <T>(description: string, fn: (tx: Tic80BridgeTransaction) => Promise<T>) => {
         if (description === this.delayedDescription) {
            this.delayedInvokeEntered?.();
            await new Promise<void>((resolve) => {
               this.releaseDelayedInvoke = resolve;
            });
         }
         return fn(this.transaction);
      },
      ping: async () => {},
   } as Tic80BridgeHandle;

   setPlayingPosition(songPosition: number, rowIndex: number) {
      this.memory.set(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION, songPosition & 0xff);
      this.memory.set(TicMemoryMap.MUSIC_STATE_ROW, rowIndex & 0xff);
   }

   delayInvoke(description: string): Promise<void> {
      this.delayedDescription = description;
      return new Promise<void>((resolve) => {
         this.delayedInvokeEntered = resolve;
      });
   }

   releaseInvoke() {
      this.delayedDescription = null;
      this.releaseDelayedInvoke?.();
      this.releaseDelayedInvoke = null;
   }
}

describe("Tic80Backend hot restart", () => {
   it("restarts changed pattern data at the latest logical playhead", async () => {
      const {Tic80Backend} = await import("../src/subsystem/tic80/tic80_backend");
      const bridge = new FakeBridge();
      const backend = new Tic80Backend(() => bridge.handle);
      const song = makeSong();
      await backend.transmitAndPlay(makeArgs(song));

      bridge.setPlayingPosition(1, 7);
      const edited = song.clone();
      edited.patterns[1].setCell(0, 12, {midiNote: 75, instrumentIndex: 0});
      await backend.transmitEditedSong(makeArgs(edited));

      const call = bridge.calls.at(-1);
      assert.equal(call?.kind, "play");
      assert.equal(call?.data?.bakedSong.startPosition, 1);
      assert.equal(call?.data?.bakedSong.startRow, 7);
   });

   it("keeps instrument-only edits on the transmit-only path", async () => {
      const {Tic80Backend} = await import("../src/subsystem/tic80/tic80_backend");
      const bridge = new FakeBridge();
      const backend = new Tic80Backend(() => bridge.handle);
      const song = makeSong();
      await backend.transmitAndPlay(makeArgs(song));

      bridge.setPlayingPosition(1, 7);
      const edited = song.clone();
      edited.instruments[0].speed = edited.instruments[0].speed === 3
         ? 2
         : edited.instruments[0].speed + 1;
      await backend.transmitEditedSong(makeArgs(edited));

      assert.equal(bridge.calls.length, 2);
      assert.equal(bridge.calls.at(-1)?.kind, "transmit");
   });

   it("applies loop mode changes live and resumes in the new bake", async () => {
      const {Tic80Backend} = await import("../src/subsystem/tic80/tic80_backend");
      const bridge = new FakeBridge();
      const backend = new Tic80Backend(() => bridge.handle);
      const song = makeSong();
      await backend.transmitAndPlay(makeArgs(song));

      bridge.setPlayingPosition(1, 7);
      await backend.transmitEditedSong(makeArgs(song, {
         loopMode: "pattern",
         cursorSongOrder: 2,
      }));

      const patternLoopCall = bridge.calls.at(-1);
      assert.equal(patternLoopCall?.kind, "play");
      assert.equal(patternLoopCall?.data?.bakedSong.transportConversion.songOrderOffset, 2);
      assert.equal(patternLoopCall?.data?.bakedSong.startPosition, 0);
      assert.equal(patternLoopCall?.data?.bakedSong.startRow, 7);

      await backend.transmitEditedSong(makeArgs(song, {
         loopMode: "off",
         cursorSongOrder: 0,
      }));

      const loopOffCall = bridge.calls.at(-1);
      assert.equal(loopOffCall?.kind, "play");
      assert.equal(loopOffCall?.data?.bakedSong.wantSongLoop, false);
      assert.equal(loopOffCall?.data?.bakedSong.startPosition, 2);
      assert.equal(loopOffCall?.data?.bakedSong.startRow, 7);
   });

   it("applies audibility changes without moving the active loop anchor", async () => {
      const {Tic80Backend} = await import("../src/subsystem/tic80/tic80_backend");
      const bridge = new FakeBridge();
      const backend = new Tic80Backend(() => bridge.handle);
      const song = makeSong();
      await backend.transmitAndPlay(makeArgs(song, {
         loopMode: "pattern",
         cursorSongOrder: 1,
      }));

      bridge.setPlayingPosition(0, 7);
      await backend.transmitEditedSong(makeArgs(song, {
         loopMode: "pattern",
         cursorSongOrder: 2,
         audibleChannels: new Set([1, 2, 3]),
      }));

      const mutedCall = bridge.calls.at(-1);
      assert.equal(mutedCall?.kind, "play");
      assert.equal(mutedCall?.data?.bakedSong.transportConversion.songOrderOffset, 1);
      assert.deepEqual(mutedCall?.data?.bakedSong.bakedSong.patterns[0].getCell(0, 1), {});

      await backend.transmitEditedSong(makeArgs(song, {
         loopMode: "pattern",
         cursorSongOrder: 2,
         audibleChannels: allChannels,
      }));

      const unmutedCall = bridge.calls.at(-1);
      assert.equal(unmutedCall?.kind, "play");
      assert.equal(unmutedCall?.data?.bakedSong.transportConversion.songOrderOffset, 1);
      assert.equal(unmutedCall?.data?.bakedSong.bakedSong.patterns[0].getCell(0, 1).midiNote, 61);
   });

   it("does not revive playback when Stop wins a pending hot-restart race", async () => {
      const {Tic80Backend} = await import("../src/subsystem/tic80/tic80_backend");
      const bridge = new FakeBridge();
      const backend = new Tic80Backend(() => bridge.handle);
      const song = makeSong();
      await backend.transmitAndPlay(makeArgs(song));

      bridge.setPlayingPosition(1, 7);
      const edited = song.clone();
      edited.patterns[1].setCell(0, 12, {midiNote: 75, instrumentIndex: 0});

      const entered = bridge.delayInvoke("transmitEditedSong: test");
      const pendingRestart = backend.transmitEditedSong(makeArgs(edited));
      await entered;
      await backend.stop();
      bridge.releaseInvoke();
      await pendingRestart;

      assert.equal(bridge.calls.filter((call) => call.kind === "play").length, 1);
      assert.equal(bridge.calls.at(-1)?.kind, "transmit");
   });
});
