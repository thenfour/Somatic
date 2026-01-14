// low level tic-80 cart serialization utils
// nothing somatic-specific here.
import {Tic80Constants} from "../../../bridge/memory_layout";
import {SomaticInstrument, type SomaticInstrumentDto} from "../../models/instruments";
import {Song} from "../../models/song";
import {Tic80Caps} from "../../models/tic80Capabilities";
import {assert, clamp} from "../../utils/utils";

/** Chunk type IDs from https://github.com/nesbox/TIC-80/wiki/.tic-File-Format */
export const TicChunkType = {
   CODE: 5,
   SFX: 9,
   WAVEFORMS: 10,
   MUSIC_TRACKS: 14,
   MUSIC_PATTERNS: 15,
} as const;

export function packWaveformSamplesToBytes16(samples32: ArrayLike<number>): number[] {
   // TIC-80 packs 2x 4-bit samples per byte.
   // We store sample 0 in the low nibble, sample 1 in the high nibble.
   const out: number[] = new Array(16);
   for (let i = 0; i < 16; i++) {
      const a = clamp((samples32[i * 2] ?? 0) | 0, 0, 15);
      const b = clamp((samples32[i * 2 + 1] ?? 0) | 0, 0, 15);
      out[i] = (a & 0x0f) | ((b & 0x0f) << 4);
   }
   return out;
}

export function unpackTrackFrame(bytes: Uint8Array, startOffset = 0): [number, number, number, number] {
   const b0 = bytes[startOffset + 0] ?? 0;
   const b1 = bytes[startOffset + 1] ?? 0;
   const b2 = bytes[startOffset + 2] ?? 0;
   const packed = (b0 & 0xff) | ((b1 & 0xff) << 8) | ((b2 & 0xff) << 16);
   const patF = packed & 0x3f;
   const patS = (packed >> 6) & 0x3f;
   const patT = (packed >> 12) & 0x3f;
   const patQ = (packed >> 18) & 0x3f;
   return [patF, patS, patT, patQ];
}

export function decodeTrackSpeed(byte: number): number {
   const b = byte & 0xff;
   // Inverse of encodeTrackSpeed (consistent with (S + 6) % 255)
   if (b === 0)
      return 6;
   if (b <= 25)
      return clamp(b + 6, 1, 31);
   // 250..254 -> 1..5
   if (b >= 250)
      return clamp(b - 249, 1, 31);
   // Unexpected values: clamp to something reasonable.
   return clamp((b + 6) % 255, 1, 31);
}

export function decodeRowsPerPattern(byte: number): number {
   return clamp(64 - (byte & 0xff), 1, Tic80Caps.pattern.maxRows);
}

export function removeTrailingZerosFn(data: Uint8Array): Uint8Array {
   if (data.length === 0) {
      return data;
   }
   let endIndex = data.length;
   while (endIndex > 0 && data[endIndex - 1] === 0) {
      endIndex--;
   }
   // ensure at least 1 byte remains; i don't know what happens if we send a zero-length chunk.
   return data.slice(0, Math.max(1, endIndex));
}

export function createChunk(type: number, payload: Uint8Array, removeTrailingZeros: boolean, bank = 0): Uint8Array {
   // most chunks can have trailing zeros removed to save space.
   if (removeTrailingZeros) {
      payload = removeTrailingZerosFn(payload);
   }

   const chunk = new Uint8Array(4 + payload.length);
   chunk[0] = ((bank & 0x07) << 5) | (type & 0x1f);
   chunk[1] = payload.length & 0xff;
   chunk[2] = (payload.length >> 8) & 0xff;
   chunk[3] = 0; // reserved
   chunk.set(payload, 4);
   return chunk;
};

// convert a string to an ASCII-only Uint8Array payload (for converting Lua code to bytecode)
export function stringToAsciiPayload(str: string): Uint8Array {
   const codeBytes = new Uint8Array(str.length);
   for (let i = 0; i < str.length; i++) {
      codeBytes[i] = str.charCodeAt(i) & 0x7F; // ensure ASCII
   }
   return codeBytes;
};


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
export function encodeTempo(displayTempo: number): number {
   const tSigned = displayTempo - 150; // -118 .. +105 for 32..255
   return (tSigned + 256) & 0xFF;      // back to 0..255 byte
}
// for completeness
export function decodeTempo(byte: number): number {
   // byte is 0..255 from the cart
   const tSigned = byte >= 128 ? byte - 256 : byte; // convert to -128..127
   return tSigned + 150;                            // UI tempo
}

export function packTrackFrame(channelPatterns: [number, number, number, number]): [number, number, number] {
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


export function encodeWaveforms(song: Song, count: number): Uint8Array {
   // refer to https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
   // for a text description of the format.

   // This represents the sound wave-table data. This is copied to RAM at0x0FFE4...0x100E3.

   // This chunk stores the various waveforms used by sound effects. Due to the fact that waveforms heights go from 0 to 15 is is possible to store 2 height in 1 byte, this is why waveforms are 16 bytes but in the editor there are 32 points you can edit.
   const bytesPerWave = Tic80Caps.waveform.pointCount / 2; // 32 samples, 4 bits each, packed 2 per byte
   const buf = new Uint8Array(Tic80Caps.waveform.count * bytesPerWave);

   for (let w = 0; w < count; w++) {
      const waveform = song.waveforms[w];
      // serialize 32 samples (4 bits each, packed 2 per byte)
      for (let i = 0; i < 16; i++) {
         const sampleA = clamp(waveform.amplitudes[i * 2] ?? 0, 0, 15);
         const sampleB = clamp(waveform.amplitudes[i * 2 + 1] ?? 0, 0, 15);
         buf[w * bytesPerWave + i] = (sampleB << 4) | sampleA;
      }
   }
   return buf;
   //return writeChunk(CHUNK.WAVEFORMS, buf);
}

export const packLoop = (start: number, length: number): number => {
   const loopStart = clamp(start, 0, Tic80Caps.sfx.envelopeFrameCount - 1);
   const loopSize = clamp(
      length,
      0,
      Tic80Caps.sfx.envelopeFrameCount - 1); // don't care about logical correctness; just that we don't overflow
   return (loopSize << 4) | loopStart;
};

export const encodeInstrumentSpeed = (speed: number): number => {
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

export const decodeInstrumentSpeed = (byte: number): number => {
   // Inverse of encodeInstrumentSpeed: (S + 4) % 8
   return (byte + 4) & 0x07;
};

function decodeSignedNibble4(v: number): number {
   const nib = v & 0x0f;
   return nib >= 8 ? nib - 16 : nib;
}

export function decodeInstrumentFromBytes66(payload: Uint8Array, startOffset = 0): Partial<SomaticInstrumentDto> {
   // See https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#sfx
   // Missing bytes are treated as 0.
   const volumeFrames: number[] = new Array(Tic80Caps.sfx.envelopeFrameCount);
   const waveFrames: number[] = new Array(Tic80Caps.sfx.envelopeFrameCount);
   const arpeggioFrames: number[] = new Array(Tic80Caps.sfx.envelopeFrameCount);
   const pitchFrames: number[] = new Array(Tic80Caps.sfx.envelopeFrameCount);

   for (let tick = 0; tick < Tic80Caps.sfx.envelopeFrameCount; tick++) {
      const b0 = payload[startOffset + (tick * 2) + 0] ?? 0;
      const b1 = payload[startOffset + (tick * 2) + 1] ?? 0;

      const volEncoded = b0 & 0x0f;
      const wave = (b0 >> 4) & 0x0f;
      const pitchNib = (b1 >> 4) & 0x0f;
      const chord = b1 & 0x0f;

      volumeFrames[tick] = Tic80Caps.sfx.volumeMax - volEncoded;
      waveFrames[tick] = wave;
      arpeggioFrames[tick] = chord;

      // Stored pitch is a signed 4-bit nibble (-8..+7).
      const pitchSigned = decodeSignedNibble4(pitchNib);
      pitchFrames[tick] = clamp(pitchSigned - Tic80Caps.sfx.pitchMin, 0, 15);
   }

   const b60 = payload[startOffset + 60] ?? 0;
   const b61 = payload[startOffset + 61] ?? 0;
   const b62 = payload[startOffset + 62] ?? 0;
   const b63 = payload[startOffset + 63] ?? 0;
   const b64 = payload[startOffset + 64] ?? 0;
   const b65 = payload[startOffset + 65] ?? 0;

   const octave = b60 & 0x07;
   const pitch16x = ((b60 >> 3) & 0x01) !== 0;
   const speedBits = (b60 >> 4) & 0x07;
   const arpeggioDown = (b60 & 0x80) !== 0;

   const baseNote = b61 & 0x0f;
   const stereoLeft = ((b61 >> 4) & 0x01) === 0;
   const stereoRight = ((b61 >> 5) & 0x01) === 0;

   const waveLoopStart = b62 & 0x0f;
   const waveLoopLength = (b62 >> 4) & 0x0f;
   const volumeLoopStart = b63 & 0x0f;
   const volumeLoopLength = (b63 >> 4) & 0x0f;
   const arpeggioLoopStart = b64 & 0x0f;
   const arpeggioLoopLength = (b64 >> 4) & 0x0f;
   const pitchLoopStart = b65 & 0x0f;
   const pitchLoopLength = (b65 >> 4) & 0x0f;

   return {
      speed: decodeInstrumentSpeed(speedBits),
      baseNote,
      octave,
      stereoLeft,
      stereoRight,

      volumeFrames,
      volumeLoopStart,
      volumeLoopLength,

      arpeggioFrames,
      arpeggioLoopStart,
      arpeggioLoopLength,
      arpeggioDown,

      waveFrames,
      waveLoopStart,
      waveLoopLength,

      pitchFrames,
      pitchLoopStart,
      pitchLoopLength,
      pitch16x,
   };
}

export function decodeWaveformSamplesFromBytes16(payload: Uint8Array, startOffset = 0): number[] {
   // Inverse of packWaveformSamplesToBytes16 / encodeWaveforms.
   const out = new Array<number>(Tic80Caps.waveform.pointCount);
   for (let i = 0; i < 16; i++) {
      const b = payload[startOffset + i] ?? 0;
      out[i * 2] = b & 0x0f;
      out[i * 2 + 1] = (b >> 4) & 0x0f;
   }
   return out;
}

export type TicCartChunk = {
   bank: number; type: number; size: number; reserved: number; payload: Uint8Array; offset: number;
};

export function parseTicCartChunks(cartBytes: Uint8Array): TicCartChunk[] {
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#chunk-format
   const chunks: TicCartChunk[] = [];
   let offset = 0;

   while (offset < cartBytes.length) {
      if (offset + 4 > cartBytes.length) {
         throw new Error(`Invalid .tic: truncated chunk header at offset ${offset}`);
      }

      const b0 = cartBytes[offset + 0] ?? 0;
      const sizeLo = cartBytes[offset + 1] ?? 0;
      const sizeHi = cartBytes[offset + 2] ?? 0;
      const reserved = cartBytes[offset + 3] ?? 0;

      const bank = (b0 >> 5) & 0x07;
      const type = b0 & 0x1f;
      const size = (sizeLo & 0xff) | ((sizeHi & 0xff) << 8);

      const payloadStart = offset + 4;
      const payloadEnd = payloadStart + size;
      if (payloadEnd > cartBytes.length) {
         throw new Error(`Invalid .tic: chunk type ${type} bank ${bank} declares size ${
            size} but overruns file at offset ${offset}`);
      }

      chunks.push({
         bank,
         type,
         size,
         reserved,
         payload: cartBytes.subarray(payloadStart, payloadEnd),
         offset,
      });

      offset = payloadEnd;
   }

   return chunks;
}

export const encodeInstrument = (inst: SomaticInstrument): Uint8Array => {
   const out = new Uint8Array(Tic80Constants.BYTES_PER_SFX);

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

function makeTic80ReservedInstrument0(): SomaticInstrument {
   const inst = new SomaticInstrument();
   inst.name = "dontuse";
   return inst;
}

function makeTic80NoteOffInstrument1(): SomaticInstrument {
   const inst = new SomaticInstrument();
   inst.name = "off";
   inst.volumeFrames.fill(0);
   return inst;
}


export function encodeSfx(song: Song, count: number): Uint8Array {
   // 66 bytes per SFX (up to 64 entries in RAM).
   // Somatic instruments are serialized with a +2 offset to leave room for TIC-80 reserved instruments:
   //   0 = reserved (unused)
   //   1 = reserved silent instrument used for note offs
   //   2.. = Somatic instruments 0..
   const realCount = count + 2;
   const buf = new Uint8Array(realCount * Tic80Constants.BYTES_PER_SFX);

   const inst0 = makeTic80ReservedInstrument0();
   const inst1 = makeTic80NoteOffInstrument1();

   for (let ticIndex = 0; ticIndex < realCount; ticIndex++) {
      const inst = ticIndex === 0 ? inst0 : ticIndex === 1 ? inst1 : song.instruments[ticIndex - 2];
      assert(!!inst, `Missing instrument for TIC-80 SFX index ${ticIndex}`);
      const encoded = encodeInstrument(inst);
      buf.set(encoded, ticIndex * Tic80Constants.BYTES_PER_SFX);
   }

   return buf;
}
