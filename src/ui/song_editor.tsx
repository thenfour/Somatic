import React from 'react';
import { Tic80AudioController } from '../audio/controller';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { EditorState } from '../models/editor_state';
import type { ArrangementThumbnailSize } from '../models/song';
import { Song } from '../models/song';
import { SomaticCaps } from '../models/tic80Capabilities';
import { kSubsystem, SubsystemTypeKey } from '../subsystem/base/SubsystemBackendBase';
import { clamp } from '../utils/utils';
import { IntegerUpDown } from './basic/NumericUpDown';
import { Tooltip } from './basic/tooltip';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { CheckboxButton } from './Buttons/CheckboxButton';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: Tic80AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const patternId = song.songOrder[editorState.activeSongPosition].patternIndex ?? 0;
    //const pattern = song.patterns[patternId]!;
    const mgr = useShortcutManager();

    const onSpeedChange = (val: number) => {
        onSongChange({ description: 'Set song speed', undoable: true, mutator: (s) => s.setSpeed(val) });
    };

    const onTempoChange = (val: number) => {
        onSongChange({ description: 'Set song tempo', undoable: true, mutator: (s) => s.setTempo(val) });
    };

    const onRowsPerPatternChange = (val: number) => {
        onSongChange({ description: 'Set rows per pattern', undoable: true, mutator: (s) => s.setRowsPerPattern(val) });
    };

    const bpm = song.subsystem.calculateBpm({ songTempo: song.tempo, songSpeed: song.speed, rowsPerBeat: 4 });

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
            st.setPatternEditTarget({ rowIndex: safeRow, channelIndex: safeChannel, song });

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
                            s.name = e.target.value;
                        },
                    })}
                />
            </label>

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
            <Tooltip title={`Song speed (${bpm} BPM) (ticks per row). ${mgr.getActionBindingLabelAlways("IncreaseSpeed")} / ${mgr.getActionBindingLabelAlways("DecreaseSpeed")} to adjust.`}>
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

            <fieldset>
                <legend>Arrangement Pattern Thumbnails</legend>
                <ButtonGroup>
                    {([
                        { value: "off", label: "Off" },
                        { value: "small", label: "Small" },
                        { value: "normal", label: "Normal" },
                        { value: "large", label: "Large" },
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

            <fieldset>
                <legend>Custom Playroutine Entrypoint</legend>
                <p>
                    Define a custom Lua snippet which includes the TIC() function when exporting the song.
                </p>
                <CheckboxButton
                    checked={song.useCustomEntrypointLua}
                    //highlighted={!!song.useCustomEntrypointLua}
                    onChange={(checked) => {
                        onSongChange({
                            description: checked ? 'Enable custom playroutine' : 'Disable custom playroutine',
                            undoable: true,
                            mutator: (s) => {
                                console.log(`Setting useCustomEntrypointLua to ${checked}`);
                                s.useCustomEntrypointLua = checked;
                            },
                        });
                    }}
                >
                    Use custom entrypoint?
                </CheckboxButton>
                <label>
                    <textarea
                        className='debug-panel-textarea'
                        disabled={!song.useCustomEntrypointLua}
                        value={song.customEntrypointLua || ""}
                        onChange={(e) => onSongChange({
                            description: 'Set custom playroutine entrypoint',
                            undoable: true,
                            mutator: (s) => {
                                s.customEntrypointLua = e.target.value;
                            },
                        })}
                    />
                </label>
            </fieldset>
        </div>
    );
};
