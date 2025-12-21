import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform } from "../models/waveform";
import { clamp } from "../utils/utils";

export type WaveformSwatchDisplayStyle = "normal" | "selected" | "muted";

export const WaveformSwatch: React.FC<{
    value: Tic80Waveform;
    scale: number;
    //isSelected?: boolean;
    displayStyle: WaveformSwatchDisplayStyle;
    /** Optional small overlay label, similar to WaveformCanvas coordinates. */
    overlayText?: string;
    onClick?: () => void;
}> = ({ value, scale, displayStyle, overlayText, onClick }) => {
    const pointCount = Tic80Caps.waveform.pointCount;
    const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
    const width = scale * pointCount;
    const height = scale * amplitudeRange;

    const maxAmp = amplitudeRange - 1;

    const points: JSX.Element[] = [];
    for (let i = 0; i < pointCount; i += 1) {
        const amp = clamp(value.amplitudes[i] ?? 0, 0, maxAmp);

        const x = (i) * (width / pointCount);
        const y = height - ((amp + 1) * height) / amplitudeRange;
        points.push(
            <rect
                key={i}
                className="waveform-swatch__point"
                x={x}
                y={y}
                width={scale}
                height={scale}
            />,
        );
    }

    const className = `interactable waveform-swatch waveform-swatch--${displayStyle}`;

    return (
        <button type="button" className={className} onClick={onClick} style={{ width, height }}>
            <svg
                className="waveform-swatch__svg"
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                aria-hidden="true"
            >
                {points}
                {overlayText && (
                    <text
                        x={8}
                        y={16}
                        className="waveform-editor__coordinates"
                    >
                        {overlayText}
                    </text>
                )}
            </svg>
        </button>
    );
};
