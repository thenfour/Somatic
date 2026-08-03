import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {EditorState} from "../src/models/editor_state";

describe("EditorState pattern-column visibility", () => {
   it("shows the volume column by default and preserves its visibility in snapshots", () => {
      const state = EditorState.fromData({});
      assert.equal(state.showVolumeColumn, true);

      state.setShowVolumeColumn(false);
      assert.equal(state.clone().showVolumeColumn, false);
   });

   it("moves the edit target out of the volume column when it is hidden", () => {
      const state = new EditorState();
      state.setPatternEditColumnType("volume");

      state.setShowVolumeColumn(false);

      assert.equal(state.patternEditColumnType, "instrument");
   });
});
