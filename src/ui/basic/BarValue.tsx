import { formatBytes } from "../../utils/utils";
import { Tooltip } from "./tooltip";

export const SizeValue: React.FC<{ value: number; }> = ({ value }) => {
    return (
        <Tooltip title={`${value} bytes`}>
            <div className="size-value" style={{ whiteSpace: "nowrap" }}>{formatBytes(value)}</div>
        </Tooltip>
    );
};

export const BarValue: React.FC<{ value: number; max: number; label: React.ReactNode }> = ({ value, max, label }) => {
    const safeMax = Math.max(1, max);
    const pct = Math.max(0, Math.min(1, value / safeMax));
    return (
        <div className="bar-value" style={{
            "--bar-value-fill-percent": `${(pct * 100).toFixed(1)}%`,
        } as React.CSSProperties}>
            <div
                className="bar-value--content"
                aria-hidden="true"
            >
                <span
                    className="bar-value--label"
                >
                    {label}
                </span>
                <div
                    className="bar-value--bar"
                />
            </div>
        </div>
    );
};
