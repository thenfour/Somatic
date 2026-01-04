// import {Tic80MemoryMap, SomaticMemoryLayout} from "../../bridge/memory_layout";
// import {SongCartDetails} from "../audio/tic80_cart_serializer";
// import {MemoryMapVisProps, MemoryMapVisRegion} from "../ui/MemoryMapVis";
// import {MemoryRegion} from "./bitpack/MemoryRegion";

// export function generateWaveformMemoryMap(cartDetails: SongCartDetails): MemoryMapVisProps {
//    const usedRegion = cartDetails.memoryRegions.waveforms;
//    const totalWaveforms = 16;
//    const totalBytes = totalWaveforms * 32;

//    const regions: MemoryMapVisRegion[] = [];

//    if (usedRegion.size > 0) {
//       regions.push({
//          startAddress: usedRegion.address,
//          length: usedRegion.size,
//          label: `${cartDetails.optimizeResult.usedWaveformCount} Waveforms (${usedRegion.size} bytes)`,
//          hashKey: "waveforms-used",
//          type: "used"
//       });
//    }

//    const freeBytes = totalBytes - usedRegion.size;
//    if (freeBytes > 0) {
//       regions.push({
//          startAddress: usedRegion.address + usedRegion.size,
//          length: freeBytes,
//          label: `Free (${freeBytes} bytes)`,
//          hashKey: "waveforms-free",
//          type: "free"
//       });
//    }

//    return {
//       root: {
//          startAddress: Tic80MemoryMap.Waveforms.address,
//          length: totalBytes,
//          label: "Waveforms",
//          hashKey: "waveforms-root"
//       },
//       regions
//    };
// }

// /**
//  * Generate memory map for SFX region (cartridge export)
//  */
// export function generateSfxMemoryMap(cartDetails: SongCartDetails): MemoryMapVisProps {
//    const usedRegion = cartDetails.memoryRegions.sfx;
//    const totalSfx = 64;
//    const totalBytes = totalSfx * 72;

//    const regions: MemoryMapVisRegion[] = [];

//    if (usedRegion.size > 0) {
//       regions.push({
//          startAddress: usedRegion.address,
//          length: usedRegion.size,
//          label: `${cartDetails.optimizeResult.usedSfxCount} SFX (${usedRegion.size} bytes)`,
//          hashKey: "sfx-used",
//          type: "used"
//       });
//    }

//    const freeBytes = totalBytes - usedRegion.size;
//    if (freeBytes > 0) {
//       regions.push({
//          startAddress: usedRegion.address + usedRegion.size,
//          length: freeBytes,
//          label: `Free (${freeBytes} bytes)`,
//          hashKey: "sfx-free",
//          type: "free"
//       });
//    }

//    return {
//       root: {startAddress: Tic80MemoryMap.Sfx.address, length: totalBytes, label: "SFX", hashKey: "sfx-root"},
//       regions
//    };
// }

// /**
//  * Generate memory map for Map region (bridge runtime allocation)
//  */
// export function generateMapMemoryMap(cartDetails: SongCartDetails): MemoryMapVisProps {
//    const bridgeRegions = cartDetails.memoryRegions.bridgeRegions;

//    const regions: MemoryMapVisRegion[] = bridgeRegions.map((region, idx) => ({
//                                                               startAddress: region.address,
//                                                               length: region.size,
//                                                               label: `${region.name} (${region.size} bytes)`,
//                                                               hashKey: `map-${idx}`,
//                                                               type: "used" as const
//                                                            }));

//    // Sort regions by address
//    regions.sort((a, b) => a.startAddress - b.startAddress);

//    return {
//       root: {
//          startAddress: Tic80MemoryMap.Map.address,
//          length: Tic80MemoryMap.Map.size,
//          label: "Map (Bridge Runtime)",
//          hashKey: "map-root"
//       },
//       regions
//    };
// }

// /**
//  * Generate memory map for MusicPatterns region (cartridge export)
//  */
// export function generatePatternMemoryMapCartridge(cartDetails: SongCartDetails): MemoryMapVisProps {
//    const usedRegion = cartDetails.memoryRegions.patterns;
//    const totalBytes = Tic80MemoryMap.MusicPatterns.size;

//    const regions: MemoryMapVisRegion[] = [];

//    if (usedRegion.size > 0) {
//       regions.push({
//          startAddress: usedRegion.address,
//          length: usedRegion.size,
//          label: `Compressed Patterns (${usedRegion.size} bytes)`,
//          hashKey: "pattern-cart-used",
//          type: "used"
//       });
//    }

//    const freeBytes = totalBytes - usedRegion.size;
//    if (freeBytes > 0) {
//       regions.push({
//          startAddress: usedRegion.address + usedRegion.size,
//          length: freeBytes,
//          label: `Free (${freeBytes} bytes)`,
//          hashKey: "pattern-cart-free",
//          type: "free"
//       });
//    }

//    return {
//       root: {
//          startAddress: Tic80MemoryMap.MusicPatterns.address,
//          length: totalBytes,
//          label: "MusicPatterns (Cart Export)",
//          hashKey: "pattern-cart-root"
//       },
//       regions
//    };
// }

// /**
//  * Generate memory map for MusicPatterns region (runtime allocation)
//  */
// export function generatePatternMemoryMapRuntime(cartDetails: SongCartDetails): MemoryMapVisProps {
//    const patternsRegion = cartDetails.memoryRegions.patterns;
//    const bufferRegions = cartDetails.memoryRegions.patternBuffers;

//    const regions: MemoryMapVisRegion[] = [
//       {
//          startAddress: patternsRegion.address,
//          length: patternsRegion.size,
//          label: `Compressed Patterns (${patternsRegion.size} bytes)`,
//          hashKey: "pattern-runtime-compressed",
//          type: "used"
//       },
//       ...bufferRegions.map((region, idx) => ({
//                               startAddress: region.address,
//                               length: region.size,
//                               label: `${region.name} (${region.size} bytes)`,
//                               hashKey: `pattern-runtime-buffer-${idx}`,
//                               type: "used" as const
//                            }))
//    ];

//    // Sort regions by address
//    regions.sort((a, b) => a.startAddress - b.startAddress);

//    return {
//       root: {
//          startAddress: Tic80MemoryMap.MusicPatterns.address,
//          length: Tic80MemoryMap.MusicPatterns.size,
//          label: "MusicPatterns (Runtime Layout)",
//          hashKey: "pattern-runtime-root"
//       },
//       regions
//    };
// }

// /**
//  * Generate all memory maps for display
//  */
// export function generateAllMemoryMaps(cartDetails: SongCartDetails) {
//    return {
//       waveforms: generateWaveformMemoryMap(cartDetails),
//       sfx: generateSfxMemoryMap(cartDetails),
//       map: generateMapMemoryMap(cartDetails),
//       patternCart: generatePatternMemoryMapCartridge(cartDetails),
//       patternRuntime: generatePatternMemoryMapRuntime(cartDetails)
//    };
// }
