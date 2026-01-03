import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {decodeFloat32PcmFromDto, encodeFloat32PcmToDto} from "../src/audio/wav_reader";
import {buildMorphGradientFromSampleImport} from "../src/audio/morph_sample_import";

describe("morph sample import", () => {
   it("roundtrips Float32 PCM through base64 DTO", () => {
      const decoded = {
         fileName: "test.wav",
         sampleRateHz: 44100,
         channelCount: 2,
         frameCount: 5,
         channels: [
            new Float32Array([0, 0.5, -0.5, 1, -1]),
            new Float32Array([1, 0.25, -0.25, 0, 0.75]),
         ],
      };

      const dto = encodeFloat32PcmToDto(decoded);
      const rt = decodeFloat32PcmFromDto(dto);

      assert.equal(rt.channelCount, 2);
      assert.equal(rt.frameCount, 5);
      assert.deepEqual(Array.from(rt.channels[0]!), Array.from(decoded.channels[0]!));
      assert.deepEqual(Array.from(rt.channels[1]!), Array.from(decoded.channels[1]!));
   });

   it("normalizes generated morph nodes with shared gain", () => {
      const frameCount = 64;
      const decoded = {
         fileName: "test.wav",
         sampleRateHz: 44100,
         channelCount: 1,
         frameCount,
         channels: [new Float32Array(Array.from({length: frameCount}, () => 0.25))],
      };

      const nodes = buildMorphGradientFromSampleImport({
         decoded,
         windows: [{begin01: 0, lengthWaveforms: 1}],
         targetDurationSeconds: 1,
      });

      assert.equal(nodes.length, 1);
      const amps = nodes[0]!.amplitudes;
      const maxAmp = Math.max(...Array.from(amps));
      assert.equal(maxAmp, 15);
   });
});
