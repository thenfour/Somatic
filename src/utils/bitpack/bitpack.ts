import {MemoryRegion, BitCursor} from "./MemoryRegion";
import {assertBitsFitInRegion, maskLowBits} from "./utils";

export type BitSize = number|"variable";

/**
 * Discriminated union of all possible codec node types.
 * Each codec has a 'node' property containing metadata used for code generation and introspection.
 */
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
   | { kind: "varArray"; name: string; elemCodec: Codec<unknown>; lengthCodec: Codec<number>; maxCount: number; alignToByteAfterLength: boolean };

export interface Codec<T = unknown> {
   node: CodecNode;
   bitSize: BitSize;
   encode(value: T, writer: BitWriter): void;
   decode(reader: BitReader): T;
   getLayout?: () => LayoutItem[];
   byteSizeCeil?: () => number;
}

type FieldEntry<T = unknown> = {
   kind: "field"; //
   name: string;
   codec: Codec<T>
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
   encode: (value: T, writer: BitWriter) => void,
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
   enum: (name: string, nBits: number, mapping: Record<string, number>): Codec<string|number> => {
      const enc = new Map<string, number>(Object.entries(mapping));
      const dec = new Map<number, string>(Object.entries(mapping).map(([k, v]) => [v | 0, k]));
      const base = C.u(nBits);
      return _codec(
         {kind: "enum", name, nBits, mapping},
         (v: string|number, w: BitWriter) => {
            const num = enc.has(v as string) ? enc.get(v as string)! : v;
            if (typeof num !== "number")
               throw new Error(`enum ${name}: unknown value '${v}'`);
            base.encode(num, w);
         },
         (r: BitReader) => {
            const num = base.decode(r);
            return dec.has(num) ? dec.get(num)! : num;
         },
         base.bitSize,
      );
   },
   field: <T>(name: string, codec: Codec<T>): FieldEntry<T> => ({kind: "field", name, codec}),
   struct: (name: string, items: Array<FieldEntry | Codec<unknown>>): Codec<Record<string, unknown>> => {
      const seq: StructSeqItem[] = items.map((it) => {
         if (!it)
            throw new Error(`struct(${name}): null item`);
         if ((it as FieldEntry).kind === "field")
            return it as FieldEntry;
         const maybeCodec = it as Codec<unknown>;
         if (maybeCodec.node && typeof maybeCodec.encode === 'function' && typeof maybeCodec.decode === 'function')
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
         (obj: Record<string, unknown>, w: BitWriter) => {
            for (const it of seq) {
               if (it.kind === "field")
                  it.codec.encode(obj[it.name], w);
               else
                  it.codec.encode(undefined, w);
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
            return out;
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
         (arr: T[], w: BitWriter) => {
            if (!Array.isArray(arr))
               throw new Error(`array(${name}): expected array, got ${typeof arr}`);
            if (arr.length !== count)
               throw new Error(`array(${name}): expected length ${count}, got ${arr.length}`);
            for (let i = 0; i < count; i++)
               elemCodec.encode(arr[i], w);
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
         (arr: T[], w: BitWriter) => {
            if (!Array.isArray(arr))
               throw new Error(`varArray(${name}): expected array, got ${typeof arr}`);
            const len = arr.length | 0;
            if (len < 0 || len > maxCount)
               throw new Error(`varArray(${name}): length out of range: ${len} (max ${maxCount})`);
            lengthCodec.encode(len, w);
            if (alignToByteAfterLength)
               w.advanceToNextByteBoundary();
            for (let i = 0; i < len; i++)
               elemCodec.encode(arr[i], w);
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
};

export {MemoryRegion, BitCursor, BitReader, BitWriter, C};
