import type {AudioRenderFormat, AudioRenderSettings} from "../models/song";

export type AudioRenderSettingsChangeImpact = "none" | "mp3" | "outputs" | "master";

export type AudioRenderDownloadCacheEntry<T> = Readonly<{
   key: string;
   value: T;
}>;

export type AudioRenderDownloadCache<T> = Readonly<
   Partial<Record<AudioRenderFormat, AudioRenderDownloadCacheEntry<T>>>
>;

const metadataEquals = (a: AudioRenderSettings["metadata"], b: AudioRenderSettings["metadata"]) => (
   a.title === b.title
   && a.artist === b.artist
   && a.album === b.album
   && a.year === b.year
   && a.genre === b.genre
   && a.comment === b.comment
);

export function getAudioRenderSettingsChangeImpact(
   previous: AudioRenderSettings,
   next: AudioRenderSettings,
): AudioRenderSettingsChangeImpact {
   if (
      previous.removeDcBias !== next.removeDcBias
      || previous.normalizePeak !== next.normalizePeak
      || previous.normalizationTargetDbfs !== next.normalizationTargetDbfs
      || previous.trimSilence !== next.trimSilence
      || previous.leadingSilenceMs !== next.leadingSilenceMs
      || previous.trailingSilenceMs !== next.trailingSilenceMs
   ) {
      return "master";
   }
   if (!metadataEquals(previous.metadata, next.metadata)) {
      return "outputs";
   }
   if (previous.mp3BitrateKbps !== next.mp3BitrateKbps) {
      return "mp3";
   }
   return "none";
}

export function getAudioRenderDownloadKey(
   format: AudioRenderFormat,
   settings: AudioRenderSettings,
): string {
   return JSON.stringify({
      format,
      metadata: settings.metadata,
      ...(format === "mp3" ? {mp3BitrateKbps: settings.mp3BitrateKbps} : {}),
   });
}

export function getCachedAudioRenderDownload<T>(
   cache: AudioRenderDownloadCache<T>,
   format: AudioRenderFormat,
   settings: AudioRenderSettings,
): T | null {
   const entry = cache[format];
   return entry?.key === getAudioRenderDownloadKey(format, settings) ? entry.value : null;
}

export function cacheAudioRenderDownload<T>(
   cache: AudioRenderDownloadCache<T>,
   format: AudioRenderFormat,
   settings: AudioRenderSettings,
   value: T,
): AudioRenderDownloadCache<T> {
   return {
      ...cache,
      [format]: {key: getAudioRenderDownloadKey(format, settings), value},
   };
}

export function invalidateAudioRenderDownloadCache<T>(
   cache: AudioRenderDownloadCache<T>,
   impact: AudioRenderSettingsChangeImpact,
): AudioRenderDownloadCache<T> {
   if (impact === "master" || impact === "outputs") return {};
   if (impact !== "mp3" || cache.mp3 === undefined) return cache;
   const {mp3: _discarded, ...retained} = cache;
   return retained;
}
