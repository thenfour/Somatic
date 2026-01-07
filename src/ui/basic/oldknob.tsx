import React from "react";
import { Knob } from "./Knob2";
import { invLerp, lerp } from "../../utils/utils";

export interface ContinuousParamConfig {
    resolutionSteps?: number;
    default: number;
    center: number;
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
    const [defaultValue, centerValue] = React.useMemo(() => {
        const def = config.convertTo01(config.default);
        const cent = config.convertTo01(config.center);
        return [def, cent];
    }, [config]);
    return <Knob
        min={0}
        max={1}
        defaultValue={defaultValue}
        centerValue={centerValue}
        step={config.resolutionSteps ? 1 / (config.resolutionSteps - 1) : undefined}
        label={label}
        onChange={(x) => {
            const val = config.convertFrom01(x);
            onChange(val);
        }}
        formatValue={(x) => config.format(config.convertFrom01(x))}
        value={config.convertTo01(value)}
    />;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// // todo: knob wrappers for other curves, param types. see #133

// duration always in seconds
export interface CurvedKnobProps {
    label?: string;
    k: number; // curve factor (linear = 0, higher = more curve)
    value: number;
    onChange: (newValue: number) => void;
    min?: number;
    max: number;
    centerValue?: number;
    defaultValue?: number;

    formatValue?: (v: number) => string;

    className?: string;
    style?: React.CSSProperties;
}

export const CurvedKnob: React.FC<CurvedKnobProps> = ({ label, value, onChange, min = 0, max, centerValue, defaultValue, k, formatValue, className, style }) => {
    const unitCurve = (x: number): number => {
        if (x <= 0) return x;
        if (x >= 1) return x;
        return Math.log(1 + k * x) / Math.log(1 + k);
    };
    const invUnitCurve = (y: number): number => {
        return (Math.exp(y * Math.log(1 + k)) - 1) / k;
    };

    // curving. curve at the unit level for simplicity and continuity.
    // then scale to(from) seconds.
    const externalToUnit = (seconds: number): number => {
        const t01 = invLerp(min, max, seconds);
        const r = unitCurve(t01);
        return r;
    };
    const unitToExternal = (unit: number): number => {
        const t01 = invUnitCurve(unit);
        const r = lerp(min, max, t01);
        return r;
    };

    return <Knob
        min={min}
        max={max}

        centerValue={centerValue}
        defaultValue={defaultValue}

        label={label}
        onChange={onChange}
        formatValue={formatValue}
        value={value}

        fromUnit={unitToExternal}
        toUnit={externalToUnit}

        className={`curved-knob ${className || ""}`}
        style={style}
    />;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// duration always in seconds
export interface DurationKnobProps {
    label?: string;
    value: number;
    onChange: (newValue: number) => void;
    min?: number;
    max: number;
    centerValue?: number;
    defaultValue?: number;

    className?: string;
    style?: React.CSSProperties;
}

export const DurationKnob: React.FC<DurationKnobProps> = ({ label, value, onChange, min = 0, max, centerValue, defaultValue, className, style }) => {
    const formatDuration = (seconds: number): string => {
        if (seconds < 1) {
            return `${Math.round(seconds * 1000)} ms`;
        } else {
            return `${seconds.toFixed(3)} s`;
        }
    };

    return <CurvedKnob
        min={min}
        max={max}

        centerValue={centerValue}
        defaultValue={defaultValue}

        label={label}
        onChange={onChange}
        formatValue={formatDuration}
        value={value}
        k={5}
        className={`duration-knob ${className || ""}`}
        style={style}
    />;
};


