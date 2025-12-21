import {compareBuffers} from "../utils/utils";

// Run-length encode the input data; return shortened output.
export function RLEncode(input: Uint8Array): Uint8Array {
   const output: number[] = [];
   let i = 0;

   while (i < input.length) {
      const value = input[i];
      let runLength = 1;

      // Count consecutive identical bytes (max run length 255)
      while (i + runLength < input.length && input[i + runLength] === value && runLength < 255) {
         runLength++;
      }

      // Emit run: [length, value]
      output.push(runLength);
      output.push(value);

      i += runLength;
   }

   return new Uint8Array(output);
}

export function RLEDecode(input: Uint8Array): Uint8Array {
   const output: number[] = [];
   let i = 0;

   while (i < input.length - 1) {
      const runLength = input[i];
      const value = input[i + 1];

      // Emit 'runLength' copies of 'value'
      for (let j = 0; j < runLength; j++) {
         output.push(value);
      }

      i += 2;
   }

   return new Uint8Array(output);
}

// Run-length encode 3-byte cells: [b0,b1,b2] repeated.
// Input length MUST be a multiple of 3.
export function RLEncodeTriplets(input: Uint8Array): Uint8Array {
   if (input.length % 3 !== 0) {
      throw new Error(`RLEncodeTriplets: input length ${input.length} not multiple of 3`);
   }

   const output: number[] = [];
   const n = input.length;
   let i = 0;

   while (i < n) {
      const b0 = input[i];
      const b1 = input[i + 1];
      const b2 = input[i + 2];

      let runLength = 1;

      // Count how many times this triplet repeats (max 255)
      while (i + runLength * 3 < n && runLength < 255 && input[i + runLength * 3] === b0 &&
             input[i + runLength * 3 + 1] === b1 && input[i + runLength * 3 + 2] === b2) {
         runLength++;
      }

      // Emit run: [runLength, b0, b1, b2]
      output.push(runLength & 0xff, b0 & 0xff, b1 & 0xff, b2 & 0xff);

      i += runLength * 3;
   }

   return new Uint8Array(output);
}


// Decode 3-byte-cell RLE into a fixed number of cells.
export function RLEDecodeTriplets(
   input: Uint8Array,
   expectedLength: number,
   ): Uint8Array {
   const output = new Uint8Array(expectedLength);
   const n = input.length;

   if (n % 4 !== 0) {
      throw new Error(`RLEDecodeTriplets: input length ${n} not multiple of 4`);
   }

   let i = 0;   // index in encoded stream
   let out = 0; // index in output bytes

   while (i < n) {
      const runLength = input[i]; // 0..255
      const b0 = input[i + 1];
      const b1 = input[i + 2];
      const b2 = input[i + 3];
      i += 4;

      if (runLength === 0) {
         throw new Error("RLEDecodeTriplets: zero-length run");
      }

      for (let r = 0; r < runLength; r++) {
         if (out + 3 > output.length) {
            throw new Error(
               `RLEDecodeTriplets: decoded too much data (out=${out}, len=${output.length})`,
            );
         }
         output[out++] = b0;
         output[out++] = b1;
         output[out++] = b2;
      }
   }

   if (out !== output.length) {
      throw new Error(
         `RLEDecodeTriplets: decoded length ${out} != expected ${output.length}`,
      );
   }

   return output;
}

export function toBase64(data: Uint8Array): string {
   let binary = "";
   for (let i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
   }
   return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
   const binary = atob(base64);
   const len = binary.length;
   const bytes = new Uint8Array(len);
   for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
   }
   return bytes;
}


// Custom ASCII85-style base85: digits 0..84 map to chars 33..117 ('!'..'u')
const BASE85_RADIX = 85;
const BASE85_OFFSET = 33; // '!' in ASCII

export function base85Encode(data: Uint8Array): string {
   let out = "";
   const n = data.length;

   for (let i = 0; i < n; i += 4) {
      const b0 = data[i] ?? 0;
      const b1 = data[i + 1] ?? 0;
      const b2 = data[i + 2] ?? 0;
      const b3 = data[i + 3] ?? 0;

      // avoid signed-int32 behavior from bitwise ops
      let v = b0 * 2 ** 24 + b1 * 2 ** 16 + b2 * 2 ** 8 + b3; // 0..2^32-1

      const digits = new Array<number>(5);
      for (let d = 4; d >= 0; d--) {
         digits[d] = v % 85;
         v = Math.floor(v / 85);
      }

      for (let d = 0; d < 5; d++) {
         out += String.fromCharCode(33 + digits[d]);
      }
   }

   return out;
}

export function base85Decode(str: string, expectedLength: number): Uint8Array {
   if (str.length % 5 !== 0) {
      throw new Error(`base85Decode: input length ${str.length} is not a multiple of 5`);
   }

   const tmp: number[] = [];
   const groups = str.length / 5;
   let idx = 0;

   for (let g = 0; g < groups; g++) {
      let v = 0;

      for (let d = 0; d < 5; d++) {
         const code = str.charCodeAt(idx++);
         const digit = code - BASE85_OFFSET;
         if (digit < 0 || digit >= BASE85_RADIX) {
            throw new Error(`base85Decode: invalid base85 char '${str[idx - 1]}' at index ${idx - 1}`);
         }
         v = v * BASE85_RADIX + digit;
      }

      // Unpack 32-bit value into 4 bytes
      const b0 = (v >>> 24) & 0xff;
      const b1 = (v >>> 16) & 0xff;
      const b2 = (v >>> 8) & 0xff;
      const b3 = v & 0xff;

      tmp.push(b0, b1, b2, b3);
   }

   // Trim padding to the expected raw byte length
   if (expectedLength > tmp.length) {
      throw new Error(
         `base85Decode: expectedLength ${expectedLength} > decoded length ${tmp.length}`,
      );
   }

   return new Uint8Array(tmp.slice(0, expectedLength));
}


// string is a series of hexadecimal byte values separated by spaces
export function TestBase85Encoding(payload: string|number[]) {
   console.log(`TestBase85Encoding input:`, payload);
   if (typeof payload === "string") {
      payload = payload.split(" ").map(byteStr => parseInt(byteStr, 16));
   }
   const input = new Uint8Array(payload);
   const encoded = base85Encode(input);
   console.log(` -> Encoded:`, encoded);
   const decoded = base85Decode(encoded, input.length);
   const result = compareBuffers(input, decoded);
   console.log(`TestBase85Encoding:`, result);
}


// LZ tune for
// * window size (max dist) (smaller = smaller decoder); prob around 16.
// * minimum match length (there's a sweet spot between backrefs & literals -- probably 3 or 4)
// * max len -- there's diminishing returns after a certain point but doesn't matter much. probably around 18-20.
// *

export interface LZConfig {
   windowSize: number;     // how far back matches can refer (e.g. 16..4096)
   minMatchLength: number; // emit a match only if >= this (e.g. 3..6)
   maxMatchLength: number; // cap match length (e.g. 18..258)
   useRLE: boolean;        // enable 0x81 opcode (repeat byte)
}

/** ---- Varint (unsigned LEB128) ---- */
function writeVarint(out: number[], x: number) {
   // x must be >= 0 and <= 2^31-ish; good enough for asset sizes
   while (x >= 0x80) {
      out.push((x & 0x7f) | 0x80);
      x >>>= 7;
   }
   out.push(x);
}

function readVarint(data: Uint8Array, i: number): {value: number; next: number} {
   let x = 0;
   let shift = 0;
   while (true) {
      if (i >= data.length)
         throw new Error("truncated varint");
      const b = data[i++];
      x |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0)
         break;
      shift += 7;
      if (shift > 35)
         throw new Error("varint too large");
   }
   return {value: x >>> 0, next: i};
}

/** Roughly how many bytes a varint would take (for cheap cost comparisons). */
function varintSize(x: number): number {
   let n = 1;
   while (x >= 0x80) {
      n++;
      x >>>= 7;
   }
   return n;
}

/** ---- Decompress ---- */
export function lzDecompress(encoded: Uint8Array): Uint8Array {
   const out: number[] = [];
   let i = 0;

   while (i < encoded.length) {
      const tag = encoded[i++];

      if (tag === 0x00) {
         const r = readVarint(encoded, i);
         i = r.next;
         const len = r.value;
         if (i + len > encoded.length)
            throw new Error("truncated literal run");
         for (let j = 0; j < len; j++)
            out.push(encoded[i++]);
      } else if (tag === 0x80) {
         const rl = readVarint(encoded, i);
         i = rl.next;
         const rd = readVarint(encoded, i);
         i = rd.next;
         const len = rl.value;
         const dist = rd.value;

         if (dist <= 0 || dist > out.length)
            throw new Error("invalid match distance");
         for (let j = 0; j < len; j++) {
            out.push(out[out.length - dist]);
         }
      } else if (tag === 0x81) {
         const rl = readVarint(encoded, i);
         i = rl.next;
         const len = rl.value;
         if (i >= encoded.length)
            throw new Error("truncated rle");
         const v = encoded[i++];
         for (let j = 0; j < len; j++)
            out.push(v);
      } else {
         throw new Error(`unknown tag 0x${tag.toString(16)}`);
      }
   }

   return Uint8Array.from(out);
}

// note that the playroutine's LZ decoder may need to be modified if this changes.
// for example it does NOT support RLE (0x81) opcodes.
// Also the window size affects decoder memory usage.
export const gSomaticLZDefaultConfig: LZConfig = {
   windowSize: 16,
   minMatchLength: 4,
   maxMatchLength: 30,
   useRLE: false,
};

/** ---- Compress (greedy) ---- */
export function lzCompress(input: Uint8Array, cfg: LZConfig): Uint8Array {
   const {
      windowSize,
      minMatchLength,
      maxMatchLength,
      useRLE,
   } = cfg;

   if (windowSize < 1)
      throw new Error("windowSize must be >= 1");
   if (minMatchLength < 2)
      throw new Error("minMatchLength should be >= 2 (usually 3)");
   if (maxMatchLength < minMatchLength)
      throw new Error("maxMatchLength must be >= minMatchLength");

   const out: number[] = [];
   const lits: number[] = [];

   function flushLits() {
      if (lits.length === 0)
         return;
      out.push(0x00);
      writeVarint(out, lits.length);
      out.push(...lits);
      lits.length = 0;
   }

   function emitMatch(len: number, dist: number) {
      out.push(0x80);
      writeVarint(out, len);
      writeVarint(out, dist);
   }

   function emitRLE(len: number, value: number) {
      out.push(0x81);
      writeVarint(out, len);
      out.push(value);
   }

   // Estimate encoded size of candidates (to choose between LZ vs RLE vs literals).
   const matchCost = (len: number, dist: number) => 1 + varintSize(len) + varintSize(dist); // 0x80 + len + dist
   const rleCost = (len: number) => 1 + varintSize(len) + 1;                                // 0x81 + len + value
   const litCost = (len: number) => 1 + varintSize(len) + len;                              // 0x00 + len + bytes

   let i = 0;
   while (i < input.length) {
      // Optional: detect RLE run at i
      let rleLen = 0;
      if (useRLE) {
         const v = input[i];
         let k = i + 1;
         const cap = Math.min(input.length, i + maxMatchLength);
         while (k < cap && input[k] === v)
            k++;
         rleLen = k - i;
      }

      // Find best LZ match (greedy longest within window, capped)
      let bestLen = 0;
      let bestDist = 0;

      const maxDist = Math.min(windowSize, i);
      const maxLenCap = Math.min(maxMatchLength, input.length - i);

      // Simple brute-force search. For tuning/testing this is fine.
      for (let dist = 1; dist <= maxDist; dist++) {
         let len = 0;
         // Compare input[i + len] vs input[i + len - dist]
         while (len < maxLenCap && input[i + len] === input[i + len - dist])
            len++;
         if (len > bestLen) {
            bestLen = len;
            bestDist = dist;
            if (bestLen === maxLenCap)
               break; // can't do better
         }
      }

      const canMatch = bestLen >= minMatchLength;
      const canRLE = useRLE && rleLen >= minMatchLength;

      if (!canMatch && !canRLE) {
         // literal byte
         lits.push(input[i++]);
         // optional: keep literals from growing too huge (not necessary, but keeps memory tame)
         if (lits.length >= 1 << 15)
            flushLits();
         continue;
      }

      // Choose best operation by cost-per-byte-saved. We'll compare:
      // - LZ match candidate (if any)
      // - RLE candidate (if any)
      // - otherwise literals
      //
      // For fairness, we compare costs for encoding exactly N bytes of output.
      // For LZ, N = bestLen; for RLE, N = rleLen.
      //
      // If both exist, we can also clamp to the same N and compare, but
      // typically you want the op that encodes MORE bytes cheaply.
      let choose: "LZ"|"RLE"|"LIT" = "LIT";
      let useLen = 1;

      // Start with "literal run" as baseline (encode next byte as literal; we'll accumulate)
      let bestScore = Infinity;

      if (canMatch) {
         const len = Math.min(bestLen, maxLenCap);
         const cost = matchCost(len, bestDist);
         const score = cost / len; // lower is better
         bestScore = score;
         choose = "LZ";
         useLen = len;
      }

      if (canRLE) {
         const len = Math.min(rleLen, maxLenCap);
         const cost = rleCost(len);
         const score = cost / len;
         // Prefer RLE if it wins on score, or ties but is longer (often helps)
         if (score < bestScore || (score === bestScore && len > useLen)) {
            bestScore = score;
            choose = "RLE";
            useLen = len;
         }
      }

      // Emit chosen op
      flushLits();
      if (choose === "LZ") {
         emitMatch(useLen, bestDist);
         i += useLen;
      } else if (choose === "RLE") {
         emitRLE(useLen, input[i]);
         i += useLen;
      } else {
         // Shouldn't happen given canMatch/canRLE checks, but keep safe:
         lits.push(input[i++]);
      }
   }

   flushLits();
   return Uint8Array.from(out);
}
