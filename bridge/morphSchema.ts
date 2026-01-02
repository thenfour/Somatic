// Shared morph/sfx payload schema and encoder.
// Uses the bitpack helpers to keep layout authoritative in one place.
//
// The codec definition is the single source of truth. Field names, types, ranges,
// normalization, and Lua minification lists are all derived from it automatically.

import {SomaticCaps, Tic80Caps} from "../src/models/tic80Capabilities";
import {WaveEngineId} from "../src/models/instruments";
import {clamp} from "../src/utils/utils";
import {BitWriter, C, MemoryRegion} from "../src/utils/bitpack/bitpack";
import type {Codec} from "../src/utils/bitpack/bitpack";
import {LayoutBuilder} from "../src/utils/bitpack/LayoutBuilder";

export type MorphEffectKind = "none"|"wavefold"|"hardSync";

// Helper types to extract field info from codec
type CodecFieldInfo = {
   name: string;                 //
   codec: Codec<any>;            //
   bitSize: number | "variable"; //
   min: number;                  //
   max: number;                  //
   signed: boolean;              //
};

// Extract field metadata from a struct codec
function extractFieldInfo(structCodec: Codec<any>): CodecFieldInfo[] {
   const node = structCodec.node;
   if (node.kind !== "struct") {
      throw new Error("extractFieldInfo requires a struct codec");
   }

   const fields: CodecFieldInfo[] = [];
   for (const item of node.seq) {
      if (item.kind !== "field")
         continue;

      const codec = item.codec;
      const codecNode = codec.node;
      let min = 0;
      let max = 0;
      let signed = false;

      if (codecNode.kind === "u") {
         signed = false;
         max = Math.pow(2, codecNode.n) - 1;
      } else if (codecNode.kind === "i") {
         signed = true;
         const halfRange = Math.pow(2, codecNode.n - 1);
         min = -halfRange;
         max = halfRange - 1;
      } else if (codecNode.kind === "enum") {
         // Enums are handled by the codec itself, just pass through
         min = 0;
         max = Math.pow(2, codecNode.nBits) - 1;
      }

      fields.push({
         name: item.name,
         codec,
         bitSize: codec.bitSize,
         min,
         max,
         signed,
      });
   }

   return fields;
}

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

const MorphEffectKindCodec = C.enum("MorphEffectKind", 2, {
   none: 0,
   wavefold: 1,
   hardSync: 2,
});

// =========================
// Waveform morph gradients (per-instrument, embedded waveforms)

// Each node stores the waveform as 16 bytes (2x 4-bit samples per byte), plus per-segment duration+curve.
// Note: The last node's duration+curve are stored but ignored at runtime.
export const WaveformMorphGradientNodeCodec = C.struct("WaveformMorphGradientNode", [
   C.field("waveBytes", C.array("waveBytes", C.u(8), 16)),
   C.field("durationTicks10", C.u(10)),
   C.field("curveS6", C.i(6)),
]);

// Stored as: len (u5) then align-to-byte, then `len` nodes.
// We enforce maxCount here as a codec-level guard; UI will typically use SomaticCaps.maxMorphGradientNodes.
export const WaveformMorphGradientCodec = C.varArray(
   "WaveformMorphGradient",
   WaveformMorphGradientNodeCodec,
   C.u(5),
   16,
   true,
);

export const MorphEntryCodec = C.struct("MorphEntry", [
   C.field("instrumentId", C.u8()),
   C.field("waveEngineId", C.u(2)),
   C.field("sourceWaveformIndex", C.u(4)),
   C.field("renderWaveformSlot", C.u(4)),
   // Byte offset (from start of extra-song payload) to WaveformMorphGradient data.
   // 0 means "no gradient".
   C.field("gradientOffsetBytes", C.u(16)),
   C.field("pwmDuty5", C.u(5)),
   C.field("pwmDepth5", C.u(5)),
   C.field("lfoCycleTicks12", C.u(12)),
   C.field("lowpassEnabled", C.bool()),
   C.field("lowpassDurationTicks12", C.u(12)),
   C.field("lowpassCurveS6", C.i(6)),
   C.field("lowpassModSource", C.bool()),
   C.field("effectKind", MorphEffectKindCodec),
   C.field("effectAmtU8", C.u8()),
   C.field("effectDurationTicks12", C.u(12)),
   C.field("effectCurveS6", C.i(6)),
   C.field("effectModSource", C.bool()),
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

// Auto-generate the field names list for Lua minification
export const MorphEntryFieldNamesToRename = MORPH_ENTRY_FIELDS.map(f => f.name) as readonly string[];

// Auto-generate the normalizer
const normalizeMorphEntry = makeNormalizer<MorphEntryPacked>(MORPH_ENTRY_FIELDS);

// Type for the packed/flattened structure (inferred from codec fields)
export type MorphEntryPacked = {
   instrumentId: number;                 //
   waveEngineId: WaveEngineId;           //
   sourceWaveformIndex: number;          //
   renderWaveformSlot: number;           //
   gradientOffsetBytes: number;          //
   pwmDuty5: number;                     //
   pwmDepth5: number;                    //
   lfoCycleTicks12: number;              //
   lowpassEnabled: number;               //
   lowpassDurationTicks12: number;       //
   lowpassCurveS6: number;               //
   lowpassModSource: number;             //
   effectKind: MorphEffectKind | number; //
   effectAmtU8: number;                  //
   effectDurationTicks12: number;        //
   effectCurveS6: number;                //
   effectModSource: number;
};

// Input type with nested config (kept for ergonomic API)
export type MorphEntryInput = {
   instrumentId: number; cfg: {
      waveEngineId: WaveEngineId; //
      sourceWaveformIndex: number;
      renderWaveformSlot: number;
      pwmDuty5: number;               //
      pwmDepth5: number;              //
      lowpassEnabled: boolean;        //
      lowpassDurationTicks12: number; //
      lowpassCurveS6: number;         //
      lowpassModSource: number;       //
      effectKind: MorphEffectKind;    //
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
      lowpassDurationTicks12: cfg.lowpassDurationTicks12,
      lowpassCurveS6: cfg.lowpassCurveS6,
      lowpassModSource: cfg.lowpassModSource ? 1 : 0,
      effectKind: cfg.effectKind,
      effectAmtU8: cfg.effectAmtU8,
      effectDurationTicks12: cfg.effectDurationTicks12,
      effectCurveS6: cfg.effectCurveS6,
      effectModSource: cfg.effectModSource ? 1 : 0,
   };
}

const MorphHeaderCodec = C.struct("MorphHeader", [
   C.field("entryCount", C.u8()),
]);

function fixedBits(codec: Codec<unknown>, name: string): number {
   if (codec.bitSize === "variable")
      throw new Error(`${name} codec must be fixed size`);
   return codec.bitSize;
}

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

   // collect gradient data (and associate with instrument indices)
   type GradientData = { instrumentIndex: number; nodes: WaveformMorphGradientNodePacked[]; };
   const gradients: GradientData[] = [];
   for (let i = 0; i < instrumentEntryCount; i++) {
      const inst = input.instruments[i];
      const waveEngineId: WaveEngineId = inst.cfg.waveEngineId;
      if (waveEngineId !== WaveEngineId.morph)
         continue;
      const nodes = inst.morphGradientNodes || [];
      gradients.push({instrumentIndex: i, nodes});
   }

   // Use LayoutBuilder to compute section offsets declaratively
   const layout = new LayoutBuilder();
   layout.addSection("header", SomaticExtraSongDataHeaderCodec, {instrumentEntryCount, patternEntryCount});

   // Add instrument entries (each needs to know its gradient offset if applicable)
   // We'll add them as placeholders first, then patch gradientOffsetBytes after finalizing layout
   const instrumentSections: {id: string; packed: MorphEntryPacked; normalized: MorphEntryPacked}[] = [];
   for (let i = 0; i < input.instruments.length; i++) {
      const entry = input.instruments[i];
      const packed = flattenEntry(entry);
      const normalized = normalizeMorphEntry(packed);
      const sectionId = `instrument_${i}`;
      instrumentSections.push({id: sectionId, packed, normalized});
      layout.addSection(sectionId, MorphEntryCodec, normalized);
   }

   // Add pattern entries
   for (let i = 0; i < input.patterns.length; i++) {
      const normalized = normalizeSomaticPatternEntry(input.patterns[i]);
      layout.addSection(`pattern_${i}`, SomaticPatternEntryCodec, normalized);
   }

   // Add gradient blobs
   for (let i = 0; i < gradients.length; i++) {
      const g = gradients[i];
      layout.addSection(`gradient_${i}`, WaveformMorphGradientCodec, g.nodes);
   }

   // Finalize layout (computes all offsets and total size)
   const plan = layout.finalize();

   if (typeof totalBytes === "number" && plan.totalBytes > totalBytes) {
      throw new Error(`SOMATIC_SFX_CONFIG overflow: need ${plan.totalBytes} bytes, have ${totalBytes}`);
   }

   const out = new Uint8Array(totalBytes ?? plan.totalBytes);
   out.fill(0);

   const region = new MemoryRegion("somatic_extra_song_data", 0, out.length);
   const writer = new BitWriter(out, region);

   // Encode header
   SomaticExtraSongDataHeaderCodec.encode({instrumentEntryCount, patternEntryCount}, writer);

   // Encode instruments (now with correct gradient offsets)
   for (let i = 0; i < instrumentSections.length; i++) {
      writer.advanceToNextByteBoundary();
      const section = instrumentSections[i];
      // Find corresponding gradient (if any) and patch offset
      const gradientIndex = gradients.findIndex((g) => g.instrumentIndex === i);
      if (gradientIndex !== -1) {
         const gradientOffset = plan.offsets.get(`gradient_${gradientIndex}`)!;
         section.normalized.gradientOffsetBytes = clampU16(gradientOffset);
      }
      MorphEntryCodec.encode(section.normalized, writer);
   }

   // Encode patterns
   for (let i = 0; i < input.patterns.length; i++) {
      writer.advanceToNextByteBoundary();
      const normalized = normalizeSomaticPatternEntry(input.patterns[i]);
      SomaticPatternEntryCodec.encode(normalized, writer);
   }

   // Encode gradient blobs
   for (let i = 0; i < gradients.length; i++) {
      writer.advanceToNextByteBoundary();
      WaveformMorphGradientCodec.encode(gradients[i].nodes, writer);
   }

   return out;
}

export function encodeMorphPayload(entries: MorphEntryInput[], totalBytes?: number): Uint8Array {
   const entryCount = entries.length;
   const neededBytes = MORPH_HEADER_BYTES + entryCount * MORPH_ENTRY_BYTES;
   if (typeof totalBytes === "number" && neededBytes > totalBytes) {
      throw new Error(`SOMATIC_SFX_CONFIG overflow: need ${neededBytes} bytes, have ${totalBytes}`);
   }

   const out = new Uint8Array(totalBytes ?? neededBytes);
   out.fill(0);

   const region = new MemoryRegion("morph_payload", 0, out.length);
   const writer = new BitWriter(out, region);

   MorphHeaderCodec.encode({entryCount}, writer);
   for (const entry of entries) {
      writer.advanceToNextByteBoundary(); // ensure each entry starts on a byte boundary for the Lua decoder
      const packed = flattenEntry(entry);
      const normalized = normalizeMorphEntry(packed);
      MorphEntryCodec.encode(normalized, writer);
   }

   return out;
}
