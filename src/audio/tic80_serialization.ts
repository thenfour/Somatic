// low level tic-80 cart serialization utils
// nothing somatic-specific here.
import {Tic80Constants} from "../../bridge/memory_layout";
import {Tic80Instrument} from "../models/instruments";
import {Song} from "../models/song";
import {Tic80Caps} from "../models/tic80Capabilities";
import {clamp} from "../utils/utils";

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

export const encodeInstrument = (inst: Tic80Instrument): Uint8Array => {
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


export function encodeSfx(song: Song, count: number): Uint8Array {
   // 66 bytes per SFX (up to 64 entries in RAM). We only fill instruments (1..INSTRUMENT_COUNT).
   //const sfxCount = getMaxSfxUsedIndex(song);
   const buf = new Uint8Array(count * Tic80Constants.BYTES_PER_SFX);

   for (let i = 1; i < count; i++) {
      const encoded = encodeInstrument(song.instruments?.[i]);
      buf.set(encoded, i * Tic80Constants.BYTES_PER_SFX);
   }

   return buf;
}
