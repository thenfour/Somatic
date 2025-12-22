// Build bridge.tic from bridge.lua
// TIC-80 .tic file format: https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
// .tic is a series of chunks
//   - 4-byte header (1 byte type, 2 bytes size, 1 byte reserved) + data
//   - Chunk type 5 = CODE chunk (Lua text)
//
//   node scripts/build-bridge.js
//   npm run build-bridge


const fs = require('fs');
const path = require('path');
const { parseJSONWithComments } = require('./jsonc-utils');

const BRIDGE_LUA_PATH = path.resolve(__dirname, '../bridge/bridge.lua');
const BRIDGE_CONFIG_JSONC_PATH = path.resolve(__dirname, '../bridge/bridge_config.jsonc');
const OUTPUT_GENERATED_BRIDGE_LUA_PATH = path.resolve(__dirname, '../temp/bridge-generated.lua');
const OUTPUT_TIC_PATH = path.resolve(__dirname, '../public/bridge.tic');

// TIC-80 chunk types (subset)
const CHUNK_CODE = 5;

function loadBridgeConfig() {
    if (!fs.existsSync(BRIDGE_CONFIG_JSONC_PATH)) {
        throw new Error(`bridge_config.jsonc not found at ${BRIDGE_CONFIG_JSONC_PATH}`);
    }
    const raw = fs.readFileSync(BRIDGE_CONFIG_JSONC_PATH, 'utf8');
    return parseJSONWithComments(raw);
}

function escapeLuaString(str) {
    return String(str)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r");
}

function jsonToLua(value, indent) {
    const pad = '\t'.repeat(indent);
    const padInner = '\t'.repeat(indent + 1);

    if (Array.isArray(value)) {
        if (value.length === 0) return '{}';
        const parts = value.map(v => padInner + jsonToLua(v, indent + 1) + ',');
        return '{\n' + parts.join('\n') + '\n' + pad + '}';
    }

    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return '{}';
        const parts = entries.map(([key, v]) => {
            const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
            const luaKey = isIdent ? key : `["${escapeLuaString(key)}"]`;
            return padInner + luaKey + ' = ' + jsonToLua(v, indent + 1) + ',';
        });
        return '{\n' + parts.join('\n') + '\n' + pad + '}';
    }

    if (typeof value === 'string') {
        return '"' + escapeLuaString(value) + '"';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (value == null) {
        return 'nil';
    }
    return 'nil';
}

function generateLuaAutogenBlock(config) {
    const luaTable = jsonToLua(config, 0);
    const lines = [];
    lines.push('-- AUTO-GENERATED FROM bridge_config.jsonc. DO NOT EDIT BY HAND.');
    lines.push('');
    lines.push('local BRIDGE_CONFIG = ' + luaTable);
    lines.push('');
    return lines.join('\n');
}

function buildTicCart(luaSource) {
    const codeBytes = Buffer.from(luaSource, 'utf8');
    
    // Chunk header: type (1 byte) + size (2 bytes little-endian) + bank (1 byte)
    const chunkHeaderSize = 4;
    const chunkHeader = Buffer.alloc(chunkHeaderSize);
    chunkHeader.writeUInt8(CHUNK_CODE, 0);           // chunk type
    chunkHeader.writeUInt16LE(codeBytes.length, 1);  // size (little-endian)
    chunkHeader.writeUInt8(0, 3);                    // bank = 0
    
    // Combine header + code
    return Buffer.concat([chunkHeader, codeBytes]);
}

function buildBridge() {
    console.log('[build-bridge] Reading', BRIDGE_LUA_PATH);

    if (!fs.existsSync(BRIDGE_LUA_PATH)) {
        throw new Error(`bridge.lua not found at ${BRIDGE_LUA_PATH}`);
    }

    const bridgeConfig = loadBridgeConfig();
    const autogen = generateLuaAutogenBlock(bridgeConfig);

    const luaTemplate = fs.readFileSync(BRIDGE_LUA_PATH, 'utf8');
    console.log(`[build-bridge] Lua template: ${luaTemplate.length} bytes`);

    const markerStart = 'BRIDGE_AUTOGEN_START';
    const markerEnd = 'BRIDGE_AUTOGEN_END';
    const startIdx = luaTemplate.indexOf(markerStart);
    const endIdx = luaTemplate.indexOf(markerEnd);
    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        throw new Error('BRIDGE_AUTOGEN_START/END markers not found or malformed in bridge.lua');
    }

    // We want to preserve the full lines that contain the markers, including
    // the leading "-- ", and replace only the content *between* them.
    const startLineEndIdx = luaTemplate.indexOf('\n', startIdx);
    const before = startLineEndIdx === -1
        ? luaTemplate
        : luaTemplate.slice(0, startLineEndIdx + 1);

    let endLineStartIdx = luaTemplate.lastIndexOf('\n', endIdx);
    if (endLineStartIdx === -1) endLineStartIdx = 0; else endLineStartIdx += 1;
    const after = luaTemplate.slice(endLineStartIdx);

    const luaSource = `${before}\n\n${autogen}\n\n${after}`;
    console.log(`[build-bridge] Lua source (with autogen): ${luaSource.length} bytes`);

    // write out the generated Lua for inspection
    {
        if (!fs.existsSync(path.dirname(OUTPUT_GENERATED_BRIDGE_LUA_PATH))) {
            fs.mkdirSync(path.dirname(OUTPUT_GENERATED_BRIDGE_LUA_PATH), { recursive: true });
        }
        fs.writeFileSync(OUTPUT_GENERATED_BRIDGE_LUA_PATH, luaSource);
        console.log('[build-bridge] Written generated Lua to', OUTPUT_GENERATED_BRIDGE_LUA_PATH);
    }

    const ticCart = buildTicCart(luaSource);
    console.log(`[build-bridge] TIC cart: ${ticCart.length} bytes`);
    
    const outputDir = path.dirname(OUTPUT_TIC_PATH);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(OUTPUT_TIC_PATH, ticCart);
    console.log('[build-bridge] Written', OUTPUT_TIC_PATH);
}

module.exports = { buildBridge };

// direct execution...
if (require.main === module) {
    try {
        buildBridge();
        console.log('[build-bridge] Success!');
    } catch (err) {
        console.error('[build-bridge] Error:', err);
        process.exit(1);
    }
}
