import React, { useMemo } from "react";
import { ContinuousKnob, ContinuousParamConfig } from "./basic/oldknob";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { WaveformSwatch } from "./waveformSwatch";
import { MorphSampleImportWindowDto, WaveformMorphGradientNode } from "../models/instruments";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform } from "../models/waveform";
import { clamp } from "../utils/utils";
import { framesToWindowDto, windowDtoToFrames } from "../audio/morph_sample_import";

function isZeroCrossing(a: number, b: number): boolean {
    // Treat a zero-crossing as a sign change, or a transition to/from exact zero.
    // Avoid treating (0,0) as a crossing so we don't "stick" inside silent/flat regions.
    if (a === 0 && b === 0) return false;
    return (a < 0 && b > 0) || (a > 0 && b < 0) || (a === 0 && b !== 0) || (b === 0 && a !== 0);
}

function findZeroCrossingIndex(args: {
    samples: Float32Array;
    startIndex: number;
    direction: -1 | 1;
    minIndex: number;
    maxIndex: number;
}): number | null {
    const { samples, startIndex, direction } = args;
    const minIndex = clamp(Math.trunc(args.minIndex), 0, Math.max(0, samples.length - 1));
    const maxIndex = clamp(Math.trunc(args.maxIndex), 0, Math.max(0, samples.length - 1));
    const start = clamp(Math.trunc(startIndex), minIndex, maxIndex);

    if (samples.length < 2) return null;
    if (minIndex >= maxIndex) return null;

    if (direction > 0) {
        for (let i = Math.max(start + 1, minIndex + 1); i <= maxIndex; i++) {
            const a = samples[i - 1] ?? 0;
            const b = samples[i] ?? 0;
            if (isZeroCrossing(a, b)) return i;
        }
        return null;
    }

    // When searching backwards, skip the boundary at `start` itself so "Previous" moves
    // even if we're already aligned to a zero crossing.
    for (let i = Math.min(start - 1, maxIndex); i > minIndex; i--) {
        const a = samples[i - 1] ?? 0;
        const b = samples[i] ?? 0;
        if (isZeroCrossing(a, b)) return i;
    }
    return null;
}

const Begin01Config: ContinuousParamConfig = {
    resolutionSteps: 1000,
    default: 0,
    convertTo01: (v) => clamp(v, 0, 1),
    convertFrom01: (v01) => clamp(v01, 0, 1),
    format: (v) => `${Math.round(v * 100)}%`,
};

const LengthWaveformsConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 2,
    convertTo01: (v) => clamp((v - 1) / 63, 0, 1),
    convertFrom01: (v01) => 1 + v01 * 63,
    format: (v) => `${v.toFixed(2)}x`,
};

export const MorphSampleWindowItem: React.FC<{
    index: number;
    window: MorphSampleImportWindowDto;
    monoSamples: Float32Array;
    gradientNode?: WaveformMorphGradientNode;
    onChange: (next: MorphSampleImportWindowDto) => void;
}> = ({ index, window, monoSamples, gradientNode, onChange }) => {
    const frames = useMemo(() => {
        return windowDtoToFrames(window, monoSamples.length);
    }, [window, monoSamples.length]);

    const minWindowFrames = Tic80Caps.waveform.pointCount;
    const endFrame = frames.beginFrame + frames.frameLength;

    const slice = useMemo(() => {
        return monoSamples.slice(frames.beginFrame, frames.beginFrame + frames.frameLength);
    }, [monoSamples, frames.beginFrame, frames.frameLength]);

    const windowWaveformSwatch = useMemo(() => {
        if (!gradientNode) return null;
        return new Tic80Waveform({ name: "", amplitudes: [...gradientNode.amplitudes] });
    }, [gradientNode]);

    const moveBeginToZeroCrossing = (direction: -1 | 1) => {
        const maxBegin = Math.max(0, endFrame - minWindowFrames);
        const idx = findZeroCrossingIndex({
            samples: monoSamples,
            startIndex: frames.beginFrame,
            direction,
            minIndex: 0,
            maxIndex: maxBegin,
        });
        if (idx == null) return;

        const nextBegin = clamp(idx, 0, maxBegin);
        const nextLen = endFrame - nextBegin;
        onChange(framesToWindowDto({ beginFrame: nextBegin, frameLength: nextLen }, monoSamples.length));
    };

    const moveEndToZeroCrossing = (direction: -1 | 1) => {
        const minEnd = frames.beginFrame + minWindowFrames;
        const maxEnd = monoSamples.length - 1;
        if (minEnd > maxEnd) return;

        const start = clamp(endFrame, minEnd, maxEnd);
        const idx = findZeroCrossingIndex({
            samples: monoSamples,
            startIndex: start,
            direction,
            minIndex: minEnd,
            maxIndex: maxEnd,
        });
        if (idx == null) return;

        const nextEnd = clamp(idx, minEnd, maxEnd);
        const nextLen = nextEnd - frames.beginFrame;
        onChange(framesToWindowDto({ beginFrame: frames.beginFrame, frameLength: nextLen }, monoSamples.length));
    };

    return (
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <strong>Window {index + 1}</strong>
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                    begin {frames.beginFrame} / {monoSamples.length} frames, len {frames.frameLength} frames
                </span>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <WaveformVisualizer
                        samples={slice}
                        height={120}
                        dottedMarkers={[0, slice.length]}
                    />
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                    {windowWaveformSwatch && (
                        <WaveformSwatch
                            value={windowWaveformSwatch}
                            scale={4}
                            displayStyle="muted"
                            overlayText={`${index + 1}`}
                        />
                    )}
                </div>
            </div>

            <div className="field-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <ContinuousKnob
                        label="Begin"
                        value={clamp(window.begin01, 0, 1)}
                        config={Begin01Config}
                        onChange={(v) => onChange({ ...window, begin01: clamp(v, 0, 1) })}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => moveBeginToZeroCrossing(-1)}>
                            {"<"}
                        </button>
                        <button type="button" onClick={() => moveBeginToZeroCrossing(1)}>
                            {">"}
                        </button>
                    </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <ContinuousKnob
                        label={`Length (x${Tic80Caps.waveform.pointCount})`}
                        value={Math.max(1, window.lengthWaveforms)}
                        config={LengthWaveformsConfig}
                        onChange={(v) => onChange({ ...window, lengthWaveforms: Math.max(1, v) })}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => moveEndToZeroCrossing(-1)}>
                            {"<"}
                        </button>
                        <button type="button" onClick={() => moveEndToZeroCrossing(1)}>
                            {">"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
