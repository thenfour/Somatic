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
    onClick?: () => void;
}> = ({ value, onClick }) => {
    //Tic80Caps.waveform.pointCount;
    return (
        <div className="waveform-swatch" onClick={onClick}>
            {/* 
            a selectable waveform swatch rendering the waveform visually.
            fixed size is fine, 
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
            display grid of waveforms (4x4), highlight selected.
            onClickWaveform when item clicked.
            */}
        </div>
    );
}

export const WaveformEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onEditorStateChange, onSongChange }) => {

    return (
        <div className="waveform-editor-panel">
            <h3>Waveform Editor</h3>
            {/*
            waveform editor UI here
            - waveform select grid
            - graphical waveform editor
            */}
        </div>);

};

