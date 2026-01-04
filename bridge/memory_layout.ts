// Centralized TIC-80 memory layout for Somatic bridge and playroutines.

import {MemoryRegion} from "../src/utils/bitpack/bitpack";

// https://github.com/nesbox/TIC-80/wiki/RAM
export const Tic80MemoryMap = {
   VRam: new MemoryRegion({name: "VRam", address: 0x00000, size: 0x4000}),
   Tiles: new MemoryRegion({name: "Tiles", address: 0x04000, size: 0x2000}),
   Sprites: new MemoryRegion({name: "Sprites", address: 0x06000, size: 0x2000}),
   Map: new MemoryRegion({name: "Map", address: 0x08000, size: 0x7FF0}),
   Gamepads: new MemoryRegion({name: "Gamepads", address: 0x0FF80, size: 0x04}),
   Mouse: new MemoryRegion({name: "Mouse", address: 0x0FF84, size: 0x04}),
   Keyboard: new MemoryRegion({name: "Keyboard", address: 0x0FF88, size: 0x04}),
   SfxState: new MemoryRegion({name: "SfxState", address: 0x0FF8C, size: 0x10}),
   SoundRegisters: new MemoryRegion({name: "SoundRegisters", address: 0x0FF9C, size: 0x48}),
   Waveforms: new MemoryRegion({name: "Waveforms", address: 0x0FFE4, size: 0x100}),
   Sfx: new MemoryRegion({name: "Sfx", address: 0x100E4, size: 0x1080}),
   MusicPatterns: new MemoryRegion({name: "MusicPatterns", address: 0x11164, size: 0x2D00}),
   MusicTracks: new MemoryRegion({name: "MusicTracks", address: 0x13E64, size: 0x198}),
   SoundState: new MemoryRegion({name: "SoundState", address: 0x13FFC, size: 0x04}),
   StereoVolume: new MemoryRegion({name: "StereoVolume", address: 0x14000, size: 0x04}),
   PersistentMemory: new MemoryRegion({name: "PersistentMemory", address: 0x14004, size: 0x400}),
   SpriteFlags: new MemoryRegion({name: "SpriteFlags", address: 0x14404, size: 0x200}),
   SystemFont: new MemoryRegion({name: "SystemFont", address: 0x14604, size: 0x800}),
   GamepadMapping: new MemoryRegion({name: "GamepadMapping", address: 0x14E04, size: 0x20}),
   Reserved: new MemoryRegion({name: "Reserved", address: 0x14E36, size: 0x3204}),
};

export const Tic80Constants = {
   // Q: is it ALWAYS 192? (even when rows per pattern is fewer than 64?)
   BYTES_PER_MUSIC_PATTERN: 192,
   BYTES_PER_SFX: 66,
   BYTES_PER_WAVEFORM: 16,
   MUSIC_CHANNELS: 4,
} as const;

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


// Somatic Requirements

// Pattern playback buffers
const PATTERN_BUFFER_SIZE = Tic80Constants.BYTES_PER_MUSIC_PATTERN * Tic80Constants.MUSIC_CHANNELS; // 768 bytes
//const PATTERN_BUFFER_COUNT = 2; // Front and back buffers

const LOG_BUFFER_SIZE = 240; // Log buffer for cart→host messages

// SFX configuration storage
// Worst case: 64 instruments * 14 bytes each = 896 bytes
// Round up to 1KB for safety and future expansion
const SOMATIC_SFX_CONFIG_SIZE = 0x400; // 1KB

const patternMem = Tic80MemoryMap.MusicPatterns;

// Temp buffers for decompression/decoding operations
// We need 2 buffers to support operations like:
// - Buffer A: decompress base85 -> compressed data
// - Buffer B: decompress LZ -> final data
const TEMP_BUFFER_SIZE = 0x400; // 1KB per buffer (needed for SFX config decompression - up to 32 instruments)
//const TEMP_BUFFER_COUNT = 2;

const tempBufferB = patternMem.getTopAlignedCellFromTop(TEMP_BUFFER_SIZE, 0).withName("TempBufferB");
const tempBufferA = patternMem.getTopAlignedCellFromTop(TEMP_BUFFER_SIZE, 1).withName("TempBufferA");
// pattern playback buffers are the last whole PATTERN_BUFFER_SIZE-sized, pattern-aligned regions before the temp buffers
const maxPossiblePatternBufferAddr = Math.min(tempBufferA.address, tempBufferB.address) - PATTERN_BUFFER_SIZE;

const patternBufferB =
   patternMem.getCellBeforeAddress(Tic80Constants.BYTES_PER_MUSIC_PATTERN, maxPossiblePatternBufferAddr)
      .withSize(PATTERN_BUFFER_SIZE)
      .withName("PatternBufferA");

const patternBufferA =
   patternMem
      .getCellBeforeAddress(
         Tic80Constants.BYTES_PER_MUSIC_PATTERN,
         maxPossiblePatternBufferAddr,
         -Tic80Constants
             .MUSIC_CHANNELS // because each pattern buffer is 4 patterns (one per channel) and we are walking in cells of 1 pattern
         )
      .withSize(PATTERN_BUFFER_SIZE)
      .withName("PatternBufferB");

const reservedPatternMemRuntimeRegions = [patternBufferA, patternBufferB, tempBufferA, tempBufferB];
const firstPatternMemReservedAddress = reservedPatternMemRuntimeRegions.reduce(
   (minAddr, region) => Math.min(minAddr, region.address), Number.MAX_SAFE_INTEGER);

const compressedPatternsRegion = patternMem.getRegionFromBottomUntilExclusiveAddress(firstPatternMemReservedAddress);

// const patternBufferAAddr = 0x13324; // Pattern 45 (hard-coded to match original)
// const patternBufferBAddr = 0x13624; // Pattern 49 (hard-coded to match original)
// const tempBufferAAddr = 0x13A64;    // Hard-coded to match original
// const tempBufferBAddr = 0x13C64;    // Hard-coded to match original

// Create regions based on these hard-coded addresses
// const patternBufferA =
//    new MemoryRegion({name: "PatternBufferA", address: patternBufferAAddr, size: PATTERN_BUFFER_SIZE});
// const patternBufferB =
//    new MemoryRegion({name: "PatternBufferB", address: patternBufferBAddr, size: PATTERN_BUFFER_SIZE});
// const tempBufferA = new MemoryRegion({name: "TempBufferA", address: tempBufferAAddr, size: TEMP_BUFFER_SIZE});
// const tempBufferB = new MemoryRegion({name: "TempBufferB", address: tempBufferBAddr, size: TEMP_BUFFER_SIZE});

// Available space for compressed patterns (everything before pattern buffer A)
// const compressedPatternsRegion = new MemoryRegion(
//    {name: "CompressedPatterns", address: patternMem.address, size: patternBufferAAddr - patternMem.address});


// Calculate which TIC-80 pattern indices these buffers correspond to
// 1+ because TIC-80 pattern indices are 1-based (0 = no pattern)
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
const outboxLogRegion =
   new MemoryRegion({name: "OutboxLog", address: currentTop - LOG_BUFFER_SIZE, size: LOG_BUFFER_SIZE});
currentTop = outboxLogRegion.address;

// Outbox header (16 bytes: magic, version, heartbeat, state, etc.)
const OUTBOX_HEADER_SIZE = 16;
const outboxHeaderRegion =
   new MemoryRegion({name: "OutboxHeader", address: currentTop - OUTBOX_HEADER_SIZE, size: OUTBOX_HEADER_SIZE});
currentTop = outboxHeaderRegion.address;

// Inbox mailbox (64 bytes: command, params, mutex, seq, token)
const INBOX_SIZE = 64;
const inboxRegion = new MemoryRegion({name: "Inbox", address: currentTop - INBOX_SIZE, size: INBOX_SIZE});
currentTop = inboxRegion.address;

// Registers region (32 bytes: song position, FPS, etc.)
const REGISTERS_SIZE = 32;
const registersRegion =
   new MemoryRegion({name: "Registers", address: currentTop - REGISTERS_SIZE, size: REGISTERS_SIZE});
currentTop = registersRegion.address;

// Marker region (32 bytes: identification string)
const MARKER_SIZE = 32;
const markerRegion = new MemoryRegion({name: "Marker", address: currentTop - MARKER_SIZE, size: MARKER_SIZE});
currentTop = markerRegion.address;

// SFX config (krate stuff) (1KB for instrument morph configurations)
const somaticSfxConfigRegion = new MemoryRegion(
   {name: "SomaticSfxConfig", address: currentTop - SOMATIC_SFX_CONFIG_SIZE, size: SOMATIC_SFX_CONFIG_SIZE});


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
