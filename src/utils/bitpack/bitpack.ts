import {MemoryRegion, BitCursor} from "./MemoryRegion";
import {assertBitsFitInRegion, maskLowBits} from "./utils";

export type BitSize = number|"variable";

/**
 * Discriminated union of all possible codec node types.
 * Each codec has a 'node' property containing metadata used for code generation and introspection.
 */
// clang-format off
export type CodecNode =
   | { kind: "u"; n: number }
   | { kind: "i"; n: number }
   | { kind: "u16le" }
   | { kind: "i16le" }
   | { kind: "u16be" }
   | { kind: "i16be" }
   | { kind: "alignToByte" }
   | { kind: "padBits"; n: number }
   | { kind: "enum"; name: string; nBits: number; mapping: Record<string, number> }
   | { kind: "struct"; name: string; seq: StructSeqItem[]; layout: LayoutItem[] }
   | { kind: "array"; name: string; elemCodec: Codec<unknown>; count: number }
   | { kind: "varArray"; name: string; elemCodec: Codec<unknown>; lengthCodec: Codec<number>; maxCount: number; alignToByteAfterLength: boolean }
   | { kind: "runtimeArray"; name: string; elemCodec: Codec<unknown>; alignToByteBeforeEachElement: boolean }
   | { kind: "computed"; name: string; baseCodec: Codec<unknown>; compute: (ctx: ComputeContext) => unknown };

// clang-format on

/**
 * Context provided to computed field functions during encoding.
 * Allows fields to access offsets, sizes, and other computed values.
 * Paths use dot notation: "field.subfield" or "array[0]"
 */
export interface ComputeContext {
   /** Get the byte offset of a path from the root (e.g., "gradients[0]", "header.count") */
   getOffset(path: string): number;
   /** Internal: current path during encoding (for building offset map) */
   _currentPath?: string;
   /** Internal: offset map built during measurement pass */
   _offsets?: Map<string, number>;
   /** Internal: writer used during measurement (for tracking byte positions) */
   _writer?: BitWriter;
   /** Custom properties set by the encoder */
   [key: string]: unknown;
}

export interface Codec<T = unknown> {
   node: CodecNode;
   bitSize: BitSize;
   encode(value: T, writer: BitWriter, ctx?: ComputeContext): void;
   decode(reader: BitReader): T;
   getLayout?: () => LayoutItem[];
   byteSizeCeil?: () => number;
}

// =========================
// Type inference helpers (Zod-style)

export type InferCodecType<T extends Codec<unknown>> = T extends Codec<infer U>? U : never;

// Lowercase alias to match the requested call-site style: inferCodecType<typeof MyCodec>
export type inferCodecType<T extends Codec<unknown>> = InferCodecType<T>;

type AnyCodec = Codec<unknown>;

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends((k: infer I) => void) ? I : never;

type Simplify<T> = {
   [K in keyof T]: T[K]
}&{};

type StructValueFromItems<Items extends readonly unknown[]> =
   Simplify < UnionToIntersection < Items[number] extends infer I ?
   I extends {
   kind: "field";
   name: infer N extends string;
   codec: infer C extends AnyCodec
}
? {[K in N]: InferCodecType<C>} : {}: never >> ;

/**
 * Metadata extracted from a codec field for introspection.
 * Useful for validation, normalization, and code generation.
 */
export type CodecFieldInfo = {
   name: string; codec: Codec<unknown>; bitSize: number | "variable"; min: number; max: number; signed: boolean;
};

/**
 * Extract field metadata from a struct codec.
 * Returns information about each field including its type, size, and numeric range.
 */
export function extractFieldInfo(structCodec: Codec<unknown>): CodecFieldInfo[] {
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

/**
 * Get the fixed bit size of a codec, throwing if it's variable-sized.
 */
export function fixedBits(codec: Codec<unknown>, name: string): number {
   if (codec.bitSize === "variable")
      throw new Error(`${name} codec must be fixed size`);
   return codec.bitSize;
}

type FieldEntry<Name extends string = string, C extends AnyCodec = AnyCodec> = {
   kind: "field"; //
   name: Name;
   codec: C;
};
type AnonEntry = {
   kind: "anon"; codec: Codec<unknown>
};
type StructSeqItem = FieldEntry|AnonEntry;
type LayoutItem = {
   name: string; bitOffset: number; bitSize: BitSize
};


class BitReader {
   u8: Uint8Array;
   region: MemoryRegion;
   cur: BitCursor;
   constructor(u8: Uint8Array, region: MemoryRegion, cursor = new BitCursor(region, 0)) {
      this.u8 = u8;
      this.region = region;
      this.cur = cursor;
   }
   advanceToNextByteBoundary() {
      this.cur.advanceToNextByteBoundary();
      return this;
   }
   readBitsU(n: number) {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`readBitsU: n must be 0..32, got ${n}`);
      assertBitsFitInRegion(this.region, this.cur.bitOffset, n, "BitReader.readBitsU");
      let remaining = n;
      let out = 0 >>> 0;
      let outShift = 0;
      while (remaining > 0) {
         const absByte = this.cur.byteIndexAbs();
         const bitInByte = this.cur.bitIndexInByte();
         const avail = 8 - bitInByte;
         const k = remaining < avail ? remaining : avail;
         const byteVal = this.u8[absByte] >>> 0;
         const part = (byteVal >>> bitInByte) & maskLowBits(k);
         out = (out | ((part << outShift) >>> 0)) >>> 0;
         this.cur.seekBits(k);
         outShift += k;
         remaining -= k;
      }
      return n === 32 ? (out >>> 0) : out;
   }
   readBitsI(n: number) {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`readBitsI: n must be 1..32, got ${n}`);
      const u = this.readBitsU(n);
      if (n === 32)
         return (u | 0);
      const signBit = 1 << (n - 1);
      return (u & signBit) ? (u - Math.pow(2, n)) : u;
   }
   readU8() {
      this.advanceToNextByteBoundary();
      return this.readBitsU(8);
   }
   readI8() {
      this.advanceToNextByteBoundary();
      return this.readBitsI(8);
   }
   readU16LE() {
      this.advanceToNextByteBoundary();
      const lo = this.readBitsU(8);
      const hi = this.readBitsU(8);
      return (lo | (hi << 8)) >>> 0;
   }
   readI16LE() {
      const u = this.readU16LE();
      return (u & 0x8000) ? (u - 0x10000) : u;
   }
   readU16BE() {
      this.advanceToNextByteBoundary();
      const hi = this.readBitsU(8);
      const lo = this.readBitsU(8);
      return ((hi << 8) | lo) >>> 0;
   }
   readI16BE() {
      const u = this.readU16BE();
      return (u & 0x8000) ? (u - 0x10000) : u;
   }
}

class BitWriter {
   u8: Uint8Array;
   region: MemoryRegion;
   cur: BitCursor;
   constructor(u8: Uint8Array, region: MemoryRegion, cursor = new BitCursor(region, 0)) {
      this.u8 = u8;
      this.region = region;
      this.cur = cursor;
   }
   advanceToNextByteBoundary() {
      this.cur.advanceToNextByteBoundary();
      return this;
   }
   writeBitsU(n: number, value: number) {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`writeBitsU: n must be 0..32, got ${n}`);
      assertBitsFitInRegion(this.region, this.cur.bitOffset, n, "BitWriter.writeBitsU");
      let v = (n === 32) ? (value >>> 0) : (value >>> 0);
      if (n < 32) {
         const max = Math.pow(2, n) - 1;
         if (value < 0 || value > max) {
            throw new Error(`writeBitsU(${n}): value out of range: ${value} (max ${max})`);
         }
      }
      let remaining = n;
      let inShift = 0;
      while (remaining > 0) {
         const absByte = this.cur.byteIndexAbs();
         const bitInByte = this.cur.bitIndexInByte();
         const avail = 8 - bitInByte;
         const k = remaining < avail ? remaining : avail;
         const mask = maskLowBits(k);
         const part = (v >>> inShift) & mask;
         const clearMask = (~(mask << bitInByte)) & 0xFF;
         const prev = this.u8[absByte] >>> 0;
         const next = ((prev & clearMask) | ((part & mask) << bitInByte)) & 0xFF;
         this.u8[absByte] = next;
         this.cur.seekBits(k);
         inShift += k;
         remaining -= k;
      }
      return this;
   }
   writeBitsI(n: number, value: number) {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`writeBitsI: n must be 1..32, got ${n}`);
      if (n === 32) {
         this.writeBitsU(32, value | 0);
         return this;
      }
      const min = -Math.pow(2, n - 1);
      const max = Math.pow(2, n - 1) - 1;
      if (value < min || value > max)
         throw new Error(`writeBitsI(${n}): value out of range: ${value} (min ${min}, max ${max})`);
      const u = value < 0 ? (value + Math.pow(2, n)) : value;
      this.writeBitsU(n, u >>> 0);
      return this;
   }
   writeU8(v: number) {
      this.advanceToNextByteBoundary();
      return this.writeBitsU(8, v);
   }
   writeI8(v: number) {
      this.advanceToNextByteBoundary();
      return this.writeBitsI(8, v);
   }
   writeU16LE(v: number) {
      this.advanceToNextByteBoundary();
      this.writeBitsU(8, v & 0xFF);
      this.writeBitsU(8, (v >>> 8) & 0xFF);
      return this;
   }
   writeI16LE(v: number) {
      return this.writeU16LE(v & 0xFFFF);
   }
   writeU16BE(v: number) {
      this.advanceToNextByteBoundary();
      this.writeBitsU(8, (v >>> 8) & 0xFF);
      this.writeBitsU(8, v & 0xFF);
      return this;
   }
   writeI16BE(v: number) {
      return this.writeU16BE(v & 0xFFFF);
   }
}

function _codec<T>(
   node: CodecNode,
   encode: (value: T, writer: BitWriter, ctx?: ComputeContext) => void,
   decode: (reader: BitReader) => T,
   bitSize: BitSize,
   ): Codec<T> {
   return {node, bitSize, encode, decode};
}

/**
 * Codec factory – Domain-Specific Language (DSL) for defining binary data schemas.
 * 
 * Use this to build codecs for bit-packed binary formats. Each codec knows how to:
 * - Encode values to a BitWriter
 * - Decode values from a BitReader
 * - Report its size in bits (or "variable" for dynamic sizes)
 * 
 * Example:
 * ```typescript
 * const MyStructCodec = C.struct("MyStruct", [
 *    C.field("flags", C.u(3)),
 *    C.field("value", C.i(16)),
 *    C.alignToByte(),
 *    C.field("data", C.array("data", C.u8(), 4))
 * ]);
 * ```
 */
const C = {
   u: (n: number): Codec<number> => {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`C.u(n): n must be 0..32, got ${n}`);
      return _codec(
         {kind: "u", n}, (v: number, w: BitWriter) => w.writeBitsU(n, v), (r: BitReader) => r.readBitsU(n), n);
   },
   i: (n: number): Codec<number> => {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`C.i(n): n must be 1..32, got ${n}`);
      return _codec(
         {kind: "i", n}, (v: number, w: BitWriter) => w.writeBitsI(n, v), (r: BitReader) => r.readBitsI(n), n);
   },
   bool: (): Codec<number> => C.u(1),
   u8: (): Codec<number> => C.u(8),
   i8: (): Codec<number> => C.i(8),
   u16le: (): Codec<number> =>
      _codec({kind: "u16le"}, (v: number, w: BitWriter) => w.writeU16LE(v), (r: BitReader) => r.readU16LE(), 16),
   i16le: (): Codec<number> =>
      _codec({kind: "i16le"}, (v: number, w: BitWriter) => w.writeI16LE(v), (r: BitReader) => r.readI16LE(), 16),
   u16be: (): Codec<number> =>
      _codec({kind: "u16be"}, (v: number, w: BitWriter) => w.writeU16BE(v), (r: BitReader) => r.readU16BE(), 16),
   i16be: (): Codec<number> =>
      _codec({kind: "i16be"}, (v: number, w: BitWriter) => w.writeI16BE(v), (r: BitReader) => r.readI16BE(), 16),
   alignToByte: (): Codec<void> => _codec(
      {kind: "alignToByte"},
      (_v: void, w: BitWriter) => {
         w.advanceToNextByteBoundary();
      },
      (r: BitReader) => {
         r.advanceToNextByteBoundary();
         return undefined;
      },
      "variable"),
   padBits: (n: number): Codec<void> => {
      n |= 0;
      if (n < 0)
         throw new Error(`C.padBits: n must be >=0, got ${n}`);
      return _codec(
         {kind: "padBits", n},
         (_v: void, w: BitWriter) => {
            w.writeBitsU(n, 0);
         },
         (r: BitReader) => {
            r.readBitsU(n);
            return undefined;
         },
         n);
   },
   enum: <T extends string|number = string | number>(name: string, nBits: number, mapping: Record<string, number>):
      Codec<T> => {
         const enc = new Map<string, number>(Object.entries(mapping));
         const dec = new Map<number, string>(Object.entries(mapping).map(([k, v]) => [v | 0, k]));
         const base = C.u(nBits);
         return _codec(
            {kind: "enum", name, nBits, mapping},
            (v: T, w: BitWriter) => {
               const num = enc.has(v as unknown as string) ? enc.get(v as unknown as string)! : (v as unknown);
               if (typeof num !== "number")
                  throw new Error(`enum ${name}: unknown value '${v}'`);
               base.encode(num, w);
            },
            (r: BitReader) => {
               const num = base.decode(r);
               return (dec.has(num) ? dec.get(num)! : num) as unknown as T;
            },
            base.bitSize,
         );
      },
   field: <const Name extends string, C extends AnyCodec>(name: Name, codec: C): FieldEntry<Name, C> =>
      ({kind: "field", name, codec}),
   struct: <const Items extends readonly(FieldEntry<string, AnyCodec>| AnyCodec)[]>(
      name: string,
      items: Items,
      ): Codec<StructValueFromItems<Items>> => {
      const seq: StructSeqItem[] = items.map((it) => {
         if (!it)
            throw new Error(`struct(${name}): null item`);
         if ((it as FieldEntry).kind === "field")
            return it as FieldEntry;
         const maybeCodec = it as Codec<unknown>;
         if (maybeCodec.node && typeof maybeCodec.encode === "function" && typeof maybeCodec.decode === "function")
            return {kind: "anon", codec: maybeCodec};
         throw new Error(`struct(${name}): item must be field(...) or codec, got ${JSON.stringify(it)}`);
      });
      const layout: LayoutItem[] = [];
      let bitOff = 0;
      let fixed = true;
      for (const it of seq) {
         if (it.kind === "field") {
            const bs = it.codec.bitSize;
            if (bs === "variable") {
               fixed = false;
               layout.push({name: it.name, bitOffset: bitOff, bitSize: bs});
            } else {
               layout.push({name: it.name, bitOffset: bitOff, bitSize: bs});
               bitOff += bs;
            }
         } else {
            const k = it.codec.node.kind;
            if (k === "alignToByte") {
               const m = bitOff & 7;
               const pad = m === 0 ? 0 : (8 - m);
               layout.push({name: "(alignToByte)", bitOffset: bitOff, bitSize: pad});
               bitOff += pad;
            } else if (k === "padBits") {
               const bs = it.codec.bitSize;
               if (bs === "variable")
                  fixed = false;
               else
                  bitOff += bs;
            } else {
               fixed = false;
            }
         }
      }
      const bitSize = fixed ? bitOff : "variable";
      const codec = _codec(
         {kind: "struct", name, seq, layout},
         (obj: StructValueFromItems<Items>, w: BitWriter, ctx?: ComputeContext) => {
            const rec = obj as unknown as Record<string, unknown>;
            for (const it of seq) {
               if (it.kind === "field") {
                  const fieldPath = ctx?._currentPath ? `${ctx._currentPath}.${it.name}` : it.name;
                  const byteOffset = w.cur.currentByteIndex();
                  if (ctx?._offsets) {
                     ctx._offsets.set(fieldPath, byteOffset);
                  }
                  const prevPath = ctx?._currentPath;
                  if (ctx)
                     ctx._currentPath = fieldPath;
                  it.codec.encode(rec[it.name], w, ctx);
                  if (ctx)
                     ctx._currentPath = prevPath;
               } else {
                  it.codec.encode(undefined, w, ctx);
               }
            }
         },
         (r: BitReader) => {
            const out: Record<string, unknown> = {};
            for (const it of seq) {
               if (it.kind === "field") {
                  out[it.name] = it.codec.decode(r);
               } else {
                  it.codec.decode(r);
               }
            }
            return out as unknown as StructValueFromItems<Items>;
         },
         bitSize,
      );
      codec.getLayout = () => layout.slice();
      codec.byteSizeCeil = () => {
         if (bitSize === "variable")
            throw new Error(`struct ${name} has variable size; cannot compute byteSizeCeil()`);
         return ((bitSize + 7) / 8) | 0;
      };
      return codec;
   },
   array: <T>(name: string, elemCodec: Codec<T>, count: number): Codec<T[]> => {
      count |= 0;
      if (count < 0)
         throw new Error(`array(${name}): count must be >=0, got ${count}`);
      const elemBits = elemCodec.bitSize;
      const bitSize = (elemBits === "variable") ? "variable" : (elemBits * count);
      return _codec(
         {kind: "array", name, elemCodec, count},
         (arr: T[], w: BitWriter, ctx?: ComputeContext) => {
            if (!Array.isArray(arr))
               throw new Error(`array(${name}): expected array, got ${typeof arr}`);
            if (arr.length !== count)
               throw new Error(`array(${name}): expected length ${count}, got ${arr.length}`);
            for (let i = 0; i < count; i++)
               elemCodec.encode(arr[i], w, ctx);
         },
         (r: BitReader) => {
            const out: T[] = new Array(count);
            for (let i = 0; i < count; i++)
               out[i] = elemCodec.decode(r);
            return out;
         },
         bitSize,
      );
   },

   // Variable-length array (length-prefixed).
   // Notes:
   // - Always variable-sized.
   // - `maxCount` is enforced on encode and decode.
   // - `alignToByteAfterLength` is useful when the length is stored in a non-byte number of bits (e.g. u5)
   //   but you want the elements to begin at a byte boundary (for simple blob offset arithmetic).
   varArray: <T>(
      name: string,
      elemCodec: Codec<T>,
      lengthCodec: Codec<number>,
      maxCount: number,
      alignToByteAfterLength = false,
      ): Codec<T[]> => {
      maxCount |= 0;
      if (maxCount < 0)
         throw new Error(`varArray(${name}): maxCount must be >=0, got ${maxCount}`);
      return _codec(
         {kind: "varArray", name, elemCodec, lengthCodec, maxCount, alignToByteAfterLength},
         (arr: T[], w: BitWriter, ctx?: ComputeContext) => {
            if (!Array.isArray(arr))
               throw new Error(`varArray(${name}): expected array, got ${typeof arr}`);
            const len = arr.length | 0;
            if (len < 0 || len > maxCount)
               throw new Error(`varArray(${name}): length out of range: ${len} (max ${maxCount})`);
            lengthCodec.encode(len, w, ctx);
            if (alignToByteAfterLength)
               w.advanceToNextByteBoundary();
            for (let i = 0; i < len; i++) {
               const elemPath = ctx?._currentPath ? `${ctx._currentPath}[${i}]` : `[${i}]`;
               const byteOffset = w.cur.currentByteIndex();
               if (ctx?._offsets) {
                  ctx._offsets.set(elemPath, byteOffset);
               }
               const prevPath = ctx?._currentPath;
               if (ctx)
                  ctx._currentPath = elemPath;
               elemCodec.encode(arr[i], w, ctx);
               if (ctx)
                  ctx._currentPath = prevPath;
            }
         },
         (r: BitReader) => {
            const len = lengthCodec.decode(r) | 0;
            if (len < 0 || len > maxCount)
               throw new Error(`varArray(${name}): decoded length out of range: ${len} (max ${maxCount})`);
            if (alignToByteAfterLength)
               r.advanceToNextByteBoundary();
            const out: T[] = new Array(len);
            for (let i = 0; i < len; i++)
               out[i] = elemCodec.decode(r);
            return out;
         },
         "variable",
      );
   },

   // Runtime-sized array (count determined at encode time, not codec construction).
   // Unlike varArray, this doesn't encode the length - the decoder must know the count by other means.
   // Useful for top-level payloads where the count comes from headers or external sources.
   runtimeArray: <T>(
      name: string,
      elemCodec: Codec<T>,
      alignToByteBeforeEachElement = false,
      ): Codec<T[]> => {
      return _codec(
         {kind: "runtimeArray", name, elemCodec, alignToByteBeforeEachElement},
         (arr: T[], w: BitWriter, ctx?: ComputeContext) => {
            if (!Array.isArray(arr))
               throw new Error(`runtimeArray(${name}): expected array, got ${typeof arr}`);
            for (let i = 0; i < arr.length; i++) {
               if (alignToByteBeforeEachElement)
                  w.advanceToNextByteBoundary();
               const elemPath = ctx?._currentPath ? `${ctx._currentPath}[${i}]` : `[${i}]`;
               const byteOffset = w.cur.currentByteIndex();
               if (ctx?._offsets) {
                  ctx._offsets.set(elemPath, byteOffset);
               }
               const prevPath = ctx?._currentPath;
               if (ctx)
                  ctx._currentPath = elemPath;
               elemCodec.encode(arr[i], w, ctx);
               if (ctx)
                  ctx._currentPath = prevPath;
            }
         },
         (r: BitReader) => {
            throw new Error(`runtimeArray(${name}): decode not supported - count must be known at decode time`);
         },
         "variable",
      );
   },

   // Computed field - value is computed during encoding based on context (e.g., section offsets).
   // The baseCodec defines the encoding format; compute() provides the value.
   computed: <T>(name: string, baseCodec: Codec<T>, compute: (ctx: ComputeContext) => T): Codec<T> => {
      return _codec(
         {kind: "computed", name, baseCodec, compute},
         (_value: T, w: BitWriter, ctx?: ComputeContext) => {
            if (!ctx)
               throw new Error(`computed(${name}): requires ComputeContext but none provided`);
            const computedValue = compute(ctx);
            baseCodec.encode(computedValue, w, ctx);
         },
         (r: BitReader) => {
            return baseCodec.decode(r);
         },
         baseCodec.bitSize,
      );
   },
};

/**
 * Measure a codec with data and build an offset map.
 * Returns a context that can be used to query offsets during actual encoding.
 */
export function measureCodecOffsets<T>(codec: Codec<T>, data: T): ComputeContext {
   // Create a large temporary buffer for measurement
   const measureBuf = new Uint8Array(256 * 1024);
   const measureRegion = new MemoryRegion("measure", 0, measureBuf.length);
   const measureWriter = new BitWriter(measureBuf, measureRegion);

   const offsets = new Map<string, number>();
   const ctx: ComputeContext = {
      getOffset: (path: string) => {
         const offset = offsets.get(path);
         if (offset === undefined)
            throw new Error(`getOffset: unknown path '${path}'`);
         return offset;
      },
      _currentPath: "",
      _offsets: offsets,
      _writer: measureWriter,
   };

   codec.encode(data, measureWriter, ctx);
   return ctx;
}

/**
 * Encode with automatic offset tracking.
 * First measures to build offset map, then encodes with that context.
 */
export function encodeWithOffsets<T>(codec: Codec<T>, data: T, out: Uint8Array, region: MemoryRegion): void {
   const ctx = measureCodecOffsets(codec, data);
   const writer = new BitWriter(out, region);
   // Reset path for actual encoding
   ctx._currentPath = "";
   ctx._writer = writer;
   codec.encode(data, writer, ctx);
}

export {MemoryRegion, BitCursor, BitReader, BitWriter, C};
