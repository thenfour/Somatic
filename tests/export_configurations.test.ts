import assert from "node:assert/strict";
import fs from "node:fs";
import {createRequire} from "node:module";
import {describe, it} from "node:test";

import {
   CueSheetFieldValues,
   createExportConfigurationClipboardPayload,
   ExportConfiguration,
   isValidExportConfigurationName,
   kDefaultDebugMinificationOptions,
   kDefaultReleaseMinificationOptions,
   parseExportConfigurationClipboardPayload,
} from "../src/models/exportConfiguration";
import {Song} from "../src/models/song";
import {gTic80AllChannelsAudible} from "../src/models/tic80Capabilities";

const testRequire = createRequire(import.meta.url);
(testRequire as any).extensions[".lua"] = (module: NodeModule, filename: string) => {
   (module as any).exports = fs.readFileSync(filename, "utf8");
};

describe("export configurations", () => {
   it("creates independent Debug and Release defaults and appends a Release-style configuration", () => {
      const song = new Song();

      assert.deepEqual(song.exportConfigurations.map((configuration) => configuration.name), ["Debug", "Release"]);
      assert.deepEqual(song.exportConfigurations[0].minificationOptions, kDefaultDebugMinificationOptions);
      assert.deepEqual(song.exportConfigurations[1].minificationOptions, kDefaultReleaseMinificationOptions);
      assert.notEqual(
         song.exportConfigurations[0].minificationOptions.functionNamesToKeep,
         kDefaultDebugMinificationOptions.functionNamesToKeep,
      );
      assert.notEqual(
         song.exportConfigurations[1].minificationOptions.tableEntryKeysToRename,
         kDefaultReleaseMinificationOptions.tableEntryKeysToRename,
      );

      const added = song.addExportConfiguration();
      assert.equal(added.name, "New export config");
      assert.deepEqual(added.minificationOptions, kDefaultReleaseMinificationOptions);
      assert.equal(added.useCustomEntrypointLua, false);
      assert.equal(added.customEntrypointLua, "");
      assert.equal(added.exportCueSheet, true);
      assert.deepEqual(added.cueSheetFields, [...CueSheetFieldValues]);

      added.minificationOptions.functionNamesToKeep.push("CUSTOM");
      added.exportCueSheet = false;
      added.cueSheetFields = ["beat", "note"];
      assert.deepEqual(song.exportConfigurations[1].minificationOptions.functionNamesToKeep, []);
      const cloned = song.clone().exportConfigurations[2];
      assert.deepEqual(cloned.minificationOptions.functionNamesToKeep, ["CUSTOM"]);
      assert.equal(cloned.exportCueSheet, false);
      assert.deepEqual(cloned.cueSheetFields, ["beat", "note"]);
   });

   it("requires a non-whitespace name and normalizes invalid loaded names", () => {
      assert.equal(isValidExportConfigurationName("Integration release"), true);
      assert.equal(isValidExportConfigurationName(" \t\n"), false);
      assert.equal(new ExportConfiguration({name: "   "}).name, "Export configuration");
      const configuration = new ExportConfiguration({name: "Valid"});
      assert.throws(
         () => { configuration.name = " \t"; },
         /at least one non-whitespace character/,
      );

      const data = new Song().toData();
      data.exportConfigurations![0].name = "\t";
      const loaded = Song.fromData(data);
      assert.equal(loaded.exportConfigurations[0].name, "Export configuration");
   });

   it("round-trips complete tagged clipboard payloads and rejects unrelated JSON", () => {
      const configuration = new ExportConfiguration({
         name: "Integration release",
         useCustomEntrypointLua: true,
         customEntrypointLua: "",
         exportCueSheet: true,
         cueSheetFields: ["beat", "note"],
         minificationOptions: kDefaultReleaseMinificationOptions,
      });
      const payload = createExportConfigurationClipboardPayload(configuration);
      const pasted = parseExportConfigurationClipboardPayload(JSON.parse(JSON.stringify(payload)));

      assert.deepEqual(pasted?.toData(), configuration.toData());
      assert.equal(parseExportConfigurationClipboardPayload({name: "not tagged"}), null);
      assert.equal(parseExportConfigurationClipboardPayload({...payload, version: 2}), null);
      assert.equal(parseExportConfigurationClipboardPayload({
         ...payload,
         configuration: {...payload.configuration, name: "  "},
      }), null);
      assert.equal(parseExportConfigurationClipboardPayload({
         ...payload,
         configuration: {
            ...payload.configuration,
            minificationOptions: {...payload.configuration.minificationOptions, stripComments: "yes"},
         },
      }), null);
      assert.equal(parseExportConfigurationClipboardPayload({
         ...payload,
         configuration: {...payload.configuration, cueSheetFields: ["unknown"]},
      }), null);
   });

   it("migrates v1 Debug and Release behavior without retaining legacy fields", () => {
      const current = new Song().toData();
      const {exportConfigurations: _exportConfigurations, ...legacyBase} = current;
      const legacyReleaseOptions = {
         ...kDefaultReleaseMinificationOptions,
         maxLineLength: 73,
         functionNamesToKeep: ["PUBLIC_API"],
         tableEntryKeysToRename: [...kDefaultReleaseMinificationOptions.tableEntryKeysToRename],
      };
      const legacy = {
         ...legacyBase,
         schemaVersion: 1,
         releaseMinificationOptions: legacyReleaseOptions,
         useCustomEntrypointLua: true,
         customEntrypointLua: "function TIC() print('legacy') end",
         exportCueSheet: false,
         cueSheetFields: ["beat", "note"],
      } as any;

      const migrated = Song.fromData(legacy);
      assert.deepEqual(migrated.exportConfigurations.map((configuration) => configuration.name), ["Debug", "Release"]);
      assert.deepEqual(migrated.exportConfigurations[0].minificationOptions, kDefaultDebugMinificationOptions);
      assert.deepEqual(migrated.exportConfigurations[1].minificationOptions, legacyReleaseOptions);
      for (const configuration of migrated.exportConfigurations) {
         assert.equal(configuration.useCustomEntrypointLua, true);
         assert.equal(configuration.customEntrypointLua, "function TIC() print('legacy') end");
         assert.equal(configuration.exportCueSheet, false);
         assert.deepEqual(configuration.cueSheetFields, ["beat", "note"]);
      }

      const saved = migrated.toData() as any;
      assert.equal(saved.schemaVersion, 2);
      assert.equal(Object.hasOwn(saved, "releaseMinificationOptions"), false);
      assert.equal(Object.hasOwn(saved, "useCustomEntrypointLua"), false);
      assert.equal(Object.hasOwn(saved, "customEntrypointLua"), false);
      assert.equal(Object.hasOwn(saved, "exportCueSheet"), false);
      assert.equal(Object.hasOwn(saved, "cueSheetFields"), false);
   });

   it("runs the v0 migration through the v2 export-configuration migration", () => {
      const current = new Song().toData();
      const {exportConfigurations: _exportConfigurations, ...legacyBase} = current;
      const migrated = Song.fromData({
         ...legacyBase,
         schemaVersion: 0,
         useCustomEntrypointLua: false,
         customEntrypointLua: "",
         releaseMinificationOptions: kDefaultReleaseMinificationOptions,
      } as any);

      assert.equal(migrated.toData().schemaVersion, 2);
      assert.deepEqual(migrated.exportConfigurations.map((configuration) => configuration.name), ["Debug", "Release"]);
   });

   it("uses each configuration's own minification and custom or blank entrypoint", async () => {
      const {serializeSongToCartDetailed} = await import("../src/subsystem/tic80/tic80_cart_serializer");
      const song = new Song();
      const debug = song.exportConfigurations[0];
      const release = song.exportConfigurations[1];

      debug.useCustomEntrypointLua = true;
      debug.customEntrypointLua = "function TIC() print('CUSTOM_DEBUG_CONTROL') end";
      const debugDetails = serializeSongToCartDetailed(song, false, debug, gTic80AllChannelsAudible);
      const releaseDetails = serializeSongToCartDetailed(song, false, release, gTic80AllChannelsAudible);

      assert.match(debugDetails.wholePlayroutineCode, /CUSTOM_DEBUG_CONTROL/);
      assert.doesNotMatch(releaseDetails.wholePlayroutineCode, /CUSTOM_DEBUG_CONTROL/);
      assert.match(debugDetails.wholePlayroutineCode, /invalid LZ match distance/);
      assert.doesNotMatch(releaseDetails.wholePlayroutineCode, /invalid LZ match distance/);

      const integration = song.addExportConfiguration();
      integration.name = "Integration release";
      integration.useCustomEntrypointLua = true;
      integration.customEntrypointLua = "";
      const integrationDetails = serializeSongToCartDetailed(
         song,
         false,
         integration,
         gTic80AllChannelsAudible,
      );
      assert.doesNotMatch(integrationDetails.wholePlayroutineCode, /function\s+TIC\s*\(/);
   });
});
