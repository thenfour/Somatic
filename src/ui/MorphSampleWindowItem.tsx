import React, { useMemo } from "react";
import { ContinuousKnob, ContinuousParamConfig } from "./basic/oldknob";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { MorphSampleImportWindowDto } from "../models/instruments";
import { Tic80Caps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";
import { windowDtoToFrames } from "../audio/morph_sample_import";

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
    onChange: (next: MorphSampleImportWindowDto) => void;
}> = ({ index, window, monoSamples, onChange }) => {
    const frames = useMemo(() => {
        return windowDtoToFrames(window, monoSamples.length);
    }, [window, monoSamples.length]);

    const slice = useMemo(() => {
        return monoSamples.slice(frames.beginFrame, frames.beginFrame + frames.frameLength);
    }, [monoSamples, frames.beginFrame, frames.frameLength]);

    return (
        <div style={{ border: "1px solid var(--panel-border)", padding: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <strong>Window {index + 1}</strong>
                <span style={{ fontSize: 12, opacity: 0.8 }}>
                    begin {frames.beginFrame} / {monoSamples.length} frames, len {frames.frameLength} frames
                </span>
            </div>

            <WaveformVisualizer
                samples={slice}
                height={70}
                dottedMarkers={[0, slice.length]}
            />

            <div className="field-row">
                <ContinuousKnob
                    label="Begin"
                    value={clamp(window.begin01, 0, 1)}
                    config={Begin01Config}
                    onChange={(v) => onChange({ ...window, begin01: clamp(v, 0, 1) })}
                />
                <ContinuousKnob
                    label={`Length (x${Tic80Caps.waveform.pointCount})`}
                    value={Math.max(1, window.lengthWaveforms)}
                    config={LengthWaveformsConfig}
                    onChange={(v) => onChange({ ...window, lengthWaveforms: Math.max(1, v) })}
                />
            </div>
        </div>
    );
};
