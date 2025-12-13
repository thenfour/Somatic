import React from 'react';
import { AudioController } from '../audio/controller';
import { OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
import { PositionList } from './position_list';

type SongEditorProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const SongEditor: React.FC<SongEditorProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const onSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setSpeed(val));
    };

    const onLengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onSongChange((s) => s.setLength(val));
    };

    const onOctaveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value, 10);
        onEditorStateChange((state) => state.setOctave(val));
    };

    const onPatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
