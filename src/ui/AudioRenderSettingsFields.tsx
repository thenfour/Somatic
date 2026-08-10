import React from "react";

import {
   AudioRenderFormat,
   AudioRenderFormatValues,
   AudioRenderMetadata,
   AudioRenderNormalizationTarget,
   AudioRenderSettings,
   AudioRenderSilencePadding,
} from "../models/song";
import {CheckboxButton} from "./Buttons/CheckboxButton";
import {RadioButton} from "./Buttons/RadioButton";
import "./AudioRenderSettingsFields.css";
import {ButtonGroup} from "./Buttons/ButtonGroup";
import {Knob} from "./basic/Knob2";

// const FormatLabels: Record<AudioRenderFormat, {title: AudioRenderFormat; detail: string}> = {
//    wav: {title: "wav", detail: "Lossless PCM"},
//    mp3: {title: "mp3", detail: "Compressed"},
//    flac: {title: "flac", detail: "Compressed lossless"},
// };

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
};

export const AudioRenderSettingsFields: React.FC<AudioRenderSettingsFieldsProps> = ({
   settings,
   onChange,
   legend = "Render settings",
}) => {
   const idPrefix = React.useId();

   const setFormat = (format: AudioRenderFormat) => {
      onChange({...settings, format});
   };

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
            <span className="audio-render-settings__group-label">Format</span>
            {/* <div className="audio-render-settings__formats" role="radiogroup" aria-label="Audio format"> */}
            <ButtonGroup orientation="horizontal">
               {AudioRenderFormatValues.map((format) => {
                  //const label = FormatLabels[format];
                  return (
                     <RadioButton
                        key={format}
                        type="button"
                        selected={settings.format === format}
                        role="radio"
                        aria-checked={settings.format === format}
                        onClick={() => setFormat(format)}
                     >
                        <span className="audio-render-settings__format-title">{format}</span>
                     </RadioButton>
                  );
               })}
            </ButtonGroup>
            {/* </div> */}
         </div>

         <div className="audio-render-settings__group">
            <span className="audio-render-settings__group-label">Peak Normalization</span>
            <div className="audio-render-settings__control-row">
            <CheckboxButton
               checked={settings.normalizePeak}
               onChange={(normalizePeak) => onChange({...settings, normalizePeak})}
            >
               Normalize
            </CheckboxButton>
            <Knob
               label="Target peak (dBFS)"
               disabled={!settings.normalizePeak}
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
               onChange={(trimSilence) => onChange({...settings, trimSilence})}
            >
               Trim Silence
            </CheckboxButton>
            <Knob
               label="Lead-in (ms)"
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
                     value={settings.metadata.comment}
                     onChange={(event) => setMetadata("comment", event.target.value)}
                  />
               </label>
            </div>
         </div>
      </fieldset>
   );
};
