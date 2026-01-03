import React from "react";
import { Knob } from "./Knob2";

export interface ContinuousParamConfig {
    resolutionSteps: number;
    default: number;
    convertTo01: (value: number) => number;
    convertFrom01: (value01: number) => number;
    format: (value: number) => string;
};

interface ContinuousKnobProps {
    label?: string | undefined;
    value: number;
    onChange: (newValue: number) => void;
    config: ContinuousParamConfig;
}

export const ContinuousKnob: React.FC<ContinuousKnobProps> = ({ label, value, onChange, config }) => {
    return <Knob
        min={0}
        max={1}
        step={1 / (config.resolutionSteps - 1)}
        label={label}
        onChange={(x) => {
            const val = config.convertFrom01(x);
            onChange(val);
        }}
        formatValue={(x) => config.format(config.convertFrom01(x))}
        value={config.convertTo01(value)}
    />;
};

// todo: knob wrappers for other curves, param types. see #133