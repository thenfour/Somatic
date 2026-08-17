import {
   AudioSample,
   AudioSampleSink,
   AudioSampleSource,
   BufferSource,
   BufferTarget,
   canEncodeAudio,
   FlacOutputFormat,
   Input,
   type MetadataTags,
   Mp3OutputFormat,
   Output,
   type OutputFormat,
   Quality,
   WAVE,
   WavOutputFormat,
   type AudioCodec,
} from "mediabunny";

import type {
   AudioRenderFormat,
   AudioRenderMetadata,
   AudioRenderMp3BitrateKbps,
   AudioRenderSettings,
} from "../models/song";
import {
   type AudioRenderPreview,
   type AudioSourceAnalysis,
   createAudioRenderAbortError,
   createAudioRenderPreview,
   Pcm16AudioAnalyzer,
} from "./audio_render_processing";
import {AudioRenderDcFilter} from "./audio_render_dc_filter";
import {yieldToBrowser} from "../utils/utils";
import {millisecondsToAudioFrames} from "../utils/music/dsp";

export type AudioRenderWorkProgress = Readonly<{
   completedFrames: number;
   totalFrames: number;
   fraction01: number;
}>;

export type EncodedAudioRender = Readonly<{
   bytes: Uint8Array;
   mimeType: string;
   extensionWithDot: `.${AudioRenderFormat}`;
}>;

export type RenderedAudioMaster = Readonly<{
   bytes: Uint8Array;
   mimeType: "audio/wav";
   preview: AudioRenderPreview;
}>;

type AudioRenderCodecConfig = Readonly<{
   codec: AudioCodec;
   format: OutputFormat;
   mimeType: string;
   extensionWithDot: `.${AudioRenderFormat}`;
}>;

const AUDIO_WORK_YIELD_FRAMES = 262144;

function throwIfAborted(signal?: AbortSignal): void {
   if (signal?.aborted) {
      throw createAudioRenderAbortError();
   }
}

function copySampleToInterleavedPcm16(sample: AudioSample): Int16Array {
   const byteLength = sample.allocationSize({format: "s16", planeIndex: 0});
   const interleaved = new Int16Array(byteLength / Int16Array.BYTES_PER_ELEMENT);
   sample.copyTo(interleaved, {format: "s16", planeIndex: 0});
   return interleaved;
}

function reportProgress(
   callback: ((progress: AudioRenderWorkProgress) => void) | undefined,
   completedFrames: number,
   totalFrames: number,
): void {
   if (!callback) return;
   callback({
      completedFrames,
      totalFrames,
      fraction01: totalFrames > 0 ? Math.min(1, completedFrames / totalFrames) : 0,
   });
}

async function getTic80Pcm16Track(input: Input<BufferSource>) {
   const track = await input.getPrimaryAudioTrack();
   if (!track) {
      throw new Error("The captured WAVE file has no audio track.");
   }
   // so, yes this is depending on the TIC-80 to capture explicitly in PCM16.
   // considering WAV output will also be in PCM16, and we do very minimal processing,
   // it's safe to do this. Float processing would be necessary if we're doing more DSP,
   // or if TIC80 changes its output format (hint: it won't).
   const codec = await track.getCodec();
   if (codec !== "pcm-s16") {
      throw new Error(`Expected TIC-80 to capture 16-bit PCM audio; received ${codec ?? "an unknown codec"}.`);
   }
   return track;
}

export async function analyzeTic80CapturedWav(args: {
   wavBytes: Uint8Array;
   signal?: AbortSignal;
   onProgress?: (progress: AudioRenderWorkProgress) => void;
}): Promise<AudioSourceAnalysis> {
   throwIfAborted(args.signal);
   const input = new Input({formats: [WAVE], source: new BufferSource(args.wavBytes)});
   const onAbort = () => input.dispose();
   args.signal?.addEventListener("abort", onAbort, {once: true});

   try {
      const track = await getTic80Pcm16Track(input);
      const [sampleRateHz, channelCount, durationSeconds] = await Promise.all([
         track.getSampleRate(),
         track.getNumberOfChannels(),
         input.getDurationFromMetadata([track]),
      ]);
      const expectedFrameCount = millisecondsToAudioFrames((durationSeconds ?? 0) * 1000, sampleRateHz);
      const analyzer = new Pcm16AudioAnalyzer(sampleRateHz, channelCount);
      const sink = new AudioSampleSink(track);
      let completedFrames = 0;
      let nextYieldFrame = AUDIO_WORK_YIELD_FRAMES;

      for await (const sample of sink.samples()) {
         try {
            throwIfAborted(args.signal);
            analyzer.accept(copySampleToInterleavedPcm16(sample));
            completedFrames += sample.numberOfFrames;
            if (completedFrames >= nextYieldFrame) {
               reportProgress(args.onProgress, completedFrames, expectedFrameCount);
               nextYieldFrame = completedFrames + AUDIO_WORK_YIELD_FRAMES;
               await yieldToBrowser();
            }
         } finally {
            sample.close();
         }
      }

      throwIfAborted(args.signal);
      const analysis = analyzer.finish();
      reportProgress(args.onProgress, analysis.frameCount, analysis.frameCount);
      return analysis;
   } catch (error) {
      if (args.signal?.aborted) {
         throw createAudioRenderAbortError();
      }
      throw error;
   } finally {
      args.signal?.removeEventListener("abort", onAbort);
      input.dispose();
   }
}

async function ensureAudioEncoder(format: AudioRenderFormat): Promise<void> {
   if (format === "mp3" && !(await canEncodeAudio("mp3"))) {
      const {registerMp3Encoder} = await import("@mediabunny/mp3-encoder");
      registerMp3Encoder();
   } else if (format === "flac" && !(await canEncodeAudio("flac"))) {
      const {registerFlacEncoder} = await import("@mediabunny/flac-encoder");
      registerFlacEncoder();
   }
}

function createCodecConfig(format: AudioRenderFormat): AudioRenderCodecConfig {
   switch (format) {
      case "wav":
         return {
            codec: "pcm-s16",
            format: new WavOutputFormat({metadataFormat: "info"}),
            mimeType: "audio/wav",
            extensionWithDot: ".wav",
         };
      case "mp3":
         return {
            codec: "mp3",
            format: new Mp3OutputFormat(),
            mimeType: "audio/mpeg",
            extensionWithDot: ".mp3",
         };
      case "flac":
         return {
            codec: "flac",
            format: new FlacOutputFormat(),
            mimeType: "audio/flac",
            extensionWithDot: ".flac",
         };
   }
}

function toMetadataTags(metadata: AudioRenderMetadata): MetadataTags {
   const nonempty = (value: string) => value.trim() || undefined;
   const year = /^\d{4}$/.test(metadata.year.trim()) ? Number(metadata.year.trim()) : null;
   let date: Date | undefined;
   if (year !== null && year >= 1 && year <= 9999) {
      date = new Date(0);
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCFullYear(year, 0, 1);
   }

   return {
      title: nonempty(metadata.title),
      artist: nonempty(metadata.artist),
      album: nonempty(metadata.album),
      date,
      genre: nonempty(metadata.genre),
      comment: nonempty(metadata.comment),
   };
}

export async function createAudioRenderMaster(args: {
   sourceWavBytes: Uint8Array;
   analysis: AudioSourceAnalysis;
   settings: AudioRenderSettings;
   signal?: AbortSignal;
   onProgress?: (progress: AudioRenderWorkProgress) => void;
}): Promise<RenderedAudioMaster> {
   throwIfAborted(args.signal);

   const preview = createAudioRenderPreview(args.analysis, args.settings);
   const codecConfig = createCodecConfig("wav");
   const target = new BufferTarget();
   const output = new Output({format: codecConfig.format, target});
   const source = new AudioSampleSource({
      codec: codecConfig.codec,
      transform: {sampleFormat: "s16"},
   });
   output.addAudioTrack(source);

   const input = new Input({formats: [WAVE], source: new BufferSource(args.sourceWavBytes)});
   const dcFilters = args.settings.removeDcBias
      ? Array.from({length: args.analysis.channelCount}, () => new AudioRenderDcFilter())
      : null;
   let emittedFrames = 0;
   let sourceFramesRead = 0;
   let nextYieldFrame = AUDIO_WORK_YIELD_FRAMES;
   let outputStarted = false;
   const onAbort = () => {
      input.dispose();
      if (outputStarted && output.state !== "finalized" && output.state !== "canceled") {
         void output.cancel().catch(() => undefined);
      }
   };
   args.signal?.addEventListener("abort", onAbort, {once: true});

   const emitPcm = async (inputPcm: ArrayLike<number>, frameCount: number) => {
      throwIfAborted(args.signal);
      const pcm = new Int16Array(inputPcm.length);
      for (let i = 0; i < inputPcm.length; i++) {
         const channel = i % args.analysis.channelCount;
         const inputSample = inputPcm[i] ?? 0;
         const filtered = dcFilters
            ? dcFilters[channel]!.processSample(inputSample)
            : inputSample;
         pcm[i] = Math.max(-32768, Math.min(32767, Math.round(filtered)));
      }
      const sample = new AudioSample({
         data: pcm,
         format: "s16",
         numberOfChannels: args.analysis.channelCount,
         sampleRate: args.analysis.sampleRateHz,
         timestamp: emittedFrames / args.analysis.sampleRateHz,
      });
      try {
         await source.add(sample);
         emittedFrames += frameCount;
      } finally {
         sample.close();
      }
      throwIfAborted(args.signal);
   };

   const emitSilence = async (frameCount: number) => {
      const maximumChunkFrames = 16384;
      let remainingFrames = frameCount;
      while (remainingFrames > 0) {
         const chunkFrames = Math.min(remainingFrames, maximumChunkFrames);
         await emitPcm(
            new Int16Array(chunkFrames * args.analysis.channelCount),
            chunkFrames,
         );
         remainingFrames -= chunkFrames;
      }
   };

   try {
      const track = await getTic80Pcm16Track(input);
      const [sampleRateHz, channelCount] = await Promise.all([
         track.getSampleRate(),
         track.getNumberOfChannels(),
      ]);
      if (sampleRateHz !== args.analysis.sampleRateHz || channelCount !== args.analysis.channelCount) {
         throw new Error("Captured audio format changed between analysis and encoding.");
      }

      await output.start();
      outputStarted = true;
      await emitSilence(preview.leadingSilenceFrames);

      const sink = new AudioSampleSink(track);
      for await (const sample of sink.samples()) {
         try {
            throwIfAborted(args.signal);
            const sampleStartFrame = sourceFramesRead;
            const sampleEndFrame = sampleStartFrame + sample.numberOfFrames;
            const retainedStart = Math.max(preview.trimStartFrame, sampleStartFrame);
            const retainedEnd = Math.min(preview.trimEndFrame, sampleEndFrame);
            if (retainedStart < retainedEnd) {
               const pcm = copySampleToInterleavedPcm16(sample);
               const firstLocalFrame = retainedStart - sampleStartFrame;
               const retainedFrameCount = retainedEnd - retainedStart;
               const firstSample = firstLocalFrame * channelCount;
               const retainedSampleCount = retainedFrameCount * channelCount;
               const processed = new Float64Array(retainedSampleCount);
               for (let i = 0; i < retainedSampleCount; i++) {
                  processed[i] = (pcm[firstSample + i] ?? 0) * preview.gain;
               }
               await emitPcm(processed, retainedFrameCount);
            }
            sourceFramesRead = sampleEndFrame;
            if (sourceFramesRead >= nextYieldFrame) {
               reportProgress(args.onProgress, sourceFramesRead, args.analysis.frameCount);
               nextYieldFrame = sourceFramesRead + AUDIO_WORK_YIELD_FRAMES;
               await yieldToBrowser();
            }
         } finally {
            sample.close();
         }
      }

      await emitSilence(preview.trailingSilenceFrames);
      if (emittedFrames === 0) {
         await emitSilence(1);
      }
      input.dispose();
      await output.finalize();
      throwIfAborted(args.signal);
      reportProgress(args.onProgress, args.analysis.frameCount, args.analysis.frameCount);

      if (!target.buffer) {
         throw new Error("Audio encoding completed without output bytes.");
      }
      return {
         bytes: new Uint8Array(target.buffer),
         mimeType: "audio/wav",
         preview,
      };
   } catch (error) {
      if (output.state !== "finalized" && output.state !== "canceled") {
         await output.cancel().catch(() => undefined);
      }
      if (args.signal?.aborted) {
         throw createAudioRenderAbortError();
      }
      throw error;
   } finally {
      args.signal?.removeEventListener("abort", onAbort);
      input.dispose();
   }
}

export async function encodeAudioRenderDownload(args: {
   masterWavBytes: Uint8Array;
   masterFrameCount: number;
   format: AudioRenderFormat;
   metadata: AudioRenderMetadata;
   mp3BitrateKbps: AudioRenderMp3BitrateKbps;
   signal?: AbortSignal;
   onProgress?: (progress: AudioRenderWorkProgress) => void;
}): Promise<EncodedAudioRender> {
   throwIfAborted(args.signal);
   await ensureAudioEncoder(args.format);
   throwIfAborted(args.signal);

   const codecConfig = createCodecConfig(args.format);
   const target = new BufferTarget();
   const output = new Output({format: codecConfig.format, target});
   const source = new AudioSampleSource({
      codec: codecConfig.codec,
      ...(codecConfig.codec === "mp3"
         ? {quality: new Quality({bitrate: args.mp3BitrateKbps * 1000})}
         : {}),
      transform: {sampleFormat: "s16"},
   });
   output.addAudioTrack(source);
   output.setMetadataTags(toMetadataTags(args.metadata));

   const input = new Input({formats: [WAVE], source: new BufferSource(args.masterWavBytes)});
   let completedFrames = 0;
   let nextYieldFrame = AUDIO_WORK_YIELD_FRAMES;
   let outputStarted = false;
   const onAbort = () => {
      input.dispose();
      if (outputStarted && output.state !== "finalized" && output.state !== "canceled") {
         void output.cancel().catch(() => undefined);
      }
   };
   args.signal?.addEventListener("abort", onAbort, {once: true});

   try {
      const track = await getTic80Pcm16Track(input);
      await output.start();
      outputStarted = true;

      const sink = new AudioSampleSink(track);
      for await (const sample of sink.samples()) {
         try {
            throwIfAborted(args.signal);
            await source.add(sample);
            completedFrames += sample.numberOfFrames;
            if (completedFrames >= nextYieldFrame) {
               reportProgress(args.onProgress, completedFrames, args.masterFrameCount);
               nextYieldFrame = completedFrames + AUDIO_WORK_YIELD_FRAMES;
               await yieldToBrowser();
            }
         } finally {
            sample.close();
         }
      }

      input.dispose();
      await output.finalize();
      throwIfAborted(args.signal);
      reportProgress(args.onProgress, args.masterFrameCount, args.masterFrameCount);
      if (!target.buffer) {
         throw new Error("Audio encoding completed without output bytes??");
      }
      return {
         bytes: new Uint8Array(target.buffer),
         mimeType: codecConfig.mimeType,
         extensionWithDot: codecConfig.extensionWithDot,
      };
   } catch (error) {
      if (output.state !== "finalized" && output.state !== "canceled") {
         await output.cancel().catch(() => undefined);
      }
      if (args.signal?.aborted) {
         throw createAudioRenderAbortError();
      }
      throw error;
   } finally {
      args.signal?.removeEventListener("abort", onAbort);
      input.dispose();
   }
}
