// Build bridge.tic from bridge.lua
// TIC-80 .tic file format: https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
// .tic is a series of chunks
//   - 4-byte header (1 byte type, 2 bytes size, 1 byte reserved) + data
//   - Chunk type 5 = CODE chunk (Lua text)
//
//   ts-node scripts/build-bridge.ts
//   npm run build-bridge

// Add support for importing .lua files as text
import fs from "fs";
(require as any).extensions[".lua"] = (module: any, filename: string) => {
   module.exports = fs.readFileSync(filename, "utf8");
};

import path from "path";
import {BUILD_INFO, getBridgeCartFilename} from "./buildInfo";
import bridgeConfig, {BridgeConfig} from "../bridge/bridge_config";
import {emitLuaDecoder} from "../src/utils/bitpack/emitLuaDecoder";
import {MorphEntryCodec, MORPH_ENTRY_BYTES, MORPH_HEADER_BYTES, SOMATIC_EXTRA_SONG_HEADER_BYTES, SOMATIC_PATTERN_ENTRY_BYTES, SomaticPatternEntryCodec, WaveformMorphGradientCodec,} from "../bridge/morphSchema";
import {SomaticMemoryLayout, Tic80MemoryMap} from "../bridge/memory_layout";

const BRIDGE_LUA_PATH = path.resolve(__dirname, "../bridge/bridge.lua");
const OUTPUT_GENERATED_BRIDGE_LUA_PATH = path.resolve(__dirname, "../temp/bridge-generated.lua");
const OUTPUT_TIC_PATH = path.resolve(__dirname, "../public", getBridgeCartFilename(BUILD_INFO));

// TIC-80 chunk types (subset)
const CHUNK_CODE = 5;

function loadBridgeConfig(): BridgeConfig {
   return bridgeConfig;
}

function escapeLuaString(str: string): string {
   return String(str).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

function jsonToLua(value: unknown, indent: number): string {
   const pad = "\t".repeat(indent);
   const padInner = "\t".repeat(indent + 1);

   if (Array.isArray(value)) {
      if (value.length === 0)
         return "{}";
      const parts = value.map(v => padInner + jsonToLua(v, indent + 1) + ",");
      return "{\n" + parts.join("\n") + "\n" + pad + "}";
   }

   if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0)
         return "{}";
      const parts = entries.map(([key, v]) => {
         const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
         const luaKey = isIdent ? key : `["${escapeLuaString(key)}"]`;
         return padInner + luaKey + " = " + jsonToLua(v, indent + 1) + ",";
      });
      return "{\n" + parts.join("\n") + "\n" + pad + "}";
   }

   if (typeof value === "string") {
      return "\"" + escapeLuaString(value) + "\"";
   }
   if (typeof value === "number") {
      return String(value);
   }
   if (typeof value === "boolean") {
      return value ? "true" : "false";
   }
   if (value == null) {
      return "nil";
   }
   return "nil";
}

function generateLuaAutogenBlock(config: BridgeConfig): string {
   const luaTable = jsonToLua(config, 0);
   const lines: string[] = [];
   lines.push("-- AUTO-GENERATED FROM bridge_config.ts and morphSchema.ts. DO NOT EDIT BY HAND.");
   lines.push("");
   lines.push("local BRIDGE_CONFIG = " + luaTable);
   lines.push("");
   lines.push("-- Memory Constants (generated from memory_layout.ts)");
   lines.push(`local WAVE_BASE = ${Tic80MemoryMap.Waveforms.address}`);
   lines.push(`local SFX_BASE = ${Tic80MemoryMap.Sfx.address}`);
   lines.push(`local PATTERNS_BASE = ${Tic80MemoryMap.MusicPatterns.address}`);
   lines.push(`local TRACKS_BASE = ${Tic80MemoryMap.MusicTracks.address}`);
   lines.push(`local TEMP_BUFFER_A = ${SomaticMemoryLayout.tempBufferA.address}`);
   lines.push(`local TEMP_BUFFER_B = ${SomaticMemoryLayout.tempBufferB.address}`);
   lines.push(`local PATTERN_BUFFER_A = ${SomaticMemoryLayout.patternBufferA.address}`);
   lines.push(`local PATTERN_BUFFER_B = ${SomaticMemoryLayout.patternBufferB.address}`);
   lines.push(`local SOMATIC_SFX_CONFIG = ${SomaticMemoryLayout.somaticSfxConfig.address}`);
   lines.push(`local MARKER_ADDR = ${SomaticMemoryLayout.marker.address}`);
   lines.push(`local REGISTERS_ADDR = ${SomaticMemoryLayout.registers.address}`);
   lines.push(`local INBOX_ADDR = ${SomaticMemoryLayout.inbox.address}`);
   lines.push(`local OUTBOX_ADDR = ${SomaticMemoryLayout.outboxHeader.address}`);
   lines.push(`local LOG_BASE = ${SomaticMemoryLayout.outboxLog.address}`);
   lines.push(`local LOG_SIZE = ${SomaticMemoryLayout.sizes.LOG_BUFFER_SIZE}`);
   lines.push("");
   lines.push("-- Morph schema (generated)");
   lines.push(`local MORPH_HEADER_BYTES = ${MORPH_HEADER_BYTES}`);
   lines.push(`local MORPH_ENTRY_BYTES = ${MORPH_ENTRY_BYTES}`);
   lines.push(`local SOMATIC_EXTRA_SONG_HEADER_BYTES = ${SOMATIC_EXTRA_SONG_HEADER_BYTES}`);
   lines.push(`local SOMATIC_PATTERN_ENTRY_BYTES = ${SOMATIC_PATTERN_ENTRY_BYTES}`);
   lines.push("");
   lines.push(emitLuaDecoder(MorphEntryCodec, {
                 functionName: "decode_MorphEntry",
                 baseArgName: "base",
                 includeLayoutComments: true,
              }).trim());
   lines.push("");
   lines.push(emitLuaDecoder(SomaticPatternEntryCodec, {
                 functionName: "decode_SomaticPatternEntry",
                 baseArgName: "base",
                 includeLayoutComments: true,
              }).trim());
   lines.push("");

   lines.push(emitLuaDecoder(WaveformMorphGradientCodec, {
                 functionName: "decode_WaveformMorphGradient",
                 baseArgName: "base",
                 includeLayoutComments: false,
              }).trim());
   lines.push("");
   return lines.join("\n");
}

function buildTicCart(luaSource: string): Buffer {
   const codeBytes = Buffer.from(luaSource, "utf8");

   // Chunk header: type (1 byte) + size (2 bytes little-endian) + bank (1 byte)
   const chunkHeaderSize = 4;
   const chunkHeader = Buffer.alloc(chunkHeaderSize);
   chunkHeader.writeUInt8(CHUNK_CODE, 0);          // chunk type
   chunkHeader.writeUInt16LE(codeBytes.length, 1); // size (little-endian)
   chunkHeader.writeUInt8(0, 3);                   // bank = 0

   // Combine header + code
   return Buffer.concat([chunkHeader, codeBytes]);
}

function cleanOldBridgeCarts(): void {
   const publicDir = path.resolve(__dirname, "../public");
   const currentName = path.basename(OUTPUT_TIC_PATH);
   if (!fs.existsSync(publicDir))
      return;

   const entries = fs.readdirSync(publicDir, {withFileTypes: true});
   for (const entry of entries) {
      if (!entry.isFile())
         continue;
      const name = entry.name;
      if (name === currentName)
         continue;
      if (name.startsWith("bridge-") && name.endsWith(".tic")) {
         const fullPath = path.join(publicDir, name);
         try {
            fs.unlinkSync(fullPath);
            console.log("[build-bridge] Removed old bridge cart", fullPath);
         } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn("[build-bridge] Failed to remove old bridge cart", fullPath, msg);
         }
      }
   }
}

export function buildBridge(): void {
   console.log("[build-bridge] Reading", BRIDGE_LUA_PATH);

   if (!fs.existsSync(BRIDGE_LUA_PATH)) {
      throw new Error(`bridge.lua not found at ${BRIDGE_LUA_PATH}`);
   }

   const config = loadBridgeConfig();
   const autogen = generateLuaAutogenBlock(config);

   const luaTemplate = fs.readFileSync(BRIDGE_LUA_PATH, "utf8");
   console.log(`[build-bridge] Lua template: ${luaTemplate.length} bytes`);

   const markerStart = "BRIDGE_AUTOGEN_START";
   const markerEnd = "BRIDGE_AUTOGEN_END";
   const startIdx = luaTemplate.indexOf(markerStart);
   const endIdx = luaTemplate.indexOf(markerEnd);
   if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      throw new Error("BRIDGE_AUTOGEN_START/END markers not found or malformed in bridge.lua");
   }

   // We want to preserve the full lines that contain the markers, including
   // the leading "-- ", and replace only the content *between* them.
   const startLineEndIdx = luaTemplate.indexOf("\n", startIdx);
   const before = startLineEndIdx === -1 ? luaTemplate : luaTemplate.slice(0, startLineEndIdx + 1);

   let endLineStartIdx = luaTemplate.lastIndexOf("\n", endIdx);
   if (endLineStartIdx === -1)
      endLineStartIdx = 0;
   else
      endLineStartIdx += 1;
   const after = luaTemplate.slice(endLineStartIdx);

   const luaSource = `${before}\n\n${autogen}\n\n${after}`;
   console.log(`[build-bridge] Lua source (with autogen): ${luaSource.length} bytes`);

   // write out the generated Lua for inspection
   {
      if (!fs.existsSync(path.dirname(OUTPUT_GENERATED_BRIDGE_LUA_PATH))) {
         fs.mkdirSync(path.dirname(OUTPUT_GENERATED_BRIDGE_LUA_PATH), {recursive: true});
      }
      fs.writeFileSync(OUTPUT_GENERATED_BRIDGE_LUA_PATH, luaSource);
      console.log("[build-bridge] Written generated Lua to", OUTPUT_GENERATED_BRIDGE_LUA_PATH);
   }

   const ticCart = buildTicCart(luaSource);
   console.log(`[build-bridge] TIC cart: ${ticCart.length} bytes`);

   const outputDir = path.dirname(OUTPUT_TIC_PATH);
   if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, {recursive: true});
   }
   // Remove any older bridge-*.tic so public/ (and thus dist/) stays clean.
   cleanOldBridgeCarts();

   fs.writeFileSync(OUTPUT_TIC_PATH, ticCart);
   console.log("[build-bridge] Written", OUTPUT_TIC_PATH);
}

// direct execution...
if (require.main === module) {
   try {
      buildBridge();
      console.log("[build-bridge] Success!");
   } catch (err) {
      console.error("[build-bridge] Error:", err);
      process.exit(1);
   }
}

export default buildBridge;
