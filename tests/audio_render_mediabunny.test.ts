import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {BufferSource, Input, WAVE} from "mediabunny";

import {
   analyzeTic80CapturedWav,
   encodeAudioRender,
} from "../src/audio/audio_render_mediabunny";
import type {AudioRenderSettings} from "../src/models/song";

function createPcm16Wave(args: {
   sampleRateHz: number;
   channelCount: number;
   interleavedSamples: Int16Array;
}): Uint8Array {
   const dataByteLength = args.interleavedSamples.byteLength;
   const bytes = new Uint8Array(44 + dataByteLength);
   const view = new DataView(bytes.buffer);
   const writeAscii = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
   };
   writeAscii(0, "RIFF");
   view.setUint32(4, 36 + dataByteLength, true);
   writeAscii(8, "WAVE");
   writeAscii(12, "fmt ");
   view.setUint32(16, 16, true);
   view.setUint16(20, 1, true);
   view.setUint16(22, args.channelCount, true);
   view.setUint32(24, args.sampleRateHz, true);
   view.setUint32(28, args.sampleRateHz * args.channelCount * 2, true);
   view.setUint16(32, args.channelCount * 2, true);
   view.setUint16(34, 16, true);
   writeAscii(36, "data");
   view.setUint32(40, dataByteLength, true);
   for (let i = 0; i < args.interleavedSamples.length; i++) {
      view.setInt16(44 + i * 2, args.interleavedSamples[i] ?? 0, true);
   }
   return bytes;
}

describe("MediaBunny audio render adapter", () => {
   it("analyzes captured PCM16 and re-encodes processed WAVE audio", async () => {
      const sourceBytes = createPcm16Wave({
         sampleRateHz: 1000,
         channelCount: 2,
         interleavedSamples: new Int16Array([
            0, 0,
            2, -2,
            16384, -8192,
            0, 0,
         ]),
      });
      const analysis = await analyzeTic80CapturedWav({wavBytes: sourceBytes});
      assert.equal(analysis.frameCount, 4);
      assert.equal(analysis.channelCount, 2);
      assert.equal(analysis.trimStartFrame, 1);
      assert.equal(analysis.trimEndFrame, 3);
      assert.equal(analysis.peakAmplitude, 0.5);

      const settings: AudioRenderSettings = {
         format: "wav",
         normalizePeak: true,
         normalizationTargetDbfs: -12.041199826559248,
         trimSilence: true,
         leadingSilenceMs: 1,
         trailingSilenceMs: 2,
         metadata: {
            title: "Adapter test",
            artist: "Somatic",
            album: "",
            year: "2026",
            genre: "Chiptune",
            comment: "Metadata",
         },
      };
      const encoded = await encodeAudioRender({
         sourceWavBytes: sourceBytes,
         analysis,
         settings,
      });
      assert.equal(encoded.mimeType, "audio/wav");
      assert.equal(encoded.extensionWithDot, ".wav");
      assert.equal(encoded.preview.outputFrameCount, 5);

      const outputAnalysis = await analyzeTic80CapturedWav({wavBytes: encoded.bytes});
      assert.equal(outputAnalysis.frameCount, 5);
      // Trimming intentionally precedes normalization. The original two-LSB boundary sample is retained, then
      // attenuation quantizes it to the one-LSB mastering floor in the encoded result.
      assert.equal(outputAnalysis.trimStartFrame, 2);
      assert.equal(outputAnalysis.trimEndFrame, 3);
      assert.equal(outputAnalysis.peakAmplitude, 0.25);

      const taggedInput = new Input({formats: [WAVE], source: new BufferSource(encoded.bytes)});
      try {
         const tags = await taggedInput.getMetadataTags();
         assert.equal(tags.title, "Adapter test");
         assert.equal(tags.artist, "Somatic");
         assert.equal(tags.genre, "Chiptune");
         assert.equal(tags.comment, "Metadata");
         assert.equal(tags.date?.getUTCFullYear(), 2026);
      } finally {
         taggedInput.dispose();
      }
   });
});
