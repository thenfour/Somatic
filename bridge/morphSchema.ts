// Shared morph/sfx payload schema and encoder.
// Uses the bitpack helpers to keep layout authoritative in one place.
//
// The codec definition is the single source of truth. Field names, types, ranges,
// normalization, and Lua minification lists are all derived from it automatically.

import {SomaticCaps, Tic80Caps} from "../src/models/tic80Capabilities";
import {SomaticEffectKind, WaveEngineId} from "../src/models/instruments";
import {clamp} from "../src/utils/utils";
import {BitWriter, C, MemoryRegion, encodeWithOffsets, measureCodecOffsets, extractFieldInfo, fixedBits} from "../src/utils/bitpack/bitpack";
import type {Codec, CodecFieldInfo} from "../src/utils/bitpack/bitpack";
import type {inferCodecType} from "../src/utils/bitpack/bitpack";

// Generate a normalization function from field metadata
function makeNormalizer<T extends Record<string, any>>(fields: CodecFieldInfo[]): (input: T) => T {
   return (input: T): T => {
      const output: any = {};
      for (const field of fields) {
         const value = input[field.name];
         const codecNode = field.codec.node;

         if (codecNode.kind === "enum") {
            // Enums pass through; codec validates
            output[field.name] = value;
         } else if (codecNode.kind === "u" && codecNode.n === 1) {
            // Boolean/bit field
            output[field.name] = clamp(Number(value), 0, 1);
         } else if (field.signed) {
            output[field.name] = clamp(Math.trunc(value), field.min, field.max);
         } else {
            output[field.name] = clamp(Math.trunc(value), field.min, field.max);
         }
      }
      return output as T;
   };
}

// Single source of truth: the codec definition
// All other structures (types, field lists, normalization) derive from this.

const MorphEffectKindCodec = C.enum<SomaticEffectKind>("MorphEffectKind", 2, {
   none: SomaticEffectKind.none,
   wavefold: SomaticEffectKind.wavefold,
   hardSync: SomaticEffectKind.hardSync,
});

const WaveEngineIdCodec = C.enum<WaveEngineId>("WaveEngineId", 2, {
   native: WaveEngineId.native,
   pwm: WaveEngineId.pwm,
   morph: WaveEngineId.morph,
});


// =========================
// Waveform morph gradients (per-instrument, embedded waveforms)

// Each node stores the waveform as 16 bytes (2x 4-bit samples per byte), plus per-segment duration+curve.
// Note: The last node's duration+curve are stored but ignored at runtime.
export const WaveformMorphGradientNodeCodec = C.struct("WaveformMorphGradientNode", [
   C.field("waveBytes", C.array("waveBytes", C.u(8), 16)), // 16 bytes; each byte packs 2 4-bit samples.
   C.field("durationTicks10", C.u(10)),
   C.field("curveS6", C.i(6)),
]);

// Stored as: len (u5) then align-to-byte, then `len` nodes.
// We enforce maxCount here as a codec-level guard; UI will typically use SomaticCaps.maxMorphGradientNodes.
export const WaveformMorphGradientCodec = C.varArray(
   "WaveformMorphGradient",
   WaveformMorphGradientNodeCodec,
   C.u(5),
   SomaticCaps.maxMorphGradientNodes,
   true,
);

export const MorphEntryCodec = C.struct("MorphEntry", [
   C.field("instrumentId", C.u8()),
   C.field("waveEngineId", WaveEngineIdCodec),
   C.field("sourceWaveformIndex", C.u(4)),
   C.field("renderWaveformSlot", C.u(4)),
   // Byte offset (from start of extra-song payload) to WaveformMorphGradient data.
   // 0 means "no gradient".
   C.field("gradientOffsetBytes", C.u(16)),
   C.field("pwmDuty5", C.u(5)),
   C.field("pwmDepth5", C.u(5)),
   C.field("lfoCycleTicks12", C.u(12)),
   C.field("lowpassEnabled", C.bool()),
   C.field("lowpassFreqU8", C.u8()),
   C.field("lowpassDurationTicks12", C.u(12)),
   C.field("lowpassCurveS6", C.i(6)),
   // 0=envelope, 1=lfo, 2=none
   C.field("lowpassModSource", C.u(2)),
   C.field("effectKind", MorphEffectKindCodec),
   C.field("effectAmtU8", C.u8()),
   C.field("effectDurationTicks12", C.u(12)),
   C.field("effectCurveS6", C.i(6)),
   // 0=envelope, 1=lfo, 2=none
   C.field("effectModSource", C.u(2)),
]);

// =========================
// Somatic per-pattern extra data (POC: per-row Somatic command + param)

export const SomaticExtraSongDataHeaderCodec = C.struct("SomaticExtraSongDataHeader", [
   C.field("instrumentEntryCount", C.u8()),
   C.field("patternEntryCount", C.u8()),
]);

export const SomaticPatternCellCodec = C.struct("SomaticPatternCell", [
   // 0 = none; 1..15 = command id + 1
   // (UI stores 0-based command indices; we offset by +1 so 0 can mean "none")
   C.field("effectId", C.u(4)),
   C.field("paramU8", C.u8()),
]);

export const SomaticPatternEntryCodec = C.struct("SomaticPatternEntry", [
   // 0-based pattern-column index (preparedSong.patternColumns index)
   C.field("patternIndex", C.u8()),
   C.field("cells", C.array("cells", SomaticPatternCellCodec, 64)),
]);

// Derive everything else from the codec
const MORPH_ENTRY_FIELDS = extractFieldInfo(MorphEntryCodec);
const WAVEFORM_MORPH_GRADIENT_NODE_FIELDS = extractFieldInfo(WaveformMorphGradientNodeCodec);

// Auto-generate (mostly) the field names list for Lua minification
export const MorphEntryFieldNamesToRename = [
   ...MORPH_ENTRY_FIELDS.map(f => f.name),
   ...WAVEFORM_MORPH_GRADIENT_NODE_FIELDS.map(f => f.name),
   ...extractFieldInfo(SomaticPatternEntryCodec).map(f => f.name),
   ...extractFieldInfo(SomaticPatternCellCodec).map(f => f.name),
   "extraSongData",
   "samples",
   "morphGradientNodes",
   "songOrder",
] as readonly string[];

// Auto-generate the normalizer
const normalizeMorphEntry = makeNormalizer<MorphEntryPacked>(MORPH_ENTRY_FIELDS);

// Packed/flattened structure (inferred from codec fields)
export type MorphEntryPacked = inferCodecType<typeof MorphEntryCodec>;

// Input type with nested config (kept for ergonomic API)
export type MorphEntryInput = {
   instrumentId: number; //
   cfg: {
      waveEngineId: WaveEngineId; //
      sourceWaveformIndex: number;
      renderWaveformSlot: number;
      pwmDuty5: number;        //
      pwmDepth5: number;       //
      lowpassEnabled: boolean; //
      lowpassFreqU8: number;
      lowpassDurationTicks12: number; //
      lowpassCurveS6: number;         //
      lowpassModSource: number;       //
      effectKind: SomaticEffectKind;  //
      effectAmtU8: number;            //
      effectDurationTicks12: number;
      effectCurveS6: number;
      effectModSource: number;
      lfoCycleTicks12: number;
   };
   // Only used when waveEngine = morph
   morphGradientNodes?: WaveformMorphGradientNodePacked[];
};

// Flatten input structure to packed structure
function flattenEntry(entry: MorphEntryInput): MorphEntryPacked {
   const {cfg} = entry;
   return {
      instrumentId: entry.instrumentId,
      waveEngineId: cfg.waveEngineId,
      sourceWaveformIndex: cfg.sourceWaveformIndex,
      renderWaveformSlot: cfg.renderWaveformSlot,
      gradientOffsetBytes: 0,
      pwmDuty5: cfg.pwmDuty5,
      pwmDepth5: cfg.pwmDepth5,
      lfoCycleTicks12: cfg.lfoCycleTicks12,
      lowpassEnabled: cfg.lowpassEnabled ? 1 : 0,
      lowpassFreqU8: cfg.lowpassFreqU8,
      lowpassDurationTicks12: cfg.lowpassDurationTicks12,
      lowpassCurveS6: cfg.lowpassCurveS6,
      lowpassModSource: cfg.lowpassModSource,
      effectKind: cfg.effectKind,
      effectAmtU8: cfg.effectAmtU8,
      effectDurationTicks12: cfg.effectDurationTicks12,
      effectCurveS6: cfg.effectCurveS6,
      effectModSource: cfg.effectModSource,
   };
}

const MorphHeaderCodec = C.struct("MorphHeader", [
   C.field("entryCount", C.u8()),
]);

export const MORPH_ENTRY_BITS = fixedBits(MorphEntryCodec, "MorphEntry");
export const MORPH_ENTRY_BYTES = MorphEntryCodec.byteSizeCeil!();
export const MORPH_HEADER_BITS = fixedBits(MorphHeaderCodec, "MorphHeader");
export const MORPH_HEADER_BYTES = MorphHeaderCodec.byteSizeCeil!();

export const SOMATIC_EXTRA_SONG_HEADER_BITS = fixedBits(SomaticExtraSongDataHeaderCodec, "SomaticExtraSongDataHeader");
export const SOMATIC_EXTRA_SONG_HEADER_BYTES = SomaticExtraSongDataHeaderCodec.byteSizeCeil!();

export const SOMATIC_PATTERN_ENTRY_BITS = fixedBits(SomaticPatternEntryCodec, "SomaticPatternEntry");
export const SOMATIC_PATTERN_ENTRY_BYTES = SomaticPatternEntryCodec.byteSizeCeil!();

export const WAVEFORM_MORPH_GRADIENT_NODE_BITS = fixedBits(WaveformMorphGradientNodeCodec, "WaveformMorphGradientNode");
export const WAVEFORM_MORPH_GRADIENT_NODE_BYTES = WaveformMorphGradientNodeCodec.byteSizeCeil!();

export type SomaticPatternCellPacked = {
   // 0 = none; 1..15 = command id + 1
   effectId: number; //
   paramU8: number;
};

export type SomaticPatternEntryPacked = {
   patternIndex: number;              //
   cells: SomaticPatternCellPacked[]; // length 64
};

export type WaveformMorphGradientNodePacked = {
   // 16 bytes; each byte packs 2 4-bit samples.
   waveBytes: number[];     // length 16
   durationTicks10: number; // 0-1023
   curveS6: number;         // signed 6-bit (-32..31)
};

export type SomaticExtraSongDataInput = {
   instruments: MorphEntryInput[]; patterns: SomaticPatternEntryPacked[];
};

function clampU16(value: number): number {
   return clamp(Math.trunc(value), 0, 0xffff);
}

function clampU(value: number, bits: number): number {
   const v = Math.trunc(value);
   const max = (1 << bits) - 1;
   return clamp(v, 0, max);
}

function clampU8(value: number): number {
   return clamp(Math.trunc(value), 0, 255);
}

function normalizeSomaticPatternEntry(entry: SomaticPatternEntryPacked): SomaticPatternEntryPacked {
   const cells: SomaticPatternCellPacked[] = new Array(Tic80Caps.pattern.maxRows);
   for (let i = 0; i < Tic80Caps.pattern.maxRows; i++) {
      const c = entry.cells[i] ?? {effectId: 0, paramU8: 0};
      cells[i] = {
         effectId: clampU(c.effectId, 4),
         paramU8: clampU8(c.paramU8),
      };
   }
   return {
      patternIndex: clampU8(entry.patternIndex),
      cells,
   };
}

export function encodeSomaticExtraSongDataPayload(input: SomaticExtraSongDataInput, totalBytes?: number): Uint8Array {
   const instrumentEntryCount = input.instruments.length;
   const patternEntryCount = input.patterns.length;

   // Prepare normalized data
   const normalizedInstruments = input.instruments.map(entry => {
      const packed = flattenEntry(entry);
      return normalizeMorphEntry(packed);
   });

   const normalizedPatterns = input.patterns.map(entry => normalizeSomaticPatternEntry(entry));

   // Collect gradient data (only for morph instruments)
   const gradients: WaveformMorphGradientNodePacked[][] = [];
   const gradientInstrumentIndices: number[] = [];
   for (let i = 0; i < instrumentEntryCount; i++) {
      const inst = input.instruments[i];
      const waveEngineId: WaveEngineId = inst.cfg.waveEngineId;
      if (waveEngineId !== WaveEngineId.morph)
         continue;
      const nodes = inst.morphGradientNodes || [];
      gradients.push(nodes);
      gradientInstrumentIndices.push(i);
   }

   // Define the complete payload schema
   const PayloadCodec = C.struct("SomaticExtraSongDataPayload", [
      C.field("header", SomaticExtraSongDataHeaderCodec),
      C.field("instruments", C.runtimeArray("instruments", MorphEntryCodec, true)),
      C.field("patterns", C.runtimeArray("patterns", SomaticPatternEntryCodec, true)),
      C.field("gradients", C.runtimeArray("gradients", WaveformMorphGradientCodec, true)),
   ]);

   const payloadData = {
      header: {instrumentEntryCount, patternEntryCount},
      instruments: normalizedInstruments,
      patterns: normalizedPatterns,
      gradients: gradients,
   };

   // Measure to get offsets
   const ctx = measureCodecOffsets(PayloadCodec, payloadData);

   // Patch gradient offset fields with computed values
   for (let i = 0; i < normalizedInstruments.length; i++) {
      const gradientIndex = gradientInstrumentIndices.indexOf(i);
      if (gradientIndex !== -1) {
         const gradientPath = `gradients[${gradientIndex}]`;
         const offset = ctx.getOffset(gradientPath);
         normalizedInstruments[i].gradientOffsetBytes = clampU16(offset);
      }
   }

   // Get total size from measurement
   const measuredBytes = ctx._writer!.cur.currentByteLengthCeil();

   if (typeof totalBytes === "number" && measuredBytes > totalBytes) {
      throw new Error(`SOMATIC_SFX_CONFIG overflow: need ${measuredBytes} bytes, have ${totalBytes}`);
   }

   const out = new Uint8Array(totalBytes ?? measuredBytes);
   out.fill(0);

   const region = new MemoryRegion({
      name: "somatic_extra_song_data",
      address: 0,
      size: out.length,
   });

   // Encode with the codec (it already knows the layout from the schema)
   encodeWithOffsets(PayloadCodec, payloadData, out, region);

   return out;
}
