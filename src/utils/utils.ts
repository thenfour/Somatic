export function assert(condition: boolean = true, message: string = "Assertion failed") {
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