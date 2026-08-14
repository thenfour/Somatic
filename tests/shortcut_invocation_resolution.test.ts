import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {gActionRegistry} from "../src/keyb/ActionRegistry";
import {findActionsSharingChord, resolveBindingsForPlatform} from "../src/keyb/KeyboardConflicts";
import {chooseShortcutInvocation} from "../src/keyb/KeyboardShortcutManager";

describe("shortcut invocation specificity", () => {
   it("retains candidate order for equal-specificity conflicts", () => {
      const chosen = chooseShortcutInvocation([
         {value: "first", specificity: 1},
         {value: "second", specificity: 1},
      ], {});

      assert.equal(chosen, "first");
   });

   it("treats invalid specificity values as the global default", () => {
      const chosen = chooseShortcutInvocation([
         {value: "invalid", specificity: Number.NaN},
         {value: "contextual", specificity: 1},
      ], {});

      assert.equal(chosen, "contextual");
   });

   it("allows and reports every shared binding without pairwise exceptions", () => {
      const bindings = resolveBindingsForPlatform(gActionRegistry, {}, "win");
      const enter = {kind: "character", key: "Enter"} as const;

      assert.deepEqual(bindings.PlayRow, [enter]);
      assert.deepEqual(bindings.EditSideChannelData, [enter]);
      assert.deepEqual(
         findActionsSharingChord(
            ["PlayRow", "EditSideChannelData", "ClearCell"],
            "EditSideChannelData",
            enter,
            bindings,
         ),
         ["PlayRow"],
      );
   });
});
