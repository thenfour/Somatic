import React from "react";
import {Button} from "./Buttons/PushButton";
import {ModalDialog} from "./basic/ModalDialog";
import "./AudioRenderDialog.css";
import {clamp01} from "../utils/utils";
import {
   calculateAudioRenderMetrics,
   formatAudioRenderDuration,
} from "../audio/audio_render_metrics";

export type AudioRenderPhase = "preparing"|"rendering"|"cancelling";

export type AudioRenderDialogProps = {
   open: boolean;
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   renderStartedAtMillis: number|null;
   totalAudioSeconds: number;
   onCancel: () => void;
};

export const AudioRenderDialog: React.FC<AudioRenderDialogProps> = ({
   open,
   phase,
   fraction01,
   completedRows,
   totalRows,
   renderStartedAtMillis,
   totalAudioSeconds,
   onCancel,
}) => {
   const [nowMillis, setNowMillis] = React.useState(() => performance.now());

   React.useEffect(() => {
      if (!open || renderStartedAtMillis === null) return;
      const updateNow = () => setNowMillis(performance.now());
      updateNow();
      const timer = window.setInterval(updateNow, 250);
      return () => window.clearInterval(timer);
   }, [open, renderStartedAtMillis]);

   const safeFraction01 = clamp01(fraction01);
   const percent = Math.round(safeFraction01 * 100);
   const elapsedSeconds = renderStartedAtMillis === null
      ? 0
      : Math.max(0, (nowMillis - renderStartedAtMillis) / 1000);
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
      : phase === "cancelling"
         ? "Cancelling render..."
         : "Rendering audio...";

   return (
      <ModalDialog isOpen={open} ariaLabelledBy="audio-render-dialog-title">
         <div className="modal-dialog__body audio-render-dialog">
            <h2 id="audio-render-dialog-title">Render Song to WAV</h2>
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
