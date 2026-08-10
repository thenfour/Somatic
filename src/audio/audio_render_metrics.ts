import {clamp01} from "../utils/utils";

export type AudioRenderMetrics = Readonly<{
   elapsedSeconds: number;
   renderedAudioSeconds: number;
   remainingSeconds: number|null;
   realtimeRate: number|null;
}>;

export function calculateAudioRenderMetrics(args: {
   fraction01: number;
   totalAudioSeconds: number;
   elapsedSeconds: number;
}): AudioRenderMetrics {
   const fraction01 = clamp01(Number.isFinite(args.fraction01) ? args.fraction01 : 0);
   const totalAudioSeconds = Math.max(0, Number.isFinite(args.totalAudioSeconds) ? args.totalAudioSeconds : 0);
   const elapsedSeconds = Math.max(0, Number.isFinite(args.elapsedSeconds) ? args.elapsedSeconds : 0);
   const renderedAudioSeconds = totalAudioSeconds * fraction01;
   const realtimeRate = elapsedSeconds > 0 && renderedAudioSeconds > 0
      ? renderedAudioSeconds / elapsedSeconds
      : null;
   const remainingSeconds = fraction01 >= 1
      ? 0
      : realtimeRate && realtimeRate > 0
         ? (totalAudioSeconds - renderedAudioSeconds) / realtimeRate
         : null;

   return {
      elapsedSeconds,
      renderedAudioSeconds,
      remainingSeconds,
      realtimeRate,
   };
}

export function formatAudioRenderDuration(
   seconds: number,
   rounding: "floor"|"ceil" = "floor",
): string {
   const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
   const wholeSeconds = rounding === "ceil" ? Math.ceil(safeSeconds) : Math.floor(safeSeconds);
   const hours = Math.floor(wholeSeconds / 3600);
   const minutes = Math.floor((wholeSeconds % 3600) / 60);
   const remainingSeconds = wholeSeconds % 60;
   const secondsText = remainingSeconds.toString().padStart(2, "0");

   return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, "0")}:${secondsText}`
      : `${minutes}:${secondsText}`;
}
