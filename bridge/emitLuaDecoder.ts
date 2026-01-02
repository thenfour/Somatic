// Lua decoder code generator for TIC-80 RAM (peek-based) readers.
// Emits a Lua function that decodes a bitpack `Codec` starting at a base address.

import type {Codec, BitSize} from "./bitpack";
import bitpackPreludeLua from "./bitpack.lua";

const BITPACK_BASE_PLACEHOLDER = "__BP_BASE__";

type LuaDecoderOptions = {
   functionName?: string;
   baseArgName?: string;
   returnName?: string;
   includeLayoutComments?: boolean;
   localReaderName?: string;
};

type LayoutEntry = {
   name: string; bitOffset: number; bitSize: BitSize
};

function indent(lines: string, nSpaces: number): string {
   const pad = " ".repeat(nSpaces);
   return lines.split("\n").map((l) => (l.length ? pad + l : l)).join("\n");
}

function emitDecodeExpr(codec: Codec, luaReader: string): string {
   const k = codec.node.kind;
   switch (k) {
      case "u":
         return `${luaReader}.u(${codec.node.n})`;
      case "i":
         return `${luaReader}.i(${codec.node.n})`;
      case "u8":
         return `${luaReader}.align(); ${luaReader}.u(8)`;
      case "i8":
         return `${luaReader}.align(); ${luaReader}.i(8)`;
      case "u16le":
         return `${luaReader}.align(); (${luaReader}.u(8) | (${luaReader}.u(8) << 8))`;
      case "i16le":
         return `(function() ${luaReader}.align(); local u = (${luaReader}.u(8) | (${
            luaReader}.u(8) << 8)); if (u & 0x8000) ~= 0 then return u - 0x10000 else return u end end)()`;
      case "u16be":
         return `${luaReader}.align(); ((${luaReader}.u(8) << 8) | ${luaReader}.u(8))`;
      case "i16be":
         return `(function() ${luaReader}.align(); local u = ((${luaReader}.u(8) << 8) | ${
            luaReader}.u(8)); if (u & 0x8000) ~= 0 then return u - 0x10000 else return u end end)()`;
      case "enum":
         return `${luaReader}.u(${codec.node.nBits})`;
      default:
         throw new Error(`emitLuaDecoder: no expr emitter for codec kind '${k}'`);
   }
}

function emitStatementsForCodec(codec: Codec, targetExpr: string, luaReader: string, returnName: string): string {
   const k = codec.node.kind;
   if (k === "struct") {
      const lines: string[] = [];
      lines.push(`local ${returnName} = {}`);
      for (const it of codec.node.seq as Array<{kind: string; name?: string; codec: Codec;}>) {
         if (it.kind === "field") {
            const sub = it.codec;
            const subKind = sub.node.kind;
            if (subKind === "struct" || subKind === "array") {
               const childVar = `${it.name}`;
               lines.push(`do`);
               lines.push(indent(emitStatementsForCodec(sub, childVar, luaReader, childVar), 2));
               lines.push(indent(`${returnName}.${it.name} = ${childVar}`, 2));
               lines.push(`end`);
            } else {
               lines.push(`${returnName}.${it.name} = ${emitDecodeExpr(sub, luaReader)}`);
            }
         } else {
            const dk = (it as any).codec.node.kind;
            if (dk === "alignToByte")
               lines.push(`${luaReader}.align()`);
            else if (dk === "padBits")
               lines.push(`${luaReader}.u(${(it as any).codec.node.n}) -- pad`);
            else
               throw new Error(`emitLuaDecoder: unsupported directive kind '${dk}'`);
         }
      }
      lines.push(`return ${returnName}`);
      return lines.join("\n");
   }

   if (k === "array") {
      const lines: string[] = [];
      lines.push(`local ${targetExpr} = {}`);
      lines.push(`for i=1,${codec.node.count} do`);
      const elem: Codec = codec.node.elemCodec;
      if (elem.node.kind === "struct" || elem.node.kind === "array") {
         lines.push(indent(`do`, 2));
         lines.push(indent(emitStatementsForCodec(elem, "_tmp", luaReader, "_tmp"), 4));
         lines.push(indent(`${targetExpr}[i] = _tmp`, 4));
         lines.push(indent(`end`, 2));
      } else {
         lines.push(indent(`${targetExpr}[i] = ${emitDecodeExpr(elem, luaReader)}`, 2));
      }
      lines.push(`end`);
      return lines.join("\n");
   }

   throw new Error(`emitLuaDecoder: emitStatementsForCodec only supports struct/array; got ${k}`);
}

function emitLayoutComment(codec: Codec, include: boolean): string {
   if (!include || codec.node.kind !== "struct")
      return "";
   const layout: LayoutEntry[] = codec.node.layout || codec.getLayout?.() || [];
   if (!layout.length)
      return "";
   const lines: string[] = [];
   const name = codec.node.name || "payload";
   lines.push(`-- Layout: ${name}`);
   for (const e of layout) {
      const off = e.bitOffset | 0;
      const sz = e.bitSize;
      const b0 = off;
      const b1 = sz === "variable" ? "?" : (off + sz - 1);
      lines.push(`--   ${String(e.name).padEnd(16)} bits ${String(b0).padStart(4)}..${String(b1).padStart(4)}`);
   }
   return lines.join("\n");
}

function emitLuaPrelude(baseArgName: string): string {
   return bitpackPreludeLua.split(BITPACK_BASE_PLACEHOLDER).join(baseArgName);
}

export function emitLuaDecoder(codec: Codec, opt: LuaDecoderOptions = {}): string {
   const {
      functionName = `decode_${codec.node && codec.node.name ? codec.node.name : "payload"}`,
      baseArgName = "base",
      returnName = "out",
      includeLayoutComments = true,
      localReaderName = "r",
   } = opt;

   if (!codec || !codec.node)
      throw new Error("emitLuaDecoder: codec must be a C.struct(...) or C.array(...) codec");
   if (codec.node.kind !== "struct" && codec.node.kind !== "array")
      throw new Error(`emitLuaDecoder: root codec must be struct/array, got ${codec.node.kind}`);

   const layoutComment = emitLayoutComment(codec, includeLayoutComments);
   const body = `local function ${functionName}(${baseArgName})\n  local ${localReaderName} = _bp_make_reader(${
      baseArgName})\n${indent(emitStatementsForCodec(codec, returnName, localReaderName, returnName), 2)}\nend`;

   const prelude = emitLuaPrelude(baseArgName);
   return [prelude, layoutComment, body].filter(Boolean).join("\n\n") + "\n";
}

export type {LuaDecoderOptions};
