import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {GlobalActions} from "../src/keyb/ActionIds";
import {gActionRegistry} from "../src/keyb/ActionRegistry";
import {EditorState} from "../src/models/editor_state";

describe("EditorState pattern-column visibility", () => {
   it("shows mixer columns by default and preserves their visibility in snapshots", () => {
      const state = EditorState.fromData({});
      assert.equal(state.showVolumeColumn, true);
      assert.equal(state.showPanColumn, true);

      state.setShowVolumeColumn(false);
      state.setShowPanColumn(false);
      assert.equal(state.clone().showVolumeColumn, false);
      assert.equal(state.clone().showPanColumn, false);
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
