import {describe, it} from "node:test";
import assert from "node:assert/strict";

import {BitReader, BitWriter, C, MemoryRegion, encodeWithOffsets, measureCodecOffsets} from "../src/utils/bitpack/bitpack";
import type {Codec} from "../src/utils/bitpack/bitpack";

function encodeToBytes<T>(codec: Codec<T>, value: T, maxBytes = 1024): Uint8Array {
   const buf = new Uint8Array(maxBytes);
   buf.fill(0);
   const region = new MemoryRegion("test", 0, buf.length);
   const w = new BitWriter(buf, region);
   codec.encode(value, w);
   return buf.slice(0, w.cur.currentByteLengthCeil());
}

function decodeFromBytes<T>(codec: Codec<T>, bytes: Uint8Array): T {
   const region = new MemoryRegion("test", 0, bytes.length);
   const r = new BitReader(bytes, region);
   return codec.decode(r);
}

// memory region basic tests
describe("MemoryRegion", () => {
   it("creates regions and computes addresses correctly", () => {
      const region = new MemoryRegion({name: "TestRegion", address: 0x1000, size: 0x200});
      assert.equal(region.address, 0x1000);
      assert.equal(region.size, 0x200);
      assert.equal(region.endAddress(), 0x1200);
   });

   it("checks address containment correctly", () => {
      const region = new MemoryRegion({name: "TestRegion", address: 0x1000, size: 0x200});
      assert.equal(region.containsAddress(0x0FFF), false);
      assert.equal(region.containsAddress(0x1000), true);
      assert.equal(region.containsAddress(0x11FF), true);
      assert.equal(region.containsAddress(0x1200), false);
   });
   it("checks region containment correctly", () => {
      const region = new MemoryRegion({name: "TestRegion", address: 0x1000, size: 0x200});
      const inside = new MemoryRegion({name: "Inside", address: 0x1100, size: 0x50});
      const outside = new MemoryRegion({name: "Outside", address: 0x0F00, size: 0x200});
      assert.equal(region.containsRegion(inside), true);
      assert.equal(region.containsRegion(outside), false);
   });
   it("gets cells correctly", () => {
      const region = new MemoryRegion({name: "TestRegion", address: 0x1000, size: 0x200});
      const cell = region.getCell(0x40, 2);
      assert.equal(cell.address, 0x1000 + 0x40 * 2);
      assert.equal(cell.size, 0x40);
   });
   it("gets top cells correctly", () => {
      const region = new MemoryRegion(
         {name: "TestRegion", address: 100, size: 50}); // last byte is 149. so a cell of 3 has bytes [147,148,149]
      const cell = region.getTopAlignedCellFromTop(3, 0);
      assert.equal(cell.address, 147);
      assert.equal(cell.size, 3);
      const cell1 = region.getTopAlignedCellFromTop(3, 1); // next cell of 3 has bytes [144,145,146]
      assert.equal(cell1.address, 144);
      assert.equal(cell1.size, 3);
   });
   it("gets cells before address correctly", () => {
      const region = new MemoryRegion({name: "TestRegion", address: 100, size: 100}); // last byte is 199
      // let's say you reserved 2 bytes at the top [198, 199], and you want the cell of size 30 before that.
      // cells are aligned from the bottom of the region, so available cells are:
      // [100..129], [130..159], [160..189].
      const cell = region.getCellBeforeAddress(30, 198);
      assert.equal(cell.address, 160);
      assert.equal(cell.size, 30);
      const cell1 = region.getCellBeforeAddress(30, 160); // 160 should be exclusive.
      assert.equal(cell1.address, 130);
      assert.equal(cell1.size, 30);
      const cell2 = region.getCellBeforeAddress(30, 160, -1); // next cell down
      assert.equal(cell2.address, 100);
      assert.equal(cell2.size, 30);
   });
});

describe("bitpack", () => {
   it("packs unsigned bitfields LSB-first", () => {
      const Codec = C.struct("Packed", [
         C.field("a", C.u(3)),
         C.field("b", C.u(5)),
      ]);

      const bytes = encodeToBytes(Codec, {a: 5, b: 17});
      assert.equal(bytes.length, 1);
      assert.equal(bytes[0], 0x8D);

      const roundTrip = decodeFromBytes(Codec, bytes);
      assert.deepEqual(roundTrip, {a: 5, b: 17});
   });

   it("alignToByte moves to the next byte boundary", () => {
      const Codec = C.struct("Aligned", [
         C.field("a", C.u(3)),
         C.alignToByte(),
         C.field("b", C.u8()),
      ]);

      const bytes = encodeToBytes(Codec, {a: 7, b: 0xAA});
      assert.deepEqual(Array.from(bytes), [0x07, 0xAA]);

      const roundTrip = decodeFromBytes(Codec, bytes);
      assert.deepEqual(roundTrip, {a: 7, b: 0xAA});
   });

   it("padBits consumes bits without producing fields", () => {
      const Codec = C.struct("PadBits", [
         C.field("a", C.u(3)),
         C.padBits(2),
         C.field("b", C.u(3)),
      ]);

      // a in bits 0..2, pad in 3..4, b in 5..7
      const bytes = encodeToBytes(Codec, {a: 7, b: 5});
      assert.equal(bytes.length, 1);
      assert.equal(bytes[0], 7 | (5 << 5));

      const roundTrip = decodeFromBytes(Codec, bytes);
      assert.deepEqual(roundTrip, {a: 7, b: 5});
   });

   it("roundtrips signed integers", () => {
      const Codec = C.struct("Signed", [
         C.field("x", C.i(6)),
      ]);

      const bytes = encodeToBytes(Codec, {x: -1});
      const roundTrip = decodeFromBytes(Codec, bytes);
      assert.deepEqual(roundTrip, {x: -1});
   });

   it("encodes/decodes 16-bit endianness correctly", () => {
      const LE = C.struct("LE", [C.field("u", C.u16le()), C.field("s", C.i16le())]);
      const BE = C.struct("BE", [C.field("u", C.u16be()), C.field("s", C.i16be())]);

      const leBytes = encodeToBytes(LE, {u: 0x1234, s: -2});
      assert.deepEqual(Array.from(leBytes), [0x34, 0x12, 0xFE, 0xFF]);
      assert.deepEqual(decodeFromBytes(LE, leBytes), {u: 0x1234, s: -2});

      const beBytes = encodeToBytes(BE, {u: 0x1234, s: -2});
      assert.deepEqual(Array.from(beBytes), [0x12, 0x34, 0xFF, 0xFE]);
      assert.deepEqual(decodeFromBytes(BE, beBytes), {u: 0x1234, s: -2});
   });

   it("encodes fixed-length arrays", () => {
      const Codec = C.array("arr", C.u(4), 3);
      const bytes = encodeToBytes(Codec, [1, 2, 15]);
      assert.deepEqual(Array.from(bytes), [0x21, 0x0F]);
      assert.deepEqual(decodeFromBytes(Codec, bytes), [1, 2, 15]);
   });

   it("encodes/decodes varArray with non-byte length prefix + alignment", () => {
      const Codec = C.varArray("va", C.u8(), C.u(5), 8, true);

      const bytes = encodeToBytes(Codec, [9, 8, 7]);
      assert.deepEqual(Array.from(bytes), [0x03, 0x09, 0x08, 0x07]);
      assert.deepEqual(decodeFromBytes(Codec, bytes), [9, 8, 7]);

      assert.throws(() => encodeToBytes(Codec, new Array(9).fill(0)), /length out of range/i);
   });

   it("encodes enums by name and decodes to name when known", () => {
      const Enum = C.enum<"a"|"b"|number>("E", 2, {a: 1, b: 2});
      const bytesA = encodeToBytes(Enum, "a");
      assert.deepEqual(Array.from(bytesA), [0x01]);
      assert.equal(decodeFromBytes(Enum, bytesA), "a");

      const bytes3 = encodeToBytes(Enum, 3);
      assert.deepEqual(Array.from(bytes3), [0x03]);
      assert.equal(decodeFromBytes(Enum, bytes3), 3);
   });

   it("records byte offsets during measurement and encodeWithOffsets matches direct encode", () => {
      const Codec = C.struct("Offsets", [
         C.field("a", C.u(3)),
         C.field("b", C.u(5)),
         C.field("c", C.u8()),
      ]);

      const data = {a: 1, b: 2, c: 0xFF};
      const ctx = measureCodecOffsets(Codec, data);
      assert.equal(ctx.getOffset("a"), 0);
      assert.equal(ctx.getOffset("b"), 0);
      assert.equal(ctx.getOffset("c"), 1);

      const direct = encodeToBytes(Codec, data);

      const out = new Uint8Array(direct.length);
      const region = new MemoryRegion("test", 0, out.length);
      encodeWithOffsets(Codec, data, out, region);

      assert.deepEqual(Array.from(out), Array.from(direct));
   });
});
