import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {Song} from "../src/models/song";

describe("audio render settings", () => {
   it("follows ordinary song-title edits until the render title is intentionally changed", () => {
      const song = new Song({name: "Main title"});

      assert.equal(song.audioRenderSettings.metadata.title, "Main title");
      song.setName("Renamed project");
      assert.equal(song.audioRenderSettings.metadata.title, "Renamed project");

      song.audioRenderSettings.metadata.title = "Release title";
      song.setName("Another project title");
      assert.equal(song.audioRenderSettings.metadata.title, "Release title");
   });

   it("persists processing, MP3, and metadata settings through serialization", () => {
      const song = new Song({name: "Project title"});
      song.audioRenderSettings = {
         removeDcBias: false,
         normalizePeak: true,
         normalizationTargetDbfs: -2.5,
         trimSilence: true,
         leadingSilenceMs: 150,
         trailingSilenceMs: 500,
         mp3BitrateKbps: 192,
         metadata: {
            title: "Release title",
            artist: "Artist",
            album: "Album",
            year: "2026",
            genre: "Chiptune",
            comment: "Rendered by Somatic",
         },
      };

      const loaded = Song.fromJSON(song.toJSON());

      assert.deepEqual(loaded.audioRenderSettings, song.audioRenderSettings);
      assert.equal(loaded.getAudioRenderFilename(".flac"), "Release title.flac");
   });

   it("normalizes malformed persisted settings", () => {
      const song = Song.fromData({
         name: "Fallback title",
         audioRenderSettings: {
            format: "unsupported",
            removeDcBias: "yes",
            normalizePeak: "yes",
            normalizationTargetDbfs: 4,
            trimSilence: "yes",
            leadingSilenceMs: -10,
            trailingSilenceMs: 999999,
            mp3BitrateKbps: 123,
            metadata: {title: 42},
         },
      } as any);

      assert.equal(song.audioRenderSettings.removeDcBias, true);
      assert.equal(song.audioRenderSettings.normalizePeak, false);
      assert.equal(song.audioRenderSettings.normalizationTargetDbfs, 0);
      assert.equal(song.audioRenderSettings.trimSilence, false);
      assert.equal(song.audioRenderSettings.leadingSilenceMs, 0);
      assert.equal(song.audioRenderSettings.trailingSilenceMs, 5000);
      assert.equal(song.audioRenderSettings.mp3BitrateKbps, 320);
      assert.equal(song.audioRenderSettings.metadata.title, "Fallback title");
      assert.equal(song.audioRenderSettings.metadata.artist, "");
   });
});
