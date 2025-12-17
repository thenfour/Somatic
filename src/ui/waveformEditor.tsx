import { useState } from "react";
import { useClipboard } from '../hooks/useClipboard';
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform, Tic80WaveformDto } from "../models/waveform";
import { WaveformCanvas } from "./waveform_canvas";

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
    const scale = 3;

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
    const waveform = song.waveforms[editingWaveformId];
    if (!waveform) {
        //console.log(`No waveform found at index ${editingWaveformId}`, song.waveforms);
        return (
            <div className="waveform-editor">
                <p>No waveform selected.</p>
            </div>
        );
    }

    const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
    const maxAmp = amplitudeRange - 1;

    const handleCanvasChange = (nextValues: number[]) => {
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;
            const len = Math.min(wf.amplitudes.length, nextValues.length);
            for (let i = 0; i < len; i += 1) {
                const v = Math.max(0, Math.min(maxAmp, nextValues[i] ?? 0));
                wf.amplitudes[i] = v;
            }
        });
    };

    return (
        <WaveformCanvas
            values={Array.from(waveform.amplitudes)}
            maxValue={maxAmp}
            scale={16}
            classNamePrefix="waveform-editor"
            onChange={handleCanvasChange}
        />
    );

};



export const WaveformEditorPanel: React.FC<{
    song: Song;
    editorState: EditorState;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onSongChange }) => {

    const [editingWaveformId, setEditingWaveformId] = useState<number>(0);
    const [mixPercent, setMixPercent] = useState<number>(100);
    const [harmonic, setHarmonic] = useState<number>(1);
    const clipboard = useClipboard();

    const applyGeneratedWaveform = (generator: (index: number, pointCount: number, maxAmp: number) => number) => {
        const waveform = song.waveforms[editingWaveformId];
        if (!waveform) return;

        const pointCount = Tic80Caps.waveform.pointCount;
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        const mix = Math.max(0, Math.min(100, mixPercent)) / 100;

        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;
            const len = Math.min(wf.amplitudes.length, pointCount);
            for (let i = 0; i < len; i += 1) {
                const current = Math.max(0, Math.min(maxAmp, wf.amplitudes[i] ?? 0));
                const generated = Math.max(0, Math.min(maxAmp, generator(i, pointCount, maxAmp)));
                const blended = Math.round(current * (1 - mix) + generated * mix);
                wf.amplitudes[i] = blended;
            }
        });
    };

    const makePhase = (index: number, pointCount: number) => {
        return (harmonic * index) / pointCount;
    };

    const handlePulse = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            // simple 50% duty pulse
            const frac = phase - Math.floor(phase);
            return frac < 0.5 ? maxAmp : 0;
        });
    };

    const handleSaw = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            const frac = phase - Math.floor(phase);
            return Math.round(frac * maxAmp);
        });
    };

    const handleTriangle = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            const frac = phase - Math.floor(phase);
            const tri = frac < 0.5 ? frac * 2 : (1 - frac) * 2;
            return Math.round(tri * maxAmp);
        });
    };

    const handleSine = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount); // 0..harmonic
            const angle = 2 * Math.PI * phase;
            const s = (Math.sin(angle) + 1) / 2; // 0..1
            return Math.round(s * maxAmp);
        });
    };

    const handleNoise = () => {
        applyGeneratedWaveform((_i, _pointCount, maxAmp) => {
            return Math.floor(Math.random() * (maxAmp + 1));
        });
    };

    const handleShift = (direction: 1 | -1) => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;
            for (let i = 0; i < wf.amplitudes.length; i += 1) {
                const current = Math.max(0, Math.min(maxAmp, wf.amplitudes[i] ?? 0));
                let next = current + direction;
                if (next < 0) next = maxAmp;
                if (next > maxAmp) next = 0;
                wf.amplitudes[i] = next;
            }
        });
    };

    const handleNormalize = () => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;

            // Find the min and max values in the waveform
            let min = maxAmp;
            let max = 0;
            for (let i = 0; i < wf.amplitudes.length; i += 1) {
                const val = wf.amplitudes[i];
                if (val < min) min = val;
                if (val > max) max = val;
            }

            // If the waveform is flat, nothing to normalize
            if (min === max) return;

            // Scale to use the full range
            const range = max - min;
            for (let i = 0; i < wf.amplitudes.length; i += 1) {
                const val = wf.amplitudes[i];
                wf.amplitudes[i] = Math.round(((val - min) / range) * maxAmp);
            }
        });
    };

    const handleLowpass = () => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;

            // Simple 3-point moving average lowpass filter
            const original = new Uint8Array(wf.amplitudes);
            const len = original.length;

            for (let i = 0; i < len; i += 1) {
                const prev = original[(i - 1 + len) % len];
                const curr = original[i];
                const next = original[(i + 1) % len];
                // Weighted average: 25% prev + 50% current + 25% next
                const filtered = (prev * 0.25 + curr * 0.5 + next * 0.25);
                wf.amplitudes[i] = Math.round(Math.max(0, Math.min(maxAmp, filtered)));
            }
        });
    };

    const handleLowpass1Pole = () => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;

            // 1-pole IIR lowpass filter: y[n] = y[n-1] + α * (x[n] - y[n-1])
            // α = 0.3 gives a moderate smoothing effect
            const alpha = 0.5;
            const original = new Uint8Array(wf.amplitudes);
            const len = original.length;

            // Initialize with the first sample
            let y = original[0];

            for (let i = 0; i < len; i += 1) {
                const x = original[i];
                y = y + alpha * (x - y);
                wf.amplitudes[i] = Math.round(Math.max(0, Math.min(maxAmp, y)));
            }
        });
    };

    const handleCopy = async () => {
        const waveform = song.waveforms[editingWaveformId];
        await clipboard.copyObjectToClipboard(waveform.toData());
    };

    const handlePaste = async () => {
        const data = await clipboard.readObjectFromClipboard<Tic80WaveformDto>();
        if (!data) return;
        onSongChange((s) => {
            s.waveforms[editingWaveformId] = Tic80Waveform.fromData(data);
        });
    };

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
            <div className="waveform-editor-controls">
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Clipboard</span>
                    <button type="button" onClick={handleCopy}>Copy</button>
                    <button type="button" onClick={handlePaste}>Paste</button>
                </div>
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Mix</span>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={mixPercent}
                        onChange={(e) => setMixPercent(Number(e.target.value))}
                    />
                    <span className="waveform-editor-controls__value">{mixPercent}%</span>
                </div>
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Harmonic</span>
                    {[1, 2, 3, 4, 5].map((h) => (
                        <button
                            key={h}
                            type="button"
                            className={h === harmonic ? "waveform-editor-controls__button waveform-editor-controls__button--active" : "waveform-editor-controls__button"}
                            onClick={() => setHarmonic(h)}
                        >
                            {h}
                        </button>
                    ))}
                </div>
                <div className="waveform-editor-controls__row">
                    <button type="button" onClick={handlePulse}>Pulse</button>
                    <button type="button" onClick={handleSaw}>Saw</button>
                    <button type="button" onClick={handleTriangle}>Tri</button>
                    <button type="button" onClick={handleSine}>Sine</button>
                    <button type="button" onClick={handleNoise}>Noise</button>
                </div>
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Shift</span>
                    <button type="button" onClick={() => handleShift(1)}>Up</button>
                    <button type="button" onClick={() => handleShift(-1)}>Down</button>
                    <button type="button" onClick={handleNormalize}>Normalize</button>
                    <button type="button" onClick={handleLowpass}>Lowpass</button>
                    <button type="button" onClick={handleLowpass1Pole}>LP 1-pole</button>
                </div>
            </div>
        </div>);

};

