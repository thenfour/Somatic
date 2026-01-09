import React from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { calculateBpm, SomaticCaps, Tic80Caps } from '../models/tic80Capabilities';
import { IntegerUpDown } from './basic/NumericUpDown';
import { Tooltip } from './basic/tooltip';
import { CheckboxButton } from './Buttons/CheckboxButton';
import type { ArrangementThumbnailSize } from '../models/song';
import { ButtonGroup } from './Buttons/ButtonGroup';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
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

    const bpm = calculateBpm({ songTempo: song.tempo, songSpeed: song.speed, rowsPerBeat: 4 });

    const thumbnailSize: ArrangementThumbnailSize = song.arrangementThumbnailSize ?? "normal";

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
            <Tooltip title={`Song tempo (${bpm} BPM); ${mgr.getActionBindingLabelAlways("IncreaseTempo")} / ${mgr.getActionBindingLabelAlways("DecreaseTempo")} to adjust.`}>
                <div className="field-row">
                    <label htmlFor="song-tempo">Tempo</label>
                    <IntegerUpDown
                        min={Tic80Caps.song.minTempo}
                        max={Tic80Caps.song.maxTempo}
                        value={song.tempo}
                        onChange={onTempoChange}
                    />
                </div>
            </Tooltip>
            <Tooltip title={`Song speed (${bpm} BPM) (ticks per row). ${mgr.getActionBindingLabelAlways("IncreaseSpeed")} / ${mgr.getActionBindingLabelAlways("DecreaseSpeed")} to adjust.`}>
                <div className="field-row">
                    <label htmlFor="song-speed">Speed</label>
                    <IntegerUpDown
                        min={Tic80Caps.song.songSpeedMin}
                        max={Tic80Caps.song.songSpeedMax}
                        value={song.speed}
                        onChange={onSpeedChange}
                    />
                </div>
            </Tooltip>
            <Tooltip title={`Number of rows in each pattern. Affects all patterns in the song.`}>
                <div className="field-row">

                    <label htmlFor="song-rows-per-pattern">Pattern Len</label>
                    <IntegerUpDown
                        min={Tic80Caps.pattern.minRows}
                        max={Tic80Caps.pattern.maxRows}
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
                            highlighted={thumbnailSize === opt.value}
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
                    //checked={!!song.customEntrypointLua}
                    highlighted={song.useCustomEntrypointLua}
                    onChange={(checked) => {
                        onSongChange({
                            description: checked ? 'Enable custom playroutine' : 'Disable custom playroutine',
                            undoable: true,
                            mutator: (s) => {
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
