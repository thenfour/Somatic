import React, { useMemo } from "react";
import { ContinuousKnob, ContinuousParamConfig } from "./basic/oldknob";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { WaveformSwatch } from "./waveformSwatch";
import { MorphSampleImportWindowDto } from "../models/instruments";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform } from "../models/waveform";
import { clamp } from "../utils/utils";
import { resampleWindowToTic80Amplitudes, windowDtoToFrames } from "../audio/morph_sample_import";

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

    const windowWaveformSwatch = useMemo(() => {
        const amps = resampleWindowToTic80Amplitudes(slice);
        return new Tic80Waveform({ name: "", amplitudes: [...amps] });
    }, [slice]);

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
                        height={70}
                        dottedMarkers={[0, slice.length]}
                    />
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                    <WaveformSwatch
                        value={windowWaveformSwatch}
                        scale={4}
                        displayStyle="muted"
                        overlayText={`${index + 1}`}
                    />
                </div>
            </div>

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
