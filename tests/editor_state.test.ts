import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {GlobalActions} from "../src/keyb/ActionIds";
import {gActionRegistry} from "../src/keyb/ActionRegistry";
import {EditorState} from "../src/models/editor_state";
import {SelectionRange1D} from "../src/models/selectionRange1D";
import {Song} from "../src/models/song";

describe("EditorState pattern-column visibility", () => {
   it("shows mixer columns by default and preserves their visibility in snapshots", () => {
      const state = EditorState.fromData({});
      assert.equal(state.showVolumeColumn, true);
      assert.equal(state.showPanColumn, true);
      assert.equal(state.showSideChannelData, true);

      state.setShowVolumeColumn(false);
      state.setShowPanColumn(false);
      state.setShowSideChannelData(false);
      assert.equal(state.clone().showVolumeColumn, false);
      assert.equal(state.clone().showPanColumn, false);
      assert.equal(state.clone().showSideChannelData, false);
   });

   it("moves the edit target out of the volume column when it is hidden", () => {
      const state = new EditorState();
      state.setPatternEditColumnType("volume");

      state.setShowVolumeColumn(false);

      assert.equal(state.patternEditColumnType, "instrument");
   });

   it("moves the edit target to the nearest mixer column when pan is hidden", () => {
      const state = new EditorState();
      state.setPatternEditColumnType("pan");

      state.setShowPanColumn(false);
      assert.equal(state.patternEditColumnType, "volume");

      state.setShowVolumeColumn(false);
      state.setShowPanColumn(true);
      state.setPatternEditColumnType("pan");
      state.setShowPanColumn(false);
      assert.equal(state.patternEditColumnType, "instrument");
   });
});

describe("EditorState instrument operation range", () => {
   it("keeps one current instrument at the active end and preserves the range in snapshots", () => {
      const song = new Song();
      const state = new EditorState();

      state.setInstrumentSelection(song, new SelectionRange1D({anchor: 2, focus: 5}));

      assert.equal(state.currentInstrument, 5);
      assert.deepEqual(state.clone().instrumentOperationRange?.toData(), {anchor: 2, focus: 5});
   });

   it("collapses the operation range when the current instrument changes normally", () => {
      const song = new Song();
      const state = new EditorState({instrumentOperationRange: {anchor: 2, focus: 5}});

      state.setCurrentInstrument(song, 3);

      assert.equal(state.currentInstrument, 3);
      assert.deepEqual(state.instrumentOperationRange?.toData(), {anchor: 3, focus: 3});
   });
});

describe("volume-column app action", () => {
   it("is registered as a configurable View action without a conflicting default binding", () => {
      assert.equal(GlobalActions.ToggleVolumeColumn, "ToggleVolumeColumn");
      assert.equal(gActionRegistry.ToggleVolumeColumn.category, "View");
      assert.deepEqual(gActionRegistry.ToggleVolumeColumn.defaultBindings, []);
   });
});

describe("pan-column app action", () => {
   it("is registered as a configurable View action without a conflicting default binding", () => {
      assert.equal(GlobalActions.TogglePanColumn, "TogglePanColumn");
      assert.equal(gActionRegistry.TogglePanColumn.category, "View");
      assert.deepEqual(gActionRegistry.TogglePanColumn.defaultBindings, []);
   });
});

describe("side-channel app action", () => {
   it("is registered as a configurable View action without a default binding", () => {
      assert.equal(GlobalActions.ToggleSideChannelData, "ToggleSideChannelData");
      assert.equal(gActionRegistry.ToggleSideChannelData.category, "View");
      assert.deepEqual(gActionRegistry.ToggleSideChannelData.defaultBindings, []);
   });
});

describe("loop-mode app actions", () => {
   it("registers every concrete loop mode as a configurable Transport action", () => {
      const actionIds = [
         "SetLoopOff",
         "SetLoopSong",
         "SetLoopSelectionInSongOrder",
         "SetLoopPattern",
         "SetLoopHalfPattern",
         "SetLoopQuarterPattern",
         "SetLoopSelectionInPattern",
      ] as const;

      for (const actionId of actionIds) {
         assert.equal(GlobalActions[actionId], actionId);
         assert.equal(gActionRegistry[actionId].category, "Transport");
         assert.deepEqual(gActionRegistry[actionId].defaultBindings, []);
      }
   });
});
