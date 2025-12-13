import React from "react";
import { PositionList } from "./position_list";
import { OCTAVE_COUNT, PATTERN_COUNT } from "../defs";

export const SongEditor = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const onSpeedChange = (e) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setSpeed(val));
    };

    const onLengthChange = (e) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setLength(val));
    };

    const onOctaveChange = (e) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setOctave(val));
    };

    const onPatternChange = (e) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setPattern(val));
    };

    return (
        <div className="section">
            <PositionList
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                onEditorStateChange={onEditorStateChange}
                audio={audio}
            />
            <label>
                Speed
                <input type="number" min={1} max={31} value={song.speed} onChange={onSpeedChange} />
            </label>
            <label>
                Length
                <input type="number" min={1} max={256} value={song.length} onChange={onLengthChange} />
            </label>
            <label>
                Octave
                <input type="number" min={1} max={OCTAVE_COUNT} value={editorState.octave} onChange={onOctaveChange} />
            </label>
            <label>
                Pattern
                <input type="number" min={0} max={PATTERN_COUNT - 1} value={editorState.pattern} onChange={onPatternChange} />
            </label>
        </div>
    );
};
