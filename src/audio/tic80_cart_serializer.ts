import {midiToTicPitch} from "../defs";
import type {Song} from "../models/song";
import type {Pattern} from "../models/pattern";
import type {Tic80Instrument} from "../models/instruments";
import {clamp} from "../utils/utils";
import {Tic80Caps} from "../models/tic80Capabilities";

/** Chunk type IDs from https://github.com/nesbox/TIC-80/wiki/.tic-File-Format */
// see also: tic.h / sound.c (TIC80_SOURCE)
const CHUNK = {
   SFX: 9,
   WAVEFORMS: 10,
   MUSIC_TRACKS: 14,
   MUSIC_PATTERNS: 15,
} as const;

//const SONG_TRACK_STEPS = 16; // TIC-80 stores 16 pattern slots per track
//const PATTERN_ROWS = 16; // patterns chunk stores 16 rows per channel (192 bytes)
//const CHANNEL_COUNT = 4;
//const SFX_TICKS = 30;
const SFX_BYTES_PER_SAMPLE = 66;

/** Trim trailing zero bytes (spec allows chunk truncation). */
function trimTrailingZeros(data: Uint8Array): Uint8Array {
   let last = data.length - 1;
   while (last >= 0 && data[last] === 0)
      last--;
   return data.slice(0, last + 1);
}

function writeChunk(type: number, payload: Uint8Array, bank = 0): Uint8Array {
   const data = trimTrailingZeros(payload);
   const header = new Uint8Array(4 + data.length);
   header[0] = ((bank & 0x07) << 5) | (type & 0x1f);
   header[1] = data.length & 0xff;
   header[2] = (data.length >> 8) & 0xff;
   header[3] = 0; // reserved
   header.set(data, 4);
   return header;
}

function encodeNoteTriplet(midiNoteValue: number, instrument: number): [number, number, number] {
   // Rest/no-note
   const ticPitch = midiToTicPitch(midiNoteValue);
   if (!ticPitch)
      return [0, 0, 0];

   const sfx = Math.max(0, Math.min(255, instrument | 0));
   const command = 0; // no effect command for now
   const arg = 0;

   const byte0 = ticPitch.noteNibble & 0x0f;
   const byte1 = ((sfx >> 5) & 0x01) << 7 | ((command & 0x07) << 4) | (arg & 0x0f);
   const byte2 = ((ticPitch.octave & 0x07) << 5) | (sfx & 0x1f);
   return [byte0, byte1, byte2];
}

function encodePattern(pattern: Pattern): Uint8Array {
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-patterns
   // chunk type 15
   // RAM at 0x11164...0x13E63
   // 192 bytes per pattern (16 rows x 4 channels x 3 bytes)
   // note: sfx number of 0 is valid in tic-80.

   //    Each pattern is 192 bytes long (trailing zeros are removed). Each note in a patters is represented by a triplet of bytes, like this: ----NNNN SCCCAAAA OOOSSSSS

   // Explanation :

   //     N is the note number (4-15 for notes and <4 for stops)
   //     S is the sfx number (the part in byte 2 is to be added to the one in byte 3 after shifting it to the left 2 times)
   //     C is the command to be performed on the note (0-7 -> MCJSPVD)
   //     A is the x and y arguments for each command
   //     O is the octave of each note


   const buf = new Uint8Array(Tic80Caps.pattern.maxRows * 3);

   // for (let row = 0; row < PATTERN_ROWS; row++) {
   //     for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
   //         const rowData = pattern.channels[ch]?.rows[row];
   //         const midiNoteValue = rowData?.note ?? 0;
   //         const inst = rowData?.instrument ?? 0;
   //         const [b0, b1, b2] = encodeNoteTriplet(midiNoteValue, inst);
   //         const idx = (row * CHANNEL_COUNT + ch) * 3;
   //         buf[idx + 0] = b0;
   //         buf[idx + 1] = b1;
   //         buf[idx + 2] = b2;
   //     }
   // }

   return buf;
}

function encodePatterns(song: Song): Uint8Array {
   const patterns = new Uint8Array(Tic80Caps.pattern.count * Tic80Caps.pattern.maxRows * 3);
   for (let p = 0; p < Tic80Caps.pattern.count; p++) {
      const pattern = song.patterns[p];
      if (!pattern)
         continue;
      const encoded = encodePattern(pattern);
      patterns.set(encoded, p * encoded.length);
   }
   return writeChunk(CHUNK.MUSIC_PATTERNS, patterns);
}

function encodeTrack(song: Song): Uint8Array {
   const buf = new Uint8Array(51); // 48 bytes positions + speed/rows/tempo
   // const steps = Math.min(SONG_TRACK_STEPS, song.length);
   // for (let i = 0; i < steps; i++) {
   //     const patIndex = song.positions[i] ?? 0;
   //     const packed = (patIndex & 0x3f) // F
   //         | ((patIndex & 0x3f) << 6) // S
   //         | ((patIndex & 0x3f) << 12) // T
   //         | ((patIndex & 0x3f) << 18); // Q
   //     const base = i * 3;
   //     buf[base + 0] = packed & 0xff;
   //     buf[base + 1] = (packed >> 8) & 0xff;
   //     buf[base + 2] = (packed >> 16) & 0xff;
   // }

   // Speed: decode is (S + 6) % 255; clamp to 0..254
   const speedByte = (song.speed - 6 + 255) % 255;
   buf[48] = speedByte & 0xff;

   // Rows: decode is 64 - R
   buf[49] = 64 - 64; // we always encode 64 rows -> 0

   // Tempo: decode is T + 150; we do not track tempo, so default 150 -> store 0
   buf[50] = 0;

   return writeChunk(CHUNK.MUSIC_TRACKS, buf);
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
   return writeChunk(CHUNK.WAVEFORMS, buf);
}

function encodeSfx(song: Song): Uint8Array {
   const packLoop = (start: number, length: number): number => {
      const loopStart = clamp(start, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
      const loopSize = clamp(
         length, 0, Tic80Caps.sfx.envelopeFrameCount - 1); // don't care about correctness; just that we don't overflow
      return (loopSize << 4) | loopStart;
   };

   const encodeInstrument = (inst?: Tic80Instrument): Uint8Array => {
      const out = new Uint8Array(SFX_BYTES_PER_SAMPLE);
      if (!inst)
         return out;

      for (let tick = 0; tick < Tic80Caps.sfx.envelopeFrameCount; tick++) {
         const vol = clamp(inst.volumeFrames[tick], 0, 15);
         const wave = clamp(inst.waveFrames[tick], 0, 15);
         const chord = clamp(inst.arpeggioFrames[tick], 0, 15);
         const pitch = clamp(inst.pitchFrames[tick], -8, 7);

         out[tick * 2 + 0] = ((wave & 0x0f) << 4) | (vol & 0x0f);
         out[tick * 2 + 1] = ((pitch & 0x0f) << 4) | (chord & 0x0f);
      }

      const reverse = inst.arpeggioDown ? 1 : 0;
      const speedBits = inst.speed & 0x07; // stored as signed 3 bits in TIC-80
      const octave = clamp(inst.octave ?? 0, 0, 7);
      const pitch16x = inst.pitch16x ? 1 : 0;
      out[60] = (octave & 0x07) | (pitch16x << 3) | (speedBits << 4) | (reverse ? 0x80 : 0);

      const baseNote = clamp(inst.baseNote ?? 0, 0, 11);
      const stereoLeft = inst.stereoLeft ? 1 : 0;
      const stereoRight = inst.stereoRight ? 1 : 0;
      out[61] = (baseNote & 0x0f) | (stereoLeft << 4) | (stereoRight << 5);

      out[62] = packLoop(inst.waveLoopStart, inst.waveLoopLength);
      out[63] = packLoop(inst.volumeLoopStart, inst.volumeLoopLength);
      out[64] = packLoop(inst.arpeggioLoopStart, inst.arpeggioLoopLength);
      out[65] = packLoop(inst.pitchLoopStart, inst.pitchLoopLength);

      return out;
   };

   // 66 bytes per SFX (up to 64 entries in RAM). We only fill instruments (1..INSTRUMENT_COUNT).
   const sfxCount = Tic80Caps.maxSfx; // reserve index 0
   const buf = new Uint8Array(sfxCount * SFX_BYTES_PER_SAMPLE);

   for (let i = 1; i < sfxCount; i++) {
      const encoded = encodeInstrument(song.instruments?.[i]);
      buf.set(encoded, i * SFX_BYTES_PER_SAMPLE);
   }

   return writeChunk(CHUNK.SFX, buf);
}

export function serializeSongToCart(song: Song): Uint8Array {
   const parts: Uint8Array[] = [];
   parts.push(encodeWaveforms(song));
   parts.push(encodeSfx(song));
   parts.push(encodePatterns(song));
   parts.push(encodeTrack(song));

   const total = parts.reduce((sum, p) => sum + p.length, 0);
   const out = new Uint8Array(total);
   let offset = 0;
   for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
   }
   return out;
}
