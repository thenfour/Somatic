import React from "react";
import {saveSync} from "save-file";

import {
   analyzeTic80CapturedWav,
   createAudioRenderMaster,
   encodeAudioRenderDownload,
   type EncodedAudioRender,
   type RenderedAudioMaster,
} from "../audio/audio_render_mediabunny";
import type {AudioRenderPreview, AudioSourceAnalysis} from "../audio/audio_render_processing";
import {
   cacheAudioRenderDownload,
   type AudioRenderDownloadCache,
   getAudioRenderSettingsChangeImpact,
   getCachedAudioRenderDownload,
   invalidateAudioRenderDownloadCache,
} from "../audio/audio_render_session";
import type {Song, AudioRenderFormat, AudioRenderSettings} from "../models/song";
import {kSubsystem} from "../subsystem/base/SubsystemBackendBase";
import type {BackendRenderSongToWavArgs} from "../subsystem/tic80/tic80_backend";
import type {Tic80AudioCaptureResult} from "../subsystem/tic80/Tic80Bridged";
import type {AudioRenderDialogProps, AudioRenderPhase} from "../ui/AudioRenderDialog";
import type {ToastOptions} from "../ui/toast_provider";
import {tic80RowsToSeconds} from "../utils/music/tic80Music";

type AudioRenderDialogState = Readonly<{
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   renderStartedAtMillis: number | null;
   renderCompletedAtMillis: number | null;
   totalAudioSeconds: number;
   sourceWavByteLength: number;
   master: RenderedAudioMaster | null;
   analysis: AudioSourceAnalysis | null;
   preview: AudioRenderPreview | null;
   downloads: AudioRenderDownloadCache<EncodedAudioRender>;
   encodingFormat: AudioRenderFormat | null;
}>;

export type UseAudioRenderSessionArgs = Readonly<{
   song: Song;
   rendererReady: boolean;
   isRendererReady: () => boolean;
   getAudibleChannels: (song: Song) => Set<number>;
   renderSongToWav: (args: BackendRenderSongToWavArgs) => Promise<Tic80AudioCaptureResult>;
   onSettingsChange: (settings: AudioRenderSettings) => void;
   pushToast: (options: ToastOptions | string) => string;
}>;

export type AudioRenderSession = Readonly<{
   canOpen: boolean;
   isBusy: () => boolean;
   open: () => void;
   dialogProps: AudioRenderDialogProps;
}>;

function createConfigureState(song: Song): AudioRenderDialogState {
   const totalRows = song.getSongLengthRows();
   return {
      phase: "configure",
      fraction01: 0,
      completedRows: 0,
      totalRows,
      renderStartedAtMillis: null,
      renderCompletedAtMillis: null,
      totalAudioSeconds: tic80RowsToSeconds(totalRows, {
         tempo: song.tempo,
         speed: song.speed,
      }),
      sourceWavByteLength: 0,
      master: null,
      analysis: null,
      preview: null,
      downloads: {},
      encodingFormat: null,
   };
}

function copySettings(settings: AudioRenderSettings): AudioRenderSettings {
   return {...settings, metadata: {...settings.metadata}};
}

export function useAudioRenderSession(args: UseAudioRenderSessionArgs): AudioRenderSession {
   const [dialog, setDialog] = React.useState<AudioRenderDialogState | null>(null);
   const abortRef = React.useRef<AbortController | null>(null);
   const operationGenerationRef = React.useRef(0);
   const isBusy = React.useCallback(() => abortRef.current !== null, []);

   React.useEffect(() => () => {
      operationGenerationRef.current++;
      abortRef.current?.abort();
   }, []);

   const open = () => {
      if (dialog !== null || abortRef.current) return;
      if (!args.isRendererReady()) {
         args.pushToast({message: "TIC-80 is not ready to render audio.", variant: "error"});
         return;
      }
      if (args.song.subsystemType !== kSubsystem.key.TIC80) {
         args.pushToast({message: "Audio rendering is only available for TIC-80 songs.", variant: "error"});
         return;
      }
      setDialog(createConfigureState(args.song));
   };

   const render = async () => {
      if (abortRef.current || dialog === null) return;
      if (!args.isRendererReady()) {
         args.pushToast({message: "TIC-80 is not ready to render audio.", variant: "error"});
         return;
      }

      const songToRender = args.song.clone();
      const settings = copySettings(args.song.audioRenderSettings);
      const abortController = new AbortController();
      const operationGeneration = ++operationGenerationRef.current;
      const totalRows = songToRender.getSongLengthRows();
      const isCurrentOperation = () => (
         abortRef.current === abortController
         && operationGenerationRef.current === operationGeneration
         && !abortController.signal.aborted
      );
      abortRef.current = abortController;
      setDialog((state) => state ? {
         ...state,
         phase: "preparing",
         fraction01: 0,
         completedRows: 0,
         totalRows,
         renderStartedAtMillis: performance.now(),
         renderCompletedAtMillis: null,
         totalAudioSeconds: tic80RowsToSeconds(totalRows, {
            tempo: songToRender.tempo,
            speed: songToRender.speed,
         }),
         sourceWavByteLength: 0,
         master: null,
         analysis: null,
         preview: null,
         downloads: {},
         encodingFormat: null,
      } : state);

      try {
         const capture = await args.renderSongToWav({
            reason: "user export",
            song: songToRender,
            audibleChannels: args.getAudibleChannels(songToRender),
            signal: abortController.signal,
            onProgress: (progress) => {
               if (!isCurrentOperation()) return;
               setDialog((state) => state ? {...state, phase: "rendering", ...progress} : state);
            },
         });
         if (!isCurrentOperation()) return;

         setDialog((state) => state ? {
            ...state,
            phase: "analyzing",
            fraction01: 0,
            completedRows: state.totalRows,
            sourceWavByteLength: capture.bytes.byteLength,
         } : state);
         const analysis = await analyzeTic80CapturedWav({
            wavBytes: capture.bytes,
            signal: abortController.signal,
            onProgress: (progress) => {
               if (!isCurrentOperation()) return;
               setDialog((state) => state?.phase === "analyzing"
                  ? {...state, fraction01: progress.fraction01}
                  : state);
            },
         });
         if (!isCurrentOperation()) return;

         setDialog((state) => state ? {...state, phase: "processing", fraction01: 0} : state);
         const master = await createAudioRenderMaster({
            sourceWavBytes: capture.bytes,
            analysis,
            settings,
            signal: abortController.signal,
            onProgress: (progress) => {
               if (!isCurrentOperation()) return;
               setDialog((state) => state?.phase === "processing"
                  ? {...state, fraction01: progress.fraction01}
                  : state);
            },
         });
         if (!isCurrentOperation()) return;

         abortRef.current = null;
         setDialog((state) => state ? {
            ...state,
            phase: "ready",
            fraction01: 1,
            renderCompletedAtMillis: performance.now(),
            master,
            analysis,
            preview: master.preview,
         } : state);
      } catch (error) {
         if (operationGenerationRef.current !== operationGeneration) return;
         if (error instanceof Error && error.name === "AbortError") {
            args.pushToast({message: "Audio render cancelled.", variant: "info"});
         } else {
            console.error("Audio render failed", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            args.pushToast({message: `Failed to render audio: ${message}`, variant: "error"});
         }
         setDialog(createConfigureState(args.song));
      } finally {
         if (abortRef.current === abortController) {
            abortRef.current = null;
         }
      }
   };

   const cancel = () => {
      const abortController = abortRef.current;
      if (!abortController || abortController.signal.aborted) return;
      setDialog((state) => state ? {...state, phase: "cancelling"} : state);
      abortController.abort();
   };

   const close = () => {
      if (abortRef.current) return;
      operationGenerationRef.current++;
      setDialog(null);
   };

   const updateSettings = (settings: AudioRenderSettings) => {
      if (abortRef.current) return;
      const impact = getAudioRenderSettingsChangeImpact(args.song.audioRenderSettings, settings);
      args.onSettingsChange(settings);
      setDialog((state) => {
         if (!state || impact === "none") return state;
         if (impact === "master") return createConfigureState(args.song);
         return {...state, downloads: invalidateAudioRenderDownloadCache(state.downloads, impact)};
      });
   };

   const download = async (format: AudioRenderFormat) => {
      const master = dialog?.master;
      if (!master || abortRef.current) return;
      const settings = copySettings(args.song.audioRenderSettings);
      const cached = getCachedAudioRenderDownload(dialog.downloads, format, settings);
      if (cached) {
         const filename = args.song.getAudioRenderFilename(cached.extensionWithDot);
         saveSync(new Blob([cached.bytes as any], {type: cached.mimeType}), filename);
         args.pushToast({message: `Downloaded ${filename}.`, variant: "success"});
         return;
      }

      const abortController = new AbortController();
      const operationGeneration = ++operationGenerationRef.current;
      abortRef.current = abortController;
      setDialog((state) => state ? {
         ...state,
         phase: "encoding",
         encodingFormat: format,
         fraction01: 0,
      } : state);

      try {
         const encoded = await encodeAudioRenderDownload({
            masterWavBytes: master.bytes,
            masterFrameCount: master.preview.outputFrameCount,
            format,
            metadata: settings.metadata,
            mp3BitrateKbps: settings.mp3BitrateKbps,
            signal: abortController.signal,
            onProgress: (progress) => {
               if (
                  abortRef.current !== abortController
                  || operationGenerationRef.current !== operationGeneration
                  || abortController.signal.aborted
               ) return;
               setDialog((state) => state?.phase === "encoding"
                  ? {...state, fraction01: progress.fraction01}
                  : state);
            },
         });
         if (
            abortRef.current !== abortController
            || operationGenerationRef.current !== operationGeneration
            || abortController.signal.aborted
         ) return;

         const filename = args.song.getAudioRenderFilename(encoded.extensionWithDot);
         saveSync(new Blob([encoded.bytes as any], {type: encoded.mimeType}), filename);
         args.pushToast({message: `Downloaded ${filename}.`, variant: "success"});
         abortRef.current = null;
         setDialog((state) => state ? {
            ...state,
            phase: "ready",
            fraction01: 1,
            encodingFormat: null,
            downloads: cacheAudioRenderDownload(state.downloads, format, settings, encoded),
         } : state);
      } catch (error) {
         if (operationGenerationRef.current !== operationGeneration) return;
         if (error instanceof Error && error.name === "AbortError") {
            args.pushToast({message: "Audio encoding cancelled.", variant: "info"});
         } else {
            console.error("Audio encoding failed", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            args.pushToast({message: `Failed to encode audio: ${message}`, variant: "error"});
         }
         if (abortRef.current === abortController) {
            abortRef.current = null;
            setDialog((state) => state ? {
               ...state,
               phase: "ready",
               fraction01: 1,
               encodingFormat: null,
            } : state);
         }
      } finally {
         if (abortRef.current === abortController) {
            abortRef.current = null;
         }
      }
   };

   return {
      canOpen: args.rendererReady && args.song.subsystemType === kSubsystem.key.TIC80 && dialog === null,
      isBusy,
      open,
      dialogProps: {
         open: dialog !== null,
         phase: dialog?.phase ?? "configure",
         fraction01: dialog?.fraction01 ?? 0,
         completedRows: dialog?.completedRows ?? 0,
         totalRows: dialog?.totalRows ?? 0,
         renderStartedAtMillis: dialog?.renderStartedAtMillis ?? null,
         renderCompletedAtMillis: dialog?.renderCompletedAtMillis ?? null,
         totalAudioSeconds: dialog?.totalAudioSeconds ?? 0,
         sourceWavByteLength: dialog?.sourceWavByteLength ?? 0,
         analysis: dialog?.analysis ?? null,
         preview: dialog?.preview ?? null,
         settings: args.song.audioRenderSettings,
         encodingFormat: dialog?.encodingFormat ?? null,
         onSettingsChange: updateSettings,
         onRender: () => void render(),
         onCancel: cancel,
         onClose: close,
         onDownload: (format) => void download(format),
      },
   };
}
