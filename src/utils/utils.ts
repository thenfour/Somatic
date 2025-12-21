export function assert(condition: boolean = true, message: string = "Assertion failed"): asserts condition {
   if (!condition) {
      console.error("Assertion failed:", message);
      throw new Error(message);
   }
};

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);


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


// takes string contents, returns Lua string literal with quotes and escapes.
export function toLuaStringLiteral(str: string): string {
   const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
   return `"${escaped}"`;
};


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
