import React, { useEffect, useMemo, useRef, useState } from "react";
import "/src/waveform.css";

export type WaveformHighlightWindow = {
    beginFrame: number;
    frameLength: number;
};

export const WaveformVisualizer: React.FC<{
    samples: Float32Array;
    className?: string;
    height?: number;
    highlights?: WaveformHighlightWindow[];
    secondaryHighlights?: WaveformHighlightWindow[];
    // Optional start/end markers (dotted) in frame indices.
    dottedMarkers?: number[];
}> = ({ samples, className, height = 120, highlights = [], secondaryHighlights = [], dottedMarkers = [] }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const [layoutTick, setLayoutTick] = useState(0);

    const frameCount = samples.length;

    const highlightsClamped = useMemo(() => {
        const safe: WaveformHighlightWindow[] = [];
        for (const h of highlights) {
            if (!h) continue;
            const begin = Math.max(0, Math.min(frameCount, Math.trunc(h.beginFrame)));
            const len = Math.max(0, Math.trunc(h.frameLength));
            safe.push({ beginFrame: begin, frameLength: len });
        }
        return safe;
    }, [highlights, frameCount]);

    const secondaryHighlightsClamped = useMemo(() => {
        const safe: WaveformHighlightWindow[] = [];
        for (const h of secondaryHighlights) {
            if (!h) continue;
            const begin = Math.max(0, Math.min(frameCount, Math.trunc(h.beginFrame)));
            const len = Math.max(0, Math.trunc(h.frameLength));
            safe.push({ beginFrame: begin, frameLength: len });
        }
        return safe;
    }, [secondaryHighlights, frameCount]);

    const dottedMarkersClamped = useMemo(() => {
        return dottedMarkers
            .filter((m) => Number.isFinite(m))
            .map((m) => Math.max(0, Math.min(frameCount, Math.trunc(m))))
            .sort((a, b) => a - b);
    }, [dottedMarkers, frameCount]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth;
        const cssHeight = height;

        // If not mounted/layouted yet.
        if (cssWidth <= 0 || cssHeight <= 0) return;

        canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
        canvas.height = Math.max(1, Math.floor(cssHeight * dpr));

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const style = getComputedStyle(canvas);
        const bg = style.getPropertyValue("--waveform-edit-background");
        const fg = style.getPropertyValue("--waveform-edit-point");
        const highlight = style.getPropertyValue("--waveform-edit-highlight");
        const grid = style.getPropertyValue("--waveform-edit-grid-line");
        const loopLine = style.getPropertyValue("--waveform-edit-loop-line");

        const w = cssWidth;
        const h = cssHeight;

        ctx.clearRect(0, 0, w, h);

        // background
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        // grid midline
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();

        // highlight windows
        if (highlightsClamped.length > 0 && frameCount > 0) {
            ctx.fillStyle = highlight;
            ctx.globalAlpha = 0.4;
            for (const hw of highlightsClamped) {
                const x0 = (hw.beginFrame / frameCount) * w;
                const x1 = ((hw.beginFrame + hw.frameLength) / frameCount) * w;
                ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
            }
            ctx.globalAlpha = 1;
        }

        // secondary highlight windows (preview)
        if (secondaryHighlightsClamped.length > 0 && frameCount > 0) {
            // Use a lighter fill + dashed outline so it reads as a preview layer.
            ctx.fillStyle = loopLine;
            ctx.globalAlpha = 0.15;
            for (const hw of secondaryHighlightsClamped) {
                const x0 = (hw.beginFrame / frameCount) * w;
                const x1 = ((hw.beginFrame + hw.frameLength) / frameCount) * w;
                ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
            }
            ctx.globalAlpha = 1;

            ctx.strokeStyle = loopLine;
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            for (const hw of secondaryHighlightsClamped) {
                const x0 = (hw.beginFrame / frameCount) * w;
                const x1 = ((hw.beginFrame + hw.frameLength) / frameCount) * w;
                ctx.strokeRect(x0, 1, Math.max(1, x1 - x0), h - 2);
            }
            ctx.setLineDash([]);
        }

        // dotted markers (e.g. auto-window source range)
        if (dottedMarkersClamped.length > 0 && frameCount > 0) {
            ctx.strokeStyle = loopLine;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            for (const m of dottedMarkersClamped) {
                const x = (m / frameCount) * w;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }

        // waveform (min/max per pixel column)
        if (frameCount > 0) {
            ctx.strokeStyle = fg;
            ctx.lineWidth = 2;

            const columns = Math.max(1, Math.floor(w));
            const framesPerCol = frameCount / columns;

            const sampleToY = (s: number) => {
                // samples are expected in -1..+1. Clamp lightly to avoid weird files.
                const clamped = Math.max(-1, Math.min(1, Number.isFinite(s) ? s : 0));
                return (1 - (clamped + 1) / 2) * h;
            };

            // Sparse rendering: there are too few samples per pixel column.
            // here the min/max-per-pixel approach produces glitches
            // so instead we draw a polyline stepping by sample.
            const useSparsePath = framesPerCol <= 4;

            if (useSparsePath) {
                ctx.beginPath();
                if (frameCount === 1) {
                    const x = 0.5;
                    const y = sampleToY(samples[0] ?? 0);
                    ctx.moveTo(x, y);
                    ctx.lineTo(w - 0.5, y);
                } else {
                    for (let i = 0; i < frameCount; i++) {
                        const x = (i / (frameCount - 1)) * (w - 1) + 0.5;
                        const y = sampleToY(samples[i] ?? 0);
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                }
                ctx.stroke();
                return;
            }

            ctx.beginPath();
            for (let x = 0; x < columns; x++) {
                const i0 = Math.floor(x * framesPerCol);
                const i1 = Math.min(frameCount, Math.floor((x + 1) * framesPerCol));

                if (i0 >= frameCount) break;
                if (i1 <= i0) continue;

                let min = 1;
                let max = -1;
                for (let i = i0; i < i1; i++) {
                    const v = samples[i] ?? 0;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }

                const y0 = sampleToY(max);
                const y1 = sampleToY(min);

                ctx.moveTo(x + 0.5, y0);
                ctx.lineTo(x + 0.5, y1);
            }
            ctx.stroke();
        }
    }, [samples, frameCount, height, highlightsClamped, secondaryHighlightsClamped, dottedMarkersClamped, layoutTick]);

    // Redraw on resize (cheap: just re-run effect)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ro = new ResizeObserver(() => {
            setLayoutTick((t) => t + 1);
        });
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className={`waveform-visualizer__canvas ${className ?? ""}`}
            style={{ width: "100%", height }}
        />
    );
};
