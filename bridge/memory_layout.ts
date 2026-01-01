// Centralized TIC-80 memory layout for Somatic bridge and playroutines.

import {MemoryRegion} from "./bitpack";

// https://github.com/nesbox/TIC-80/wiki/RAM
export const Tic80MemoryMap = {
   VRam: new MemoryRegion("VRam", 0x00000, 0x4000),
   Tiles: new MemoryRegion("Tiles", 0x04000, 0x2000),
   Sprites: new MemoryRegion("Sprites", 0x06000, 0x2000),
   Map: new MemoryRegion("Map", 0x08000, 0x7FF0),
   Gamepads: new MemoryRegion("Gamepads", 0x0FF80, 0x04),
   Mouse: new MemoryRegion("Mouse", 0x0FF84, 0x04),
   Keyboard: new MemoryRegion("Keyboard", 0x0FF88, 0x04),
   SfxState: new MemoryRegion("SfxState", 0x0FF8C, 0x10),
   SoundRegisters: new MemoryRegion("SoundRegisters", 0x0FF9C, 0x48),
   Waveforms: new MemoryRegion("Waveforms", 0x0FFE4, 0x100),
   Sfx: new MemoryRegion("Sfx", 0x100E4, 0x1080),
   MusicPatterns: new MemoryRegion("MusicPatterns", 0x11164, 0x2D00),
   MusicTracks: new MemoryRegion("MusicTracks", 0x13E64, 0x198),
   SoundState: new MemoryRegion("SoundState", 0x13FFC, 0x04),
   StereoVolume: new MemoryRegion("StereoVolume", 0x14000, 0x04),
   PersistentMemory: new MemoryRegion("PersistentMemory", 0x14004, 0x400),
   SpriteFlags: new MemoryRegion("SpriteFlags", 0x14404, 0x200),
   SystemFont: new MemoryRegion("SystemFont", 0x14604, 0x800),
   GamepadMapping: new MemoryRegion("GamepadMapping", 0x14E04, 0x20),
   Reserved: new MemoryRegion("Reserved", 0x14E36, 0x3204),
};

const Tic80Constants = {
   // Q: is it ALWAYS 192? (even when rows per pattern is fewer than 64?)
   BYTES_PER_MUSIC_PATTERN: 192,
   BYTES_PER_SFX: 66,
   BYTES_PER_WAVEFORM: 16,
   MUSIC_CHANNELS: 4,
};

// tic80 helpers
export function RegionForMusicPattern(patternIndex: number) {
   return Tic80MemoryMap.MusicPatterns.getCell(Tic80Constants.BYTES_PER_MUSIC_PATTERN, patternIndex);
}

export function RegionForSfx(sfxIndex: number) {
   return Tic80MemoryMap.Sfx.getCell(Tic80Constants.BYTES_PER_SFX, sfxIndex);
}

export function RegionForWaveform(waveformIndex: number) {
   return Tic80MemoryMap.Waveforms.getCell(Tic80Constants.BYTES_PER_WAVEFORM, waveformIndex);
}



//const TIC80_BYTES_PER_PATTERN = 192; // Each pattern is 192 bytes (64 rows * 3 bytes)
//const TIC80_CHANNELS = 4;            // TIC-80 supports 4 audio channels
const TIC80_BYTES_PER_WAVEFORM = 16; // 32 samples * 4 bits, packed 2 per byte
const TIC80_BYTES_PER_SFX = 66;      // Each SFX is 66 bytes

// Somatic Requirements

// Temp buffers for decompression/decoding operations
// We need 2 buffers to support operations like:
// - Buffer A: decompress base85 -> compressed data
// - Buffer B: decompress LZ -> final data
const TEMP_BUFFER_SIZE = 0x400; // 1KB per buffer (needed for SFX config decompression - up to 32 instruments)
const TEMP_BUFFER_COUNT = 2;

// Pattern playback buffers
const PATTERN_BUFFER_SIZE = Tic80Constants.BYTES_PER_MUSIC_PATTERN * Tic80Constants.MUSIC_CHANNELS; // 768 bytes
const PATTERN_BUFFER_COUNT = 2; // Front and back buffers

const LOG_BUFFER_SIZE = 240; // Log buffer for cart→host messages

// SFX configuration storage
// Worst case: 64 instruments * 14 bytes each = 896 bytes
// Round up to 1KB for safety and future expansion
const SOMATIC_SFX_CONFIG_SIZE = 0x400; // 1KB

/////////////////////////////////////////////////////////////////////////////////
const patternMem = Tic80MemoryMap.MusicPatterns;


const patternBufferAAddr = 0x13324; // Pattern 45 (hard-coded to match original)
const patternBufferBAddr = 0x13624; // Pattern 49 (hard-coded to match original)
const tempBufferAAddr = 0x13A64;    // Hard-coded to match original
const tempBufferBAddr = 0x13C64;    // Hard-coded to match original

// Create regions based on these hard-coded addresses
const patternBufferA = new MemoryRegion("PatternBufferA", patternBufferAAddr, PATTERN_BUFFER_SIZE);
const patternBufferB = new MemoryRegion("PatternBufferB", patternBufferBAddr, PATTERN_BUFFER_SIZE);
const tempBufferA = new MemoryRegion("TempBufferA", tempBufferAAddr, TEMP_BUFFER_SIZE);
const tempBufferB = new MemoryRegion("TempBufferB", tempBufferBAddr, TEMP_BUFFER_SIZE);

// Available space for compressed patterns (everything before pattern buffer A)
const compressedPatternsRegion =
   new MemoryRegion("CompressedPatterns", patternMem.address, patternBufferAAddr - patternMem.address);

// Calculate which TIC-80 pattern indices these buffers correspond to
const patternBufferAIndex =
   1 + Math.floor((patternBufferA.address - patternMem.address) / Tic80Constants.BYTES_PER_MUSIC_PATTERN);
const patternBufferBIndex =
   1 + Math.floor((patternBufferB.address - patternMem.address) / Tic80Constants.BYTES_PER_MUSIC_PATTERN);



// The Map region is mostly unused by Somatic, so we allocate our bridge state
// from the TOP down for safety

const mapMem = Tic80MemoryMap.Map;

// Work backwards from the top
let currentTop = mapMem.endAddress();

// Outbox log ring buffer (240 bytes)
const outboxLogRegion = new MemoryRegion("OutboxLog", currentTop - LOG_BUFFER_SIZE, LOG_BUFFER_SIZE);
currentTop = outboxLogRegion.address;

// Outbox header (16 bytes: magic, version, heartbeat, state, etc.)
const OUTBOX_HEADER_SIZE = 16;
const outboxHeaderRegion = new MemoryRegion("OutboxHeader", currentTop - OUTBOX_HEADER_SIZE, OUTBOX_HEADER_SIZE);
currentTop = outboxHeaderRegion.address;

// Inbox mailbox (64 bytes: command, params, mutex, seq, token)
const INBOX_SIZE = 64;
const inboxRegion = new MemoryRegion("Inbox", currentTop - INBOX_SIZE, INBOX_SIZE);
currentTop = inboxRegion.address;

// Registers region (32 bytes: song position, FPS, etc.)
const REGISTERS_SIZE = 32;
const registersRegion = new MemoryRegion("Registers", currentTop - REGISTERS_SIZE, REGISTERS_SIZE);
currentTop = registersRegion.address;

// Marker region (32 bytes: identification string)
const MARKER_SIZE = 32;
const markerRegion = new MemoryRegion("Marker", currentTop - MARKER_SIZE, MARKER_SIZE);
currentTop = markerRegion.address;

// SFX config (1KB for instrument morph configurations)
const somaticSfxConfigRegion =
   new MemoryRegion("SomaticSfxConfig", currentTop - SOMATIC_SFX_CONFIG_SIZE, SOMATIC_SFX_CONFIG_SIZE);


export const SomaticMemoryLayout = {
   tempBufferA,
   tempBufferB,
   patternBufferA,
   patternBufferB,
   compressedPatterns: compressedPatternsRegion,

   somaticSfxConfig: somaticSfxConfigRegion,
   marker: markerRegion,
   registers: registersRegion,
   inbox: inboxRegion,
   outboxHeader: outboxHeaderRegion,
   outboxLog: outboxLogRegion,

   computed: {
      PATTERN_MEM_LIMIT: compressedPatternsRegion.endAddress(),
      PATTERN_BUFFER_A_INDEX: patternBufferAIndex,
      PATTERN_BUFFER_B_INDEX: patternBufferBIndex,
      PATTERN_BUFFER_A_ADDR: patternBufferA.address,
      PATTERN_BUFFER_B_ADDR: patternBufferB.address,
      TEMP_BUFFER_A_ADDR: tempBufferA.address,
      TEMP_BUFFER_B_ADDR: tempBufferB.address,

      SOMATIC_SFX_CONFIG: somaticSfxConfigRegion.address,
      MARKER_ADDR: markerRegion.address,
      REGISTERS_ADDR: registersRegion.address,
      INBOX_ADDR: inboxRegion.address,
      OUTBOX_ADDR: outboxHeaderRegion.address,
      LOG_BASE: outboxLogRegion.address,
      LOG_SIZE: LOG_BUFFER_SIZE,
   },

   sizes: {
      TEMP_BUFFER_SIZE,
      PATTERN_BUFFER_SIZE,
      LOG_BUFFER_SIZE,
      SOMATIC_SFX_CONFIG_SIZE,
   },
};

export function printMemoryLayout(): string {
   const lines: string[] = [];
   lines.push("Pattern Memory:");
   lines.push(`  Compressed Patterns: ${compressedPatternsRegion.toString()}`);
   lines.push(`  Pattern Buffer A:    ${patternBufferA.toString()} (TIC-80 pattern #${patternBufferAIndex})`);
   lines.push(`  Pattern Buffer B:    ${patternBufferB.toString()} (TIC-80 pattern #${patternBufferBIndex})`);
   lines.push(`  Temp Buffer A:       ${tempBufferA.toString()}`);
   lines.push(`  Temp Buffer B:       ${tempBufferB.toString()}`);
   lines.push("");
   lines.push("Map Memory (Bridge State):");
   lines.push(`  SFX Config:          ${somaticSfxConfigRegion.toString()}`);
   lines.push(`  Marker:              ${markerRegion.toString()}`);
   lines.push(`  Registers:           ${registersRegion.toString()}`);
   lines.push(`  Inbox:               ${inboxRegion.toString()}`);
   lines.push(`  Outbox Header:       ${outboxHeaderRegion.toString()}`);
   lines.push(`  Outbox Log:          ${outboxLogRegion.toString()}`);
   return lines.join("\n");
}
