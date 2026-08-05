import assert from "node:assert/strict";
import {describe, it} from "node:test";

import {
   decodeSomaticExtraSongDataPayload,
   encodeSomaticExtraSongDataPayload,
   SOMATIC_PATTERN_CELL_COUNT,
   SOMATIC_PATTERN_MASK_BYTES,
   SOMATIC_PATTERN_MASKS_BYTES,
   type MorphEntryInput,
   type WaveformMorphGradientNodePacked,
} from "../bridge/morphSchema";
import {SomaticMemoryLayout} from "../bridge/memory_layout";
import {
   BridgeExtraSongDataOverflowError,
   encodeBridgeExtraSongDataTransaction,
} from "../bridge/extraSongBridgeTransaction";
import {SomaticEffectKind, WaveEngineId} from "../src/models/instruments";
import {
   base85Plus1Decode,
   base85Plus1Encode,
   gSomaticLZDefaultConfig,
   lzCompress,
   lzDecompress,
} from "../src/utils/encoding";

function makeNode(seed: number): WaveformMorphGradientNodePacked {
   return {
      waveBytes: Array.from({length: 16}, (_, index) => (seed + index) & 0xff),
      durationTicks10: (seed * 17) & 0x03ff,
      curveS6: (seed % 64) - 32,
   };
}

function makeInstrument(instrumentId: number, nodes: WaveformMorphGradientNodePacked[]): MorphEntryInput {
   return {
      instrumentId,
      cfg: {
         waveEngineId: nodes.length > 0 ? WaveEngineId.morph : WaveEngineId.native,
         sourceWaveformIndex: 3,
         pwmDuty5: 15,
         pwmDepth5: 7,
         lowpassEnabled: true,
         lowpassAmountU8: 123,
         lowpassDurationTicks12: 2345,
         lowpassCurveS6: -17,
         lowpassModSource: 1,
         effectKind: SomaticEffectKind.wavefold,
         effectAmtU8: 211,
         effectDurationTicks12: 3456,
         effectCurveS6: 19,
         effectModSource: 2,
         lfoCycleTicks12: 1025,
         panU8: 0,
         panLfoDepthU8: 255,
         volumeU8: 128,
      },
      morphGradientNodes: nodes,
   };
}

describe("Somatic extra-song binary payload", () => {
   it("uses fixed empty occupancy masks that collapse under the selected LZ settings", () => {
      const payload = encodeSomaticExtraSongDataPayload({instruments: [], patterns: []});
      assert.equal(payload.length, 1 + SOMATIC_PATTERN_MASKS_BYTES);
      assert.deepEqual(decodeSomaticExtraSongDataPayload(payload), {
         instruments: [],
         patterns: [],
         bytesRead: payload.length,
      });

      const compressed = lzCompress(payload, gSomaticLZDefaultConfig);
      assert.ok(compressed.length < 32, `expected empty masks to compress tightly, got ${compressed.length}`);
      assert.deepEqual(lzDecompress(compressed), payload);
   });

   it("distinguishes zero from absence and covers the final cell in all 256 columns", () => {
      const payload = encodeSomaticExtraSongDataPayload({
         instruments: [],
         patterns: [
            {
               patternIndex: 0,
               cells: [{rowIndex: 0, volumeU8: 0, panU8: 0, effectId: 1, paramU8: 0}],
            },
            {
               patternIndex: 255,
               cells: [{rowIndex: 63, volumeU8: 255, panU8: 255, effectId: 5, paramU8: 255}],
            },
         ],
      });

      const firstMaskByte = 1;
      const lastMaskByte = firstMaskByte + SOMATIC_PATTERN_MASK_BYTES - 1;
      assert.equal(payload[firstMaskByte] & 1, 1);
      assert.equal(payload[lastMaskByte] & 0x80, 0x80);
      assert.equal(payload[firstMaskByte + SOMATIC_PATTERN_MASK_BYTES] & 1, 1);
      assert.equal(payload[firstMaskByte + SOMATIC_PATTERN_MASK_BYTES * 2] & 1, 1);

      const decoded = decodeSomaticExtraSongDataPayload(payload);
      assert.deepEqual(decoded.patterns, [
         {
            patternIndex: 0,
            cells: [{rowIndex: 0, volumeU8: 0, panU8: 0, effectId: 1, paramU8: 0}],
         },
         {
            patternIndex: 255,
            cells: [{rowIndex: 63, volumeU8: 255, panU8: 255, effectId: 5, paramU8: 255}],
         },
      ]);
      assert.equal(SOMATIC_PATTERN_CELL_COUNT, 256 * 64);
   });

   it("round-trips inline gradients with zero, one, and the maximum node count", () => {
      const instruments = [
         makeInstrument(2, []),
         makeInstrument(3, [makeNode(1)]),
         makeInstrument(4, Array.from({length: 16}, (_, index) => makeNode(index + 2))),
      ];
      const payload = encodeSomaticExtraSongDataPayload({instruments, patterns: []});
      const decoded = decodeSomaticExtraSongDataPayload(payload);

      assert.deepEqual(decoded.instruments.map(entry => entry.morphGradientNodes.length), [0, 1, 16]);
      assert.deepEqual(decoded.instruments[1].morphGradientNodes[0], makeNode(1));
      assert.deepEqual(decoded.instruments[2].morphGradientNodes[15], makeNode(17));
      assert.equal(decoded.bytesRead, payload.length);
   });

   it("round-trips both orderly and random practical-heavy occupancy through LZ", () => {
      let randomState = 0x12345678;
      const randomByte = () => {
         randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
         return randomState >>> 24;
      };
      const makePatterns = (orderly: boolean) => Array.from({length: 64}, (_, patternIndex) => {
         const cells = Array.from({length: 64}, (_, rowIndex) => {
            const cell: {
               rowIndex: number;
               volumeU8?: number;
               panU8?: number;
               effectId?: number;
               paramU8?: number;
            } = {rowIndex};
            const linearIndex = patternIndex * 64 + rowIndex;
            if (orderly ? patternIndex < 32 : randomByte() < 128)
               cell.volumeU8 = orderly ? rowIndex * 4 & 0xff : randomByte();
            if (orderly ? patternIndex >= 32 && patternIndex < 48 : randomByte() < 64)
               cell.panU8 = orderly ? patternIndex * 4 & 0xff : randomByte();
            if (orderly ? linearIndex % 7 === 0 : randomByte() < 38) {
               cell.effectId = orderly ? linearIndex % 5 + 1 : randomByte() % 5 + 1;
               cell.paramU8 = orderly ? rowIndex : randomByte();
            }
            return cell;
         }).filter(cell => cell.volumeU8 !== undefined || cell.panU8 !== undefined || cell.effectId !== undefined);
         return {patternIndex, cells};
      });

      const orderly = encodeSomaticExtraSongDataPayload({instruments: [], patterns: makePatterns(true)});
      const random = encodeSomaticExtraSongDataPayload({instruments: [], patterns: makePatterns(false)});
      const orderlyCompressed = lzCompress(orderly, gSomaticLZDefaultConfig);
      const randomCompressed = lzCompress(random, gSomaticLZDefaultConfig);
      assert.deepEqual(lzDecompress(orderlyCompressed), orderly);
      assert.deepEqual(lzDecompress(randomCompressed), random);
      assert.ok(orderlyCompressed.length < randomCompressed.length);
   });

   it("round-trips Base85+1 for every padding prefix", () => {
      for (let length = 0; length <= 7; length++) {
         const bytes = Uint8Array.from({length}, (_, index) => index * 37 & 0xff);
         assert.deepEqual(base85Plus1Decode(base85Plus1Encode(bytes)), bytes);
      }
   });
});

describe("bridge extra-song transaction", () => {
   it("accepts exactly the Tiles+Sprites compressed limit and rejects one byte more", () => {
      const limit = SomaticMemoryLayout.computed.BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES;
      assert.equal(limit, 16382);

      const transaction = encodeBridgeExtraSongDataTransaction(new Uint8Array(limit), 99999);
      assert.equal(transaction.length, SomaticMemoryLayout.bridgeExtraSongData.size);
      assert.equal(transaction[0] | transaction[1] << 8, limit);

      assert.throws(
         () => encodeBridgeExtraSongDataTransaction(new Uint8Array(limit + 1), 99999),
         (error: unknown) => error instanceof BridgeExtraSongDataOverflowError
            && error.compressedBytes === limit + 1
            && error.limitBytes === limit
            && /export remains available/.test(error.message),
      );
   });
});
