import {MorphSampleImportAutoWindowParamsDto, MorphSampleImportWindowDto, WaveformMorphGradientNode} from "../models/instruments";
import {SomaticCaps, Tic80Caps} from "../models/tic80Capabilities";
import {clamp, lerp} from "../utils/utils";
import type {DecodedPcm} from "./wav_reader";

export type MorphSampleWindowInFrames = {
   beginFrame: number; //
   frameLength: number;
};

export function extractSingleChannelPcm(decoded: DecodedPcm): Float32Array {
   return decoded.channels[0] ?? new Float32Array(0);
}

// take a window (with begin01 and lengthWaveforms) and convert to frame indices
// frame = sample index
export function windowDtoToFrames(
   dto: MorphSampleImportWindowDto,
   frameCount: number,
   ): MorphSampleWindowInFrames //
{
   const frameLength = Math.max(1, Math.round(dto.lengthWaveforms * Tic80Caps.waveform.pointCount));
   const maxBegin = Math.max(0, frameCount - frameLength);
   const beginFrame = clamp(Math.round(dto.begin01 * frameCount), 0, maxBegin);
   return {beginFrame, frameLength};
}

export function framesToWindowDto(
   frames: MorphSampleWindowInFrames,
   frameCount: number,
   ): MorphSampleImportWindowDto //
{
   const begin01 = frameCount <= 0 ? 0 : clamp(frames.beginFrame / frameCount, 0, 1);
   const lengthWaveforms = Math.max(1, frames.frameLength / Tic80Caps.waveform.pointCount);
   return {begin01, lengthWaveforms};
}

export type AutoWindowResult =|{
   ok: true;
   windows: MorphSampleImportWindowDto[]
}
|{
   ok: false;
   error: string
};

interface AutoWindowArgs {
   frameCount: number;
   params: MorphSampleImportAutoWindowParamsDto;
}

// do the auto-selection of windows from the source sample
// frameCount = sample count
export function autoSelectWindows({frameCount, params}: AutoWindowArgs): AutoWindowResult //
{
   const cappedWindowCount = clamp(Math.trunc(params.windowCount), 1, SomaticCaps.maxMorphGradientNodes);
   const sourceDuration01 = clamp(params.sourceDuration01, 0, 1);
   const usableFrames = Math.max(0, Math.floor(frameCount * sourceDuration01));

   const frameLength = Math.max(
      Tic80Caps.waveform.pointCount,
      Math.round(params.perWindowDurationWaveforms * Tic80Caps.waveform.pointCount),
   );

   if (cappedWindowCount === 0) {
      return {ok: true, windows: []};
   }

   if (usableFrames <= 0) {
      return {ok: false, error: "Source duration is too small."};
   }

   const rangeStart = 0;
   const rangeEnd = usableFrames;
   const rangeLen = rangeEnd - rangeStart;

   const exp = Math.max(0.01, params.placementExponent); // could also try our n11 curve.

   const starts: number[] = [];
   let prevStart = rangeStart - frameLength;

   for (let i = 0; i < cappedWindowCount; i++) {
      const t01 = cappedWindowCount === 1 ? 0 : i / (cappedWindowCount - 1);
      const shaped = Math.pow(t01, exp);
      const desiredStart = rangeStart + shaped * (rangeLen - frameLength);

      const minStart = prevStart + frameLength;
      const maxStart = rangeStart + (rangeLen - frameLength) - (cappedWindowCount - i - 1) * frameLength;
      //   if (minStart > maxStart) {
      //      return {
      //         ok: false,
      //         error: "Cannot place windows without overlap (try fewer windows or a shorter window length).",
      //      };
      //   }

      const start = clamp(Math.round(desiredStart), minStart, maxStart);
      starts.push(start);
      prevStart = start;
   }

   const windows = starts.map(
      (beginFrame) => framesToWindowDto({beginFrame, frameLength}, frameCount),
   );

   return {ok: true, windows};
}

// linear sample interpolation
function sampleLinear(samples: Float32Array, pos: number): number {
   const i0 = Math.floor(pos);
   const i1 = Math.min(samples.length - 1, i0 + 1);
   const t = pos - i0;
   const a = samples[i0] ?? 0;
   const b = samples[i1] ?? 0;
   return lerp(a, b, t);
}

export function Float32ToTic80Amplitude(s: number): number {
   const v01 = clamp((s + 1) / 2, 0, 1);
   const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;
   return Math.round(v01 * maxAmp);
}

// resample a window of Float32 samples to Tic-80 waveform amplitudes (0-15)
export function resampleWindowToTic80Amplitudes(windowSamples: Float32Array): Uint8Array {
   const out = new Uint8Array(Tic80Caps.waveform.pointCount);
   const n = windowSamples.length;
   const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;

   if (n <= 0) {
      return out;
   }

   for (let i = 0; i < out.length; i++) {
      const pos = out.length <= 1 ? 0 : (i * (n - 1)) / (out.length - 1);
      const s = sampleLinear(windowSamples, pos);
      out[i] = Float32ToTic80Amplitude(s);
   }

   return out;
}

// build the morph gradient nodes from the sample import data
export function buildMorphGradientFromSampleImport(
   args: {decoded: DecodedPcm; windows: MorphSampleImportWindowDto[]; targetDurationSeconds: number;}):
   WaveformMorphGradientNode[] //
{
   const mono = extractSingleChannelPcm(args.decoded);
   const cappedWindowCount = clamp(args.windows.length, 1, SomaticCaps.maxMorphGradientNodes);
   const durationTotal = clamp(args.targetDurationSeconds, 0, SomaticCaps.maxMorphGradientTotalDurationSeconds);
   const perNodeDuration = cappedWindowCount > 0 ? durationTotal / cappedWindowCount : 0;

   const nodes: WaveformMorphGradientNode[] = [];

   for (let i = 0; i < cappedWindowCount; i++) {
      const w = args.windows[i];
      if (!w)
         continue;
      const {beginFrame, frameLength} = windowDtoToFrames(w, mono.length);
      const slice = mono.slice(beginFrame, beginFrame + frameLength);
      const amps = resampleWindowToTic80Amplitudes(slice);
      nodes.push({
         amplitudes: amps,
         durationSeconds: perNodeDuration,
         curveN11: 0,
      });
   }

   return nodes;
}
