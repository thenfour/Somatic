export const kNullKey = "__NULL__";

// situation:
// const arr = ["a","b","c"] as const;
// const query : string = getUserResponse();
// arr.includes(query) -> type error because query is string, not "a"|"b"|"c"
//
export function includesOf<const A extends readonly unknown[]>(arr: A, value: unknown): value is A[number] {
   return (arr as readonly unknown[]).includes(value);
}


// result stuff
export type Ok<T> = {
   ok: true; value: T
};
export type Err = {
   ok: false; error: string
};
export type Result<T> = Ok<T>|Err;

export function ok<T>(value: T): Ok<T> {
   return {ok: true, value};
}

export function err<T = never>(error: string): Result<T> {
   return {ok: false, error};
}


export function assert(condition: boolean = true, message: string = "Assertion failed"): asserts condition {
   if (!condition) {
      console.error("Assertion failed:", message);
      throw new Error(message);
   }
};

export function lerp(a: number, b: number, t: number): number {
   return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
   if (a === b)
      return 0;
   return (v - a) / (b - a);
}

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const clamp01 = (v: number) => clamp(v, 0, 1);

export function IsNullOrWhitespace(str: string|null|undefined): boolean {
   return str === null || str === undefined || str.trim().length === 0;
}

export function TryParseInt(value: any): number|null {
   if (typeof value === "number" && isFinite(value)) {
      return Math.floor(value);
   }
   if (typeof value === "string") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
         return parsed;
      }
   }
   return null;
};

// you can't just do "value ?? defaultValue" because that treats false as nullish.
export function CoalesceBoolean(value: boolean|null|undefined, defaultValue: boolean): boolean {
   if (value === null || value === undefined) {
      return defaultValue;
   }
   return value;
}

export interface FingerprintResult {
   checksum: number;
   length: number;
   firstBytes: string;
}

export function getBufferFingerprint(buf: Uint8Array, length = 16): FingerprintResult {
   let checksum = 0;
   for (let i = 0; i < buf.length; i++) {
      checksum += buf[i];
   }
   const firstBytes = Array.from(buf.slice(0, length)).map(b => b.toString(16).padStart(2, "0")).join(" ");
   return {
      checksum,
      length: buf.length,
      firstBytes,
   };
}


/**
 * Convert polar coordinates (angle in degrees, 0° at top, CW positive)
 * to cartesian SVG coordinates.
 */
export function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number) {
   const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
   return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
   };
}


// takes string contents, returns Lua string literal with quotes and escapes.
export function toLuaStringLiteral(str: string): string {
   const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
   return `"${escaped}"`;
};


// Replace one or more Lua "blocks" delimited by begin/end marker lines.
// - Markers are matched as substrings within their lines (so callers can pass "-- BEGIN_BLARG").
// - The entire block (including marker lines and inner contents) is replaced with `replacement`.
type LuaBlockSpan = {
   eol: string; beginLineStart0: number; innerStart: number; endLineStart0: number; blockEnd: number;
   nextSearchFrom: number;
};

function findNextLuaBlockSpan(
   src: string,
   beginMarker: string,
   endMarker: string,
   searchFrom: number,
   strict: boolean,
   ): LuaBlockSpan|null {
   const eol = src.includes("\r\n") ? "\r\n" : "\n";

   const beginIdx = src.indexOf(beginMarker, searchFrom);
   if (beginIdx < 0)
      return null;

   const beginLineStart = Math.max(0, src.lastIndexOf(eol, beginIdx));
   const beginLineStart0 = (beginLineStart === 0) ? 0 : beginLineStart + eol.length;
   const beginLineEnd = src.indexOf(eol, beginIdx);
   const innerStart = (beginLineEnd < 0) ? src.length : beginLineEnd + eol.length;

   const endIdx = src.indexOf(endMarker, innerStart);
   if (endIdx < 0) {
      if (strict) {
         assert(false, `replaceLuaBlock: end marker not found: ${endMarker}`);
      }
      return null;
   }

   const endLineStart = Math.max(0, src.lastIndexOf(eol, endIdx));
   const endLineStart0 = (endLineStart === 0) ? 0 : endLineStart + eol.length;
   const endLineEnd = src.indexOf(eol, endIdx);
   const blockEnd = (endLineEnd < 0) ? src.length : endLineEnd + eol.length;

   return {
      eol,
      beginLineStart0,
      innerStart,
      endLineStart0,
      blockEnd,
      nextSearchFrom: beginLineStart0,
   };
}

export function replaceLuaBlock(
   src: string,
   beginMarker: string,
   endMarker: string,
   replacement: string,
   ): string {
   let out = src;
   let searchFrom = 0;
   while (true) {
      const span = findNextLuaBlockSpan(out, beginMarker, endMarker, searchFrom, true);
      if (!span)
         break;

      // Normalize line endings to match the surrounding source.
      // If the replaced block was followed by more content, ensure the replacement ends with EOL
      // so the last replacement line doesn't get merged into the following line.
      let replacementNorm = replacement.replace(/\r?\n/g, span.eol);
      if (replacementNorm.length > 0 && !replacementNorm.endsWith(span.eol) && span.blockEnd < out.length) {
         replacementNorm += span.eol;
      }

      out = out.slice(0, span.beginLineStart0) + replacementNorm + out.slice(span.blockEnd);
      searchFrom = span.beginLineStart0 + replacementNorm.length;
   }

   return out;
}

export type ExtractedLuaBlock = {
   placeholder: string; content: string;
};

// Extract blocks delimited by begin/end markers and replace them with placeholders.
// Similar scanning semantics to replaceLuaBlock(), but captures inner content for reinsertion.
export function extractLuaBlocks(
   src: string,
   beginMarker: string,
   endMarker: string,
   placeholderFactory: (index: number) => string,
   options?: {strict?: boolean},
   ): {code: string; blocks: ExtractedLuaBlock[]} {
   const strict = options?.strict ?? false;
   const blocks: ExtractedLuaBlock[] = [];

   let out = src;
   let searchFrom = 0;
   let i = 0;

   while (true) {
      const span = findNextLuaBlockSpan(out, beginMarker, endMarker, searchFrom, strict);
      if (!span)
         break;

      const content = out.slice(span.innerStart, span.endLineStart0);
      const placeholder = placeholderFactory(i);
      const replacement = placeholder + span.eol;

      blocks.push({placeholder, content});
      out = out.slice(0, span.beginLineStart0) + replacement + out.slice(span.blockEnd);
      searchFrom = span.beginLineStart0 + replacement.length;
      i++;
   }

   return {code: out, blocks};
}


// Remove any Lua lines that contain one of the specified marker substrings.
// Useful for stripping marker comments while leaving surrounding code untouched.
export function removeLuaBlockMarkers(src: string, markers: string[]): string {
   if (markers.length === 0)
      return src;

   const eol = src.includes("\r\n") ? "\r\n" : "\n";
   const lines = src.split(/\r?\n/);
   const filtered = lines.filter(line => !markers.some(m => m && line.includes(m)));
   return filtered.join(eol);
}


export interface CompareResult {
   match: boolean;
   lengthA: number;
   lengthB: number;
   firstMismatchIndex: number;
   description: string;
}
export function compareBuffers(bufA: Uint8Array, bufB: Uint8Array): CompareResult {
   const lengthA = bufA.length;
   const lengthB = bufB.length;
   if (lengthA !== lengthB) {
      return {
         match: false,
         lengthA,
         lengthB,
         firstMismatchIndex: -1,
         description: `Length mismatch: A=${lengthA}, B=${lengthB}`,
      };
   }
   for (let i = 0; i < lengthA; i++) {
      if (bufA[i] !== bufB[i]) {
         return {
            match: false,
            lengthA,
            lengthB,
            firstMismatchIndex: i,
            description: `Data mismatch at index ${i}: A=${bufA[i]}, B=${bufB[i]}`,
         };
      }
   }
   return {
      match: true,
      lengthA,
      lengthB,
      firstMismatchIndex: -1,
      description: `Buffers match, length=${lengthA}`,
   };
}


export const CharMap = {
   UpTriangle: "▲",
   DownTriangle: "▼",
   LeftTriangle: "◀",
   RightTriangle: "▶",
   UpTriangleOutlined: "△",
   DownTriangleOutlined: "▽",
   LeftTriangleOutlined: "◁",
   RightTriangleOutlined: "▷",
   Mul: "×",
   Div: "÷",
   PlusMinus: "±",
   Plus: "+",
   Minus: "−",
   Check: "✔",
   Cross: "✘",
   Bullet: "•",
   BoldSixPointedAsterisk: "🞷",
   Refresh: "↻",
   OverlappingSquares: "⧉",
   UpArrow: "⬆",
   DownArrow: "⬇",
   LeftArrow: "⬅",
   RightArrow: "➡",
   UpDown: "↕",
   Flag: "⚑",
};


export const formatBytes = (n: number|null) => {
   if (n == null)
      return "...";
   if (n < 1024)
      return `${n} B`;
   if (n < 1024 * 1024)
      return `${(n / 1024).toFixed(1)} KB`;
   return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};


export const inclusiveRangeStartEnd = (start: number, end: number): number[] => {
   const lower = Math.min(start, end);
   const upper = Math.max(start, end);
   const length = Math.max(upper - lower + 1, 0);
   return Array.from({length}, (_, idx) => lower + idx);
};



export const numericRange = (start: number, length: number): number[] => {
   return Array.from({length}, (_, idx) => start + idx);
};



export type Coord2D = {
   x: number; //
   y: number
};

export type Size2D = {
   width: number;  //
   height: number; //
};

export type Rect2D = {
   start: Coord2D; //
   size: Size2D;   // can be negative
};

export function signNonZero(x: number): 1|- 1 {
   return x >= 0 ? 1 : -1;
}



export type RelativeUnit = "second(s)"|"minute(s)"|"hour(s)"|"day(s)"|"week(s)"|"month(s)"|"year(s)";

/**
 * Turn a date into a short, human-readable description relative to now
 * (e.g. "3 minutes ago", "in 2 hours", "just now").
 */
export const formatRelativeToNow = (value: Date, now: Date = new Date()): string => {
   if (!Number.isFinite(value.getTime()))
      return "";

   const diffMs = value.getTime() - now.getTime();
   const absMs = Math.abs(diffMs);
   const isFuture = diffMs > 0;

   const sec = 1000;
   const min = 60 * sec;
   const hour = 60 * min;
   const day = 24 * hour;
   const week = 7 * day;
   const month = 30 * day; // rough but good enough for a relative hint
   const year = 365 * day;

   // Very close to now
   if (absMs < 5 * sec)
      return "just now";

   let unit: RelativeUnit;
   let valueAbs: number;

   if (absMs < min) {
      unit = "second(s)";
      valueAbs = Math.round(absMs / sec);
   } else if (absMs < hour) {
      unit = "minute(s)";
      valueAbs = Math.round(absMs / min);
   } else if (absMs < day) {
      unit = "hour(s)";
      valueAbs = Math.round(absMs / hour);
   } else if (absMs < week) {
      unit = "day(s)";
      valueAbs = Math.round(absMs / day);
   } else if (absMs < month) {
      unit = "week(s)";
      valueAbs = Math.round(absMs / week);
   } else if (absMs < year) {
      unit = "month(s)";
      valueAbs = Math.round(absMs / month);
   } else {
      unit = "year(s)";
      valueAbs = Math.round(absMs / year);
   }

   return isFuture ? `in ${valueAbs} ${unit}` : `${valueAbs} ${unit} ago`;
};


export function SanitizeFilename(name: string, nameIfEmpty: string): string {
   // make name work on all platforms
   // https://stackoverflow.com/questions/1976007/what-characters-are-forbidden-in-windows-and-linux-directory-names
   const sanitized = name.replace(/[\/\\?%*:|"<>]/g, "_").trim();
   return sanitized.length > 0 ? sanitized : nameIfEmpty;
}


// Matches if all space-separated tokens appear sequentially (case-insensitive) in the text.
// e.g., "y ow" matches "PLAY CURRENT ROW" because "y" appears, then later "ow" appears.
// all tokens much match to return true.
export function matchesFilter(text: string, filter: string): boolean {
   if (!filter.trim())
      return true;
   const tokens = filter.toLowerCase().split(/\s+/).filter(t => t.length > 0);
   const lowerText = text.toLowerCase();
   let pos = 0;
   for (const token of tokens) {
      const idx = lowerText.indexOf(token, pos);
      if (idx === -1)
         return false;
      pos = idx + token.length;
   }
   return true;
}


// Parse a memory address-like-value ("0x14e24" string, or number)
export function parseAddress(value: string|number): number {
   if (typeof value === "number")
      return value;
   const trimmed = value.trim();
   if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      return parseInt(trimmed, 16);
   }
   const n = Number(trimmed);
   if (!Number.isFinite(n)) {
      throw new Error(`Invalid memory address: ${value}`);
   }
   return n;
}


export function typedEntries<K extends PropertyKey, V>( //
   obj: Record<K, V>): Array<[K, V]> {                  //
   return Object.entries(obj) as Array<[K, V]>;
}

export function typedKeys<K extends PropertyKey, V>(
   //
   obj: Record<K, V> //
   ): K[] {
   return Object.keys(obj) as K[];
}

export function typedValues<K extends PropertyKey, V>(
   //
   obj: Record<K, V> //
   ): V[] {
   return Object.values(obj) as V[];
}

// converts entries to a Record-ish object.
export function typedFromEntries<K extends PropertyKey, V>(entries: readonly(readonly[K, V])[]): Record<K, V> {
   return Object.fromEntries(entries as readonly(readonly[PropertyKey, unknown])[]) as Record<K, V>;
}

// gets a typed value from a Record-like; myobj[key] returns proper type.
export function typedGet<K extends PropertyKey, V>(obj: Record<K, V>, key: K): V {
   return obj[key];
}


// t in [0,1], k in [-1,1]
// k=0 -> linear
// k>0 -> slow start, fast end (ease-in)
// k<0 -> fast start, slow end (ease-out) as the complementary mirror of k>0
// S controls the steepness of the curve
export function curveT(t: number, k: number, s: number = 4): number {
   if (t <= 0)
      return 0;
   if (t >= 1)
      return 1;
   if (k === 0)
      return t;

   const kk = clamp(k, -1, 1);
   const a = (x: number) => Math.pow(2, s * x);

   if (kk > 0) {
      return Math.pow(t, a(kk));
   } else {
      // complementary mirror
      return 1 - Math.pow(1 - t, a(-kk));
   }
}

// Escape special characters in a string for use in a RegExp
export function escapeRegExp(s: string): string {
   return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* FNV-1a 32-bit hash of a JS string (UTF-16 code units). Deterministic, fast. */
export function hash32Fnv1a(str: string): number {
   let h = 0x811c9dc5; // offset basis
   for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      // h *= 16777619 (FNV prime) expressed via shifts to stay 32-bit
      h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
   }
   return h >>> 0;
}

/* 32-bit avalanche mixer
scrambles bits so that small input changes produce large, unpredictable output changes.
 */
export function mix32(x: number): number {
   x ^= x >>> 16;
   x = Math.imul(x, 0x7feb352d) >>> 0;
   x ^= x >>> 15;
   x = Math.imul(x, 0x846ca68b) >>> 0;
   x ^= x >>> 16;
   return x >>> 0;
}

// Xorshift32 PRNG
export function xorshift32(seedU32: number): () => number {
   let x = seedU32 >>> 0;
   if (x === 0)
      x = 0x6d2b79f5;
   return () => {
      x ^= (x << 13) >>> 0;
      x ^= (x >>> 17) >>> 0;
      x ^= (x << 5) >>> 0;
      return x >>> 0;
   };
}

// Generate a consistent HSL hue string from an input string.
export function getHashCSSHue(str: string): string {
   const base = hash32Fnv1a(str);

   const h1 = mix32(base);

   const hue = h1 % 360;
   return `${hue}`;
}

export type HueAssignment = Record<string, number>;

/* Assign hues evenly across [0,360) for the given keys. */
export function assignEvenHues(keys: readonly string[]): HueAssignment {
   const items = keys.map((k) => ({k, h: hash32Fnv1a(k)}));
   items.sort((a, b) => a.h - b.h);

   const n = Math.max(1, items.length);
   const out: HueAssignment = {};
   for (let i = 0; i < items.length; i++) {
      // +0.5 puts hues in the middle of their "slice"
      const hue = ((i + 0.5) / n) * 360;
      out[items[i].k] = hue;
   }
   return out;
}

//
export function secondsToTicks(seconds: number, tickRateHz: number): number {
   return Math.round(seconds * tickRateHz);
}

export function ticksToSeconds(ticks: number, tickRateHz: number): number {
   return ticks / tickRateHz;
}

export function secondsTo60HzFrames(seconds: number): number {
   return secondsToTicks(seconds, 60);
}

export function frames60HzToSeconds(frames: number): number {
   return ticksToSeconds(frames, 60);
}


/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function clampByte(v: number): number {
   return Math.max(0, Math.min(255, v | 0));
}

export function readAscii(bytes: Uint8Array, offset: number, length: number): string {
   const end = Math.min(bytes.length, offset + length);
   let s = "";
   for (let i = offset; i < end; i++) {
      const b = bytes[i] ?? 0;
      if (b === 0)
         break;
      s += String.fromCharCode(b & 0x7f);
   }
   return s;
}

export function readU16BE(bytes: Uint8Array, offset: number): number {
   const hi = bytes[offset] ?? 0;
   const lo = bytes[offset + 1] ?? 0;
   return ((hi & 0xff) << 8) | (lo & 0xff);
}


export function pcmI8FromU8(pcmU8: Uint8Array, copy: boolean): Int8Array {
   if (copy) {
      // Copy into a fresh Int8Array, preserving the same bit pattern.
      const i8 = new Int8Array(pcmU8.length);
      for (let i = 0; i < pcmU8.length; i++) {
         // reinterpret u8 byte as signed
         const v = pcmU8[i] ?? 0;
         i8[i] = (v << 24) >> 24;
      }
      return i8;
   }

   // View into the same underlying buffer. Safe as long as pcmU8 is backed by an ArrayBuffer.
   return new Int8Array(pcmU8.buffer, pcmU8.byteOffset, pcmU8.byteLength);
}

export function pcmF32FromI8(pcmI8: Int8Array): Float32Array {
   // Normalize signed 8-bit PCM to [-1, 1]. divide by 128 so that -128 maps to -1.
   const f32 = new Float32Array(pcmI8.length);
   for (let i = 0; i < pcmI8.length; i++) {
      f32[i] = (pcmI8[i] ?? 0) / 128;
   }
   return f32;
}
