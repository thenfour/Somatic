import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {CueSheetFieldValues} from "../src/models/exportConfiguration";
import {buildCueSheet, buildSongMetadataPayload, Song} from "../src/models/song";
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
      const configuration = song.exportConfigurations[0];

      assert.deepEqual(configuration.cueSheetFields, [...CueSheetFieldValues]);
      assert.deepEqual(buildCueSheet(song, configuration.cueSheetFields), [{
         pi: 0,
         beat: 0,
         rows: song.rowsPerPattern,
         icon: "star",
         note: "Intro",
      }]);
      assert.deepEqual(song.clone().exportConfigurations[0].cueSheetFields, [...CueSheetFieldValues]);
   });

   it("includes only selected fields and normalizes loaded selections", () => {
      const song = makeNamedSong();
      const configuration = song.exportConfigurations[0];
      configuration.cueSheetFields = ["beat", "note"];

      assert.deepEqual(buildCueSheet(song, configuration.cueSheetFields), [{beat: 0, note: "Intro"}]);
      assert.deepEqual(song.toData().exportConfigurations![0].cueSheetFields, ["beat", "note"]);

      const data = song.toData();
      data.exportConfigurations![0].cueSheetFields = ["note", "invalid", "beat", "note"] as any;
      const loaded = Song.fromData({
         ...data,
      });
      assert.deepEqual(loaded.exportConfigurations[0].cueSheetFields, ["beat", "note"]);
   });

   it("copies the original metadata payload shape with every cue-sheet field", () => {
      const song = makeNamedSong();
      song.exportConfigurations[0].exportCueSheet = false;
      song.exportConfigurations[0].cueSheetFields = ["beat"];

      const payload = buildSongMetadataPayload(song, ["pi", "beat", "rows", "icon", "note"]);
      assert.deepEqual(Object.keys(payload), ["transport", "cueSheet"]);
      assert.deepEqual(payload.transport, song.buildTransportConfig());
      assert.deepEqual(payload.cueSheet, [{
         pi: 0,
         beat: 0,
         rows: song.rowsPerPattern,
         icon: "star",
         note: "Intro",
      }]);
   });

   it("omits disabled fields from generated Lua while preserving cue entries", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = makeNamedSong();
      const configuration = song.exportConfigurations[0];
      const disabledConfiguration = song.exportConfigurations[1];
      configuration.cueSheetFields = ["beat", "note"];
      disabledConfiguration.exportCueSheet = false;

      const selected = serializeSongToCartDetailed(
         song,
         false,
         song.exportConfigurations[0],
         gTic80AllChannelsAudible,
      );
      assert.ok(selected.wholePlayroutineCode.includes('SOMATIC_CUE_SHEET={{beat=0,note="Intro"}}'));

      const disabled = serializeSongToCartDetailed(
         song,
         false,
         disabledConfiguration,
         gTic80AllChannelsAudible,
      );
      assert.doesNotMatch(disabled.wholePlayroutineCode, /SOMATIC_CUE_SHEET/);

      configuration.cueSheetFields = [];
      const empty = serializeSongToCartDetailed(
         song,
         false,
         song.exportConfigurations[0],
         gTic80AllChannelsAudible,
      );
      assert.ok(empty.wholePlayroutineCode.includes("SOMATIC_CUE_SHEET={{}}"));
   });
});
