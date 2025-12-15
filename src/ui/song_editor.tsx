import React from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { Tooltip } from './tooltip';
import { Tic80Caps } from '../models/tic80Capabilities';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const effectiveBpm = Math.round(((song.tempo * 6) / song.speed) * 10) / 10; // TIC BPM approximation

    const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setSpeed(val));
    };

    const onTempoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setTempo(val));
    };

    // const onLengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    //     const val = parseInt(e.target.value, 10);
    //     onSongChange((s) => s.setLength(val));
    // };

    const onOctaveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setOctave(val));
    };

    const onCurrentInstrumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setCurrentInstrument(val));
    };

    const onHighlightRowCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setHighlightRowCount(val));
    };

    const onPatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setPattern(val));
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
                <Tooltip
                    content={(
                        <>
                            Effective BPM ≈ tempo*6/speed. Higher tempo = faster; higher speed = slower rows.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </Tooltip>
                <input id="song-tempo" type="number" min={1} max={255} value={song.tempo} onChange={onTempoChange} />
            </div>
            <div className="field-row">
                <label htmlFor="song-speed">Speed</label>
                <Tooltip
                    label="Speed help"
                    content={(
                        <>
                            TIC tick divisor; rows advance slower as speed increases. Effective BPM ≈ tempo*6/speed.<br />
                            Current ≈ {effectiveBpm} BPM.
                        </>
                    )}
                >
                    <span aria-hidden="true">?</span>
                </Tooltip>
                <input id="song-speed" type="number" min={1} max={31} value={song.speed} onChange={onSpeedChange} />
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
                Octave
                <input type="number" min={1} max={Tic80Caps.pattern.octaveCount} value={editorState.octave} onChange={onOctaveChange} />
            </label>
            <label>
                Instrument
                <input
                    type="number"
                    min={1}
                    max={Tic80Caps.sfx.count}
                    value={editorState.currentInstrument}
                    onChange={onCurrentInstrumentChange}
                />
            </label>
            <label>
                Pattern
                <input type="number" min={0} max={Tic80Caps.pattern.count - 1} value={editorState.patternIndex} onChange={onPatternChange} />
            </label>
        </div>
    );
};
