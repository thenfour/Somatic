export function assert(condition: boolean = true, message: string = "Assertion failed"): asserts condition {
   if (!condition) {
      console.error("Assertion failed:", message);
      throw new Error(message);
   }
};

export function lerp(a: number, b: number, t: number): number {
   return a + (b - a) * t;
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
   const eol = src.includes("\r\n") ? "\r\n" : "\n";
   const normalizeEol = (s: string) => s.replace(/\r?\n/g, eol);
   const replacementNorm = normalizeEol(replacement);

   let out = src;
   let searchFrom = 0;
   while (true) {
      const span = findNextLuaBlockSpan(out, beginMarker, endMarker, searchFrom, true);
      if (!span)
         break;

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
