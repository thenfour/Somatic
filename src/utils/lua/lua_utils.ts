import * as luaparse from "luaparse";
import {LUA_RESERVED_WORDS} from "./lua_ast";

// luaparse doesn't actually output value; correct the type.
export type StringLiteralNode = luaparse.StringLiteral&{value?: string | null};
export type LiteralNode = luaparse.NumericLiteral|StringLiteralNode|luaparse.BooleanLiteral|luaparse.NilLiteral;


// Short name generator (a, b, c, ..., z, aa, ab, ...), skipping Lua reserved words.
export function generateShortName(index: number): string {
   const alphabet = "abcdefghijklmnopqrstuvwxyz";
   let name = "";
   let n = index;
   do {
      name = alphabet[n % 26] + name;
      n = Math.floor(n / 26) - 1;
   } while (n >= 0);
   return name;
}

export function nextFreeName(counter: {value: number}): string {
   while (true) {
      const name = generateShortName(counter.value++);
      if (!LUA_RESERVED_WORDS.has(name))
         return name;
   }
}

export function isStringLiteral(node: luaparse.Expression|undefined|null): node is luaparse.StringLiteral {
   return !!node && node.type === "StringLiteral";
}

export function decodeRawString(raw: string|undefined): string|null {
   if (!raw || raw.length < 2)
      return null;
   // Handle long bracket strings [[...]] (naive but sufficient for folding literals)
   if (raw.startsWith("[[") && raw.endsWith("]]"))
      return raw.slice(2, -2);

   const quote = raw[0];
   const tail = raw[raw.length - 1];
   if ((quote === "\"" || quote === "'") && tail === quote) {
      const inner = raw.slice(1, -1);
      try {
         if (quote === "\"")
            return JSON.parse(raw);
         // Convert single-quoted Lua string to JSON-friendly double-quoted string
         const escaped = inner.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
         return JSON.parse(`"${escaped}"`);
      } catch {
         return null;
      }
   }
   return null;
}

export function stringValue(node: StringLiteralNode): string|null {
   if (typeof node.value === "string")
      return node.value;
   return decodeRawString(node.raw);
}
