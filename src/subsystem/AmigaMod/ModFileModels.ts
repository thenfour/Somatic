// Amiga 4-channel MOD file format models go here
// self-contained except for the use of fundamental types / utils like defineEnum() et al.
// Format described in: https://www.aes.id.au/modformat.html
// also see https://wiki.multimedia.cx/index.php?title=MOD
// https://www.stef.be/bassoontracker/docs/ProtrackerCommandReference.pdf
// https://moddingwiki.shikadi.net/wiki/ProTracker_Studio_Module

// - 15 or 31 samples? it's not straightforward to tell if it's a soundtracer 15-sample mod,
//   so just assume 31.
// - mod signature can indicate a bunch of stuff; should validate & parse properly.


import {defineEnum} from "../../utils/enum";
import {clampByte, readAscii, readU16BE} from "../../utils/utils";


export const ModConstants = {
   channelCount: 4,
   rowCountPerPattern: 64, // fixed; not variable like TIC80
   sampleCount: 31,
   patternOrderTableSize: 128,
   sampleHeaderBytes: 30,
   headerBytes: 20 +  // title
      (31 * 30) + 1 + // song length
      1 +             // restart pos
      128 +           // pattern order
      4,              // signature
} as const;

export const kModSignature = {
   // Most common ProTracker 4-channel signature.
   M_K_: "M.K.",
   // Common variants seen in the wild.
   M_K_EXCL: "M!K!",
   FLT4: "FLT4",
   _4CHN: "4CHN",
} as const;

export type ModSignature = (typeof kModSignature)[keyof typeof kModSignature]|string;

export const kModEffectCommand = defineEnum({
   Arpeggio: {value: 0x0, title: "Arpeggio"},
   PortaUp: {value: 0x1, title: "Portamento Up"},
   PortaDown: {value: 0x2, title: "Portamento Down"},
   TonePorta: {value: 0x3, title: "Tone Portamento"},
   Vibrato: {value: 0x4, title: "Vibrato"},
   TonePortaVolSlide: {value: 0x5, title: "Tone Portamento + Volume Slide"},
   VibratoVolSlide: {value: 0x6, title: "Vibrato + Volume Slide"},
   Tremolo: {value: 0x7, title: "Tremolo"},
   Pan: {value: 0x8, title: "Pan (rare/implementation-defined)"},
   SampleOffset: {value: 0x9, title: "Sample Offset"},
   VolumeSlide: {value: 0xA, title: "Volume Slide"},
   PositionJump: {value: 0xB, title: "Position Jump"},
   SetVolume: {value: 0xC, title: "Set Volume"},
   PatternBreak: {value: 0xD, title: "Pattern Break"},
   // see extended effects; has subcommands specified by the high nibble of param, and then a 4-bit param value.
   Extended: {value: 0xE, title: "Extended"},
   SetSpeed: {value: 0xF, title: "Set Speed/Tempo"},
} as const);

export type ModEffectCommand = typeof kModEffectCommand.$key;

export const kModExtendedEffectCommand = defineEnum({
   FilterOnOff: {value: 0x0, title: "Set Filter On/Off"},
   FinePitchSlideUp: {value: 0x1, title: "Fine Pitch Slide Up"},
   FinePitchSlideDown: {value: 0x2, title: "Fine Pitch Slide Down"},
   GlissandoControl: {value: 0x3, title: "Glissando Control"},
   VibratoControl: {value: 0x4, title: "Vibrato Control"},
   SetFineTune: {value: 0x5, title: "Set Fine Tune"},
   PatternLoop: {value: 0x6, title: "Pattern Loop"},
   TremoloControl: {value: 0x7, title: "Tremolo Control"},
   RetriggerNote: {value: 0x9, title: "Retrigger Note"},
   FineVolumeSlideUp: {value: 0xA, title: "Fine Volume Slide Up"},
   FineVolumeSlideDown: {value: 0xB, title: "Fine Volume Slide Down"},
   NoteCut: {value: 0xC, title: "Note Cut"},
   NoteDelay: {value: 0xD, title: "Note Delay"},
   PatternDelay: {value: 0xE, title: "Pattern Delay"},
   InvertLoop: {value: 0xF, title: "Invert Loop"},
});

export type ModExtendedEffectCommand = typeof kModExtendedEffectCommand.$key;

export type ModEffect = {
   command: ModEffectCommand;
   // 8-bit effect param, as stored in the pattern.
   paramU8: number;
};

export type ModPatternCell = {
   // 1..31 when present; null when no sample.
   sampleIndex1b: number|null;

   // Amiga period value (12-bit on-disk, but we store as full number).
   // null means empty note.
   period: number | null;

   // Effect command+param.
   // command 0 with param 0 is treated as "no effect".
   effect: ModEffect | null;
};

export type ModPatternRow = {
   // Always 4 entries.
   channels: [ModPatternCell, ModPatternCell, ModPatternCell, ModPatternCell];
};

export type ModPattern = {
   // Always 64 rows.
   rows: ModPatternRow[];
};

export type ModSampleHeader = {
   name: string;
   // Sample length in bytes (decoded from 16-bit word length).
   lengthBytes: number;
   // 0..15 (4-bit).
   // (-8..7) which is the finetune value for the sample. Each finetune step changes
   // the note 1/8th of a semitone. Implemented by switching to a
   // different table of period-values for each finetune value.
   finetune: number;
   // 0..64
   // Volume is the linear
   //           difference between sound intensities. 64 is full volume, and
   //           the change in decibels can be calculated with 20*log10(Vol/64)
   volume: number;
   // Loop start/length in bytes (decoded from 16-bit word units).
   // if < 2, no loop.
   loopStartBytes: number;
   // if < 2, no loop.
   loopLengthBytes: number;
};

export type ModHeader = {
   title: string;              //
   samples: ModSampleHeader[]; // 31 entries
   songLength: number;         // seq length 1..128
   restartPosition: number;    // 0..127 - for noisetracker compatibility, usually 0.

   // 128 0-based pattern pointer entries, values 0..127.
   //
   patternOrder: number[];
   signature: ModSignature;
};

export type ModFile = {
   header: ModHeader;
   // Patterns used by the file; count is derived from patternOrder max + 1.
   patterns: ModPattern[];
   // Raw sample data, parallel to header.samples.
   sampleData: Uint8Array[];
};

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function decodeModSampleHeader(bytes: Uint8Array, offset: number): ModSampleHeader {
   // 30 bytes:
   // 0..21 name (22)
   // 22..23 length words (u16)
   // 24 finetune nibble (low 4 bits)
   // 25 volume
   // 26..27 loop start words
   // 28..29 loop length words
   const name = readAscii(bytes, offset, 22);
   const lengthWords = readU16BE(bytes, offset + 22);
   const finetune = (bytes[offset + 24] ?? 0) & 0x0f;
   const volume = clampByte(bytes[offset + 25] ?? 0);
   const loopStartWords = readU16BE(bytes, offset + 26);
   const loopLengthWords = readU16BE(bytes, offset + 28);

   return {
      name,
      lengthBytes: (lengthWords & 0xffff) * 2,
      finetune: finetune - 8, // 0..15 -> -8..7
      volume: Math.max(0, Math.min(64, volume)),
      loopStartBytes: (loopStartWords & 0xffff) * 2,
      loopLengthBytes: (loopLengthWords & 0xffff) * 2,
   };
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function decodeModHeader(bytes: Uint8Array): ModHeader {
   if (bytes.length < ModConstants.headerBytes) {
      throw new Error(
         `Invalid .mod: file too small for header (need ${ModConstants.headerBytes}, got ${bytes.length})`);
   }

   const title = readAscii(bytes, 0, 20);
   const samples: ModSampleHeader[] = new Array(ModConstants.sampleCount);
   let off = 20;
   for (let i = 0; i < ModConstants.sampleCount; i++) {
      samples[i] = decodeModSampleHeader(bytes, off);
      off += ModConstants.sampleHeaderBytes;
   }

   const songLength = clampByte(bytes[off] ?? 0);
   const restartPosition = clampByte(bytes[off + 1] ?? 0);
   off += 2;

   const patternOrder: number[] = new Array(ModConstants.patternOrderTableSize);
   for (let i = 0; i < ModConstants.patternOrderTableSize; i++) {
      patternOrder[i] = clampByte(bytes[off + i] ?? 0);
   }
   off += ModConstants.patternOrderTableSize;

   const signature = readAscii(bytes, off, 4);

   return {
      title,
      samples,
      songLength: Math.max(1, Math.min(128, songLength || 1)),
      restartPosition,
      patternOrder,
      signature,
   };
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function decodeModPatternCellFrom4Bytes(b0: number, b1: number, b2: number, b3: number): ModPatternCell {
   // On-disk packing:
   // byte0: sample hi (4) | period hi (4)
   // byte1: period lo (8)
   // byte2: sample lo (4) | effect cmd (4)
   // byte3: effect param (8)
   const sampleHi = (b0 >> 4) & 0x0f;
   const periodHi = b0 & 0x0f;
   const periodLo = b1 & 0xff;
   const sampleLo = (b2 >> 4) & 0x0f;
   const effectCmdNib = b2 & 0x0f;
   const effectParam = b3 & 0xff;

   const sampleIndex1b = ((sampleHi << 4) | sampleLo) & 0xff;
   const period = ((periodHi << 8) | periodLo) & 0x0fff;

   const hasSample = sampleIndex1b !== 0;
   const hasNote = period !== 0;
   const hasEffect = effectCmdNib !== 0 || effectParam !== 0;

   const effectInfo = kModEffectCommand.infos.find((i) => i.value === effectCmdNib);
   const effect: ModEffect|null = hasEffect && effectInfo ? {command: effectInfo.key, paramU8: effectParam} : null;

   return {
      sampleIndex1b: hasSample ? sampleIndex1b : null,
      period: hasNote ? period : null,
      effect,
   };
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function encodeModPatternCellTo4Bytes(cell: ModPatternCell): [number, number, number, number] {
   const sampleIndex1b = cell.sampleIndex1b == null ? 0 : (cell.sampleIndex1b | 0);
   const period = cell.period == null ? 0 : (cell.period | 0);

   const cmd = cell.effect ? kModEffectCommand.coerceByKey(cell.effect.command)?.value ?? 0 : 0;
   const param = cell.effect ? clampByte(cell.effect.paramU8) : 0;

   const sampleHi = (sampleIndex1b >> 4) & 0x0f;
   const sampleLo = sampleIndex1b & 0x0f;
   const periodHi = (period >> 8) & 0x0f;
   const periodLo = period & 0xff;

   const b0 = ((sampleHi & 0x0f) << 4) | (periodHi & 0x0f);
   const b1 = periodLo & 0xff;
   const b2 = ((sampleLo & 0x0f) << 4) | (cmd & 0x0f);
   const b3 = param & 0xff;
   return [b0, b1, b2, b3];
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function decodeModPattern(bytes: Uint8Array, offset: number): ModPattern {
   // Each pattern: 64 rows * 4 channels * 4 bytes = 1024 bytes
   const rows: ModPatternRow[] = [];
   let off = offset;
   for (let row = 0; row < ModConstants.rowCountPerPattern; row++) {
      const channels: ModPatternCell[] = [];
      for (let ch = 0; ch < ModConstants.channelCount; ch++) {
         const b0 = bytes[off + 0] ?? 0;
         const b1 = bytes[off + 1] ?? 0;
         const b2 = bytes[off + 2] ?? 0;
         const b3 = bytes[off + 3] ?? 0;
         channels.push(decodeModPatternCellFrom4Bytes(b0, b1, b2, b3));
         off += 4;
      }
      rows.push({channels: channels as any});
   }
   return {rows};
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////
export function decodeModFile(bytes: Uint8Array): ModFile {
   const header = decodeModHeader(bytes);

   // Determine pattern count from order table max.
   const orderUsed = header.patternOrder.slice(0, header.songLength);
   const patternCount = (orderUsed.length ? Math.max(...orderUsed) : 0) + 1;

   const patterns: ModPattern[] = new Array(patternCount);
   let offset = ModConstants.headerBytes;
   const bytesPerPattern = ModConstants.rowCountPerPattern * ModConstants.channelCount * 4;
   const patternsBytes = patternCount * bytesPerPattern;
   if (bytes.length < offset + patternsBytes) {
      throw new Error(`Invalid .mod: file too small for ${patternCount} patterns`);
   }

   for (let i = 0; i < patternCount; i++) {
      patterns[i] = decodeModPattern(bytes, offset + i * bytesPerPattern);
   }
   offset += patternsBytes;

   const sampleData: Uint8Array[] = new Array(ModConstants.sampleCount);
   for (let i = 0; i < ModConstants.sampleCount; i++) {
      const len = header.samples[i]?.lengthBytes ?? 0;
      const end = offset + len;
      if (end > bytes.length) {
         // Be tolerant; truncate if needed.
         sampleData[i] = bytes.subarray(offset, bytes.length);
         offset = bytes.length;
      } else {
         sampleData[i] = bytes.subarray(offset, end);
         offset = end;
      }
   }

   return {header, patterns, sampleData};
}
