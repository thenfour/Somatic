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
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const lastIndexRef = useRef<number | null>(null);
    const lastAmpRef = useRef<number | null>(null);

    const waveform = song.waveforms[editingWaveformId];

    const handleDrawAtPosition = (clientX: number, clientY: number) => {
        if (!waveform) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

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
        if (!isDrawing) return;
        handleDrawAtPosition(event.clientX, event.clientY);
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        lastIndexRef.current = null;
        lastAmpRef.current = null;
    };

    useEffect(() => {
        if (!isDrawing) return;

        const handleWindowMouseMove = (event: MouseEvent) => {
            handleDrawAtPosition(event.clientX, event.clientY);
        };

        const handleWindowMouseUp = () => {
            setIsDrawing(false);
            lastIndexRef.current = null;
            lastAmpRef.current = null;
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
        points.push(
            <rect
                key={i}
                x={x - scale * 0.4}
                y={y - scale * 0.4}
                width={scale * 0.8}
                height={scale * 0.8}
                className="waveform-editor__point"
            />,
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

