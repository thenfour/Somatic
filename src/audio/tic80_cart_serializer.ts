import {NOTE_INFOS} from "../defs";
import type {Tic80Instrument} from "../models/instruments";
import {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {SomaticCaps, Tic80Caps, Tic80ChannelIndex} from "../models/tic80Capabilities";
import {assert, clamp} from "../utils/utils";
import {base85Encode} from "./encoding";
import playroutineTemplate from "../../bridge/playroutine-min.lua";

/** Chunk type IDs from https://github.com/nesbox/TIC-80/wiki/.tic-File-Format */
// see also: tic.h / sound.c (TIC80_SOURCE)
const CHUNK = {
   CODE: 5,
   SFX: 9,
   WAVEFORMS: 10,
   MUSIC_TRACKS: 14,
   MUSIC_PATTERNS: 15,
} as const;

const SFX_BYTES_PER_SAMPLE = 66;

function encodePatternNote(midiNoteValue: number|undefined): {noteNibble: number; octave: number} {
   if (midiNoteValue === undefined) {
      return {noteNibble: 0, octave: 0};
   }
   const noteInfo = NOTE_INFOS[midiNoteValue]!;
   return {
      noteNibble: noteInfo.ticNoteNibble, octave: noteInfo.octave,
   }
};

function encodePatternCellTriplet(
   midiNoteValue: number|undefined, instrument: number, command: number, argX: number, argY: number):
   [number, number, number] {
   const ticPitch = encodePatternNote(midiNoteValue);

   const byte0 = ((argX & 0xf) << 4) | (ticPitch.noteNibble & 0x0f);
   const byte1 = ((instrument >> 5) & 0x01) << 7 | ((command & 0x07) << 4) | (argY & 0x0f);
   const byte2 = ((ticPitch.octave & 0x07) << 5) | (instrument & 0x1f);
   return [byte0, byte1, byte2];
}

// outputs 4 patterns (one for each channel)
export function encodePatternChannel(pattern: Pattern, channelIndex: Tic80ChannelIndex): Uint8Array {
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-patterns
   // chunk type 15
   // RAM at 0x11164...0x13E63
   // 192 bytes per pattern (16 rows x 4 channels x 3 bytes)
   // note: sfx number of 0 is valid in tic-80.

   //    Each pattern is 192 bytes long (trailing zeros are removed). Each note in a patters is represented by a triplet of bytes, like this:
   // ----NNNN SCCCAAAA OOOSSSSS

   // Explanation :

   //     N is the note number (4-15 for notes and <4 for stops)
   //     S is the sfx number (the part in byte 2 is to be added to the one in byte 3 after shifting it to the left 2 times)
   //     C is the command to be performed on the note (0-7 -> MCJSPVD)
   //     A is the x and y arguments for each command
   //     O is the octave of each note

   const buf = new Uint8Array(Tic80Caps.pattern.maxRows * 3);

   for (let row = 0; row < Tic80Caps.pattern.maxRows; row++) {
      const cellData = pattern.getCell(channelIndex, row);
      const inst = cellData.instrumentIndex ?? 0;
      const commandArgX = cellData.effectX ?? 0;
      const commandArgY = cellData.effectY ?? 0;
      const command = cellData.effect === undefined ? 0 : clamp(cellData.effect + 1, 0, 7);
      const [b0, b1, b2] = encodePatternCellTriplet(cellData.midiNote, inst, command, commandArgX, commandArgY);
      const base = 3 * row;
      buf[base + 0] = b0;
      buf[base + 1] = b1;
      buf[base + 2] = b2;
   }
   //}

   return buf;
}

export function encodePattern(pattern: Pattern): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
   const encoded0 = encodePatternChannel(pattern, 0);
   const encoded1 = encodePatternChannel(pattern, 1);
   const encoded2 = encodePatternChannel(pattern, 2);
   const encoded3 = encodePatternChannel(pattern, 3);
   return [encoded0, encoded1, encoded2, encoded3];
};

export function encodePatternCombined(pattern: Pattern): Uint8Array {
   const [encoded0, encoded1, encoded2, encoded3] = encodePattern(pattern);
   const combined = new Uint8Array(encoded0.length + encoded1.length + encoded2.length + encoded3.length);
   let offset = 0;
   combined.set(encoded0, offset);
   offset += encoded0.length;
   combined.set(encoded1, offset);
   offset += encoded1.length;
   combined.set(encoded2, offset);
   offset += encoded2.length;
   combined.set(encoded3, offset);
   return combined;
};

// each of OUR internal patterns is actually 4 tic80 patterns (channel A, B, C, D) in series.
// so for double-buffering, the front buffer for the 4 channels is [0,1,2,3], and the back buffer is [4,5,6,7], etc.
// we output as a 4-channel pattern quad in order so it can just be copied directly to TIC-80 memory.
function encodeRealPatterns(song: Song): Uint8Array[] {
   const ret: Uint8Array[] = [];
   for (let p = 0; p < song.patterns.length; p++) {
      const pattern = song.patterns[p]!;
      const combined = encodePatternCombined(pattern);
      ret.push(combined);
   }
   return ret;
}

function encodeNullPatterns(): Uint8Array {
   const patterns = new Uint8Array(Tic80Caps.pattern.count * Tic80Caps.pattern.maxRows * 3);
   return patterns;
}

// Decode raw byte S from the CHUNK_MUSIC track into "display speed" (1..31)
export function decodeTrackSpeed(rawSpeedByte: number): number {
   // rawSpeedByte: 0..255
   const speed = (rawSpeedByte + 6) % 255;
   // Spec says valid range is 1..31; clamp just in case
   return clamp(speed, 1, 31);
}

// Encode desired display speed (1..31) into raw S byte for CHUNK_MUSIC
export function encodeTrackSpeed(displaySpeed: number): number {
   // ensure integer & clamp to legal range
   let speed = clamp(displaySpeed, 1, 31);

   // Use the canonical mapping consistent with (S + 6) % 255
   if (speed === 6)
      return 0; // default speed
   if (speed >= 7)
      return speed - 6; // 7..31 -> 1..25
   // speed in 1..5
   return speed + 249; // 1..5 -> 250..254
}

// Tempo: decode is T + 150; we do not track tempo, so default 150 -> store 0
function encodeTempo(displayTempo: number): number {
   const tSigned = displayTempo - 150; // -118 .. +105 for 32..255
   return (tSigned + 256) & 0xFF;      // back to 0..255 byte
}
// for completeness
export function decodeTempo(byte: number): number {
   // byte is 0..255 from the cart
   const tSigned = byte >= 128 ? byte - 256 : byte; // convert to -128..127
   return tSigned + 150;                            // UI tempo
}

function packTrackFrame(channelPatterns: [number, number, number, number]): [number, number, number] {
   const patF = channelPatterns[0] & 0x3f;
   const patS = channelPatterns[1] & 0x3f;
   const patT = channelPatterns[2] & 0x3f;
   const patQ = channelPatterns[3] & 0x3f;
   const packed = patF | (patS << 6) | (patT << 12) | (patQ << 18);
   const byte0 = packed & 0xff;
   const byte1 = (packed >> 8) & 0xff;
   const byte2 = (packed >> 16) & 0xff;
   return [byte0, byte1, byte2];
};

function encodeTrack(song: Song): Uint8Array {
   /*
    This represents the music track data. This is copied to RAM at 0x13E64...0x13FFB.

    This chunk contains the various music tracks, as composed of 51 bytes where trailing zeros are removed, the structure is as follows

    1-48 	FFFFFFSSSSSSTTTTTTQQQQQQ 	The bytes here are arranged in triplets where
    F is the number of the pattern on the first channel
    S is the number of the pattern on the second channel
    T is the number of the pattern on the third channel
    Q is the number of the pattern on the fourth channel
    49 	SSSSSSSS 	S is the speed of the track
    50 	RRRRRRRR 	R is the number of rows in each pattern
    51 	TTTTTTTT 	T is the tempo of the track

    Although the individual notes are stored as 6 bits in the editor the maximum number that can be used is 60 (may be possible to insert illegal pattern in music tracks?)
    To get the correct speed of the track do: (S + 6) % 255
    To get the correct number of rows of the track do: 64 - R
    To get the correct tempo of the track do: T + 150.

    - tempo is a signed byte. it's stored as the delta from the default tempo of 150 bpm.
    so to get the actual tempo, you do: T + 150

   */

   // fill tracks with our double-buffering strategy.
   // we will fill all 16 steps, intended to alternate between front and back "buffer"s of pattern data.
   // in order to keep swaps single-op, each pattern "buffer" is 4 patterns long (one per channel).

   const buf = new Uint8Array(3 * Tic80Caps.song.maxSongLength + 3); // 48 bytes positions + speed/rows/tempo
   for (let i = 0; i < Tic80Caps.song.maxSongLength; i++) {
      const isFrontBuffer = (i % 2) === 0; // 0 or 1
      // pattern id 0 is a "no pattern". they are 1-based in the track data.
      const channelPatterns: [number, number, number, number] = isFrontBuffer ? [1, 2, 3, 4] : [5, 6, 7, 8];
      const [b0, b1, b2] = packTrackFrame(channelPatterns);
      const base = i * 3;
      buf[base + 0] = b0;
      buf[base + 1] = b1;
      buf[base + 2] = b2;
   }

   // Speed: decode is (S + 6) % 255; clamp to 0..254
   //const speedByte = (song.speed - 6 + 255) % 255;
   // peek(81556)
   buf[50] = encodeTrackSpeed(song.speed); //speedByte & 0xff;

   // Rows: decode is 64 - R (so encode is the same op)
   // peek(81557)
   buf[49] = 64 - song.rowsPerPattern;

   // peek(81558)
   buf[48] = encodeTempo(song.tempo);

   //return writeChunk(CHUNK.MUSIC_TRACKS, buf);
   return buf;
}

function encodeWaveforms(song: Song): Uint8Array {
   // refer to https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
   // for a text description of the format.

   // This represents the sound wave-table data. This is copied to RAM at0x0FFE4...0x100E3.

   // This chunk stores the various waveforms used by sound effects. Due to the fact that waveforms heights go from 0 to 15 is is possible to store 2 height in 1 byte, this is why waveforms are 16 bytes but in the editor there are 32 points you can edit.
   const bytesPerWave = Tic80Caps.waveform.pointCount / 2; // 32 samples, 4 bits each, packed 2 per byte
   const buf = new Uint8Array(Tic80Caps.waveform.count * bytesPerWave);

   for (let w = 0; w < Tic80Caps.waveform.count; w++) {
      const waveform = song.waveforms[w];
      // serialize 32 samples (4 bits each, packed 2 per byte)
      for (let i = 0; i < 16; i++) {
         const sampleA = clamp(waveform.amplitudes[i * 2] ?? 0, 0, 15);
         const sampleB = clamp(waveform.amplitudes[i * 2 + 1] ?? 0, 0, 15);
         buf[w * bytesPerWave + i] = (sampleA << 4) | sampleB;
      }
   }
   return buf;
   //return writeChunk(CHUNK.WAVEFORMS, buf);
}

function encodeSfx(song: Song): Uint8Array {
   const packLoop = (start: number, length: number): number => {
      const loopStart = clamp(start, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      const loopSize = clamp(
         length,
         0,
         Tic80Caps.sfx.envelopeFrameCount - 1); // don't care about logical correctness; just that we don't overflow
      return (loopSize << 4) | loopStart;
   };

   const encodeInstrumentSpeed = (speed: number): number => {
      // speed is an 3-bit value; in the editor it's 0..7
      // but stored differently:
      // "The sample speed bytes should added to 4 and then you should preform the modulus operation with 8 on it ((S + 4) % 8)"
      // so effectively minus 4 with wrapping.
      let val = speed - 4;
      if (val < 0) {
         val += 8;
      }
      return val & 0x07;
   };

   const encodeInstrument = (inst: Tic80Instrument): Uint8Array => {
      const out = new Uint8Array(SFX_BYTES_PER_SAMPLE);

      for (let tick = 0; tick < Tic80Caps.sfx.envelopeFrameCount; tick++) {
         const vol = Tic80Caps.sfx.volumeMax - clamp(inst.volumeFrames[tick], 0, Tic80Caps.sfx.volumeMax);
         const wave = clamp(inst.waveFrames[tick], 0, 15);
         const chord = clamp(inst.arpeggioFrames[tick], 0, 15);
         const pitch = clamp(
            inst.pitchFrames[tick] + Tic80Caps.sfx.pitchMin,
            Tic80Caps.sfx.pitchMin,
            Tic80Caps.sfx.pitchMax); // incoming is 0-15; map to -8..+7

         out[tick * 2 + 0] = ((wave & 0x0f) << 4) | (vol & 0x0f);
         out[tick * 2 + 1] = ((pitch & 0x0f) << 4) | (chord & 0x0f);
      }

      const reverse = inst.arpeggioDown ? 1 : 0;
      const speedBits = encodeInstrumentSpeed(inst.speed);
      const octave = clamp(inst.octave ?? 0, 0, 7);
      const pitch16x = inst.pitch16x ? 1 : 0;
      out[60] = (octave & 0x07) | (pitch16x << 3) | (speedBits << 4) | (reverse ? 0x80 : 0);

      const baseNote = clamp(inst.baseNote ?? 0, 0, 11);
      const stereoLeft = inst.stereoLeft ? 0 : 1;
      const stereoRight = inst.stereoRight ? 0 : 1;
      out[61] = (baseNote & 0x0f) | (stereoLeft << 4) | (stereoRight << 5);

      out[62] = packLoop(inst.waveLoopStart, inst.waveLoopLength);
      out[63] = packLoop(inst.volumeLoopStart, inst.volumeLoopLength);
      out[64] = packLoop(inst.arpeggioLoopStart, inst.arpeggioLoopLength);
      out[65] = packLoop(inst.pitchLoopStart, inst.pitchLoopLength);

      return out;
   };

   // 66 bytes per SFX (up to 64 entries in RAM). We only fill instruments (1..INSTRUMENT_COUNT).
   const sfxCount = Tic80Caps.maxSfx; // 64
   const buf = new Uint8Array(sfxCount * SFX_BYTES_PER_SAMPLE);

   for (let i = 1; i < sfxCount; i++) {
      const encoded = encodeInstrument(song.instruments?.[i]);
      buf.set(encoded, i * SFX_BYTES_PER_SAMPLE);
   }

   return buf;
}

// upon sending to the tic80, we send a payload which includes all the song data in a single chunk.
// that chunk is meant to be copied to RAM at 0x0FFE4, and includes the following data:
// | 0FFE4 | WAVEFORMS            | 256   |
// | 100E4 | SFX                  | 4224  |
// | 11164 | MUSIC PATTERNS       | 11520 |
// | 13E64 | MUSIC TRACKS         | 408   | <-- for the 8 tracks. but we only need 1, so size=51
//
// but we also pass a separate pattern data chunk which is used for playback because we
// copy pattern data ourselves to work around tic80 length limitations.
export interface Tic80SerializedSong {
   memory_0FFE4: Uint8Array;

   // length + order itself
   songOrderData: Uint8Array;

   // each somatic pattern is actually 4 patterns (channel A, B, C, D) in series. allows copying patterns in 1 go for all 4 channels.
   patternData: Uint8Array;
}

export function serializeSongForTic80Bridge(song: Song): Tic80SerializedSong {
   const parts: Uint8Array[] = [];

   // should follow this:
   // | 0FFE4 | WAVEFORMS            | 256   |
   // | 100E4 | SFX                  | 4224  |
   // | 11164 | MUSIC PATTERNS       | 11520 |
   // | 13E64 | MUSIC TRACKS         | 408   | <-- for the 8 tracks. but we only need 1, so size=51
   // total of 16408 bytes of music data.

   const waveformData = encodeWaveforms(song);
   const sfxData = encodeSfx(song);
   const nullPatternData = encodeNullPatterns();
   const trackData = encodeTrack(song);

   //    // overwrite nullPatternData with real patterns for testing
   //    for (let i = 0; i < realPatternData.length; i++) {
   //       const patternBytes = realPatternData[i]!;
   //       nullPatternData.set(patternBytes, i * patternBytes.length);
   //    }

   assert(waveformData.length == 256, `Unexpected waveform chunk size: ${waveformData.length}; expected 256`);
   assert(sfxData.length == 4224, `Unexpected SFX chunk size: ${sfxData.length}; expected 4224`);
   assert(nullPatternData.length == 11520, `Unexpected patterns chunk size: ${nullPatternData.length}; expected 11520`);
   //assert(realPatternData.length == 408, `Unexpected realPatternData size: ${realPatternData.length}; expected 408`);
   assert(trackData.length == 51, `Unexpected track chunk size: ${trackData.length}; expected 51`);

   parts.push(waveformData);
   parts.push(sfxData);
   parts.push(nullPatternData);
   parts.push(trackData);

   const total = parts.reduce((sum, p) => sum + p.length, 0);
   const out = new Uint8Array(total);
   let offset = 0;
   for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
   }

   // serialize song order data
   const songOrderData = new Uint8Array(1 + SomaticCaps.maxSongLength);
   songOrderData[0] = song.songOrder.length;
   for (let i = 0; i < SomaticCaps.maxSongLength; i++) {
      const patternIndex = song.songOrder[i] ?? 0;
      songOrderData[1 + i] = patternIndex & 0xff;
   }

   const realPatternData = encodeRealPatterns(song); // separate pattern data for playback use

   return {
      memory_0FFE4: out,
      songOrderData,
      patternData: ch_serializePatterns(realPatternData),
   };
}

// for each pattern blob, serialize as:
// [0..1] length of the pattern blob (u16 little-endian)
// [2..N] the blob
// it means to find pattern i, you have to walk the struct.
function ch_serializePatterns(patterns: Uint8Array[]): Uint8Array {
   // Calculate total size needed
   let totalSize = 0;
   for (const pattern of patterns) {
      totalSize += 2 + pattern.length; // 2 bytes for length + pattern data
   }

   assert(
      patterns[0].length === 768,
      `ch_serializePatterns: unexpected pattern length ${patterns[0].length}, expected 768`);

   const output = new Uint8Array(totalSize);
   let writePos = 0;

   const stats: {checksum: number; length: number; firstBytes: string;}[] = [];

   for (const pattern of patterns) {
      const length = pattern.length & 0xffff;

      // Write length as u16 little-endian
      output[writePos++] = length & 0xff;
      output[writePos++] = (length >> 8) & 0xff;

      // Write pattern data
      output.set(pattern, writePos);
      writePos += pattern.length;


      // calculate a sum of all bytes in this pattern
      let runningTotal = 0;
      for (let i = 0; i < pattern.length; i++) {
         runningTotal += pattern[i];
      }
      runningTotal &= 0xFFFFFFFF; // keep it within 32-bit range
      const firstBytes = Array.from(pattern.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" ");
      stats.push({checksum: runningTotal, length: pattern.length, firstBytes});
   }

   console.log(`ch_serializePatterns: serialized ${patterns.length} patterns, total size ${totalSize} bytes`);
   console.log(stats);

   return output;
}


function createChunk(type: number, payload: Uint8Array, bank = 0): Uint8Array {
   const chunk = new Uint8Array(4 + payload.length);
   chunk[0] = ((bank & 0x07) << 5) | (type & 0x1f);
   chunk[1] = payload.length & 0xff;
   chunk[2] = (payload.length >> 8) & 0xff;
   chunk[3] = 0; // reserved
   chunk.set(payload, 4);
   return chunk;
};

function stringToAsciiPayload(str: string): Uint8Array {
   const codeBytes = new Uint8Array(str.length);
   for (let i = 0; i < str.length; i++) {
      codeBytes[i] = str.charCodeAt(i) & 0x7F; // ensure ASCII
   }
   return codeBytes;
};

// takes string contents, returns Lua string literal with quotes and escapes.
function toLuaStringLiteral(str: string): string {
   const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
   return `"${escaped}"`;
};

function getCode(song: Song): string {
   // Generate the MUSIC_DATA section
   const songOrder = song.songOrder.map(idx => idx.toString()).join(",");

   const patternStringContents = song.patterns.map((pattern, patternIndex) => {
      // encode pattern to base85 string
      const encodedPattern = encodePatternCombined(pattern);

      // Calculate checksum for debugging
      let checksum = 0;
      for (let i = 0; i < encodedPattern.length; i++) {
         checksum += encodedPattern[i];
      }
      console.log(`Pattern ${patternIndex} checksum: ${checksum} (bytes: ${encodedPattern.length})`);

      let patternStr = base85Encode(encodedPattern);
      return patternStr;
   });
   const patternArray = patternStringContents.map(p => toLuaStringLiteral(p)).join(",\n\t\t");

   const musicDataSection = `local MUSIC_DATA = {
\tsongOrder = { ${songOrder} },
\tpatterns = {
\t\t${patternArray}
\t},
}
-- END_SOMATIC_MUSIC_DATA`;

   // Replace the MUSIC_DATA section in the template
   const markerIndex = playroutineTemplate.indexOf("-- END_SOMATIC_MUSIC_DATA");
   if (markerIndex === -1) {
      throw new Error("Template marker \"-- END_SOMATIC_MUSIC_DATA\" not found in playroutine-min.lua");
   }

   const musicDataStart = playroutineTemplate.indexOf("local MUSIC_DATA");
   if (musicDataStart === -1) {
      throw new Error("Could not find \"local MUSIC_DATA\" in template");
   }

   // Replace from musicDataStart to end of marker line
   const markerLineEnd = playroutineTemplate.indexOf("\n", markerIndex);
   const beforeMusicData = playroutineTemplate.substring(0, musicDataStart);
   const afterMarker = playroutineTemplate.substring(markerLineEnd + 1);

   return beforeMusicData + musicDataSection + "\n" + afterMarker;
}

export function serializeSongToCart(song: Song): Uint8Array {
   // TODO: optimize song.
   // e.g., remove unused instruments, waveforms, patterns, shift to pack etc.

   // cartridges are a simple concatenation of chunks.
   // each chunk has a 4-byte header, followed by payload.
   // the header is:
   // byte 0: bank (3 bits) + chunk type (5 bits)
   // byte 1-2: payload length (u16 little-endian)
   // byte 3: reserved (0)

   const waveformChunk = createChunk(CHUNK.WAVEFORMS, encodeWaveforms(song));
   const sfxChunk = createChunk(CHUNK.SFX, encodeSfx(song));
   const patternChunk = createChunk(CHUNK.MUSIC_PATTERNS, encodeNullPatterns());
   const trackChunk = createChunk(CHUNK.MUSIC_TRACKS, encodeTrack(song));
   const codePayload = stringToAsciiPayload(getCode(song));
   const codeChunk = createChunk(CHUNK.CODE, codePayload, 0);

   const chunks: Uint8Array[] = [
      codeChunk,
      waveformChunk,
      sfxChunk,
      patternChunk,
      trackChunk,
   ];

   const totalSize = chunks.reduce((sum, p) => sum + p.length, 0);
   const cartridge = new Uint8Array(totalSize);
   let offset = 0;
   for (const p of chunks) {
      cartridge.set(p, offset);
      offset += p.length;
   }

   return cartridge;
}