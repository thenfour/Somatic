// Amiga 4-channel MOD file format models go here
// self-contained except for the use of fundamental types / utils like defineEnum() et al.
// Format described in: https://www.aes.id.au/modformat.html
// also see https://wiki.multimedia.cx/index.php?title=MOD
// https://www.stef.be/bassoontracker/docs/ProtrackerCommandReference.pdf
// https://moddingwiki.shikadi.net/wiki/MOD_Format

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
   // TODO(mod-playback): many commands have tracker-specific edge cases and "memory" behavior
   // (e.g. param=0 meaning reuse previous param). This file intentionally documents those
   // quirks, but Somatic's MOD playback engine may implement a strict subset initially.

   Arpeggio: {
      value: 0x0,
      title: "Arpeggio",
      patternChar: "0",
      keyboardShortcut: "0",
      // 0xy: add semitone offsets x and y in a cycle. Commonly has "memory" if xy=00.
      description: "Arpeggio (0xy): cycle base note, +x, +y semitone offsets",
      paramFormat: "xy_nibbles",
      nominalX: 3,
      nominalY: 7,
   },
   PortaUp: {
      value: 0x1,
      title: "Portamento Up",
      patternChar: "1",
      keyboardShortcut: "1",
      // 1xx: slide pitch up by xx per tick. Often: xx=00 means reuse previous speed.
      description: "Pitch slide up (1xx): period decreases by xx per tick",
      paramFormat: "u8",
      nominalParamU8: 0x04,
   },
   PortaDown: {
      value: 0x2,
      title: "Portamento Down",
      patternChar: "2",
      keyboardShortcut: "2",
      description: "Pitch slide down (2xx): period increases by xx per tick",
      paramFormat: "u8",
      nominalParamU8: 0x04,
   },
   TonePorta: {
      value: 0x3,
      title: "Tone Portamento",
      patternChar: "3",
      keyboardShortcut: "3",
      // 3xx: slide towards the target note (period) at speed xx per tick.
      // Important nuance: the "target" comes from the note value in the same cell.
      // Many trackers treat "note+3xx" as setting a new target without retriggering the sample.
      description: "Tone portamento (3xx): slide towards target note at speed xx",
      paramFormat: "u8",
      nominalParamU8: 0x04,
   },
   Vibrato: {
      value: 0x4,
      title: "Vibrato",
      patternChar: "4",
      keyboardShortcut: "4",
      // 4xy: x=speed, y=depth (nibbles). Often supports memory for x or y if nibble is 0.
      description: "Vibrato (4xy): oscillate pitch with speed x and depth y",
      paramFormat: "xy_nibbles",
      nominalX: 4,
      nominalY: 4,
   },
   TonePortaVolSlide: {
      value: 0x5,
      title: "Tone Portamento + Volume Slide",
      patternChar: "5",
      keyboardShortcut: "5",
      // 5xy: continue tone porta (3xx) + apply volume slide Axy (same tick rules).
      // Typically: you omit the 3xx speed and rely on memory.
      description: "Tone porta + volume slide (5xy): 3xx + Axy combined",
      paramFormat: "xy_nibbles",
      nominalX: 1,
      nominalY: 0,
   },
   VibratoVolSlide: {
      value: 0x6,
      title: "Vibrato + Volume Slide",
      patternChar: "6",
      keyboardShortcut: "6",
      description: "Vibrato + volume slide (6xy): 4xy + Axy combined",
      paramFormat: "xy_nibbles",
      nominalX: 1,
      nominalY: 0,
   },
   Tremolo: {
      value: 0x7,
      title: "Tremolo",
      patternChar: "7",
      keyboardShortcut: "7",
      // 7xy: x=speed, y=depth, but affects volume instead of pitch.
      description: "Tremolo (7xy): oscillate volume with speed x and depth y",
      paramFormat: "xy_nibbles",
      nominalX: 4,
      nominalY: 4,
   },
   Pan: {
      value: 0x8,
      title: "Pan (rare/implementation-defined)",
      patternChar: "8",
      keyboardShortcut: "8",
      // 8xx: In many classic 4-channel ProTracker players, this is unused or implementation-defined.
      // Some later players treat 8xx as panning (often 00..FF). Others treat it as "sync".
      // TODO(mod-playback): decide whether to support panning, and which range mapping to use.
      description: "Pan (8xx): implementation-defined; often panning 00..FF in later players",
      paramFormat: "u8",
      nominalParamU8: 0x80,
   },
   SampleOffset: {
      value: 0x9,
      title: "Sample Offset",
      patternChar: "9",
      keyboardShortcut: "9",
      // 9xx: sample start offset. In many players, xx is in 256-byte steps.
      // Important nuance: behavior if offset is beyond sample length varies.
      description: "Sample offset (9xx): start sample at offset xx (commonly 256-byte steps)",
      paramFormat: "u8",
      nominalParamU8: 0x01,
   },
   VolumeSlide: {
      value: 0xA,
      title: "Volume Slide",
      patternChar: "A",
      keyboardShortcut: "a",
      // Axy: if x>0 slide up by x, else slide down by y; applied on ticks (not row-only).
      // Note: some trackers treat both-nonzero as "up" or prioritize one nibble.
      description: "Volume slide (Axy): slide volume up x or down y per tick",
      paramFormat: "xy_nibbles",
      nominalX: 1,
      nominalY: 0,
   },
   PositionJump: {
      value: 0xB,
      title: "Position Jump",
      patternChar: "B",
      keyboardShortcut: "b",
      // Bxx: jump to song position xx (pattern order index). Typically executed at row end.
      // TODO(mod-playback): also consider interaction with pattern break and loop.
      description: "Position jump (Bxx): set next order position to xx",
      paramFormat: "u8",
      nominalParamU8: 0x00,
   },
   SetVolume: {
      value: 0xC,
      title: "Set Volume",
      patternChar: "C",
      keyboardShortcut: "c",
      // Cxx: set channel volume 0..64 (40h=64). Values above 64 are typically clamped.
      description: "Set volume (Cxx): set channel volume (00..40 = 0..64)",
      paramFormat: "u8",
      nominalParamU8: 0x40,
   },
   PatternBreak: {
      value: 0xD,
      title: "Pattern Break",
      patternChar: "D",
      keyboardShortcut: "d",
      // Dxx: break to next position, row = BCD(xx) (e.g. 1A = row 26).
      // Nuance: BCD decoding and clamping differ across players.
      description: "Pattern break (Dxx): go to next position at row BCD(xx)",
      paramFormat: "bcd_u8",
      nominalParamU8: 0x00,
   },
   Extended: {
      value: 0xE,
      title: "Extended",
      patternChar: "E",
      keyboardShortcut: "e",
      // E?x: subcommand = high nibble, param = low nibble (4-bit).
      // see kModExtendedEffectCommand.
      description: "Extended (Eyx): y selects subcommand; x is 4-bit parameter",
      paramFormat: "extended_nibbles",
      nominalX: 0,
      nominalY: 0,
   },
   SetSpeed: {
      value: 0xF,
      title: "Set Speed/Tempo",
      patternChar: "F",
      keyboardShortcut: "f",
      // Fxx: ProTracker convention: xx <= 1F => set speed (ticks per row), else set tempo (BPM-ish).
      // Nuance: interpretation differs in some trackers/players.
      description: "Set speed/tempo (Fxx): <=1F speed (ticks/row), else tempo",
      paramFormat: "speed_or_tempo_u8",
      nominalParamU8: 0x06,
   },
} as const);

export type ModEffectCommand = typeof kModEffectCommand.$key;

export const kModExtendedEffectCommand = defineEnum({
   // These are the E-command subcommands (Eyx): y selects the subcommand, x is 0..15.
   // Some are widely supported (E1/E2/EC/ED/EE), others are much more tracker/player-specific.

   FilterOnOff: {
      value: 0x0,
      title: "Set Filter On/Off",
      patternChar: "E0",
      // E0x: classic Amiga lowpass filter toggle (hardware/Paula). Many modern players ignore.
      description: "E0x: toggle Amiga LED filter (x=0 off, x=1 on; often ignored)",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
   FinePitchSlideUp: {
      value: 0x1,
      title: "Fine Pitch Slide Up",
      patternChar: "E1",
      description: "E1x: fine pitch slide up by x (row-only)",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   FinePitchSlideDown: {
      value: 0x2,
      title: "Fine Pitch Slide Down",
      patternChar: "E2",
      description: "E2x: fine pitch slide down by x (row-only)",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   GlissandoControl: {
      value: 0x3,
      title: "Glissando Control",
      patternChar: "E3",
      // E3x: if x=1, tone porta uses semitone steps; if x=0, continuous.
      description: "E3x: glissando control (0=continuous, 1=semitone steps)",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
   VibratoControl: {
      value: 0x4,
      title: "Vibrato Control",
      patternChar: "E4",
      // E4x: select vibrato waveform (and sometimes retrig mode). Details vary.
      description: "E4x: set vibrato waveform/control (implementation-defined)",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
   SetFineTune: {
      value: 0x5,
      title: "Set Fine Tune",
      patternChar: "E5",
      // E5x: set channel finetune. Some trackers map x 0..15 to -8..7.
      description: "E5x: set channel finetune (often x 0..15 maps to -8..7)",
      paramFormat: "x_nibble",
      nominalX: 8,
   },
   PatternLoop: {
      value: 0x6,
      title: "Pattern Loop",
      patternChar: "E6",
      // E60 sets loop start at current row; E6x (x>0) decrements loop counter and jumps.
      description: "E6x: pattern loop (0=set loop start, x=loop count)",
      paramFormat: "x_nibble",
      nominalX: 2,
   },
   TremoloControl: {
      value: 0x7,
      title: "Tremolo Control",
      patternChar: "E7",
      description: "E7x: set tremolo waveform/control (implementation-defined)",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
   RetriggerNote: {
      value: 0x9,
      title: "Retrigger Note",
      patternChar: "E9",
      description: "E9x: retrigger note every x ticks (x=0 often means no-op)",
      paramFormat: "x_nibble",
      nominalX: 3,
   },
   FineVolumeSlideUp: {
      value: 0xA,
      title: "Fine Volume Slide Up",
      patternChar: "EA",
      // EAx: fine slide occurs on row only (tick 0) in many implementations.
      description: "EAx: fine volume slide up by x (row-only)",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   FineVolumeSlideDown: {
      value: 0xB,
      title: "Fine Volume Slide Down",
      patternChar: "EB",
      description: "EBx: fine volume slide down by x (row-only)",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   NoteCut: {
      value: 0xC,
      title: "Note Cut",
      patternChar: "EC",
      // ECx: cut note after x ticks (x=0 often immediate cut at tick 0).
      description: "ECx: note cut after x ticks",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
   NoteDelay: {
      value: 0xD,
      title: "Note Delay",
      patternChar: "ED",
      // EDx: delay note start by x ticks.
      description: "EDx: note delay by x ticks",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   PatternDelay: {
      value: 0xE,
      title: "Pattern Delay",
      patternChar: "EE",
      // EEx: delay the next pattern advance by x rows (or repeat current row group).
      // TODO(mod-playback): confirm exact semantics for the intended player.
      description: "EEx: pattern delay (repeat/delay pattern advance by x)",
      paramFormat: "x_nibble",
      nominalX: 1,
   },
   InvertLoop: {
      value: 0xF,
      title: "Invert Loop",
      patternChar: "EF",
      // EFx: extremely player-specific ("funk"/invert loop). Many modern players ignore.
      description: "EFx: invert loop / funk (rare; player-specific)",
      paramFormat: "x_nibble",
      nominalX: 0,
   },
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
