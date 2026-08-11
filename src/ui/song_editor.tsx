import React from 'react';
import {Tic80AudioController} from '../audio/controller';
import {useClipboard} from '../hooks/useClipboard';
import {useShortcutManager} from '../keyb/KeyboardShortcutManager';
import {EditorState} from '../models/editor_state';
import {
   CueSheetField,
   CueSheetFieldValues,
   createExportConfigurationClipboardPayload,
   ExportConfiguration,
   isValidExportConfigurationName,
   parseExportConfigurationClipboardPayload,
} from '../models/exportConfiguration';
import type {ArrangementThumbnailSize} from '../models/song';
import {buildSongMetadataPayload, Song} from '../models/song';
import {SomaticCaps} from '../models/tic80Capabilities';
import {kSubsystem, SubsystemTypeKey} from '../subsystem/base/SubsystemBackendBase';
import {
   tic80AnalyzeRuntimeCadence,
   tic80EffectTicksToBeatPercent,
   tic80EffectTicksToSeconds,
   tic80RowsToEffectTicks,
   tic80RuntimeTicksForRows,
} from '../utils/music/tic80Music';
import {clamp, formatTiming, formatToDecimalPlaces} from '../utils/utils';
import {IntegerUpDown} from './basic/NumericUpDown';
import {Tooltip} from './basic/tooltip';
import {ButtonGroup} from './Buttons/ButtonGroup';
import {CheckboxButton} from './Buttons/CheckboxButton';
import {RadioButton} from './Buttons/RadioButton';
import {Button} from './Buttons/PushButton';
import {DebugContainer} from './basic/DebugContainer';
import {LuaOptimizationOptions} from "./LuaOptimizationOptions";
import {AudioRenderSettingsFields} from "./AudioRenderSettingsFields";
import {useToasts} from "./toast_provider";
import {IconButton} from "./Buttons/IconButton";
import {mdiClose, mdiContentCopy, mdiContentPaste, mdiPlus} from "@mdi/js";
import {Divider} from "./basic/Divider";
import {useConfirmDialog} from "./basic/confirm_dialog";

type SongEditorProps = {
   song: Song;
   editorState: EditorState;
   onSongChange: (args: {mutator: (song: Song) => void; description: string; undoable: boolean;}) => void;
   onEditorStateChange: (mutator: (state: EditorState) => void) => void;
   audio: Tic80AudioController;
};

type ExportConfigurationSettingsProps = Pick<SongEditorProps, "song" | "onSongChange">;

const ExportConfigurationSettings: React.FC<ExportConfigurationSettingsProps> = ({song, onSongChange}) => {
   const clipboard = useClipboard();
   const {pushToast} = useToasts();
   const confirm = useConfirmDialog();
   const [selectedIndex, setSelectedIndex] = React.useState(0);
   const effectiveSelectedIndex = Math.min(selectedIndex, song.exportConfigurations.length - 1);
   const selectedConfiguration = song.exportConfigurations[effectiveSelectedIndex];
   const [nameDraft, setNameDraft] = React.useState(selectedConfiguration.name);
   const nameIsValid = isValidExportConfigurationName(nameDraft);

   React.useEffect(() => {
      if (selectedIndex !== effectiveSelectedIndex) {
         setSelectedIndex(effectiveSelectedIndex);
      }
   }, [effectiveSelectedIndex, selectedIndex]);

   React.useEffect(() => {
      setNameDraft(selectedConfiguration.name);
   }, [effectiveSelectedIndex, selectedConfiguration.name]);

   const commitName = () => {
      if (!nameIsValid) {
         setNameDraft(selectedConfiguration.name);
         return;
      }
      if (nameDraft === selectedConfiguration.name) return;
      onSongChange({
         description: "Rename export configuration",
         undoable: true,
         mutator: (s) => {
            s.exportConfigurations[effectiveSelectedIndex].name = nameDraft;
         },
      });
   };

   const copyConfiguration = async () => {
      try {
         const configuration = new ExportConfiguration({
            ...selectedConfiguration.toData(),
            name: nameIsValid ? nameDraft : selectedConfiguration.name,
         });
         await clipboard.copyObjectToClipboard(createExportConfigurationClipboardPayload(configuration));
      } catch (error) {
         console.error("Failed to copy export configuration", error);
         pushToast({message: "Failed to copy export configuration.", variant: "error"});
      }
   };

   const pasteConfiguration = async () => {
      try {
         const payload = await clipboard.readObjectFromClipboard<unknown>();
         const pastedConfiguration = parseExportConfigurationClipboardPayload(payload);
         if (!pastedConfiguration) {
            pushToast({message: "Clipboard does not contain an export configuration.", variant: "error"});
            return;
         }
         onSongChange({
            description: "Paste export configuration",
            undoable: true,
            mutator: (s) => {
               s.exportConfigurations[effectiveSelectedIndex] = pastedConfiguration;
            },
         });
         setNameDraft(pastedConfiguration.name);
      } catch (error) {
         console.error("Failed to paste export configuration", error);
         pushToast({message: "Failed to paste export configuration.", variant: "error"});
      }
   };

   const handleCopyCueSheet = async () => {
      const fields = selectedConfiguration.exportCueSheet ? selectedConfiguration.cueSheetFields : [];
      const payload = buildSongMetadataPayload(song, fields);
      await clipboard.copyTextToClipboard(JSON.stringify(payload, null, 2));
   };

   return (
      <fieldset>
         <legend>Export Configurations</legend>

         <div role="radiogroup" aria-label="Export configurations" style={{marginBottom: 8}}>
            <ButtonGroup orientation="horizontal">
               {song.exportConfigurations.map((configuration, index) => (
                  <RadioButton
                     key={index}
                     role="radio"
                     aria-checked={index === effectiveSelectedIndex}
                     selected={index === effectiveSelectedIndex}
                     onClick={() => setSelectedIndex(index)}
                  >
                     {configuration.name}
                  </RadioButton>
               ))}
               <Divider />
               <IconButton
                  type="button"
                  onClick={() => {
                     const newIndex = song.exportConfigurations.length;
                     onSongChange({
                        description: "Add export configuration",
                        undoable: true,
                        mutator: (s) => {
                           s.addExportConfiguration();
                        },
                     });
                     setSelectedIndex(newIndex);
                  }}
                  iconPath={mdiPlus}
               >
                  Add
               </IconButton>

            </ButtonGroup>
         </div>


         <div>
            <label>
               Export configuration name
               <input
                  type="text"
                  required
                  aria-invalid={!nameIsValid}
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  onBlur={commitName}
                  onKeyDown={(event) => {
                     if (event.key === "Enter") event.currentTarget.blur();
                  }}
               />
            </label>
         </div>



         <ButtonGroup orientation="horizontal">
            <IconButton
               type="button"
               disabled={song.exportConfigurations.length <= 1}
               onClick={async () => {
                  if (await confirm.confirm({
                     content: `Delete configuration: "${selectedConfiguration.name}"?`,
                  })) {
                     onSongChange({
                        description: "Delete export configuration",
                        undoable: true,
                        mutator: (s) => {
                           s.deleteExportConfiguration(effectiveSelectedIndex);
                        },
                     });
                  }
               }}
               iconPath={mdiClose}
            >
               Delete
            </IconButton>
            <IconButton type="button" onClick={() => void copyConfiguration()} iconPath={mdiContentCopy}>Copy</IconButton>
            <IconButton type="button" onClick={() => void pasteConfiguration()} iconPath={mdiContentPaste}>Paste</IconButton>
         </ButtonGroup>

         <fieldset>
            <legend>Cuesheet</legend>
            <ButtonGroup>
               <IconButton onClick={handleCopyCueSheet} iconPath={mdiContentCopy}>Copy cue sheet</IconButton>
            </ButtonGroup>
            <div style={{maxWidth: 350}}>
               Export an arrangement cue sheet as a global Lua table so carts can drive animation from song structure
               or pattern names. The table is called SOMATIC_CUE_SHEET.
            </div>
            <CheckboxButton
               checked={selectedConfiguration.exportCueSheet}
               onChange={(checked) => {
                  onSongChange({
                     description: checked ? "Enable cue sheet export" : "Disable cue sheet export",
                     undoable: true,
                     mutator: (s) => {
                        s.exportConfigurations[effectiveSelectedIndex].exportCueSheet = checked;
                     },
                  });
               }}
            >
               Export cue sheet?
            </CheckboxButton>
            {selectedConfiguration.exportCueSheet && (
               <div style={{marginTop: 8}}>
                  <div>Fields included in each cue:</div>
                  <ButtonGroup orientation="vertical" style={{marginTop: 4}}>
                     {CueSheetFieldValues.map((field) => (
                        <CheckboxButton
                           key={field}
                           checked={selectedConfiguration.cueSheetFields.includes(field)}
                           onChange={(checked) => {
                              onSongChange({
                                 description: `${checked ? "Include" : "Exclude"} cue sheet field ${field}`,
                                 undoable: true,
                                 mutator: (s) => s.exportConfigurations[
                                    effectiveSelectedIndex
                                 ].setCueSheetFieldEnabled(field, checked),
                              });
                           }}
                        >
                           {CueSheetFieldLabels[field]}
                        </CheckboxButton>
                     ))}
                  </ButtonGroup>
               </div>
            )}
         </fieldset>

         <fieldset>
            <legend>Optimization</legend>
            <LuaOptimizationOptions
               value={selectedConfiguration.minificationOptions}
               onChange={(newOptions) => {
                  onSongChange({
                     description: "Set export minification options",
                     undoable: true,
                     mutator: (s) => {
                        s.exportConfigurations[effectiveSelectedIndex].setMinificationOptions(newOptions);
                     },
                  });
               }}
            />
         </fieldset>

         <fieldset>
            <legend>Custom Playroutine Entrypoint</legend>
            <p>
               Define a custom Lua snippet which includes the TIC() function when exporting the song.
            </p>
            <CheckboxButton
               checked={selectedConfiguration.useCustomEntrypointLua}
               onChange={(checked) => {
                  onSongChange({
                     description: checked ? "Enable custom playroutine" : "Disable custom playroutine",
                     undoable: true,
                     mutator: (s) => {
                        s.exportConfigurations[effectiveSelectedIndex].useCustomEntrypointLua = checked;
                     },
                  });
               }}
            >
               Use custom entrypoint?
            </CheckboxButton>
            <label>
               <textarea
                  className="debug-panel-textarea"
                  disabled={!selectedConfiguration.useCustomEntrypointLua}
                  value={selectedConfiguration.customEntrypointLua}
                  onChange={(event) => onSongChange({
                     description: "Set custom playroutine entrypoint",
                     undoable: true,
                     mutator: (s) => {
                        s.exportConfigurations[effectiveSelectedIndex].customEntrypointLua = event.target.value;
                     },
                  })}
               />
            </label>
         </fieldset>
      </fieldset>
   );
};

const CueSheetFieldLabels: Record<CueSheetField, string> = {
   pi: "Pattern index (pi)",
   beat: "Start beat (beat)",
   rows: "Row count (rows)",
   icon: "Arrangement marker (icon)",
   note: "Pattern name (note)",
};

const formatRowTiming = (rowCount: number, tempo: number, speed: number): string => {
   const ticks = tic80RowsToEffectTicks(rowCount, {tempo, speed});
   const seconds = tic80EffectTicksToSeconds(ticks);
   const runtimeTicks = tic80RuntimeTicksForRows(rowCount, {tempo, speed});
   const timingErrorSeconds = tic80EffectTicksToSeconds(runtimeTicks - ticks);
   const timingError = formatTiming(timingErrorSeconds);
   const timingErrorAsPercentOfBeat = formatToDecimalPlaces(tic80EffectTicksToBeatPercent(runtimeTicks - ticks, {tempo, speed}, 4), 2);
   return `${rowCount} rows = ${formatToDecimalPlaces(ticks, 2)} TICs `
      + `(${formatTiming(seconds)}; error: ${timingError} [${timingErrorAsPercentOfBeat}% of a beat])`;
};

export const SongEditor: React.FC<SongEditorProps> = ({song, editorState, onSongChange, onEditorStateChange, audio}) => {
   const patternId = song.songOrder[editorState.activeSongPosition].patternIndex ?? 0;
   //const pattern = song.patterns[patternId]!;
   const mgr = useShortcutManager();

   const onSpeedChange = (val: number) => {
      onSongChange({
         description: "Set song speed",
         undoable: true,
         mutator: (s) => s.setSpeed(val),
      });
   };

   const onTempoChange = (val: number) => {
      onSongChange({description: 'Set song tempo', undoable: true, mutator: (s) => s.setTempo(val)});
   };

   const onRowsPerPatternChange = (val: number) => {
      onSongChange({description: 'Set rows per pattern', undoable: true, mutator: (s) => s.setRowsPerPattern(val)});
   };

   const rowsPerBeat = song.getRowsPerBeat();
   const bpm = song.subsystem.calculateBpm({songTempo: song.tempo, songSpeed: song.speed, rowsPerBeat});
   const tic80RuntimeCadence = song.subsystemType === kSubsystem.key.TIC80
      ? tic80AnalyzeRuntimeCadence({tempo: song.tempo, speed: song.speed}, song.rowsPerPattern)
      : null;
   const runtimePatternTicks = tic80RuntimeCadence
      ? tic80RuntimeTicksForRows(song.rowsPerPattern, {tempo: song.tempo, speed: song.speed})
      : null;

   const thumbnailSize: ArrangementThumbnailSize = song.arrangementThumbnailSize ?? "normal";

   const onSubsystemTypeChange = (nextSubsystemType: SubsystemTypeKey) => {
      onSongChange({
         description: 'Set song subsystem',
         undoable: true,
         mutator: (s) => {
            if (s.subsystemType === nextSubsystemType) return;
            const nextSong = Song.fromData({
               ...s.toData(),
               subsystemType: nextSubsystemType,
            });
            Object.assign(s, nextSong);
         },
      });

      // Keep editor state sane when channel count / rows change.
      onEditorStateChange((st) => {
         st.setPatternSelection(null);
         st.setArrangementSelection(null);

         const safeChannel = clamp(st.patternEditChannel ?? 0, 0, song.subsystem.channelCount - 1);
         const safeRow = clamp(st.patternEditRow ?? 0, 0, song.rowsPerPattern - 1);
         st.setPatternEditTarget({rowIndex: safeRow, channelIndex: safeChannel, song});

         for (const ch of [...st.mutedChannels]) {
            if (ch < 0 || ch >= song.subsystem.channelCount) st.mutedChannels.delete(ch);
         }
         for (const ch of [...st.soloedChannels]) {
            if (ch < 0 || ch >= song.subsystem.channelCount) st.soloedChannels.delete(ch);
         }
      });
   };

   return (
      <div className="section song-editor-root">
         <label>
            Song title
            <input
               type="text"
               className='song-title-input'
               maxLength={SomaticCaps.maxSongTitleLength}
               value={song.name}
               onChange={(e) => onSongChange({
                  description: 'Set song title',
                  undoable: true,
                  mutator: (s) => {
                     s.setName(e.target.value);
                  },
               })}
            />
         </label>

         <DebugContainer>
            <div className="field-row">
               <label htmlFor="song-subsystem">Subsystem</label>
               <select
                  id="song-subsystem"
                  value={song.subsystemType}
                  onChange={(e) => onSubsystemTypeChange(e.target.value as SubsystemTypeKey)}
               >
                  {kSubsystem.infos.map((info) => (
                     <option key={info.key} value={info.key}>
                        {info.title}
                     </option>
                  ))}
               </select>
            </div>
         </DebugContainer>

         <Tooltip title={`Number of rows in each pattern. Affects all patterns in the song.`}>
            <div className="field-row">

               <label htmlFor="song-rows-per-pattern">Pattern Len</label>
               <IntegerUpDown
                  min={1}
                  max={song.subsystem.maxRowsPerPattern}
                  value={song.rowsPerPattern}
                  onChange={onRowsPerPatternChange}
               />
            </div>
         </Tooltip>

         {tic80RuntimeCadence && runtimePatternTicks !== null && (
            <fieldset className="song-tic80-timing">
               <legend>
                  <Tooltip title="One TIC is one 60 Hz TIC-80 runtime tick (16.667 ms)">
                     <span className="song-tic80-timing__legend" tabIndex={0}>TIC-80 timing</span>
                  </Tooltip>
               </legend>
         <Tooltip title={`Song tempo (${bpm} BPM); ${mgr.getActionBindingLabelAlways("IncreaseTempo")} / ${mgr.getActionBindingLabelAlways("DecreaseTempo")} to adjust.`}>
            <div className="field-row">
               <label htmlFor="song-tempo">Tempo</label>
               <IntegerUpDown
                  min={song.subsystem.minSongTempo}
                  max={song.subsystem.maxSongTempo}
                  value={song.tempo}
                  onChange={onTempoChange}
               />
            </div>
         </Tooltip>
         <Tooltip title={`Song speed; combined with tempo, this determines TIC-80 row duration. ${mgr.getActionBindingLabelAlways("IncreaseSpeed")} / ${mgr.getActionBindingLabelAlways("DecreaseSpeed")} to adjust.`}>
            <div className="field-row">
               <label htmlFor="song-speed">Speed</label>
               <IntegerUpDown
                  min={song.subsystem.minSongSpeed}
                  max={song.subsystem.maxSongSpeed}
                  value={song.speed}
                  onChange={onSpeedChange}
               />
            </div>
         </Tooltip>

               <div>
                  {formatToDecimalPlaces(bpm, 2)} BPM;
                  Max row jitter: {formatTiming(
                     tic80EffectTicksToSeconds(tic80RuntimeCadence.worstRowErrorTicks),
                  )}; <span style={{fontSize: 'larger', fontWeight: 'bold'}}>{formatToDecimalPlaces(tic80EffectTicksToBeatPercent(
                     tic80RuntimeCadence.worstRowErrorTicks,
                     {tempo: song.tempo, speed: song.speed},
                     rowsPerBeat,
                  ), 2)}% of a beat</span>

               </div>
               <div>{formatRowTiming(1, song.tempo, song.speed)}</div>
               <div>{formatRowTiming(rowsPerBeat, song.tempo, song.speed)}</div>
               <div>{formatRowTiming(song.rowsPerPattern, song.tempo, song.speed)}</div>
               <div className="song-tic80-timing__cadence">
                  Runtime cadence (TICs/row): {tic80RuntimeCadence.ticksPerRow.join(', ')}
               </div>
               <div>
                  Period: {tic80RuntimeCadence.periodRows} rows
               </div>
               <div>
                  Actual pattern runtime ={' '}
                  {runtimePatternTicks} TICs ({formatTiming(
                     tic80EffectTicksToSeconds(runtimePatternTicks))})
               </div>
            </fieldset>
         )}

         <fieldset>
            <legend>Arrangement Pattern Thumbnails</legend>
            <ButtonGroup>
               {([
                  {value: "off", label: "Off"},
                  {value: "small", label: "Small"},
                  {value: "normal", label: "Normal"},
                  {value: "large", label: "Large"},
               ] as const).map((opt) => (
                  <CheckboxButton
                     key={opt.value}
                     checked={thumbnailSize === opt.value}
                     onChange={(checked) => {
                        if (checked) {
                           onSongChange({
                              description: "Set arrangement thumbnail size",
                              undoable: true,
                              mutator: (s) => {
                                 s.arrangementThumbnailSize = opt.value;
                              },
                           });
                        }
                     }}
                  >
                     {opt.label}
                  </CheckboxButton>
               ))}
            </ButtonGroup>
         </fieldset>

         <ExportConfigurationSettings song={song} onSongChange={onSongChange} />


         <AudioRenderSettingsFields
            settings={song.audioRenderSettings}
            onChange={(audioRenderSettings) => onSongChange({
               description: "Edit audio render settings",
               undoable: true,
               mutator: (s) => {
                  s.audioRenderSettings = audioRenderSettings;
               },
            })}
         />

      </div>
   );
};
