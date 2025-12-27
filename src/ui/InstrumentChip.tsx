import React from "react";
import "./InstrumentChip.css";
import { Tic80Instrument } from "../models/instruments";
import { Tooltip } from "./basic/tooltip";

export interface InstrumentChipProps {
    instrumentIndex: number;
    instrument: Tic80Instrument;
    onClick?: () => void;
    style?: React.CSSProperties;
    className?: string;
    showTooltip?: boolean;
}
export const InstrumentChip: React.FC<InstrumentChipProps> = ({ className, style, instrument, instrumentIndex, onClick, showTooltip = true }) => {
    const classes = ['chip'];
    if (className) {
        classes.push(className);
    }
    return <Tooltip title={instrument.getCaption(instrumentIndex)} disabled={!showTooltip}>
        <div className={classes.join(' ')} style={style} onClick={onClick}>
            <span className="instrument-chip-index">{instrument.getIndexString(instrumentIndex)}</span>
            <span className="instrument-chip-separator">{": "}</span>
            <span className="instrument-chip-name">{instrument.name}</span>
            {instrument.isKRateProcessing() && (
                <div className="instrument-chip-krate-badge"></div>
            )}
        </div>
    </Tooltip>;
};