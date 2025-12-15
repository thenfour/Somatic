// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format

import {Tic80Caps} from "./tic80Capabilities";

export interface Tic80WaveformDto {
   name: string;
   amplitudes: Uint8Array;
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
export class Tic80Waveform implements Tic80WaveformDto {
   name: string;
   amplitudes: Uint8Array;

   // editor-only...
   constructor(data: Partial<Tic80WaveformDto> = {}) {
      this.name = data.name ?? "";

      this.amplitudes =
         data.amplitudes ? new Uint8Array(data.amplitudes) : new Uint8Array(Tic80Caps.waveform.pointCount);
   }

   static fromData(data?: Partial<Tic80WaveformDto>): Tic80Waveform {
      return new Tic80Waveform(data || {});
   }

   toData(): Tic80WaveformDto {
      return {
         name: this.name,
         amplitudes: new Uint8Array(this.amplitudes),
      };
   };

   clone(): Tic80Waveform {
      return new Tic80Waveform(this);
   }
}
