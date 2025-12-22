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

const BRIDGE_LUA_PATH = path.resolve(__dirname, '../bridge/bridge.lua');
const OUTPUT_TIC_PATH = path.resolve(__dirname, '../public/bridge.tic');

// TIC-80 chunk types (subset)
const CHUNK_CODE = 5;

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
    
    const luaSource = fs.readFileSync(BRIDGE_LUA_PATH, 'utf8');
    console.log(`[build-bridge] Lua source: ${luaSource.length} bytes`);
    
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
