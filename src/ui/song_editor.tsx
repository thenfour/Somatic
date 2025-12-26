import React from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { GlobalActionId } from '../keyb/ActionIds';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { calculateBpm, SomaticCaps, Tic80Caps } from '../models/tic80Capabilities';
import { TryParseInt } from '../utils/utils';
import { Tooltip } from './basic/tooltip';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const patternId = song.songOrder[editorState.activeSongPosition]!;
    const pattern = song.patterns[patternId]!;
    const mgr = useShortcutManager();

    const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({ description: 'Set song speed', undoable: true, mutator: (s) => s.setSpeed(val) });
    };

    const onTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({ description: 'Set song tempo', undoable: true, mutator: (s) => s.setTempo(val) });
    };

    const onRowsPerPatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({ description: 'Set rows per pattern', undoable: true, mutator: (s) => s.setRowsPerPattern(val) });
    };

    const onOctaveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onEditorStateChange((state) => state.setOctave(val));
    };

    // const onCurrentInstrumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    //     const val = TryParseInt(e.target.value);
    //     if (val === null) return;
    //     onEditorStateChange((state) => state.setCurrentInstrument(val));
    // };

    const onHighlightRowCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({ description: 'Set highlight row count', undoable: true, mutator: (s) => s.setHighlightRowCount(val) });
    };

    const onEditStepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({ description: 'Set edit step', undoable: true, mutator: (s) => s.setPatternEditStep(val) });
    };

    const getActionBindingLabel = (actionId: GlobalActionId) => {
        return mgr.getActionBindingLabel(actionId) || "Unbound";
    };

    const bpm = calculateBpm({ songTempo: song.tempo, songSpeed: song.speed, rowsPerBeat: 4 });

    return (
        <div className="section">
            {/* <PositionList
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                onEditorStateChange={onEditorStateChange}
                audio={audio}
            /> */}
            <Tooltip title={`Song tempo (${bpm} BPM); ${getActionBindingLabel("IncreaseTempo")} / ${getActionBindingLabel("DecreaseTempo")} to adjust.`}>
                <div className="field-row">
                    <label htmlFor="song-tempo">Tempo</label>
                    <input id="song-tempo" type="number" min={1} max={255} value={song.tempo} onChange={onTempoChange} />
                </div>
            </Tooltip>
            <Tooltip title={`Song speed (${bpm} BPM) (ticks per row). ${getActionBindingLabel("IncreaseSpeed")} / ${getActionBindingLabel("DecreaseSpeed")} to adjust.`}>
                <div className="field-row">
                    <label htmlFor="song-speed">Speed</label>
                    <input id="song-speed" type="number" min={1} max={31} value={song.speed} onChange={onSpeedChange} />
                </div>
            </Tooltip>
            <Tooltip title={`Number of rows in each pattern. Affects all patterns in the song.`}>
                <div className="field-row">

                    <label htmlFor="song-rows-per-pattern">Pattern Len</label>
                    <input id="song-rows-per-pattern" type="number" min={1} max={Tic80Caps.pattern.maxRows} value={song.rowsPerPattern} onChange={onRowsPerPatternChange} />
                </div>
            </Tooltip>
            <label>
                Highlight rows
                <input
                    type="number"
                    min={1}
                    max={64}
                    value={song.highlightRowCount}
                    onChange={onHighlightRowCountChange}
                />
            </label>
            <Tooltip title={`Number of rows the cursor moves after note input. ${getActionBindingLabel("IncreaseEditStep")} / ${getActionBindingLabel("DecreaseEditStep")} to adjust.`}>
                <label>
                    Edit step
                    <input
                        type="number"
                        min={0}
                        max={32}
                        value={song.patternEditStep}
                        onChange={onEditStepChange}
                    />
                </label>
            </Tooltip>
            <Tooltip title={`Current octave for note input. ${getActionBindingLabel("IncreaseOctave")} / ${getActionBindingLabel("DecreaseOctave")} to adjust.`}>
                <label>
                    Octave
                    <input type="number" min={1} max={Tic80Caps.pattern.octaveCount/* -1 + 1 for 1-baseddisplay */} value={editorState.octave} onChange={onOctaveChange} />
                </label>
            </Tooltip>
            <Tooltip title={`Current instrument for note input.`}>
                <label>
                    <span>Instrument</span>
                    <select
                        value={editorState.currentInstrument}
                        onChange={(e) => onEditorStateChange((state) => state.setCurrentInstrument(parseInt(e.target.value, 10)))}
                    >
                        {Array.from({ length: Tic80Caps.sfx.count }, (_, i) => (
                            <option key={i} value={i}>
                                {song.instruments[i].getCaption(i)}
                            </option>
                        ))}
                    </select>
                </label>
            </Tooltip>
            <Tooltip title={`Decrease instrument (${getActionBindingLabel("DecreaseInstrument")}).`}>
                <button
                    style={{ display: "inline-block" }}
                    onClick={() => {
                        onEditorStateChange((state) => {
                            const newInstr = (state.currentInstrument - 1 + Tic80Caps.sfx.count) % Tic80Caps.sfx.count;
                            state.setCurrentInstrument(newInstr);
                        });
                    }}
                >{"<"}</button>
            </Tooltip>
            <Tooltip title={`Increase instrument (${getActionBindingLabel("IncreaseInstrument")}).`}>
                <button
                    style={{ display: "inline-block" }}
                    onClick={() => {
                        onEditorStateChange((state) => {
                            const newInstr = (state.currentInstrument + 1) % Tic80Caps.sfx.count;
                            state.setCurrentInstrument(newInstr);
                        });
                    }}
                >{">"}</button>
            </Tooltip>
            <label>
                Song title
                <input
                    type="text"
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
        </div>
    );
};
