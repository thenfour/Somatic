// @ts-nocheck
// this file calculates & defines things that are used
// - in the react app
// - in bridge.lua (which gets built into bridge.tic during build)
// - some auto-replaced constants in playroutine luas

// this class facilitates:
// - mock "allocation" of target platform memory
// - defining memory map
// - semantically defining our chosen memory mapped regions
//
// kinda a Span-like concept; think geometric.
class MemoryRegion {
   name;
   address;
   size;
   constructor(name, address, size) {
      if (size < 0) {
         throw new Error(`MemoryRegion ${name} cannot have negative size (${size})`);
      }
      this.name = name;
      this.address = address;
      this.size = size;
   }

   endAddress() {
      return this.address + this.size;
   }
   beginAddress() {
      return this.address;
   }
   contains(addr) {
      return addr >= this.address && addr < this.endAddress();
   }
   getName() {
      return this.name;
   }
   getSize() {
      return this.size;
   }

   withSizeDelta(delta) {
      const newSize = this.size + delta;
      if (newSize < 0) {
         throw new Error(`MemoryRegion ${this.name} cannot have negative size (${newSize})`);
      }
      return new MemoryRegion(this.name, this.address, newSize);
   }
   withBeginAddress(newAddress) {
      const delta = this.address - newAddress;
      const newSize = this.size + delta;
      if (newSize < 0) {
         throw new Error(`MemoryRegion ${this.name} cannot have negative size (${newSize})`);
      }
      return new MemoryRegion(this.name, newAddress, newSize);
   }

   toString() {
      return `${this.name} [0x${this.address.toString(16)}..0x${this.endAddress().toString(16)}] (${this.size} bytes)`;
   }

   // things like .overlaps(otherRegion) could be added here
   // or combine/slice type ops, withBeginAddress, withSize, upperChunk,
   // alignment helpers, etc.
   getCell(cellSize, cellIndex) {
      const cellAddr = this.address + cellSize * cellIndex;
      if (!this.contains(cellAddr) || !this.contains(cellAddr + cellSize - 1)) {
         throw new Error(`MemoryRegion ${this.name} cannot provide cell index ${cellIndex} (out of range)`);
      }
      return new MemoryRegion(`${this.name}_cell${cellIndex}`, cellAddr, cellSize);
   }
};



class RegionCursor {
   constructor(region, bitOffset = 0) {
      this.region = region;
      this.bitOffset = bitOffset | 0;
   }
   clone() {
      return new RegionCursor(this.region, this.bitOffset);
   }
   tellBits() {
      return this.bitOffset;
   }
   tellBytesFloor() {
      return (this.bitOffset / 8) | 0;
   }
   byteIndexAbs() {
      return (this.region.address + ((this.bitOffset / 8) | 0)) | 0;
   }
   bitIndexInByte() {
      return (this.bitOffset & 7) | 0;
   }

   // Seek by bits
   seekBits(deltaBits) {
      this.bitOffset = (this.bitOffset + (deltaBits | 0)) | 0;
      return this;
   }

   // Align to next byte boundary
   alignToByte() {
      const m = this.bitOffset & 7;
      if (m !== 0)
         this.bitOffset = (this.bitOffset + (8 - m)) | 0;
      return this;
   }
}


function _requireBitsInRegion(region, bitOffset, bitsNeeded, ctx) {
   const totalBits = region.size * 8;
   if (bitOffset < 0 || bitOffset + bitsNeeded > totalBits) {
      throw new Error(
         `${ctx}: out of bounds (need ${bitsNeeded} bits at bitOffset ${bitOffset}, region=${region.toString()})`);
   }
}



// -----------------------------
// BitReader / BitWriter (LSB-first within byte)
// -----------------------------

function _maskBits(k) {
   // k in [0..8] typically for chunking
   if (k <= 0)
      return 0;
   if (k >= 32)
      return 0xFFFFFFFF >>> 0;
   return (Math.pow(2, k) - 1) >>> 0;
}

class BitReader {
   constructor(u8, region, cursor = new RegionCursor(region, 0)) {
      this.u8 = u8; // Uint8Array
      this.region = region;
      this.cur = cursor;
   }

   alignToByte() {
      this.cur.alignToByte();
      return this;
   }

   readBitsU(n) {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`readBitsU: n must be 0..32, got ${n}`);
      _requireBitsInRegion(this.region, this.cur.bitOffset, n, "BitReader.readBitsU");

      let remaining = n;
      let out = 0 >>> 0;
      let outShift = 0;

      while (remaining > 0) {
         const absByte = this.cur.byteIndexAbs();
         const bitInByte = this.cur.bitIndexInByte();
         const avail = 8 - bitInByte;
         const k = remaining < avail ? remaining : avail;

         const byteVal = this.u8[absByte] >>> 0;
         const part = (byteVal >>> bitInByte) & _maskBits(k);

         // Assemble LSB-first into out
         out = (out | ((part << outShift) >>> 0)) >>> 0;

         this.cur.seekBits(k);
         outShift += k;
         remaining -= k;
      }

      // If n<32, keep as normal JS number; if n==32, ensure unsigned
      return n === 32 ? (out >>> 0) : out;
   }

   readBitsI(n) {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`readBitsI: n must be 1..32, got ${n}`);
      const u = this.readBitsU(n);
      if (n === 32) {
         // Interpret as signed 32-bit
         return (u | 0);
      }
      const signBit = 1 << (n - 1);
      return (u & signBit) ? (u - Math.pow(2, n)) : u;
   }

   // Convenience byte-aligned reads (faster + clearer)
   readU8() {
      this.alignToByte();
      return this.readBitsU(8);
   }
   readI8() {
      this.alignToByte();
      return this.readBitsI(8);
   }

   readU16LE() {
      this.alignToByte();
      const lo = this.readBitsU(8);
      const hi = this.readBitsU(8);
      return (lo | (hi << 8)) >>> 0;
   }
   readI16LE() {
      const u = this.readU16LE();
      return (u & 0x8000) ? (u - 0x10000) : u;
   }

   readU16BE() {
      this.alignToByte();
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
   constructor(u8, region, cursor = new RegionCursor(region, 0)) {
      this.u8 = u8;
      this.region = region;
      this.cur = cursor;
   }

   alignToByte() {
      this.cur.alignToByte();
      return this;
   }

   writeBitsU(n, value) {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`writeBitsU: n must be 0..32, got ${n}`);
      _requireBitsInRegion(this.region, this.cur.bitOffset, n, "BitWriter.writeBitsU");

      // Coerce to unsigned 32-bit for sane chunking
      let v = (n === 32) ? (value >>> 0) : (value >>> 0);
      // Range check (optional but helpful)
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

         const mask = _maskBits(k);
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

   writeBitsI(n, value) {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`writeBitsI: n must be 1..32, got ${n}`);

      if (n === 32) {
         // allow full signed 32 range
         this.writeBitsU(32, value | 0);
         return this;
      }

      const min = -Math.pow(2, n - 1);
      const max = Math.pow(2, n - 1) - 1;
      if (value < min || value > max) {
         throw new Error(`writeBitsI(${n}): value out of range: ${value} (min ${min}, max ${max})`);
      }
      const u = value < 0 ? (value + Math.pow(2, n)) : value;
      this.writeBitsU(n, u >>> 0);
      return this;
   }

   writeU8(v) {
      this.alignToByte();
      return this.writeBitsU(8, v);
   }
   writeI8(v) {
      this.alignToByte();
      return this.writeBitsI(8, v);
   }

   writeU16LE(v) {
      this.alignToByte();
      this.writeBitsU(8, v & 0xFF);
      this.writeBitsU(8, (v >>> 8) & 0xFF);
      return this;
   }
   writeI16LE(v) {
      return this.writeU16LE(v & 0xFFFF);
   }

   writeU16BE(v) {
      this.alignToByte();
      this.writeBitsU(8, (v >>> 8) & 0xFF);
      this.writeBitsU(8, v & 0xFF);
      return this;
   }
   writeI16BE(v) {
      return this.writeU16BE(v & 0xFFFF);
   }
}

// -----------------------------
// Codec IR + Builders
// -----------------------------

function _codec(node, encode, decode, bitSize) {
   return {
      node,
      bitSize, // number | "variable"
      encode,
      decode,
   };
}

const C = {
   // primitives
   u: (n) => {
      n |= 0;
      if (n < 0 || n > 32)
         throw new Error(`C.u(n): n must be 0..32, got ${n}`);
      return _codec({kind: "u", n}, (v, w) => w.writeBitsU(n, v), (r) => r.readBitsU(n), n);
   },

   i: (n) => {
      n |= 0;
      if (n <= 0 || n > 32)
         throw new Error(`C.i(n): n must be 1..32, got ${n}`);
      return _codec({kind: "i", n}, (v, w) => w.writeBitsI(n, v), (r) => r.readBitsI(n), n);
   },

   bool: () => C.u(1),

   // byte-aligned convenience codecs (encode/decode also align)
   u8: () => _codec({kind: "u8"}, (v, w) => w.writeU8(v), (r) => r.readU8(), 8),

   i8: () => _codec({kind: "i8"}, (v, w) => w.writeI8(v), (r) => r.readI8(), 8),

   u16le: () => _codec({kind: "u16le"}, (v, w) => w.writeU16LE(v), (r) => r.readU16LE(), 16),

   i16le: () => _codec({kind: "i16le"}, (v, w) => w.writeI16LE(v), (r) => r.readI16LE(), 16),

   u16be: () => _codec({kind: "u16be"}, (v, w) => w.writeU16BE(v), (r) => r.readU16BE(), 16),

   i16be: () => _codec({kind: "i16be"}, (v, w) => w.writeI16BE(v), (r) => r.readI16BE(), 16),

   // directives
   alignToByte: () => _codec(
      {kind: "alignToByte"},
      (_v, w) => {
         w.alignToByte();
      },
      (r) => {
         r.alignToByte();
         return undefined;
      },
      "variable" // depends on current offset
      ),

   padBits: (n) => {
      n |= 0;
      if (n < 0)
         throw new Error(`C.padBits: n must be >=0, got ${n}`);
      return _codec(
         {kind: "padBits", n},
         (_v, w) => {
            w.writeBitsU(n, 0);
         },
         (r) => {
            r.readBitsU(n);
            return undefined;
         },
         n);
   },

   // enum: map string <-> number (stored as unsigned)
   enum: (name, nBits, mapping) => {
      const enc = new Map(Object.entries(mapping)); // key -> number
      const dec = new Map(Object.entries(mapping).map(([k, v]) => [v | 0, k]));
      const base = C.u(nBits);
      return _codec(
         {kind: "enum", name, nBits, mapping},
         (v, w) => {
            const num = enc.has(v) ? enc.get(v) : v;
            if (typeof num !== "number")
               throw new Error(`enum ${name}: unknown value '${v}'`);
            base.encode(num, w);
         },
         (r) => {
            const num = base.decode(r);
            return dec.has(num) ? dec.get(num) : num;
         },
         base.bitSize);
   },

   // struct / fields
   field: (name, codec) => ({kind: "field", name, codec}),

   struct: (name, items /* array of field() or directive codecs */) => {
      // Normalize: allow raw codecs in items (directives), or field entries
      const seq = items.map((it) => {
         if (!it)
            throw new Error(`struct(${name}): null item`);
         if (it.kind === "field")
            return it;
         // treat codec as anonymous directive/slot
         if (it.node && it.encode && it.decode)
            return {kind: "anon", codec: it};
         throw new Error(`struct(${name}): item must be field(...) or codec, got ${JSON.stringify(it)}`);
      });

      // Precompute layout if possible (fixed sizes with deterministic align directives)
      const layout = [];
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
               // unknown directive => treat as variable
               fixed = false;
            }
         }
      }

      const bitSize = fixed ? bitOff : "variable";

      const codec = _codec(
         {kind: "struct", name, seq, layout},
         (obj, w) => {
            for (const it of seq) {
               if (it.kind === "field") {
                  it.codec.encode(obj[it.name], w);
               } else {
                  it.codec.encode(undefined, w);
               }
            }
         },
         (r) => {
            const out = {};
            for (const it of seq) {
               if (it.kind === "field") {
                  out[it.name] = it.codec.decode(r);
               } else {
                  it.codec.decode(r);
               }
            }
            return out;
         },
         bitSize);

      codec.getLayout = () => layout.slice();
      codec.byteSizeCeil = () => {
         if (bitSize === "variable")
            throw new Error(`struct ${name} has variable size; cannot compute byteSizeCeil()`);
         return ((bitSize + 7) / 8) | 0;
      };

      return codec;
   },

   // fixed-size arrays
   array: (name, elemCodec, count) => {
      count |= 0;
      if (count < 0)
         throw new Error(`array(${name}): count must be >=0, got ${count}`);

      const elemBits = elemCodec.bitSize;
      const bitSize = (elemBits === "variable") ? "variable" : (elemBits * count);

      return _codec(
         {kind: "array", name, elemCodec, count},
         (arr, w) => {
            if (!Array.isArray(arr))
               throw new Error(`array(${name}): expected array, got ${typeof arr}`);
            if (arr.length !== count)
               throw new Error(`array(${name}): expected length ${count}, got ${arr.length}`);
            for (let i = 0; i < count; i++)
               elemCodec.encode(arr[i], w);
         },
         (r) => {
            const out = new Array(count);
            for (let i = 0; i < count; i++)
               out[i] = elemCodec.decode(r);
            return out;
         },
         bitSize);
   },
};


// SFX codec



// -----------------------------
// Lua codegen (TIC-80, RAM via peek)
// -----------------------------

// function emitLuaDecoder(codec, opt = {}) {
//   const {
//     functionName = `decode_${codec.node && codec.node.name ? codec.node.name : "payload"}`,
//     baseArgName = "base",           // base address in RAM
//     returnName = "out",
//     includeLayoutComments = true,
//     localReaderName = "r",
//   } = opt;

//   if (!codec || !codec.node) throw new Error("emitLuaDecoder: codec must be a C.struct(...) codec");

//   // Small Lua helper for reading bits from RAM (peek), LSB-first within byte
//   const luaPrelude = `
// -- bitpack.lua (generated)
// -- LSB-first bits within each byte; assembled LSB-first into integers.
// local function _bp_make_reader(${baseArgName})
//   local bytePos = 0
//   local bitPos = 0

//   local function _bp_align_byte()
//     if bitPos ~= 0 then
//       bitPos = 0
//       bytePos = bytePos + 1
//     end
//   end

//   local function _bp_read_bits(n)
//     local v = 0
//     local shift = 0
//     while n > 0 do
//       local b = peek(${baseArgName} + bytePos)
//       local avail = 8 - bitPos
//       local k = (n < avail) and n or avail
//       local mask = (1 << k) - 1
//       local part = (b >> bitPos) & mask
//       v = v | (part << shift)
//       bitPos = bitPos + k
//       if bitPos >= 8 then
//         bitPos = 0
//         bytePos = bytePos + 1
//       end
//       shift = shift + k
//       n = n - k
//     end
//     return v
//   end

//   local function _bp_read_sbits(n)
//     local v = _bp_read_bits(n)
//     local sign = 1 << (n - 1)
//     if (v & sign) ~= 0 then
//       v = v - (1 << n)
//     end
//     return v
//   end

//   return {
//     align = _bp_align_byte,
//     u = _bp_read_bits,
//     i = _bp_read_sbits,
//   }
// end
// `.trim();

//   function indent(lines, nSpaces) {
//     const pad = " ".repeat(nSpaces);
//     return lines.split("\n").map(l => (l.length ? pad + l : l)).join("\n");
//   }

//   function emitDecodeExpr(c, luaReader) {
//     const k = c.node.kind;
//     switch (k) {
//       case "u": return `${luaReader}.u(${c.node.n})`;
//       case "i": return `${luaReader}.i(${c.node.n})`;
//       case "u8": return `${luaReader}.align(); ${luaReader}.u(8)`;
//       case "i8": return `${luaReader}.align(); ${luaReader}.i(8)`;
//       case "u16le": return `${luaReader}.align(); (${luaReader}.u(8) | (${luaReader}.u(8) << 8))`;
//       case "i16le": return `(function() ${luaReader}.align(); local u = (${luaReader}.u(8) | (${luaReader}.u(8) << 8)); if (u & 0x8000) ~= 0 then return u - 0x10000 else return u end end)()`;
//       case "u16be": return `${luaReader}.align(); ((${luaReader}.u(8) << 8) | ${luaReader}.u(8))`;
//       case "i16be": return `(function() ${luaReader}.align(); local u = ((${luaReader}.u(8) << 8) | ${luaReader}.u(8)); if (u & 0x8000) ~= 0 then return u - 0x10000 else return u end end)()`;
//       case "enum":
//         // emit numeric decode; mapping to strings could be added if you want (switch table)
//         return `${luaReader}.u(${c.node.nBits})`;
//       default:
//         throw new Error(`emitLuaDecoder: no expr emitter for codec kind '${k}'`);
//     }
//   }

//   function emitStatementsForCodec(c, targetExpr, luaReader, depth) {
//     const k = c.node.kind;
//     if (k === "struct") {
//       const name = c.node.name || "payload";
//       const lines = [];
//       lines.push(`local ${returnName} = {}`);
//       for (const it of c.node.seq) {
//         if (it.kind === "field") {
//           const sub = it.codec;
//           const subKind = sub.node.kind;
//           if (subKind === "struct" || subKind === "array") {
//             const childVar = `${it.name}`;
//             // allocate and assign
//             lines.push(`do`);
//             lines.push(indent(emitStatementsForCodec(sub, childVar, luaReader, depth + 1), 2));
//             lines.push(indent(`${returnName}.${it.name} = ${childVar}`, 2));
//             lines.push(`end`);
//           } else {
//             lines.push(`${returnName}.${it.name} = ${emitDecodeExpr(sub, luaReader)}`);
//           }
//         } else {
//           const dk = it.codec.node.kind;
//           if (dk === "alignToByte") lines.push(`${luaReader}.align()`);
//           else if (dk === "padBits") lines.push(`${luaReader}.u(${it.codec.node.n}) -- pad`);
//           else throw new Error(`emitLuaDecoder: unsupported directive kind '${dk}'`);
//         }
//       }
//       lines.push(`return ${returnName}`);
//       return lines.join("\n");
//     }

//     if (k === "array") {
//       const lines = [];
//       lines.push(`local ${targetExpr} = {}`);
//       lines.push(`for i=1,${c.node.count} do`);
//       const elem = c.node.elemCodec;
//       if (elem.node.kind === "struct" || elem.node.kind === "array") {
//         lines.push(indent(`do`, 2));
//         lines.push(indent(emitStatementsForCodec(elem, "_tmp", luaReader, depth + 1), 4));
//         lines.push(indent(`${targetExpr}[i] = _tmp`, 4));
//         lines.push(indent(`end`, 2));
//       } else {
//         lines.push(indent(`${targetExpr}[i] = ${emitDecodeExpr(elem, luaReader)}`, 2));
//       }
//       lines.push(`end`);
//       return lines.join("\n");
//     }

//     throw new Error(`emitLuaDecoder: emitStatementsForCodec only supports struct/array; got ${k}`);
//   }

//   const layoutComment = (includeLayoutComments && codec.node.kind === "struct")
//     ? (() => {
//         const lines = [];
//         lines.push(`-- Layout: ${codec.node.name || "payload"}`);
//         for (const e of codec.node.layout || []) {
//           const off = e.bitOffset | 0;
//           const sz = e.bitSize;
//           const b0 = off;
//           const b1 = (sz === "variable") ? "?" : (off + sz - 1);
//           lines.push(`--   ${String(e.name).padEnd(16)} bits ${String(b0).padStart(4)}..${String(b1).padStart(4)}`);
//         }
//         return lines.join("\n");
//       })()
//     : "";

//   const luaBody = `
// ${layoutComment}
// function ${functionName}(${baseArgName})
//   local ${localReaderName} = _bp_make_reader(${baseArgName})
// ${indent(emitStatementsForCodec(codec, returnName, localReaderName, 0), 2)}
// end
// `.trim();

//   return `${luaPrelude}\n\n${luaBody}\n`;
// }



// EXAMPLE of using the bitpack system to define a payload schema,

// const { MemoryRegion, C, emitLuaDecoder, encodeToRegion } = require("./bitpack");

// // Define a payload schema:
// const SpritePayload = C.struct("SpritePayload", [
//   C.field("version", C.u(4)),
//   C.field("flags",   C.u(4)),
//   C.field("x",       C.i(12)),
//   C.field("y",       C.i(12)),
//   C.alignToByte(),
//   C.field("tileId",  C.u16le()),
//   C.field("palette", C.array("palette", C.u(4), 16)),
// ]);

// // Allocate bytes for the payload (fixed-size structs only)
// const byteSize = SpritePayload.byteSizeCeil();
// const bytes = new Uint8Array(byteSize);
// const region = new MemoryRegion("sprite_payload", 0, bytes.length);

// // Serialize
// encodeToRegion(SpritePayload, {
//   version: 3,
//   flags: 5,
//   x: -123,
//   y: 456,
//   tileId: 1337,
//   palette: new Array(16).fill(0).map((_, i) => i & 0xF),
// }, bytes, region);

// // Generate TIC-80 Lua decoder source
// const lua = emitLuaDecoder(SpritePayload, {
//   functionName: "decode_SpritePayload",
//   baseArgName: "base",
//   includeLayoutComments: true,
// });

// // writeFileSync("decoder.lua", lua) ...
// console.log(bytes);
// console.log(lua);


// TODO: define the SFX payload (see packMorphEntries, `dmorph` in playroutine-release, or `decode_morph_map` in playroutine-debug)



// .--------------------------------------.
// |         96KB IO ADDRESS SPACE        |
// |--------------------------------------|
// | ADDR    | INFO              | BYTES  |
// |---------+-------------------+--------|
// | 0x00000 | <VRAM bank 0>     | 16,384 | 32kB Video RAM (see below)
// |         |    ...or <bank 1> |        |
// | 0x04000 | TILES             | 8,192  | 256 8x8 4-bit bg tiles - #0 to #255
// | 0x06000 | SPRITES           | 8,192  | 256 8x8 4-bit fg sprites - #256 to #511
// | 0x08000 | MAP               | 32,640 | 240x136 map - indexed by tile/sprite
// | 0x0FF80 | GAMEPADS          | 4      | button state for 4 gamepads
// | 0x0FF84 | MOUSE             | 4      | mouse state X / Y / buttons / scroll
// | 0x0FF88 | KEYBOARD          | 4      | keyboard state, up to 4 pressed buttons
// | 0x0FF8C | SFX STATE         | 16     |
// | 0x0FF9C | SOUND REGISTERS   | 72     | ...
// | 0x0FFE4 | WAVEFORMS         | 256    | 16 waveforms, each 32 x 4-bit values
// | 0x100E4 | SFX               | 4,224  | ...
// | 0x11164 | MUSIC PATTERNS    | 11,520 | ...
// | 0x13E64 | MUSIC TRACKS      | 408    | ...
// | 0x13FFC | SOUND STATE       | 4      | ...
// | 0x14000 | STEREO VOLUME     | 4      |
// | 0x14004 | PERSISTENT MEMORY | 1,024  | persistent RAM, per cartridge
// | 0x14404 | SPRITE FLAGS      | 512    |
// | 0x14604 | SYSTEM FONT       | 2,048  | 256 8x8 1-bit font (used by print)
// | 0x14E04 | GAMEPAD MAPPING   | 32     | keycodes for gamepad mappings
// | 0x14E36 | ** RESERVED **    | 12,764 |
// '--------------------------------------'
const Tic80MemoryMap = {
   VRam: new MemoryRegion("VRam", 0x00000, 0x4000),
   Tiles: new MemoryRegion("Tiles", 0x04000, 0x2000),
   Sprites: new MemoryRegion("Sprites", 0x06000, 0x2000),
   Map: new MemoryRegion("Map", 0x08000, 0x7FF0),
   Gamepads: new MemoryRegion("Gamepads", 0x0FF80, 0x04),
   Mouse: new MemoryRegion("Mouse", 0x0FF84, 0x04),
   Keyboard: new MemoryRegion("Keyboard", 0x0FF88, 0x04),
   SfxState: new MemoryRegion("SfxState", 0x0FF8C, 0x10),
   SoundRegisters: new MemoryRegion("SoundRegisters", 0x0FF9C, 0x48),
   Waveforms: new MemoryRegion("Waveforms", 0x0FFE4, 0x100),
   Sfx: new MemoryRegion("Sfx", 0x100E4, 0x1080),
   MusicPatterns: new MemoryRegion("MusicPatterns", 0x11164, 0x2D00),
   MusicTracks: new MemoryRegion("MusicTracks", 0x13E64, 0x198),
   SoundState: new MemoryRegion("SoundState", 0x13FFC, 0x04),
   StereoVolume: new MemoryRegion("StereoVolume", 0x14000, 0x04),
   PersistentMemory: new MemoryRegion("PersistentMemory", 0x14004, 0x400),
   SpriteFlags: new MemoryRegion("SpriteFlags", 0x14404, 0x200),
   SystemFont: new MemoryRegion("SystemFont", 0x14604, 0x800),
   GamepadMapping: new MemoryRegion("GamepadMapping", 0x14E04, 0x20),
   Reserved: new MemoryRegion("Reserved", 0x14E36, 0x3204),
};

const Tic80MemoryConstants = {
   // Q: is it ALWAYS 192? (even when rows per pattern is fewer than 64?)
   BYTES_PER_MUSIC_PATTERN: 192,
   BYTES_PER_SFX: 66,
   BYTES_PER_WAVEFORM: 16,
};

// tic80 helpers
function RegionForMusicPattern(patternIndex) {
   return Tic80MemoryMap.MusicPatterns.getCell(Tic80MemoryConstants.BYTES_PER_MUSIC_PATTERN, patternIndex);
}

function RegionForSfx(sfxIndex) {
   return Tic80MemoryMap.Sfx.getCell(Tic80MemoryConstants.BYTES_PER_SFX, sfxIndex);
}

function RegionForWaveform(waveformIndex) {
   return Tic80MemoryMap.Waveforms.getCell(Tic80MemoryConstants.BYTES_PER_WAVEFORM, waveformIndex);
}



// determine the NEEDS of our various systems.
// - bridge infrastructure
// - bridge-specific song serialization
// - cart song serialization
//   - temp buffers (patterns, (sfx/waveforms..), sfx mpping, automation lanes)
//   - pattern, song order, sfx compressed storage

// determine packed layout. even though we compress data, the decompressed payload
// still needs to fit in a smallish space. esp. the sfx config region. most fields
// don't require 8-bit width so it wins a LOT to pack things tightly.

const bridgeConfig = {
   // Marker string written into RAM for host detection
   markerText: "SOMATIC_TIC80_V1",

   // Outbox command IDs (cart -> host)
   outboxCommands: {LOG: 1},

   // Inbox command IDs (host -> cart)
   inboxCommands: {NOP: 0, TRANSMIT_AND_PLAY: 1, STOP: 2, PING: 3, TRANSMIT: 4, PLAY_SFX_ON: 6, PLAY_SFX_OFF: 7},

   tic80MemoryMap: Tic80MemoryMap,

   // Shared memory layout for bridge (cart + host)
   memory: {
      // Waveforms/sfx/patterns/tracks payload destinations (TIC-80 layout)
      WAVEFORMS_ADDR: Tic80MemoryMap.Waveforms.beginAddress(), //"0x0ffe4",
      SFX_ADDR: Tic80MemoryMap.Sfx.beginAddress(),
      PATTERNS_ADDR: Tic80MemoryMap.MusicPatterns.beginAddress(),
      TRACKS_ADDR: Tic80MemoryMap.MusicTracks.beginAddress(),

      // Pattern memory usable for packed compressed columns ends before PATTERN_MEM_LIMIT.
      // Front blit buffer uses patterns 46-49 (pattern 46 at 0x133e4); back buffer uses 50-53 (pattern 50 at 0x136e4).
      PATTERN_MEM_LIMIT: "0x13324",
      PATTERN_BUFFER_A_INDEX: 46,
      PATTERN_BUFFER_B_INDEX: 50,
      PATTERN_BUFFER_A_ADDR: "0x13324",
      PATTERN_BUFFER_B_ADDR: "0x13624",

      // Somatic bridge state lives in the top of MAP (0x8000..0x0ff7f),
      // above all tracker-format pattern data.
      //
      // Layout within MAP:
      //   0x0e400..0x0efff : packed morphing instrument config
      //   0x0f000..0x0f01f : marker & small header region
      //   0x0f020..0x0f03f : Somatic registers (song position, FPS, etc.)
      //   0x0f040..0x0f07f : INBOX (host -> cart mailbox)
      //   0x0f080..0x0f08f : OUTBOX header (cart -> host mailbox)
      //   0x0f090..0x0f17f : OUTBOX log ring buffer (LOG_SIZE bytes)
      SOMATIC_SFX_CONFIG: "0x0e800", // 0x0f000 - sfx_cfg_payload_size (~1kb)
      MARKER_ADDR: "0x0f000",
      REGISTERS_ADDR: "0x0f020",
      INBOX_ADDR: "0x0f040",
      OUTBOX_ADDR: "0x0f080",
      LOG_SIZE: 240,

      // Tracker-format (Somatic) song data encoded into TIC-80 RAM
      TILE_BASE: "0x4000",
      TF_ORDER_LIST: "0x4000",
      TF_ORDER_LIST_COUNT: "0x4000",
      TF_ORDER_LIST_ENTRIES: "0x4001",
      TF_PATTERN_DATA: "0x4101",

      // Music state snapshot written by TIC-80 runtime
      MUSIC_STATE_TRACK: "0x13ffc",
      MUSIC_STATE_FRAME: "0x13ffd",
      MUSIC_STATE_ROW: "0x13ffe",
      MUSIC_STATE_FLAGS: "0x13fff",

      // Somatic playroutine state (kept in REGISTERS_ADDR region above)
      MUSIC_STATE_SOMATIC_SONG_POSITION: "0x0f020",
      FPS: "0x0f021",

      // temp buffer for decompressing and decoding
      __AUTOGEN_TEMP_PTR_A: "0x13a64",
      __AUTOGEN_TEMP_PTR_B: "0x13c64"
   }
};

export default bridgeConfig;
export type BridgeConfig = typeof bridgeConfig;
export {MemoryRegion, RegionCursor, BitReader, BitWriter, C};
