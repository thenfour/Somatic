import {fromBase64, toBase64} from "../utils/encoding";
import {MorphSamplePcmDto} from "../models/instruments";
import {SomaticCaps} from "../models/tic80Capabilities";

export type DecodedPcm = {
   fileName: string; //
   sampleRateHz: number;
   channelCount: number;
   frameCount: number;
   channels: Float32Array[];
};

function makeAudioContext(): AudioContext {
   const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
   if (!Ctor) {
      throw new Error("AudioContext is not available in this environment");
   }
   return new Ctor();
}

export async function decodeWavArrayBuffer(
   {wavBytes, fileName}: {wavBytes: ArrayBuffer; fileName: string},
   ): Promise<DecodedPcm> {
   const audioContext = makeAudioContext();
   try {
      // Some browsers detach/consume the passed ArrayBuffer. Slice to be safe.
      const buf = wavBytes.slice(0);
      const audioBuffer = await audioContext.decodeAudioData(buf);

      const channelCount = audioBuffer.numberOfChannels;
      const frameCount = audioBuffer.length;
      const channels: Float32Array[] = [];
      for (let c = 0; c < channelCount; c++) {
         const src = audioBuffer.getChannelData(c);
         const copy = new Float32Array(src.length);
         copy.set(src);
         channels.push(copy);
      }

      return {
         fileName,
         sampleRateHz: audioBuffer.sampleRate,
         channelCount,
         frameCount,
         channels,
      };
   } finally {
      // avoid leaking AudioContext instances
      await audioContext.close();
   }
}

export function encodeFloat32PcmToDto(decoded: DecodedPcm): MorphSamplePcmDto {
   const channelPcmF32Base64 = decoded.channels.map((ch) => {
      const bytes = new Uint8Array(ch.length * 4);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < ch.length; i++) {
         view.setFloat32(i * 4, ch[i] ?? 0, true);
      }
      return toBase64(bytes); // base85 would have been an option ....
   });

   return {
      fileName: decoded.fileName,
      sampleRateHz: decoded.sampleRateHz,
      channelCount: decoded.channelCount,
      frameCount: decoded.frameCount,
      channelPcmF32Base64,
   };
}

export function decodeFloat32PcmFromDto(dto: MorphSamplePcmDto): DecodedPcm {
   const channels: Float32Array[] = [];
   for (let c = 0; c < dto.channelCount; c++) {
      const b64 = dto.channelPcmF32Base64[c] ?? "";
      const bytes = fromBase64(b64);
      const frameCount = Math.floor(bytes.byteLength / 4);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Float32Array(frameCount);
      for (let i = 0; i < frameCount; i++) {
         out[i] = view.getFloat32(i * 4, true);
      }
      channels.push(out);
   }

   return {
      fileName: dto.fileName,
      sampleRateHz: dto.sampleRateHz,
      channelCount: dto.channelCount,
      frameCount: dto.frameCount,
      channels,
   };
}

export async function decodeWavFileToDto(file: File): Promise<MorphSamplePcmDto> {
   //    if (!file.name.toLowerCase().endsWith(".wav")) {
   //       throw new Error("Only .wav files are supported");
   //    }
   if (file.size > SomaticCaps.maxImportedWavBytes) {
      throw new Error(
         `Sound file is too large (max ${(SomaticCaps.maxImportedWavBytes / (1024 * 1024)).toFixed(1)}MB)`);
   }

   const wavBytes = await file.arrayBuffer();
   const decoded = await decodeWavArrayBuffer({wavBytes, fileName: file.name});
   return encodeFloat32PcmToDto(decoded);
}
