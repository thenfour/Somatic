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
    onClick?: () => void;
}> = ({ value, onClick }) => {
    return (
        <div className="waveform-swatch" onClick={onClick}>
            {/* 
            a waveform swatch rendering the waveform visually as a kind of thumbnail.
            width = scale * Tic80Caps.waveform.pointCount
            height = scale * Tic80Caps.waveform.amplitudeRange
            */}
        </div>
    );
}


export const WaveformSelect: React.FC<{
    selectedWaveformId: number;
    song: Song;
    onClickWaveform: (waveformId: number) => void;
}> = ({ selectedWaveformId, song, onClickWaveform }) => {
    return (
        <div className="waveform-select">
            {/* 
            display grid of waveform swatches (4x4), highlight selected.
            onClickWaveform when item clicked.
            */}
        </div>
    );
}


export const WaveformEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onSongChange }) => {

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

    return (
        <div className="waveform-editor-panel">
            <h3>Waveform Editor</h3>
            {/*
            waveform editor panel here
            - waveform select grid
            - graphical waveform editor
            */}
        </div>);

};

