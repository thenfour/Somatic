
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

      // Pack 4 bytes into one 32-bit unsigned value
      let v = ((b0 << 24) >>> 0) | ((b1 << 16) >>> 0) | ((b2 << 8) >>> 0) | (b3 >>> 0);

      // Convert to 5 base85 digits (most significant first)
      const digits = new Array<number>(5);
      for (let d = 4; d >= 0; d--) {
         digits[d] = v % BASE85_RADIX;
         v = Math.floor(v / BASE85_RADIX);
      }

      // Map digits to ASCII chars
      for (let d = 0; d < 5; d++) {
         out += String.fromCharCode(BASE85_OFFSET + digits[d]);
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
            throw new Error(`base85Decode: invalid base85 char '${str[d]}' at index ${idx - 1}`);
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
