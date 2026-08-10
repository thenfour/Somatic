import React from "react";
import {Button} from "./Buttons/PushButton";
import {ModalDialog} from "./basic/ModalDialog";
import "./AudioRenderDialog.css";
import {clamp01} from "../utils/utils";

export type AudioRenderPhase = "preparing"|"rendering"|"cancelling";

export type AudioRenderDialogProps = {
   open: boolean;
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   onCancel: () => void;
};

export const AudioRenderDialog: React.FC<AudioRenderDialogProps> = ({
   open,
   phase,
   fraction01,
   completedRows,
   totalRows,
   onCancel,
}) => {
   const safeFraction01 = clamp01(fraction01);
   const percent = Math.round(safeFraction01 * 100);
   const status = phase === "preparing"
      ? "Preparing song data..."
      : phase === "cancelling"
         ? "Cancelling render..."
         : `Rendering audio... ${percent}%`;

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
               <div className="audio-render-dialog__details">
                  {Math.min(completedRows, totalRows)} / {totalRows} rows
               </div>
            )}
         </div>
         <div className="modal-dialog__footer">
            <Button type="button" onClick={onCancel} disabled={phase === "cancelling"}>
               {phase === "cancelling" ? "Cancelling..." : "Cancel"}
            </Button>
         </div>
      </ModalDialog>
   );
};
