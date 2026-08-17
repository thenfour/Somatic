import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {AudioSampleSink, BufferSource, Input, WAVE} from "mediabunny";

import {
   analyzeTic80CapturedWav,
   createAudioRenderMaster,
   encodeAudioRenderDownload,
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

async function readPcm16Wave(bytes: Uint8Array): Promise<Int16Array> {
   const input = new Input({formats: [WAVE], source: new BufferSource(bytes)});
   try {
      const track = await input.getPrimaryAudioTrack();
      assert.ok(track);
      const samples: number[] = [];
      const sink = new AudioSampleSink(track);
      for await (const sample of sink.samples()) {
         try {
            const byteLength = sample.allocationSize({format: "s16", planeIndex: 0});
            const pcm = new Int16Array(byteLength / Int16Array.BYTES_PER_ELEMENT);
            sample.copyTo(pcm, {format: "s16", planeIndex: 0});
            samples.push(...pcm);
         } finally {
            sample.close();
         }
      }
      return Int16Array.from(samples);
   } finally {
      input.dispose();
   }
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
         removeDcBias: false,
         normalizePeak: true,
         normalizationTargetDbfs: -12.041199826559248,
         trimSilence: true,
         leadingSilenceMs: 1,
         trailingSilenceMs: 2,
         mp3BitrateKbps: 320,
         metadata: {
            title: "Adapter test",
            artist: "Somatic",
            album: "",
            year: "2026",
            genre: "Chiptune",
            comment: "Metadata",
         },
      };
      const master = await createAudioRenderMaster({
         sourceWavBytes: sourceBytes,
         analysis,
         settings,
      });
      assert.equal(master.mimeType, "audio/wav");
      assert.equal(master.preview.outputFrameCount, 5);

      const encoded = await encodeAudioRenderDownload({
         masterWavBytes: master.bytes,
         masterFrameCount: master.preview.outputFrameCount,
         format: "wav",
         metadata: settings.metadata,
         mp3BitrateKbps: settings.mp3BitrateKbps,
      });
      assert.equal(encoded.mimeType, "audio/wav");
      assert.equal(encoded.extensionWithDot, ".wav");

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

   it("runs the complete padded PCM stream through the DC filter", async () => {
      const sourceBytes = createPcm16Wave({
         sampleRateHz: 1000,
         channelCount: 2,
         interleavedSamples: new Int16Array([
            1000, 2000,
            1000, 2000,
            1000, 2000,
         ]),
      });
      const analysis = await analyzeTic80CapturedWav({wavBytes: sourceBytes});
      const settings: AudioRenderSettings = {
         removeDcBias: true,
         normalizePeak: false,
         normalizationTargetDbfs: -1,
         trimSilence: false,
         leadingSilenceMs: 2,
         trailingSilenceMs: 2,
         mp3BitrateKbps: 320,
         metadata: {title: "DC", artist: "", album: "", year: "", genre: "", comment: ""},
      };

      const master = await createAudioRenderMaster({sourceWavBytes: sourceBytes, analysis, settings});
      assert.equal(master.preview.outputFrameCount, 7);
      assert.deepEqual(Array.from(await readPcm16Wave(master.bytes)), [
         0, 0,
         0, 0,
         1000, 2000,
         998, 1996,
         996, 1992,
         -6, -12,
         -6, -12,
      ]);
   });
});
