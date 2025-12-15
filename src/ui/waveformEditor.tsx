import { useEffect, useRef, useState } from "react";
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

    const pointCount = Tic80Caps.waveform.pointCount;
    const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
    const maxAmp = amplitudeRange - 1;

    const [isDrawing, setIsDrawing] = useState(false);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [hoverAmp, setHoverAmp] = useState<number | null>(null);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const lastIndexRef = useRef<number | null>(null);
    const lastAmpRef = useRef<number | null>(null);

    const waveform = song.waveforms[editingWaveformId];

    const getPointFromClientPosition = (clientX: number, clientY: number) => {
        if (!waveform) return null;
        const canvas = canvasRef.current;
        if (!canvas) return null;

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        let x = clientX - rect.left;
        let y = clientY - rect.top;

        // Clamp to the canvas bounds so drawing just outside still works
        if (x < 0) x = 0;
        if (x > rect.width) x = rect.width;
        if (y < 0) y = 0;
        if (y > rect.height) y = rect.height;

        let index = Math.floor((x / rect.width) * pointCount);
        if (index < 0) index = 0;
        if (index >= pointCount) index = pointCount - 1;

        const yNorm = 1 - y / rect.height; // 0 at bottom, 1 at top
        let amp = Math.round(yNorm * maxAmp);
        if (amp < 0) amp = 0;
        if (amp > maxAmp) amp = maxAmp;

        return { index, amp };
    };

    const handleDrawAtPosition = (clientX: number, clientY: number) => {
        const point = getPointFromClientPosition(clientX, clientY);
        if (!point) return;

        const { index, amp } = point;

        setHoverIndex(index);
        setHoverAmp(amp);

        const prevIndex = lastIndexRef.current;
        const prevAmp = lastAmpRef.current;
        const nextIndex = index;
        const nextAmp = amp;

        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;
            const len = wf.amplitudes.length;

            const writePoint = (i: number, value: number) => {
                if (i < 0 || i >= len) return;
                wf.amplitudes[i] = value;
            };

            // Interpolate any skipped indices between the previous and current point
            if (prevIndex != null && prevAmp != null && prevIndex !== nextIndex) {
                const step = nextIndex > prevIndex ? 1 : -1;
                const dx = nextIndex - prevIndex;
                for (let i = prevIndex + step; i !== nextIndex; i += step) {
                    const t = (i - prevIndex) / dx;
                    const interpAmp = Math.round(prevAmp + t * (nextAmp - prevAmp));
                    writePoint(i, interpAmp);
                }
            }

            writePoint(nextIndex, nextAmp);
        });

        lastIndexRef.current = nextIndex;
        lastAmpRef.current = nextAmp;
    };

    const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        lastIndexRef.current = null;
        lastAmpRef.current = null;
        setIsDrawing(true);
        handleDrawAtPosition(event.clientX, event.clientY);
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const point = getPointFromClientPosition(event.clientX, event.clientY);
        if (point) {
            setHoverIndex(point.index);
            setHoverAmp(point.amp);
        } else {
            setHoverIndex(null);
            setHoverAmp(null);
        }

        if (!isDrawing) return;
        handleDrawAtPosition(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        lastIndexRef.current = null;
        lastAmpRef.current = null;
        setHoverIndex(null);
        setHoverAmp(null);
    };

    useEffect(() => {
        if (!isDrawing) return;

        const handleWindowMouseMove = (event: MouseEvent) => {
            const point = getPointFromClientPosition(event.clientX, event.clientY);
            if (point) {
                setHoverIndex(point.index);
                setHoverAmp(point.amp);
                handleDrawAtPosition(event.clientX, event.clientY);
            } else {
                setHoverIndex(null);
                setHoverAmp(null);
            }
        };

        const handleWindowMouseUp = () => {
            setIsDrawing(false);
            lastIndexRef.current = null;
            lastAmpRef.current = null;
            setHoverIndex(null);
            setHoverAmp(null);
        };

        window.addEventListener("mousemove", handleWindowMouseMove);
        window.addEventListener("mouseup", handleWindowMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleWindowMouseMove);
            window.removeEventListener("mouseup", handleWindowMouseUp);
        };
    }, [isDrawing]);

    if (!waveform) {
        return (
            <div className="waveform-editor">
                <p>No waveform selected.</p>
            </div>
        );
    }

    const scale = 16;
    const width = pointCount * scale;
    const height = amplitudeRange * scale;

    const gridLines: JSX.Element[] = [];
    for (let y = 0; y <= amplitudeRange; y += 1) {
        const yy = (y * height) / amplitudeRange;
        gridLines.push(
            <line
                key={`h-${y}`}
                x1={0}
                x2={width}
                y1={yy}
                y2={yy}
                className="waveform-editor__grid-line"
            />,
        );
    }
    for (let x = 0; x <= pointCount; x += 1) {
        const xx = (x * width) / pointCount;
        gridLines.push(
            <line
                key={`v-${x}`}
                x1={xx}
                x2={xx}
                y1={0}
                y2={height}
                className="waveform-editor__grid-line"
            />,
        );
    }

    const points: JSX.Element[] = [];
    for (let i = 0; i < pointCount; i += 1) {
        const amp = Math.max(0, Math.min(maxAmp, waveform.amplitudes[i] ?? 0));
        const x = (i + 0.5) * (width / pointCount);
        const y = height - ((amp + 0.5) * height) / amplitudeRange;
        const isHovered = hoverIndex === i;
        points.push(
            <rect
                key={i}
                x={x - scale * 0.4}
                y={y - scale * 0.4}
                width={scale * 0.8}
                height={scale * 0.8}
                className={isHovered ? "waveform-editor__point waveform-editor__point--hovered" : "waveform-editor__point"}
            />,
        );
    }

    let hoverPreview: JSX.Element | null = null;
    if (hoverIndex != null && hoverAmp != null) {
        const x = (hoverIndex + 0.5) * (width / pointCount);
        const y = height - ((hoverAmp + 0.5) * height) / amplitudeRange;
        hoverPreview = (
            <rect
                x={x - scale * 0.4}
                y={y - scale * 0.4}
                width={scale * 0.8}
                height={scale * 0.8}
                className="waveform-editor__point-preview"
            />
        );
    }

    return (
        <div className="waveform-editor">
            <div
                className="waveform-editor__canvas"
                style={{ width, height }}
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    setHoverIndex(null);
                    setHoverAmp(null);
                }}
            >
                <svg
                    className="waveform-editor__svg"
                    viewBox={`0 0 ${width} ${height}`}
                    width={width}
                    height={height}
                    aria-label="Waveform editor"
                >
                    <rect
                        x={0}
                        y={0}
                        width={width}
                        height={height}
                        className="waveform-editor__background"
                    />
                    {gridLines}
                    {points}
                    {hoverPreview}
                </svg>
            </div>
        </div>
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
    const [clipboard, setClipboard] = useState<Uint8Array | null>(null);

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

    const handleCopy = () => {
        const waveform = song.waveforms[editingWaveformId];
        if (!waveform) return;
        setClipboard(new Uint8Array(waveform.amplitudes));
    };

    const handlePaste = () => {
        if (!clipboard) return;
        onSongChange((s) => {
            const wf = s.waveforms[editingWaveformId];
            if (!wf) return;
            const len = Math.min(wf.amplitudes.length, clipboard.length);
            for (let i = 0; i < len; i += 1) {
                wf.amplitudes[i] = clipboard[i];
            }
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
                    <button type="button" onClick={handlePaste} disabled={!clipboard}>Paste</button>
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
                </div>
            </div>
        </div>);

};

