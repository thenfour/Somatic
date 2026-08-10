import React from "react";
import {Button} from "./Buttons/PushButton";
import {ModalDialog} from "./basic/ModalDialog";
import {Tooltip} from "./basic/tooltip";
import "./AudioRenderDialog.css";
import {clamp01, formatBytes} from "../utils/utils";
import {
   calculateAudioRenderMetrics,
   formatAudioRenderDuration,
} from "../audio/audio_render_metrics";
import {AudioRenderSettings} from "../models/song";
import {AudioRenderSettingsFields} from "./AudioRenderSettingsFields";
import {WaveformVisualizer} from "./WaveformVisualizer";

export type AudioRenderPhase = "preparing" | "rendering" | "cancelling" | "review";

export type AudioRenderDialogProps = {
   open: boolean;
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   renderStartedAtMillis: number|null;
   renderCompletedAtMillis: number | null;
   totalAudioSeconds: number;
   sourceWavByteLength: number;
   settings: AudioRenderSettings;
   onSettingsChange: (settings: AudioRenderSettings) => void;
   onCancel: () => void;
   onClose: () => void;
   onDownload: () => void;
};

const MockWaveformSamples = (() => {
   const sampleCount = 4096;
   const samples = new Float32Array(sampleCount);
   for (let i = 0; i < sampleCount; i++) {
      const position01 = i / Math.max(1, sampleCount - 1);
      const phrase = 0.28 + 0.6 * Math.pow(Math.sin(position01 * Math.PI * 5.5), 2);
      const fade = Math.min(1, position01 * 12, (1 - position01) * 12);
      samples[i] = (
         Math.sin(i * 0.071)
         + Math.sin(i * 0.019) * 0.48
         + Math.sin(i * 0.131) * 0.18
      ) * 0.48 * phrase * fade;
   }
   return samples;
})();

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
   settings,
   onSettingsChange,
   onCancel,
   onClose,
   onDownload,
}) => {
   const [nowMillis, setNowMillis] = React.useState(() => performance.now());

   React.useEffect(() => {
      if (!open || renderStartedAtMillis === null || phase === "review") return;
      const updateNow = () => setNowMillis(performance.now());
      updateNow();
      const timer = window.setInterval(updateNow, 250);
      return () => window.clearInterval(timer);
   }, [open, phase, renderStartedAtMillis]);

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

   if (phase === "review") {
      const format = settings.format.toUpperCase();

      return (
         <ModalDialog
            isOpen={open}
            className="audio-render-modal audio-render-modal--review"
            ariaLabelledBy="audio-render-dialog-title"
            onBackdropClick={onClose}
         >
            <div className="modal-dialog__body audio-render-dialog audio-render-dialog--review">
               <div className="audio-render-dialog__heading">
                  <div>
                     <h2 id="audio-render-dialog-title">Export Audio</h2>
                  </div>
               </div>

               <div className="audio-render-dialog__waveform">
                  <WaveformVisualizer
                     samples={MockWaveformSamples}
                     height={150}
                  />
               </div>

               <dl className="audio-render-dialog__source-metrics">
                  <div>
                     <dt>Duration</dt>
                     <dd>{formatAudioRenderDuration(totalAudioSeconds)}</dd>
                  </div>
                  <div>
                     <dt>Source</dt>
                     <dd>{formatBytes(sourceWavByteLength)} WAV</dd>
                  </div>
                  <div>
                     <dt>Render time</dt>
                     <dd>{elapsedText}</dd>
                  </div>
                  <div>
                     <dt>Peak</dt>
                     <dd>(todo)</dd>
                  </div>
               </dl>

               <AudioRenderSettingsFields
                  legend="Output"
                  settings={settings}
                  onChange={onSettingsChange}
               />

            </div>
            <div className="modal-dialog__footer">
               <Button type="button" onClick={onClose}>Close</Button>
               <Button type="button" onClick={onDownload}>Download {format}</Button>
            </div>
         </ModalDialog>
      );
   }

   const status = phase === "preparing"
      ? "Preparing song data..."
      : phase === "cancelling"
         ? "Cancelling render..."
         : "Rendering audio...";

   return (
      <ModalDialog isOpen={open} ariaLabelledBy="audio-render-dialog-title">
         <div className="modal-dialog__body audio-render-dialog">
            <h2 id="audio-render-dialog-title">Render Audio</h2>
            <p>{status}</p>
            <progress
               className="audio-render-dialog__progress"
               max={1}
               value={phase === "preparing" ? undefined : safeFraction01}
               aria-label="Audio render progress"
            />
            {phase !== "preparing" && totalRows > 0 && (
               <div className="audio-render-dialog__progress-summary">
                  <span>{Math.min(completedRows, totalRows)} / {totalRows} rows</span>
                  <strong>{percent}%</strong>
               </div>
            )}
            <dl className="audio-render-dialog__metrics">
               <div>
                  <dt>Elapsed</dt>
                  <dd>{elapsedText}</dd>
               </div>
               <div>
                  <dt>Remaining</dt>
                  <dd>{remainingText}</dd>
               </div>
               <div>
                  <dt>Rate</dt>
                  <dd>{rateText}</dd>
               </div>
            </dl>
         </div>
         <div className="modal-dialog__footer">
            <Button type="button" onClick={onCancel} disabled={phase === "cancelling"}>
               {phase === "cancelling" ? "Cancelling..." : "Cancel"}
            </Button>
         </div>
      </ModalDialog>
   );
};
