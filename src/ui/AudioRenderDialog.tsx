import React from "react";
import {Button} from "./Buttons/PushButton";
import {ModalDialog} from "./basic/ModalDialog";
import "./AudioRenderDialog.css";
import {clamp01, formatBytes} from "../utils/utils";
import {
   calculateAudioRenderMetrics,
   formatAudioRenderDuration,
} from "../audio/audio_render_metrics";
import {AudioRenderFormat, AudioRenderFormatValues, AudioRenderSettings} from "../models/song";
import {AudioRenderSettingsFields} from "./AudioRenderSettingsFields";
import {WaveformVisualizer} from "./WaveformVisualizer";
import type {AudioRenderPreview, AudioSourceAnalysis} from "../audio/audio_render_processing";
import {linearGainToDecibels} from "../utils/music/dsp";
import {Tooltip} from "./basic/tooltip";

export type AudioRenderPhase =
   | "configure"
   | "preparing"
   | "rendering"
   | "analyzing"
   | "processing"
   | "encoding"
   | "cancelling"
   | "ready";

export type AudioRenderDialogProps = {
   open: boolean;
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   renderStartedAtMillis: number | null;
   renderCompletedAtMillis: number | null;
   totalAudioSeconds: number;
   sourceWavByteLength: number;
   analysis: AudioSourceAnalysis | null;
   preview: AudioRenderPreview | null;
   settings: AudioRenderSettings;
   encodingFormat: AudioRenderFormat | null;
   onSettingsChange: (settings: AudioRenderSettings) => void;
   onRender: () => void;
   onCancel: () => void;
   onClose: () => void;
   onDownload: (format: AudioRenderFormat) => void;
};

function formatPeakDbfs(dbfs: number): string {
   return Number.isFinite(dbfs) ? `${dbfs.toFixed(1)} dBFS` : "−inf dBFS";
}

function formatGainDb(gain: number): string {
   const gainDb = linearGainToDecibels(gain);
   if (!Number.isFinite(gainDb)) return "−inf dB";
   return `${gainDb >= 0 ? "+" : ""}${gainDb.toFixed(1)} dB`;
}

function formatPreciseAudioDuration(seconds: number): string {
   const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
   const milliseconds = totalMilliseconds % 1000;
   const totalSeconds = Math.floor(totalMilliseconds / 1000);
   const second = totalSeconds % 60;
   const totalMinutes = Math.floor(totalSeconds / 60);
   const minute = totalMinutes % 60;
   const hour = Math.floor(totalMinutes / 60);
   const secondsPart = `${second.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
   return hour > 0
      ? `${hour}:${minute.toString().padStart(2, "0")}:${secondsPart}`
      : `${minute}:${secondsPart}`;
}

export const AudioRenderDialog: React.FC<AudioRenderDialogProps> = ({
   open,
   phase,
   fraction01,
   completedRows,
   totalRows,
   renderStartedAtMillis,
   renderCompletedAtMillis,
   totalAudioSeconds,
   sourceWavByteLength,
   analysis,
   preview,
   settings,
   encodingFormat,
   onSettingsChange,
   onRender,
   onCancel,
   onClose,
   onDownload,
}) => {
   const [nowMillis, setNowMillis] = React.useState(() => performance.now());
   const isReady = phase === "ready";
   const isWorking = !isReady && phase !== "configure";
   const hasMaster = analysis !== null && preview !== null;

   React.useEffect(() => {
      if (!open || renderStartedAtMillis === null || isReady) return;
      const updateNow = () => setNowMillis(performance.now());
      updateNow();
      const timer = window.setInterval(updateNow, 250);
      return () => window.clearInterval(timer);
   }, [open, isReady, renderStartedAtMillis]);

   const safeFraction01 = clamp01(fraction01);
   const percent = Math.round(safeFraction01 * 100);
   const metricNowMillis = renderCompletedAtMillis ?? nowMillis;
   const elapsedSeconds = renderStartedAtMillis === null
      ? 0
      : Math.max(0, (metricNowMillis - renderStartedAtMillis) / 1000);
   const metrics = calculateAudioRenderMetrics({
      fraction01: safeFraction01,
      totalAudioSeconds,
      elapsedSeconds,
   });
   const elapsedText = formatAudioRenderDuration(metrics.elapsedSeconds);
   const remainingText = metrics.remainingSeconds === null
      ? "Estimating..."
      : formatAudioRenderDuration(metrics.remainingSeconds, "ceil");
   const rateText = metrics.realtimeRate === null
      ? "Estimating..."
      : `${metrics.realtimeRate.toFixed(1)}x realtime`;
   const status = phase === "preparing"
      ? "Preparing song data..."
      : phase === "rendering"
         ? "Rendering audio..."
         : phase === "analyzing"
            ? "Analyzing captured audio..."
            : phase === "processing"
               ? "Creating PCM master..."
               : phase === "encoding"
                  ? `Encoding ${encodingFormat?.toUpperCase() ?? "audio"}...`
                  : phase === "cancelling"
                     ? "Cancelling..."
                     : null;
   const progressIsIndeterminate = phase === "preparing" || phase === "analyzing";
   const trimmedFrames = analysis && preview
      ? Math.max(0, analysis.frameCount - preview.trimmedFrameCount)
      : 0;

   return (
      <ModalDialog
         isOpen={open}
         className="audio-render-modal"
         ariaLabelledBy="audio-render-dialog-title"
         onBackdropClick={isWorking ? undefined : onClose}
      >
         <div className="modal-dialog__body audio-render-dialog">
            <div className="audio-render-dialog__heading">
               <h2 id="audio-render-dialog-title">Export Audio</h2>
               <p>
                  {hasMaster
                     ? "The rendered master is ready for download."
                     : "Render the master before choosing a download format."}
               </p>
            </div>

            {isWorking && status && (
               <div className="audio-render-dialog__work">
                  <p>{status}</p>
                  <progress
                     className="audio-render-dialog__progress"
                     max={1}
                     value={progressIsIndeterminate ? undefined : safeFraction01}
                     aria-label="Audio render progress"
                  />
                  {phase === "rendering" && totalRows > 0 && (
                     <div className="audio-render-dialog__progress-summary">
                        <span>{Math.min(completedRows, totalRows)} / {totalRows} rows</span>
                        <strong>{percent}%</strong>
                     </div>
                  )}
                  {(phase === "processing" || phase === "encoding") && (
                     <div className="audio-render-dialog__progress-summary">
                        <span>{phase === "processing" ? "Processing captured PCM" : "Encoding rendered master"}</span>
                        <strong>{percent}%</strong>
                     </div>
                  )}
                  {(phase === "preparing" || phase === "rendering") && (
                     <dl className="audio-render-dialog__metrics">
                        <div><dt>Elapsed</dt><dd>{elapsedText}</dd></div>
                        <div><dt>Remaining</dt><dd>{remainingText}</dd></div>
                        <div><dt>Rate</dt><dd>{rateText}</dd></div>
                     </dl>
                  )}
               </div>
            )}

            {hasMaster && analysis && preview && (
               <>
                  <div className="audio-render-dialog__waveform">
                     <WaveformVisualizer
                        envelope={preview.waveform}
                        height={150}
                        ariaLabel="Rendered audio waveform preview"
                     />
                  </div>
                  <dl className="audio-render-dialog__source-metrics">
                     <div><dt>Duration</dt><dd>{formatPreciseAudioDuration(preview.durationSeconds)}</dd></div>
                     <div>
                        <dt>Source</dt>
                        <dd>{formatBytes(sourceWavByteLength)} · {(analysis.sampleRateHz / 1000).toFixed(1)} kHz · {analysis.channelCount} ch</dd>
                     </div>
                     <div><dt>Render time</dt><dd>{elapsedText}</dd></div>
                     <div><dt>Processed peak</dt><dd>{formatPeakDbfs(preview.outputPeakDbfs)}</dd></div>
                     <div><dt>Source peak</dt><dd>{formatPeakDbfs(analysis.peakDbfs)}</dd></div>
                     <div><dt>Gain</dt><dd>{formatGainDb(preview.gain)}</dd></div>
                     <div>
                        <dt>Trimmed</dt>
                        <dd>{formatPreciseAudioDuration(trimmedFrames / analysis.sampleRateHz)}</dd>
                     </div>
                  </dl>
               </>
            )}

            <AudioRenderSettingsFields
               settings={settings}
               onChange={onSettingsChange}
               disabled={isWorking}
            />
         </div>

         <div className="modal-dialog__footer audio-render-dialog__footer">
            <div className="audio-render-dialog__downloads" aria-label="Audio download formats">
               <span>Download as:</span>
               {AudioRenderFormatValues.map((format) => (
                  <Tooltip
                     key={format}
                     title={isReady
                        ? `Download ${format.toUpperCase()}`
                        : hasMaster
                           ? "Wait for the current task to finish"
                           : "Render the song before downloading"}
                  >
                     <span className="audio-render-dialog__download-trigger">
                        <Button
                           type="button"
                           disabled={!isReady}
                           onClick={() => onDownload(format)}
                        >
                           {format.toUpperCase()}
                        </Button>
                     </span>
                  </Tooltip>
               ))}
            </div>
            <div className="audio-render-dialog__actions">
               {isWorking ? (
                  <Button type="button" onClick={onCancel} disabled={phase === "cancelling"}>
                     {phase === "cancelling" ? "Cancelling..." : "Cancel"}
                  </Button>
               ) : (
                  <>
                     <Button type="button" onClick={onClose}>Close</Button>
                     <Button type="button" onClick={onRender}>{isReady ? "Render Again" : "Render"}</Button>
                  </>
               )}
            </div>
         </div>
      </ModalDialog>
   );
};
