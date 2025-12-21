// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format

import {Tic80Caps} from "./tic80Capabilities";

export interface Tic80WaveformDto {
   name: string;
   amplitudes: number[]; // length = 32
}
;

// aka "SFX" aka "sample" (from tic.h / sound.c)
//
// Chunk Type: 10
// This represents the sound wave-table data. This is copied to RAM at
// 0x0FFE4...0x100E3. This chunk stores the various waveforms used by sound
// effects. Due to the fact that waveforms heights go from 0 to 15 is is
// possible to store 2 height in 1 byte, this is why waveforms are 16 bytes but
// in the editor there are 32 points you can edit.
export class Tic80Waveform {
   name: string;
   amplitudes: Uint8Array;

   // editor-only...
   constructor(data: Partial<Tic80WaveformDto> = {}) {
      this.name = data.name ?? "";

      this.amplitudes =
         data.amplitudes ? new Uint8Array(data.amplitudes) : new Uint8Array(Tic80Caps.waveform.pointCount);

      // ensure correct length
      if (this.amplitudes.length !== Tic80Caps.waveform.pointCount) {
         const newAmps = new Uint8Array(Tic80Caps.waveform.pointCount);
         newAmps.set(this.amplitudes.subarray(0, Math.min(this.amplitudes.length, Tic80Caps.waveform.pointCount)));
         this.amplitudes = newAmps;
      }
   }

   static fromData(data?: Partial<Tic80WaveformDto>): Tic80Waveform {
      return new Tic80Waveform(data || {});
   }

   isNoise(): boolean {
      // all amplitudes are 0 or max
      const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;
      for (let i = 0; i < this.amplitudes.length; i++) {
         const amp = this.amplitudes[i]!;
         if (amp !== 0 && amp !== maxAmp) {
            return false;
         }
      }
      return true;
   }

   toData(): Tic80WaveformDto {
      return {
         name: this.name,
         amplitudes: [...this.amplitudes],
      };
   };

   clone(): Tic80Waveform {
      return new Tic80Waveform(this.toData());
   }

   contentSignature(): string {
      const dto = this.toData();
      const {name, ...content} = dto;
      return JSON.stringify(content);
   }
}
