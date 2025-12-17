import React, { useEffect } from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { HelpTooltip } from './HelpTooltip';
import { Tic80Caps } from '../models/tic80Capabilities';
import { TryParseInt } from '../utils/utils';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const effectiveBpm = Math.round(((song.tempo * 6) / song.speed) * 10) / 10; // TIC BPM approximation
    const patternId = song.songOrder[editorState.activeSongPosition]!;
    const pattern = song.patterns[patternId]!;

    const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setSpeed(val));
    };

    const onTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setTempo(val));
    };

    const onRowsPerPatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => s.setRowsPerPattern(val));
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
        onSongChange((s) => s.setHighlightRowCount(val));
    };

    const onEditStepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onEditorStateChange((state) => state.setPatternEditStep(val));
    };

    return (
        <div className="section">
            {/* <PositionList
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                onEditorStateChange={onEditorStateChange}
                audio={audio}
            /> */}
            <div className="field-row">
                <label htmlFor="song-tempo">Tempo</label>
                <HelpTooltip
                    content={(
                        <>
                            Effective BPM ≈ tempo*6/speed. Higher tempo = faster; higher speed = slower rows.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </HelpTooltip>
                <input id="song-tempo" type="number" min={1} max={255} value={song.tempo} onChange={onTempoChange} />
            </div>
            <div className="field-row">
                <label htmlFor="song-speed">Speed</label>
                <HelpTooltip
                    label="Speed help"
                    content={(
                        <>
                            TIC tick divisor; rows advance slower as speed increases. Effective BPM ≈ tempo*6/speed.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </HelpTooltip>
                <input id="song-speed" type="number" min={1} max={31} value={song.speed} onChange={onSpeedChange} />
            </div>
            <div className="field-row">
                <label htmlFor="song-rows-per-pattern">Pattern Len</label>
                <HelpTooltip
                    content={(
                        <>
                            Rows per pattern. Affects all patterns in the song.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </HelpTooltip>
                <input id="song-rows-per-pattern" type="number" min={1} max={Tic80Caps.pattern.maxRows} value={song.rowsPerPattern} onChange={onRowsPerPatternChange} />
            </div>
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
            <label>
                Edit step
                <input
                    type="number"
                    min={0}
                    max={32}
                    value={editorState.patternEditStep}
                    onChange={onEditStepChange}
                />
            </label>
            <label>
                Octave
                <input type="number" min={1} max={Tic80Caps.pattern.octaveCount/* -1 + 1 for 1-baseddisplay */} value={editorState.octave} onChange={onOctaveChange} />
            </label>
            <label>
                Instrument
                <select
                    value={editorState.currentInstrument}
                    onChange={(e) => onEditorStateChange((state) => state.setCurrentInstrument(parseInt(e.target.value, 10)))}
                >
                    {Array.from({ length: Tic80Caps.sfx.count }, (_, i) => (
                        <option key={i} value={i}>
                            {song.instruments[i].name}
                        </option>
                    ))}
                </select>
                {/* <input
                    type="number"
                    min={1}
                    max={Tic80Caps.sfx.count}
                    value={editorState.currentInstrument}
                    onChange={onCurrentInstrumentChange}
                /> */}
            </label>

        </div>
    );
};
