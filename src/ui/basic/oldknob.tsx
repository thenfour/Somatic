import React from "react";
import "./oldknob.css";
import { Knob } from "./knob";
// todo: make this more beautiful
// - svg, 1-dimension sweeping
// - shift for fine control
// - ctrl+click to set default
// - param curving

// internally we use 0-1; externally the user defines mapping & formatting.

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
        label={label}
        onChange={onChange}
        value={value}
    />;
};


// export const ContinuousKnob: React.FC<ContinuousKnobProps> = ({ label, value, onChange, config }) => {
//     return (
//         <div className="knob continuous-knob"
//             onMouseDown={(e) => {
//                 if (e.ctrlKey) {
//                     e.preventDefault();
//                     e.stopPropagation();
//                     onChange(config.default);
//                 }
//             }}
//         >
//             <label>
//                 {label}: {config.format(value)}
//                 <input
//                     type="range"
//                     min={0}
//                     max={1}
//                     step={1 / (config.resolutionSteps - 1)}
//                     value={config.convertTo01(value)}
//                     onChange={(e) => {
//                         const val = config.convertFrom01(parseFloat(e.target.value));
//                         onChange(val);
//                     }}
//                 />
//             </label>
//         </div>
//     );
// };


