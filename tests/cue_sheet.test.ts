import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {buildCueSheet, CueSheetFieldValues, Song} from "../src/models/song";
import {gTic80AllChannelsAudible} from "../src/models/tic80Capabilities";

const testRequire = createRequire(import.meta.url);
(testRequire as any).extensions[".lua"] = (module: NodeModule, filename: string) => {
   (module as any).exports = fs.readFileSync(filename, "utf8");
};

function makeNamedSong(): Song {
   const song = new Song();
   song.patterns[0].name = "Intro";
   song.songOrder[0].markerVariant = "star";
   return song;
}

describe("cue sheet field selection", () => {
   it("defaults existing songs to all cue sheet fields and persists the selection", () => {
      const song = makeNamedSong();

      assert.deepEqual(song.cueSheetFields, [...CueSheetFieldValues]);
      assert.deepEqual(buildCueSheet(song), [{
         pi: 0,
         beat: 0,
         rows: song.rowsPerPattern,
         icon: "star",
         note: "Intro",
      }]);
      assert.deepEqual(song.clone().cueSheetFields, [...CueSheetFieldValues]);
   });

   it("includes only selected fields and normalizes loaded selections", () => {
      const song = makeNamedSong();
      song.cueSheetFields = ["beat", "note"];

      assert.deepEqual(buildCueSheet(song), [{beat: 0, note: "Intro"}]);
      assert.deepEqual(song.toData().cueSheetFields, ["beat", "note"]);

      const loaded = Song.fromData({
         ...song.toData(),
         cueSheetFields: ["note", "invalid", "beat", "note"] as any,
      });
      assert.deepEqual(loaded.cueSheetFields, ["beat", "note"]);
   });

   it("omits disabled fields from generated Lua while preserving cue entries", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = makeNamedSong();
      song.cueSheetFields = ["beat", "note"];

      const selected = serializeSongToCartDetailed(song, false, "debug", gTic80AllChannelsAudible);
      assert.ok(selected.wholePlayroutineCode.includes('SOMATIC_CUE_SHEET={{beat=0,note="Intro"}}'));

      song.cueSheetFields = [];
      const empty = serializeSongToCartDetailed(song, false, "debug", gTic80AllChannelsAudible);
      assert.ok(empty.wholePlayroutineCode.includes("SOMATIC_CUE_SHEET={{}}"));
   });
});
