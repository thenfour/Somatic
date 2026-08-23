import assert from "node:assert/strict";
import {describe, it} from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";

import {Song} from "../src/models/song";
import {Pattern} from "../src/models/pattern";
import {kTic80EffectCommand} from "../src/models/tic80Capabilities";
import {getTic80SongStateAccumulator} from "../src/subsystem/tic80/tic80_song_state";
import {
   getPatternRowStateDisplay,
   PatternRowStateTooltip,
} from "../src/ui/PatternRowStateTooltip";

describe("pattern row state tooltip", () => {
   it("does not query row state while the tooltip is closed", () => {
      const song = new Song();
      const accumulator = getTic80SongStateAccumulator(song);
      const originalGetRowState = accumulator.getRowState.bind(accumulator);
      let queryCount = 0;
      accumulator.getRowState = (...args) => {
         queryCount += 1;
         return originalGetRowState(...args);
      };

      const markup = renderToStaticMarkup(
         <PatternRowStateTooltip song={song} songPosition={0} rowIndex={0}>
            <span>00</span>
         </PatternRowStateTooltip>,
      );

      assert.equal(markup, "<span>00</span>");
      assert.equal(queryCount, 0);
   });

   it("reports the active note, source instrument, and carried effects for every channel", () => {
      const pattern = new Pattern();
      pattern.setCell(0, 0, {
         midiNote: 60,
         instrumentIndex: 2,
         tic80Effect: kTic80EffectCommand.key.V,
         tic80EffectX: 3,
         tic80EffectY: 4,
      });
      pattern.setCell(0, 1, {
         tic80Effect: kTic80EffectCommand.key.P,
         tic80EffectX: 9,
         tic80EffectY: 0,
      });
      const song = new Song({
         rowsPerPattern: 2,
         patterns: [pattern.toData()],
         songOrder: [0],
      });

      const display = getPatternRowStateDisplay(song, 0, 1);

      assert.equal(display.rowReachable, true);
      assert.equal(display.channels.length, 4);
      assert.deepEqual(display.channels[0], {
         channelNumber: 1,
         note: "C-4",
         instrument: "02",
         effects: "P90 V34",
      });
      assert.deepEqual(display.channels[1], {
         channelNumber: 2,
         note: "---",
         instrument: "--",
         effects: "--",
      });
   });
});
