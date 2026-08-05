// Shared Somatic extra-song payload schema and encoder.
//
// Instruments remain tightly bit-packed. Pattern extras use three fixed occupancy
// masks followed by value planes, which distinguishes an absent value from zero
// while arranging similar data together for LZ compression.

import {SomaticCaps, Tic80Caps} from "../src/models/tic80Capabilities";
import {SomaticEffectKind, WaveEngineId} from "../src/models/instruments";
import {clamp} from "../src/utils/utils";
import {BitReader, BitWriter, C, MemoryRegion, extractFieldInfo, fixedBits} from "../src/utils/bitpack/bitpack";
import type {Codec, CodecFieldInfo, inferCodecType} from "../src/utils/bitpack/bitpack";

function makeNormalizer<T extends Record<string, any>>(fields: CodecFieldInfo[]): (input: T) => T {
   return (input: T): T => {
      const output: any = {};
      for (const field of fields) {
         const value = input[field.name];
         const codecNode = field.codec.node;
         if (codecNode.kind === "enum") {
            output[field.name] = value;
         } else if (codecNode.kind === "u" && codecNode.n === 1) {
            output[field.name] = clamp(Number(value), 0, 1);
         } else {
            output[field.name] = clamp(Math.trunc(value), field.min, field.max);
         }
      }
      return output as T;
   };
}

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

// Each node stores the waveform as 16 bytes (two 4-bit samples per byte),
// followed by a 10-bit duration and signed 6-bit curve. That is exactly 18 bytes.
export const WaveformMorphGradientNodeCodec = C.struct("WaveformMorphGradientNode", [
   C.field("waveBytes", C.array("waveBytes", C.u(8), 16)),
   C.field("durationTicks10", C.u(10)),
   C.field("curveS6", C.i(6)),
]);

// Gradient nodes are stored inline after each entry as:
// [packed MorphEntry][u8 node count][packed nodes...].
export const MorphEntryCodec = C.struct("MorphEntry", [
   C.field("instrumentId", C.u8()),
   C.field("waveEngineId", WaveEngineIdCodec),
   C.field("sourceWaveformIndex", C.u(4)),
   C.field("pwmDuty5", C.u(5)),
   C.field("pwmDepth5", C.u(5)),
   C.field("lfoCycleTicks12", C.u(12)),
   C.field("panU8", C.u8()),
   C.field("panLfoDepthU8", C.u8()),
   C.field("volumeU8", C.u8()),
   C.field("lowpassEnabled", C.bool()),
   C.field("lowpassAmountU8", C.u8()),
   C.field("lowpassDurationTicks12", C.u(12)),
   C.field("lowpassCurveS6", C.i(6)),
   C.field("lowpassModSource", C.u(2)),
   C.field("effectKind", MorphEffectKindCodec),
   C.field("effectAmtU8", C.u8()),
   C.field("effectDurationTicks12", C.u(12)),
   C.field("effectCurveS6", C.i(6)),
   C.field("effectModSource", C.u(2)),
]);

const MORPH_ENTRY_FIELDS = extractFieldInfo(MorphEntryCodec);
const WAVEFORM_MORPH_GRADIENT_NODE_FIELDS = extractFieldInfo(WaveformMorphGradientNodeCodec);

export const MorphEntryFieldNamesToRename = [
   ...MORPH_ENTRY_FIELDS.map(f => f.name),
   ...WAVEFORM_MORPH_GRADIENT_NODE_FIELDS.map(f => f.name),
   "extraSongData",
   "samples",
   "morphGradientNodes",
   "songOrder",
   "effectId",
   "paramU8",
] as readonly string[];

export type MorphEntryPacked = inferCodecType<typeof MorphEntryCodec>;

export type MorphEntryInput = {
   instrumentId: number;
   cfg: {
      waveEngineId: WaveEngineId;
      sourceWaveformIndex: number;
      pwmDuty5: number;
      pwmDepth5: number;
      lowpassEnabled: boolean;
      lowpassAmountU8: number;
      lowpassDurationTicks12: number;
      lowpassCurveS6: number;
      lowpassModSource: number;
      effectKind: SomaticEffectKind;
      effectAmtU8: number;
      effectDurationTicks12: number;
      effectCurveS6: number;
      effectModSource: number;
      lfoCycleTicks12: number;
      panU8: number;
      panLfoDepthU8: number;
      volumeU8: number;
   };
   morphGradientNodes?: WaveformMorphGradientNodePacked[];
};

function flattenEntry(entry: MorphEntryInput): MorphEntryPacked {
   const {cfg} = entry;
   return {
      instrumentId: entry.instrumentId,
      waveEngineId: cfg.waveEngineId,
      sourceWaveformIndex: cfg.sourceWaveformIndex,
      pwmDuty5: cfg.pwmDuty5,
      pwmDepth5: cfg.pwmDepth5,
      lfoCycleTicks12: cfg.lfoCycleTicks12,
      panU8: cfg.panU8,
      panLfoDepthU8: cfg.panLfoDepthU8,
      volumeU8: cfg.volumeU8,
      lowpassEnabled: cfg.lowpassEnabled ? 1 : 0,
      lowpassAmountU8: cfg.lowpassAmountU8,
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

export const MORPH_ENTRY_BITS = fixedBits(MorphEntryCodec, "MorphEntry");
export const MORPH_ENTRY_BYTES = MorphEntryCodec.byteSizeCeil!();
export const WAVEFORM_MORPH_GRADIENT_NODE_BITS =
   fixedBits(WaveformMorphGradientNodeCodec, "WaveformMorphGradientNode");
export const WAVEFORM_MORPH_GRADIENT_NODE_BYTES = WaveformMorphGradientNodeCodec.byteSizeCeil!();

export const SOMATIC_EXTRA_SONG_HEADER_BYTES = 1;
export const SOMATIC_PATTERN_COLUMN_COUNT = SomaticCaps.maxPatternCount;
export const SOMATIC_PATTERN_ROW_COUNT = Tic80Caps.pattern.maxRows;
export const SOMATIC_PATTERN_CELL_COUNT = SOMATIC_PATTERN_COLUMN_COUNT * SOMATIC_PATTERN_ROW_COUNT;
export const SOMATIC_PATTERN_MASK_BYTES = SOMATIC_PATTERN_CELL_COUNT / 8;
export const SOMATIC_PATTERN_MASK_COUNT = 3;
export const SOMATIC_PATTERN_MASKS_BYTES = SOMATIC_PATTERN_MASK_BYTES * SOMATIC_PATTERN_MASK_COUNT;

export type SomaticPatternCellExtraPacked = {
   rowIndex: number;
   volumeU8?: number;
   panU8?: number;
   effectId?: number;
   paramU8?: number;
};

export type SomaticPatternEntryPacked = {
   patternIndex: number;
   cells: SomaticPatternCellExtraPacked[];
};

export type WaveformMorphGradientNodePacked = {
   waveBytes: number[];
   durationTicks10: number;
   curveS6: number;
};

export type SomaticExtraSongDataInput = {
   instruments: MorphEntryInput[];
   patterns: SomaticPatternEntryPacked[];
};

export type DecodedSomaticInstrument = MorphEntryPacked&{
   morphGradientNodes: WaveformMorphGradientNodePacked[];
};

export type DecodedSomaticExtraSongData = {
   instruments: DecodedSomaticInstrument[];
   patterns: SomaticPatternEntryPacked[];
   bytesRead: number;
};

const normalizeMorphEntry = makeNormalizer<MorphEntryPacked>(MORPH_ENTRY_FIELDS);

function clampU8(value: number): number {
   return clamp(Math.trunc(value), 0, 0xff);
}

function normalizeGradientNode(node: WaveformMorphGradientNodePacked): WaveformMorphGradientNodePacked {
   if (!Array.isArray(node.waveBytes) || node.waveBytes.length !== 16) {
      throw new Error(`Waveform morph gradient node must contain exactly 16 wave bytes`);
   }
   return {
      waveBytes: node.waveBytes.map(clampU8),
      durationTicks10: clamp(Math.trunc(node.durationTicks10), 0, 0x03ff),
      curveS6: clamp(Math.trunc(node.curveS6), -32, 31),
   };
}

function encodeFixed<T>(codec: Codec<T>, value: T, byteLength: number, name: string): Uint8Array {
   const out = new Uint8Array(byteLength);
   const region = new MemoryRegion({name, address: 0, size: byteLength});
   codec.encode(value, new BitWriter(out, region));
   return out;
}

function decodeFixed<T>(codec: Codec<T>, bytes: Uint8Array, offset: number, byteLength: number, name: string): T {
   if (offset < 0 || offset + byteLength > bytes.length) {
      throw new Error(`${name} truncated at byte ${offset}: need ${byteLength}, have ${bytes.length - offset}`);
   }
   const view = bytes.subarray(offset, offset + byteLength);
   const region = new MemoryRegion({name, address: 0, size: view.length});
   return codec.decode(new BitReader(view, region));
}

function setMask(mask: Uint8Array, bitIndex: number): void {
   mask[bitIndex >> 3] |= 1 << (bitIndex & 7);
}

function hasMaskBit(mask: Uint8Array, bitIndex: number): boolean {
   return (mask[bitIndex >> 3] & (1 << (bitIndex & 7))) !== 0;
}

function countMaskBits(mask: Uint8Array): number {
   let count = 0;
   for (const byte of mask) {
      let value = byte;
      while (value !== 0) {
         value &= value - 1;
         count++;
      }
   }
   return count;
}

function makePatternPlanes(patterns: SomaticPatternEntryPacked[]) {
   const volume = new Array<number|undefined>(SOMATIC_PATTERN_CELL_COUNT);
   const pan = new Array<number|undefined>(SOMATIC_PATTERN_CELL_COUNT);
   const effect = new Array<number|undefined>(SOMATIC_PATTERN_CELL_COUNT);
   const param = new Array<number|undefined>(SOMATIC_PATTERN_CELL_COUNT);

   const setOnce = (plane: Array<number|undefined>, index: number, value: number, label: string) => {
      if (plane[index] !== undefined)
         throw new Error(`Duplicate ${label} value at pattern cell ${index}`);
      plane[index] = clampU8(value);
   };

   for (const pattern of patterns) {
      const patternIndex = Math.trunc(pattern.patternIndex);
      if (patternIndex < 0 || patternIndex >= SOMATIC_PATTERN_COLUMN_COUNT)
         throw new Error(`Somatic pattern index out of range: ${pattern.patternIndex}`);
      for (const cell of pattern.cells) {
         const rowIndex = Math.trunc(cell.rowIndex);
         if (rowIndex < 0 || rowIndex >= SOMATIC_PATTERN_ROW_COUNT)
            throw new Error(`Somatic pattern row out of range: ${cell.rowIndex}`);
         const index = patternIndex * SOMATIC_PATTERN_ROW_COUNT + rowIndex;
         if (cell.volumeU8 !== undefined)
            setOnce(volume, index, cell.volumeU8, "volume");
         if (cell.panU8 !== undefined)
            setOnce(pan, index, cell.panU8, "pan");
         if (cell.effectId !== undefined) {
            setOnce(effect, index, cell.effectId, "effect");
            setOnce(param, index, cell.paramU8 ?? 0, "effect parameter");
         } else if (cell.paramU8 !== undefined) {
            throw new Error(`Somatic pattern parameter has no effect at pattern ${patternIndex}, row ${rowIndex}`);
         }
      }
   }
   return {volume, pan, effect, param};
}

export function encodeSomaticExtraSongDataPayload(input: SomaticExtraSongDataInput, totalBytes?: number): Uint8Array {
   if (input.instruments.length > 0xff)
      throw new Error(`Too many Somatic instrument entries: ${input.instruments.length}`);

   const instruments = input.instruments.map(entry => ({
      entry: normalizeMorphEntry(flattenEntry(entry)),
      nodes: (entry.morphGradientNodes ?? []).map(normalizeGradientNode),
   }));
   for (const instrument of instruments) {
      if (instrument.nodes.length > SomaticCaps.maxMorphGradientNodes)
         throw new Error(`Too many waveform morph gradient nodes: ${instrument.nodes.length}`);
   }

   const planes = makePatternPlanes(input.patterns);
   const volumeMask = new Uint8Array(SOMATIC_PATTERN_MASK_BYTES);
   const panMask = new Uint8Array(SOMATIC_PATTERN_MASK_BYTES);
   const effectMask = new Uint8Array(SOMATIC_PATTERN_MASK_BYTES);
   const volumeValues: number[] = [];
   const panValues: number[] = [];
   const effectValues: number[] = [];
   const paramValues: number[] = [];

   // Ascending bit-index order is the value-plane order. Volume, pan, and
   // Somatic commands occupy independent masks so they can coexist in a row.
   for (let index = 0; index < SOMATIC_PATTERN_CELL_COUNT; index++) {
      if (planes.volume[index] !== undefined) {
         setMask(volumeMask, index);
         volumeValues.push(planes.volume[index]!);
      }
      if (planes.pan[index] !== undefined) {
         setMask(panMask, index);
         panValues.push(planes.pan[index]!);
      }
      if (planes.effect[index] !== undefined) {
         setMask(effectMask, index);
         effectValues.push(planes.effect[index]!);
         paramValues.push(planes.param[index]!);
      }
   }

   const measuredBytes = SOMATIC_EXTRA_SONG_HEADER_BYTES
      + instruments.reduce((sum, instrument) =>
         sum + MORPH_ENTRY_BYTES + 1 + instrument.nodes.length * WAVEFORM_MORPH_GRADIENT_NODE_BYTES, 0)
      + SOMATIC_PATTERN_MASKS_BYTES
      + volumeValues.length + panValues.length + effectValues.length + paramValues.length;
   if (totalBytes !== undefined && measuredBytes > totalBytes) {
      throw new Error(`Somatic extra-song payload overflow: need ${measuredBytes} bytes, have ${totalBytes}`);
   }

   const out = new Uint8Array(totalBytes ?? measuredBytes);
   let offset = 0;
   out[offset++] = instruments.length;
   for (const instrument of instruments) {
      out.set(encodeFixed(MorphEntryCodec, instrument.entry, MORPH_ENTRY_BYTES, "MorphEntry"), offset);
      offset += MORPH_ENTRY_BYTES;
      out[offset++] = instrument.nodes.length;
      for (const node of instrument.nodes) {
         out.set(
            encodeFixed(
               WaveformMorphGradientNodeCodec,
               node,
               WAVEFORM_MORPH_GRADIENT_NODE_BYTES,
               "WaveformMorphGradientNode",
            ),
            offset,
         );
         offset += WAVEFORM_MORPH_GRADIENT_NODE_BYTES;
      }
   }
   out.set(volumeMask, offset);
   offset += volumeMask.length;
   out.set(panMask, offset);
   offset += panMask.length;
   out.set(effectMask, offset);
   offset += effectMask.length;
   out.set(volumeValues, offset);
   offset += volumeValues.length;
   out.set(panValues, offset);
   offset += panValues.length;
   out.set(effectValues, offset);
   offset += effectValues.length;
   out.set(paramValues, offset);
   offset += paramValues.length;

   if (offset !== measuredBytes)
      throw new Error(`Somatic extra-song payload size mismatch: wrote ${offset}, measured ${measuredBytes}`);
   return out;
}

export function decodeSomaticExtraSongDataPayload(bytes: Uint8Array): DecodedSomaticExtraSongData {
   if (bytes.length < SOMATIC_EXTRA_SONG_HEADER_BYTES + SOMATIC_PATTERN_MASKS_BYTES)
      throw new Error(`Somatic extra-song payload truncated: ${bytes.length} bytes`);

   let offset = 0;
   const instrumentCount = bytes[offset++];
   const instruments: DecodedSomaticInstrument[] = [];
   for (let i = 0; i < instrumentCount; i++) {
      const entry = decodeFixed(MorphEntryCodec, bytes, offset, MORPH_ENTRY_BYTES, "MorphEntry");
      offset += MORPH_ENTRY_BYTES;
      if (offset >= bytes.length)
         throw new Error(`Somatic instrument ${i} is missing its gradient count`);
      const nodeCount = bytes[offset++];
      if (nodeCount > SomaticCaps.maxMorphGradientNodes)
         throw new Error(`Somatic instrument ${i} has too many gradient nodes: ${nodeCount}`);
      const morphGradientNodes: WaveformMorphGradientNodePacked[] = [];
      for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
         morphGradientNodes.push(decodeFixed(
            WaveformMorphGradientNodeCodec,
            bytes,
            offset,
            WAVEFORM_MORPH_GRADIENT_NODE_BYTES,
            "WaveformMorphGradientNode",
         ));
         offset += WAVEFORM_MORPH_GRADIENT_NODE_BYTES;
      }
      instruments.push({...entry, morphGradientNodes});
   }

   if (offset + SOMATIC_PATTERN_MASKS_BYTES > bytes.length)
      throw new Error(`Somatic pattern occupancy masks are truncated at byte ${offset}`);
   const volumeMask = bytes.subarray(offset, offset + SOMATIC_PATTERN_MASK_BYTES);
   offset += SOMATIC_PATTERN_MASK_BYTES;
   const panMask = bytes.subarray(offset, offset + SOMATIC_PATTERN_MASK_BYTES);
   offset += SOMATIC_PATTERN_MASK_BYTES;
   const effectMask = bytes.subarray(offset, offset + SOMATIC_PATTERN_MASK_BYTES);
   offset += SOMATIC_PATTERN_MASK_BYTES;

   const volumeCount = countMaskBits(volumeMask);
   const panCount = countMaskBits(panMask);
   const effectCount = countMaskBits(effectMask);
   const valuesLength = volumeCount + panCount + effectCount * 2;
   if (offset + valuesLength > bytes.length) {
      throw new Error(`Somatic pattern value planes are truncated: need ${valuesLength}, have ${bytes.length - offset}`);
   }
   let volumeOffset = offset;
   let panOffset = volumeOffset + volumeCount;
   let effectOffset = panOffset + panCount;
   let paramOffset = effectOffset + effectCount;
   offset = paramOffset + effectCount;

   const patternsByIndex = new Map<number, SomaticPatternCellExtraPacked[]>();
   for (let index = 0; index < SOMATIC_PATTERN_CELL_COUNT; index++) {
      const cell: SomaticPatternCellExtraPacked = {rowIndex: index % SOMATIC_PATTERN_ROW_COUNT};
      let occupied = false;
      if (hasMaskBit(volumeMask, index)) {
         cell.volumeU8 = bytes[volumeOffset++];
         occupied = true;
      }
      if (hasMaskBit(panMask, index)) {
         cell.panU8 = bytes[panOffset++];
         occupied = true;
      }
      if (hasMaskBit(effectMask, index)) {
         cell.effectId = bytes[effectOffset++];
         cell.paramU8 = bytes[paramOffset++];
         occupied = true;
      }
      if (occupied) {
         const patternIndex = Math.floor(index / SOMATIC_PATTERN_ROW_COUNT);
         const cells = patternsByIndex.get(patternIndex) ?? [];
         cells.push(cell);
         patternsByIndex.set(patternIndex, cells);
      }
   }

   const patterns = [...patternsByIndex].map(([patternIndex, cells]) => ({patternIndex, cells}));
   return {instruments, patterns, bytesRead: offset};
}
