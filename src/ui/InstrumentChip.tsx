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
    children?: React.ReactNode;
    width?: number;
}
export const InstrumentChip: React.FC<InstrumentChipProps> = ({ className, style, instrument, instrumentIndex, onClick, showTooltip = true, children, width }) => {
    const classes = ['chip'];
    if (className) {
        classes.push(className);
    }

    const renderedChildren = children || (
        <>
            <span className="instrument-chip-index">{instrument.getIndexString(instrumentIndex)}</span>
            <span className="instrument-chip-separator">{": "}</span>
            <span className="instrument-chip-name">{instrument.name}</span>
            {instrument.isKRateProcessing() && (
                <div className="instrument-chip-krate-badge"></div>
            )}
        </>
    );

    return <Tooltip title={instrument.getCaption(instrumentIndex)} disabled={!showTooltip}>
        <div className={classes.join(' ')} style={{ ...style, width }} onClick={onClick}>
            {renderedChildren}
        </div>
    </Tooltip>;
};