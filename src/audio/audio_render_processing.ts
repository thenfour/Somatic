import type {AudioRenderSettings} from "../models/song";
import {dbToLinear, linearGainToDecibels, millisecondsToAudioFrames} from "../utils/music/dsp";

export const PCM16_FULL_SCALE = 32768;
export const PCM16_MASTERING_SILENCE_ABS_SAMPLE = 1;
export const AUDIO_RENDER_WAVEFORM_BUCKET_FRAMES = 256;
export const AUDIO_RENDER_PREVIEW_MAX_BINS = 4096;

export type AudioWaveformEnvelope = Readonly<{
   frameCount: number;
   minimums: Float32Array;
   maximums: Float32Array;
}>;

export type AudioSourceAnalysis = Readonly<{
   sampleRateHz: number;
   channelCount: number;
   frameCount: number;
   durationSeconds: number;
   peakAmplitude: number;
   peakDbfs: number;
   trimStartFrame: number;
   trimEndFrame: number;
   waveformBuckets: Readonly<{
      bucketSizeFrames: number;
      /** Interleaved by bucket, then channel. */
      minimums: Float32Array;
      /** Interleaved by bucket, then channel. */
      maximums: Float32Array;
   }>;
}>;

export type AudioRenderPreview = Readonly<{
   trimStartFrame: number;
   trimEndFrame: number;
   trimmedFrameCount: number;
   leadingSilenceFrames: number;
   trailingSilenceFrames: number;
   outputFrameCount: number;
   durationSeconds: number;
   gain: number;
   outputPeakAmplitude: number;
   outputPeakDbfs: number;
   waveform: AudioWaveformEnvelope;
}>;

export function createAudioRenderAbortError(): Error {
   const error = new Error("Audio export cancelled.");
   error.name = "AbortError";
   return error;
}

export class Pcm16AudioAnalyzer {
   private readonly waveformMinimums: number[] = [];
   private readonly waveformMaximums: number[] = [];
   private frameCount = 0;
   private peakAbsoluteSample = 0;
   private firstAudibleFrame: number | null = null;
   private lastAudibleFrameExclusive = 0;
   private bucketFrameCount = 0;
   private readonly bucketMinimums: Int16Array;
   private readonly bucketMaximums: Int16Array;
   private finished = false;

   constructor(
      readonly sampleRateHz: number,
      readonly channelCount: number,
      readonly waveformBucketFrames = AUDIO_RENDER_WAVEFORM_BUCKET_FRAMES,
   ) {
      if (!Number.isInteger(sampleRateHz) || sampleRateHz <= 0) {
         throw new Error(`Invalid audio sample rate: ${sampleRateHz}`);
      }
      if (!Number.isInteger(channelCount) || channelCount <= 0) {
         throw new Error(`Invalid audio channel count: ${channelCount}`);
      }
      if (!Number.isInteger(waveformBucketFrames) || waveformBucketFrames <= 0) {
         throw new Error(`Invalid waveform bucket size: ${waveformBucketFrames}`);
      }
      this.bucketMinimums = new Int16Array(channelCount);
      this.bucketMinimums.fill(32767);
      this.bucketMaximums = new Int16Array(channelCount);
      this.bucketMaximums.fill(-32768);
   }

   accept(interleavedSamples: Int16Array): void {
      if (this.finished) {
         throw new Error("Cannot add PCM after audio analysis has finished.");
      }
      if (interleavedSamples.length % this.channelCount !== 0) {
         throw new Error("Interleaved PCM sample count is not divisible by the channel count.");
      }

      const chunkFrameCount = interleavedSamples.length / this.channelCount;
      for (let frame = 0; frame < chunkFrameCount; frame++) {
         let audible = false;
         const frameOffset = frame * this.channelCount;
         for (let channel = 0; channel < this.channelCount; channel++) {
            const sample = interleavedSamples[frameOffset + channel] ?? 0;
            const absoluteSample = Math.abs(sample);
            this.peakAbsoluteSample = Math.max(this.peakAbsoluteSample, absoluteSample);
            this.bucketMinimums[channel] = Math.min(this.bucketMinimums[channel]!, sample);
            this.bucketMaximums[channel] = Math.max(this.bucketMaximums[channel]!, sample);
            audible ||= absoluteSample > PCM16_MASTERING_SILENCE_ABS_SAMPLE;
         }

         const absoluteFrame = this.frameCount + frame;
         if (audible) {
            this.firstAudibleFrame ??= absoluteFrame;
            this.lastAudibleFrameExclusive = absoluteFrame + 1;
         }
         this.bucketFrameCount++;
         if (this.bucketFrameCount === this.waveformBucketFrames) {
            this.flushWaveformBucket();
         }
      }

      this.frameCount += chunkFrameCount;
   }

   finish(): AudioSourceAnalysis {
      if (this.finished) {
         throw new Error("Audio analysis has already finished.");
      }
      this.finished = true;
      if (this.bucketFrameCount > 0) {
         this.flushWaveformBucket();
      }

      const peakAmplitude = this.peakAbsoluteSample / PCM16_FULL_SCALE;
      return {
         sampleRateHz: this.sampleRateHz,
         channelCount: this.channelCount,
         frameCount: this.frameCount,
         durationSeconds: this.frameCount / this.sampleRateHz,
         peakAmplitude,
         peakDbfs: linearGainToDecibels(peakAmplitude),
         trimStartFrame: this.firstAudibleFrame ?? 0,
         trimEndFrame: this.firstAudibleFrame === null ? 0 : this.lastAudibleFrameExclusive,
         waveformBuckets: {
            bucketSizeFrames: this.waveformBucketFrames,
            minimums: Float32Array.from(this.waveformMinimums),
            maximums: Float32Array.from(this.waveformMaximums),
         },
      };
   }

   private flushWaveformBucket(): void {
      for (let channel = 0; channel < this.channelCount; channel++) {
         this.waveformMinimums.push(this.bucketMinimums[channel]! / PCM16_FULL_SCALE);
         this.waveformMaximums.push(this.bucketMaximums[channel]! / PCM16_FULL_SCALE);
      }
      this.bucketFrameCount = 0;
      this.bucketMinimums.fill(32767);
      this.bucketMaximums.fill(-32768);
   }
}

function addEnvelopeValue(
   currentMinimum: number,
   currentMaximum: number,
   minimum: number,
   maximum: number,
): [number, number] {
   return [Math.min(currentMinimum, minimum), Math.max(currentMaximum, maximum)];
}

function createProcessedWaveform(
   analysis: AudioSourceAnalysis,
   args: {
      trimStartFrame: number;
      trimmedFrameCount: number;
      leadingSilenceFrames: number;
      outputFrameCount: number;
      gain: number;
   },
): AudioWaveformEnvelope {
   const binCount = Math.min(
      AUDIO_RENDER_PREVIEW_MAX_BINS,
      Math.max(1, Math.ceil(args.outputFrameCount / analysis.waveformBuckets.bucketSizeFrames)),
   );
   const minimums = new Float32Array(binCount);
   const maximums = new Float32Array(binCount);
   const contentOutputStart = args.leadingSilenceFrames;
   const contentOutputEnd = contentOutputStart + args.trimmedFrameCount;

   for (let bin = 0; bin < binCount; bin++) {
      const outputStart = Math.floor(bin * args.outputFrameCount / binCount);
      const outputEnd = Math.max(outputStart + 1, Math.ceil((bin + 1) * args.outputFrameCount / binCount));
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;

      if (outputStart < contentOutputStart || outputEnd > contentOutputEnd || args.trimmedFrameCount === 0) {
         [minimum, maximum] = addEnvelopeValue(minimum, maximum, 0, 0);
      }

      const overlapStart = Math.max(outputStart, contentOutputStart);
      const overlapEnd = Math.min(outputEnd, contentOutputEnd);
      if (overlapStart < overlapEnd) {
         const sourceStart = args.trimStartFrame + overlapStart - contentOutputStart;
         const sourceEnd = args.trimStartFrame + overlapEnd - contentOutputStart;
         const firstBucket = Math.floor(sourceStart / analysis.waveformBuckets.bucketSizeFrames);
         const lastBucketExclusive = Math.ceil(sourceEnd / analysis.waveformBuckets.bucketSizeFrames);
         for (let sourceBucket = firstBucket; sourceBucket < lastBucketExclusive; sourceBucket++) {
            for (let channel = 0; channel < analysis.channelCount; channel++) {
               const sourceIndex = sourceBucket * analysis.channelCount + channel;
               const sourceMinimum = analysis.waveformBuckets.minimums[sourceIndex] ?? 0;
               const sourceMaximum = analysis.waveformBuckets.maximums[sourceIndex] ?? 0;
               [minimum, maximum] = addEnvelopeValue(
                  minimum,
                  maximum,
                  Math.max(-1, Math.min(1, sourceMinimum * args.gain)),
                  Math.max(-1, Math.min(1, sourceMaximum * args.gain)),
               );
            }
         }
      }

      minimums[bin] = Number.isFinite(minimum) ? minimum : 0;
      maximums[bin] = Number.isFinite(maximum) ? maximum : 0;
   }

   return {frameCount: args.outputFrameCount, minimums, maximums};
}

export function createAudioRenderPreview(
   analysis: AudioSourceAnalysis,
   settings: AudioRenderSettings,
): AudioRenderPreview {
   const trimStartFrame = settings.trimSilence ? analysis.trimStartFrame : 0;
   const trimEndFrame = settings.trimSilence ? analysis.trimEndFrame : analysis.frameCount;
   const trimmedFrameCount = Math.max(0, trimEndFrame - trimStartFrame);
   const leadingSilenceFrames = millisecondsToAudioFrames(settings.leadingSilenceMs, analysis.sampleRateHz);
   const trailingSilenceFrames = millisecondsToAudioFrames(settings.trailingSilenceMs, analysis.sampleRateHz);
   // don't allow zero frame tracks, avoid weird behavior downstream.
   const outputFrameCount = Math.max(1, leadingSilenceFrames + trimmedFrameCount + trailingSilenceFrames);
   // all-silence: don't attempt to normalize.
   const hasAudibleContent = analysis.trimEndFrame > analysis.trimStartFrame;
   const gain = settings.normalizePeak && hasAudibleContent && analysis.peakAmplitude > 0
      ? dbToLinear(settings.normalizationTargetDbfs) / analysis.peakAmplitude
      : 1;
   const retainedPeakAmplitude = trimmedFrameCount > 0 ? analysis.peakAmplitude : 0;
   const outputPeakAmplitude = Math.min(1, retainedPeakAmplitude * gain);

   return {
      trimStartFrame,
      trimEndFrame,
      trimmedFrameCount,
      leadingSilenceFrames,
      trailingSilenceFrames,
      outputFrameCount,
      durationSeconds: outputFrameCount / analysis.sampleRateHz,
      gain,
      outputPeakAmplitude,
      outputPeakDbfs: linearGainToDecibels(outputPeakAmplitude),
      waveform: createProcessedWaveform(analysis, {
         trimStartFrame,
         trimmedFrameCount,
         leadingSilenceFrames,
         outputFrameCount,
         gain,
      }),
   };
}
