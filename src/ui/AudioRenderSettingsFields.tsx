import React from "react";

import {
   AudioRenderMetadata,
   AudioRenderMp3BitrateKbps,
   AudioRenderMp3BitrateKbpsValues,
   AudioRenderNormalizationTarget,
   AudioRenderSettings,
   AudioRenderSilencePadding,
} from "../models/song";
import {CheckboxButton} from "./Buttons/CheckboxButton";
import "./AudioRenderSettingsFields.css";
import {Knob} from "./basic/Knob2";

const MetadataFields: ReadonlyArray<{
   key: Exclude<keyof AudioRenderMetadata, "comment">;
   label: string;
   maxLength: number;
}> = [
      {key: "title", label: "Title", maxLength: 160},
      {key: "artist", label: "Artist", maxLength: 160},
      {key: "album", label: "Album", maxLength: 160},
      {key: "year", label: "Year", maxLength: 32},
      {key: "genre", label: "Genre", maxLength: 80},
   ];

export type AudioRenderSettingsFieldsProps = {
   settings: AudioRenderSettings;
   onChange: (settings: AudioRenderSettings) => void;
   legend?: string;
   disabled?: boolean;
};

export const AudioRenderSettingsFields: React.FC<AudioRenderSettingsFieldsProps> = ({
   settings,
   onChange,
   legend = "Render settings",
   disabled = false,
}) => {
   const idPrefix = React.useId();

   const setMetadata = (key: keyof AudioRenderMetadata, value: string) => {
      onChange({
         ...settings,
         metadata: {...settings.metadata, [key]: value},
      });
   };

   return (
      <fieldset className="audio-render-settings">
         <legend>{legend}</legend>

         <div className="audio-render-settings__group">
            <span className="audio-render-settings__group-label">Mastering</span>
            <div className="audio-render-settings__control-row">
               <CheckboxButton
                  checked={settings.removeDcBias}
                  disabled={disabled}
                  onChange={(removeDcBias) => onChange({...settings, removeDcBias})}
               >
                  Remove DC bias
               </CheckboxButton>
               <CheckboxButton
                  checked={settings.normalizePeak}
                  disabled={disabled}
                  onChange={(normalizePeak) => onChange({...settings, normalizePeak})}
               >
                  Normalize
               </CheckboxButton>
               <Knob
                  label="Target peak (dBFS)"
                  disabled={disabled || !settings.normalizePeak}
                  value={settings.normalizationTargetDbfs}
                  onChange={(normalizationTargetDbfs) => onChange({...settings, normalizationTargetDbfs})}
                  min={AudioRenderNormalizationTarget.minDbfs}
                  max={AudioRenderNormalizationTarget.maxDbfs}
                  step={0.1}
                  centerValue={0}
                  defaultValue={AudioRenderNormalizationTarget.defaultDbfs}
                  formatValue={(value) => value.toFixed(1)}
               />
            </div>
         </div>

         <div className="audio-render-settings__group">
            <span className="audio-render-settings__group-label">Lead-in/out</span>
            <div className="audio-render-settings__control-row">
               <CheckboxButton
                  checked={settings.trimSilence}
                  disabled={disabled}
                  onChange={(trimSilence) => onChange({...settings, trimSilence})}
               >
                  Trim Silence
               </CheckboxButton>
               <Knob
                  label="Lead-in (ms)"
                  disabled={disabled}
                  value={settings.leadingSilenceMs}
                  onChange={(leadingSilenceMs) => onChange({...settings, leadingSilenceMs})}
                  min={AudioRenderSilencePadding.minMs}
                  max={AudioRenderSilencePadding.maxMs}
                  step={10}
                  centerValue={0}
                  defaultValue={AudioRenderSilencePadding.defaultMs}
                  formatValue={(value) => Math.round(value).toString()}
               />
               <Knob
                  label="Lead-out (ms)"
                  disabled={disabled}
                  value={settings.trailingSilenceMs}
                  onChange={(trailingSilenceMs) => onChange({...settings, trailingSilenceMs})}
                  min={AudioRenderSilencePadding.minMs}
                  max={AudioRenderSilencePadding.maxMs}
                  step={10}
                  centerValue={0}
                  defaultValue={AudioRenderSilencePadding.defaultMs}
                  formatValue={(value) => Math.round(value).toString()}
               />
            </div>
         </div>

         <div className="audio-render-settings__group">
            <span className="audio-render-settings__group-label">MP3</span>
            <label className="audio-render-settings__select" htmlFor={`${idPrefix}-mp3-bitrate`}>
               <span>Bitrate</span>
               <select
                  id={`${idPrefix}-mp3-bitrate`}
                  disabled={disabled}
                  value={settings.mp3BitrateKbps}
                  onChange={(event) => onChange({
                     ...settings,
                     mp3BitrateKbps: Number(event.target.value) as AudioRenderMp3BitrateKbps,
                  })}
               >
                  {AudioRenderMp3BitrateKbpsValues.map((bitrate) => (
                     <option key={bitrate} value={bitrate}>{bitrate} kbps</option>
                  ))}
               </select>
            </label>
         </div>

         <div className="audio-render-settings__group">
            <span className="audio-render-settings__group-label">Metadata</span>
            <div className="audio-render-settings__metadata">
               {MetadataFields.map((field) => {
                  const id = `${idPrefix}-${field.key}`;
                  return (
                     <label key={field.key} htmlFor={id}>
                        <span>{field.label}</span>
                        <input
                           id={id}
                           type="text"
                           maxLength={field.maxLength}
                           disabled={disabled}
                           value={settings.metadata[field.key]}
                           onChange={(event) => setMetadata(field.key, event.target.value)}
                        />
                     </label>
                  );
               })}
               <label className="audio-render-settings__comment" htmlFor={`${idPrefix}-comment`}>
                  <span>Comment</span>
                  <textarea
                     id={`${idPrefix}-comment`}
                     rows={2}
                     maxLength={500}
                     disabled={disabled}
                     value={settings.metadata.comment}
                     onChange={(event) => setMetadata("comment", event.target.value)}
                  />
               </label>
            </div>
         </div>
      </fieldset>
   );
};
