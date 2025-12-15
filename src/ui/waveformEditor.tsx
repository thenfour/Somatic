import { useState } from "react";
import { AudioController } from "../audio/controller";
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform } from "../models/waveform";

// keep tied in with Tic80Caps.

// refer to https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
// for a text description of the format.

// but tic.h / sound.c is the real source of truth; here is the relevant struct:
/*
#define WAVES_COUNT 16
#define WAVE_VALUES 32
#define WAVE_VALUE_BITS 4
#define WAVE_MAX_VALUE ((1 << WAVE_VALUE_BITS) - 1)
#define WAVE_SIZE (WAVE_VALUES * WAVE_VALUE_BITS / BITS_IN_BYTE)

...

typedef struct
{
    u8 data[WAVE_SIZE];
}tic_waveform;

typedef struct
{
    tic_waveform items[WAVES_COUNT];
} tic_waveforms;

*/

export const WaveformSwatch: React.FC<{
    value: Tic80Waveform;
    scale: number;
    isSelected?: boolean;
    onClick?: () => void;
}> = ({ value, scale, isSelected, onClick }) => {
    const pointCount = Tic80Caps.waveform.pointCount;
    const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
    const width = scale * pointCount;
    const height = scale * amplitudeRange;

    const maxAmp = amplitudeRange - 1;

    const circles: JSX.Element[] = [];
    for (let i = 0; i < pointCount; i += 1) {
        const amp = Math.max(0, Math.min(maxAmp, value.amplitudes[i] ?? 0));
        const x = (i + 0.5) * (width / pointCount);
        const y = height - ((amp + 0.5) * height) / amplitudeRange;
        circles.push(
            <circle
                key={i}
                cx={x}
                cy={y}
                r={Math.max(1, scale * 0.4)}
            />,
        );
    }

    const className = `waveform-swatch${isSelected ? " waveform-swatch--selected" : ""}`;

    return (
        <button type="button" className={className} onClick={onClick} style={{ width, height }}>
            <svg
                className="waveform-swatch__svg"
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                aria-hidden="true"
            >
                {circles}
            </svg>
        </button>
    );
};


export const WaveformSelect: React.FC<{
    selectedWaveformId: number;
    song: Song;
    onClickWaveform: (waveformId: number) => void;
}> = ({ selectedWaveformId, song, onClickWaveform }) => {
    const waveformCount = Math.min(song.waveforms.length, Tic80Caps.waveform.count);
    const scale = 2;

    return (
        <div className="waveform-select">
            {Array.from({ length: waveformCount }, (_, index) => {
                const waveform = song.waveforms[index];
                return (
                    <WaveformSwatch
                        key={index}
                        value={waveform}
                        scale={scale}
                        isSelected={index === selectedWaveformId}
                        onClick={() => onClickWaveform(index)}
                    />
                );
            })}
        </div>
    );
}


export const WaveformEditor: React.FC<{
    song: Song;
    editingWaveformId: number;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editingWaveformId, editorState, onSongChange }) => {

    return (
        <div className="waveform-editor">
            {/*
            waveform editor UI here
            - each waveform has Tic80Caps.waveform.pointCount amplitudes to edit
            - amplitude values 0..Tic80Caps.waveform.amplitudeRange-1
            - we should show this as a graphical grid; y-axis is amplitude, x-axis is point index
            - allow click+drag to draw amplitude values
            */}
        </div>);

};



export const WaveformEditorPanel: React.FC<{
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onSongChange }) => {

    const [editingWaveformId, setEditingWaveformId] = useState<number>(0);

    return (
        <div className="waveform-editor-panel">
            <h3>Waveform Editor</h3>
            <WaveformSelect
                onClickWaveform={setEditingWaveformId}
                selectedWaveformId={editingWaveformId}
                song={song}
            />

            <WaveformEditor
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                editingWaveformId={editingWaveformId}
            />
        </div>);

};

