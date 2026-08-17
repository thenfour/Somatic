import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   createAudioRenderPreview,
   PCM16_MASTERING_SILENCE_ABS_SAMPLE,
   Pcm16AudioAnalyzer,
} from "../src/audio/audio_render_processing";
import type {AudioRenderSettings} from "../src/models/song";
import {linearGainToDecibels} from "../src/utils/music/dsp";

const settings = (overrides: Partial<AudioRenderSettings> = {}): AudioRenderSettings => ({
   removeDcBias: false,
   normalizePeak: false,
   normalizationTargetDbfs: -1,
   trimSilence: false,
   leadingSilenceMs: 0,
   trailingSilenceMs: 0,
   mp3BitrateKbps: 320,
   metadata: {title: "Test", artist: "", album: "", year: "", genre: "", comment: ""},
   ...overrides,
});

describe("PCM16 audio render processing", () => {
   it("uses the native 16-bit floor across every channel to find mastering-silence boundaries", () => {
      assert.equal(PCM16_MASTERING_SILENCE_ABS_SAMPLE, 1);
      const analyzer = new Pcm16AudioAnalyzer(1000, 2, 2);
      analyzer.accept(new Int16Array([
         0, 0,
         1, -1,
         0, 2,
         -3, 0,
         1, 0,
      ]));

      const analysis = analyzer.finish();
      assert.equal(analysis.frameCount, 5);
      assert.equal(analysis.trimStartFrame, 2);
      assert.equal(analysis.trimEndFrame, 4);
      assert.equal(analysis.peakAmplitude, 3 / 32768);
      assert.equal(analysis.peakDbfs, linearGainToDecibels(3 / 32768));
   });

   it("trims first, normalizes with one gain, then adds frame-rounded padding", () => {
      const analyzer = new Pcm16AudioAnalyzer(1000, 2, 2);
      analyzer.accept(new Int16Array([
         0, 0,
         0, 0,
         8192, -4096,
         16384, -8192,
         0, 0,
      ]));
      const analysis = analyzer.finish();
      const preview = createAudioRenderPreview(analysis, settings({
         normalizePeak: true,
         normalizationTargetDbfs: -6.020599913279624,
         trimSilence: true,
         leadingSilenceMs: 1.4,
         trailingSilenceMs: 2.6,
      }));

      assert.equal(preview.trimStartFrame, 2);
      assert.equal(preview.trimEndFrame, 4);
      assert.equal(preview.trimmedFrameCount, 2);
      assert.equal(preview.leadingSilenceFrames, 1);
      assert.equal(preview.trailingSilenceFrames, 3);
      assert.equal(preview.outputFrameCount, 6);
      assert.ok(Math.abs(preview.gain - 1) < 1e-12);
      assert.ok(Math.abs(preview.outputPeakAmplitude - 0.5) < 1e-12);
      assert.equal(preview.waveform.frameCount, preview.outputFrameCount);
   });

   it("does not amplify a render containing only the 16-bit mastering floor", () => {
      const analyzer = new Pcm16AudioAnalyzer(48000, 2);
      analyzer.accept(new Int16Array([0, 0, 1, -1, 0, 0]));
      const analysis = analyzer.finish();

      const retained = createAudioRenderPreview(analysis, settings({normalizePeak: true}));
      assert.equal(retained.gain, 1);
      assert.equal(retained.outputFrameCount, 3);

      const trimmed = createAudioRenderPreview(analysis, settings({normalizePeak: true, trimSilence: true}));
      assert.equal(trimmed.trimmedFrameCount, 0);
      assert.equal(trimmed.outputFrameCount, 1);
      assert.equal(trimmed.outputPeakDbfs, Number.NEGATIVE_INFINITY);
   });

   it("uses one normalization gain for boost and attenuation", () => {
      const analyzer = new Pcm16AudioAnalyzer(48000, 2);
      analyzer.accept(new Int16Array([8192, -4096, 4096, -2048]));
      const analysis = analyzer.finish();

      const boosted = createAudioRenderPreview(analysis, settings({
         normalizePeak: true,
         normalizationTargetDbfs: -6.020599913279624,
      }));
      assert.ok(Math.abs(boosted.gain - 2) < 1e-12);
      assert.ok(Math.abs(boosted.outputPeakAmplitude - 0.5) < 1e-12);

      const attenuated = createAudioRenderPreview(analysis, settings({
         normalizePeak: true,
         normalizationTargetDbfs: -18.06179973983887,
      }));
      assert.ok(Math.abs(attenuated.gain - 0.5) < 1e-12);
      assert.ok(Math.abs(attenuated.outputPeakAmplitude - 0.125) < 1e-12);
   });
});
