import React, { useEffect, useRef, useState } from "react";
import { clamp } from "../utils/utils";

export type WaveformCanvasProps = {
    values: ReadonlyArray<number>;
    /** Inclusive max value for a sample, e.g. 15 for 0-15. */
    maxValue: number;
    /** Pixel scale factor; controls overall size (number or {x,y}). */
    scale?: number | { x: number; y: number };
    /** Optional CSS class name prefix; defaults to "waveform-editor". */
    classNamePrefix?: string;
    /** Called with a new values array whenever drawing mutates the waveform. */
    onChange: (nextValues: number[]) => void;
};

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
    values,
    maxValue,
    scale,
    classNamePrefix = "waveform-editor",
    onChange,
}) => {
    const pointCount = values.length;
    const amplitudeRange = maxValue + 1;

    const [isDrawing, setIsDrawing] = useState(false);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [hoverValue, setHoverValue] = useState<number | null>(null);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const svgRef = useRef<SVGSVGElement | null>(null);
    const lastIndexRef = useRef<number | null>(null);
    const lastValueRef = useRef<number | null>(null);
    const anchorIndexRef = useRef<number | null>(null);
    const anchorValueRef = useRef<number | null>(null);
    const bufferRef = useRef<number[]>(values.map((v) => (Number.isFinite(v) ? v : 0)));

    const scaleX = typeof scale === "number" || scale == null ? (scale ?? 16) : scale.x;
    const scaleY = typeof scale === "number" || scale == null ? (scale ?? 16) : scale.y;

    if (pointCount === 0 || amplitudeRange <= 0) {
        return (
            <div className={classNamePrefix}>
                <p>No waveform data.</p>
            </div>
        );
    }

    const clampValue = (v: number) => {
        return clamp(v, 0, maxValue);
    };

    // Keep an internal mutable buffer in sync with props whenever we're not actively drawing.
    useEffect(() => {
        if (isDrawing) return;
        bufferRef.current = values.map((v) => clampValue(v));
    }, [values, maxValue, isDrawing]);

    const getPointFromClientPosition = (clientX: number, clientY: number) => {
        const element = svgRef.current ?? canvasRef.current;
        if (!element) return null;

        const rect = element.getBoundingClientRect();
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
        // Map Y into discrete value rows aligned with SVG grid cells.
        const relYFromBottom = rect.height - y; // 0 at bottom, rect.height at top
        const cellHeight = rect.height / amplitudeRange;
        let value = Math.floor(relYFromBottom / cellHeight);
        value = clampValue(value);

        return { index, value };
    };

    const handleDrawAtPosition = (clientX: number, clientY: number, shiftKey: boolean = false) => {
        const point = getPointFromClientPosition(clientX, clientY);
        if (!point) return;

        const { index, value } = point;

        setHoverIndex(index);
        setHoverValue(value);

        const nextValues = bufferRef.current.slice();
        const len = nextValues.length;

        const writePoint = (i: number, v: number) => {
            if (i < 0 || i >= len) return;
            nextValues[i] = clampValue(v);
        };

        // Shift-drag: draw a straight line from the anchor (mouse-down point) to current.
        if (shiftKey && anchorIndexRef.current != null && anchorValueRef.current != null) {
            const startIdx = anchorIndexRef.current;
            const endIdx = index;
            const startVal = anchorValueRef.current;
            const endVal = value;
            if (startIdx === endIdx) {
                writePoint(endIdx, endVal);
            } else {
                const dx = endIdx - startIdx;
                const step = dx > 0 ? 1 : -1;
                for (let i = startIdx; i !== endIdx + step; i += step) {
                    const t = (i - startIdx) / dx;
                    const interpValue = Math.round(startVal + t * (endVal - startVal));
                    writePoint(i, interpValue);
                }
            }
        } else {
            const prevIndex = lastIndexRef.current;
            const prevValue = lastValueRef.current;
            const nextIndex = index;
            const nextValue = value;

            // Interpolate any skipped indices between the previous and current point
            if (prevIndex != null && prevValue != null && prevIndex !== nextIndex) {
                const step = nextIndex > prevIndex ? 1 : -1;
                const dx = nextIndex - prevIndex;
                for (let i = prevIndex + step; i !== nextIndex; i += step) {
                    const t = (i - prevIndex) / dx;
                    const interpValue = Math.round(prevValue + t * (nextValue - prevValue));
                    writePoint(i, interpValue);
                }
            }

            writePoint(nextIndex, nextValue);

            lastIndexRef.current = nextIndex;
            lastValueRef.current = nextValue;
        }

        bufferRef.current = nextValues;
        onChange(nextValues);
    };

    const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        lastIndexRef.current = null;
        lastValueRef.current = null;
        const startPoint = getPointFromClientPosition(event.clientX, event.clientY);
        if (startPoint) {
            anchorIndexRef.current = startPoint.index;
            anchorValueRef.current = startPoint.value;
        }
        setIsDrawing(true);
        handleDrawAtPosition(event.clientX, event.clientY, event.shiftKey);
    };

    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        const point = getPointFromClientPosition(event.clientX, event.clientY);
        if (point) {
            setHoverIndex(point.index);
            setHoverValue(point.value);
        } else {
            setHoverIndex(null);
            setHoverValue(null);
        }

        if (!isDrawing) return;
        handleDrawAtPosition(event.clientX, event.clientY, event.shiftKey);
    };

    const handleMouseUp = () => {
        setIsDrawing(false);
        lastIndexRef.current = null;
        lastValueRef.current = null;
        setHoverIndex(null);
        setHoverValue(null);
    };

    useEffect(() => {
        if (!isDrawing) return;

        const handleWindowMouseMove = (event: MouseEvent) => {
            const point = getPointFromClientPosition(event.clientX, event.clientY);
            if (point) {
                setHoverIndex(point.index);
                setHoverValue(point.value);
                handleDrawAtPosition(event.clientX, event.clientY, event.shiftKey);
            } else {
                setHoverIndex(null);
                setHoverValue(null);
            }
        };

        const handleWindowMouseUp = () => {
            setIsDrawing(false);
            lastIndexRef.current = null;
            lastValueRef.current = null;
            anchorIndexRef.current = null;
            anchorValueRef.current = null;
            setHoverIndex(null);
            setHoverValue(null);
        };

        window.addEventListener("mousemove", handleWindowMouseMove);
        window.addEventListener("mouseup", handleWindowMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleWindowMouseMove);
            window.removeEventListener("mouseup", handleWindowMouseUp);
        };
    }, [isDrawing]);

    const width = pointCount * scaleX;
    const height = amplitudeRange * scaleY;

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
                className={`${classNamePrefix}__grid-line`}
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
                className={`${classNamePrefix}__grid-line`}
            />,
        );
    }

    const points: JSX.Element[] = [];
    for (let i = 0; i < pointCount; i += 1) {
        const value = clampValue(values[i] ?? 0);
        const x = (i + 0.5) * (width / pointCount);
        const y = height - ((value + 0.5) * height) / amplitudeRange;
        const isHovered = hoverIndex === i;
        points.push(
            <rect
                key={i}
                x={x - scaleX * 0.4}
                y={y - scaleY * 0.4}
                width={scaleX * 0.8}
                height={scaleY * 0.8}
                className={isHovered
                    ? `${classNamePrefix}__point ${classNamePrefix}__point--hovered`
                    : `${classNamePrefix}__point`}
            />,
        );
    }

    let hoverPreview: JSX.Element | null = null;
    if (hoverIndex != null && hoverValue != null) {
        const x = (hoverIndex + 0.5) * (width / pointCount);
        const y = height - ((hoverValue + 0.5) * height) / amplitudeRange;
        hoverPreview = (
            <rect
                x={x - scaleX * 0.4}
                y={y - scaleY * 0.4}
                width={scaleX * 0.8}
                height={scaleY * 0.8}
                className={`${classNamePrefix}__point-preview`}
            />
        );
    }

    return (
        <div className={classNamePrefix}>
            <div
                className={`${classNamePrefix}__canvas`}
                style={{ width, height }}
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => {
                    setHoverIndex(null);
                    setHoverValue(null);
                }}
            >
                <svg
                    className={`${classNamePrefix}__svg`}
                    ref={svgRef}
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
                        className={`${classNamePrefix}__background`}
                    />
                    {gridLines}
                    {points}
                    {hoverPreview}
                </svg>
            </div>
        </div>
    );
};
