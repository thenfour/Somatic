import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   cacheAudioRenderDownload,
   getAudioRenderSettingsChangeImpact,
   getCachedAudioRenderDownload,
   invalidateAudioRenderDownloadCache,
} from "../src/audio/audio_render_session";
import type {AudioRenderSettings} from "../src/models/song";

const settings = (): AudioRenderSettings => ({
   removeDcBias: true,
   normalizePeak: false,
   normalizationTargetDbfs: -1,
   trimSilence: false,
   leadingSilenceMs: 0,
   trailingSilenceMs: 0,
   mp3BitrateKbps: 320,
   metadata: {title: "Test", artist: "", album: "", year: "", genre: "", comment: ""},
});

describe("audio render session cache", () => {
   it("classifies master, metadata, and MP3-only invalidation", () => {
      const initial = settings();
      assert.equal(getAudioRenderSettingsChangeImpact(initial, initial), "none");
      assert.equal(getAudioRenderSettingsChangeImpact(initial, {...initial, removeDcBias: false}), "master");
      assert.equal(getAudioRenderSettingsChangeImpact(initial, {
         ...initial,
         metadata: {...initial.metadata, artist: "Artist"},
      }), "outputs");
      assert.equal(getAudioRenderSettingsChangeImpact(initial, {...initial, mp3BitrateKbps: 192}), "mp3");
   });

   it("memoizes exact output settings and selectively drops MP3", () => {
      const initial = settings();
      let cache = cacheAudioRenderDownload({}, "wav", initial, "wav bytes");
      cache = cacheAudioRenderDownload(cache, "mp3", initial, "mp3 bytes");

      assert.equal(getCachedAudioRenderDownload(cache, "wav", initial), "wav bytes");
      assert.equal(getCachedAudioRenderDownload(cache, "mp3", initial), "mp3 bytes");
      assert.equal(getCachedAudioRenderDownload(cache, "mp3", {...initial, mp3BitrateKbps: 192}), null);

      const retained = invalidateAudioRenderDownloadCache(cache, "mp3");
      assert.equal(getCachedAudioRenderDownload(retained, "wav", initial), "wav bytes");
      assert.equal(getCachedAudioRenderDownload(retained, "mp3", initial), null);
      assert.deepEqual(invalidateAudioRenderDownloadCache(cache, "outputs"), {});
   });
});
