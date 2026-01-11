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
    const moreStyle: React.CSSProperties = { ...style };
    if (width !== undefined) {
        moreStyle.width = width;
    }

    const classes = ['chip instrument-chip '];
    if (className) {
        classes.push(className);
    }
    if (instrument.highlightColor) {
        classes.push('instrument-chip--highlighted');
        (moreStyle as any)["--instrument-highlight-color"] = instrument.highlightColor;
        (moreStyle as any)["--instrument-highlight-fg"] = instrument.highlightFg || '#000000';
    }

    const renderedChildren = children || (
        <>
            <span className="instrument-chip-index-container">
                <span className="instrument-chip-index">{instrument.getIndexString(instrumentIndex)}</span>
            </span>
            <span className="instrument-chip-separator">{": "}</span>
            {/* {instrument.highlightColor && (
                <span className="instrument-chip-highlight-indicator" style={{ backgroundColor: instrument.highlightColor }}></span>
            )} */}
            <span className="instrument-chip-name">{instrument.name}</span>
            {instrument.isKRateProcessing() && (
                <div className="instrument-chip-krate-badge"></div>
            )}
        </>
    );

    return <Tooltip title={instrument.getCaption(instrumentIndex)} disabled={!showTooltip}>
        <div className={classes.join(' ')} style={{ ...moreStyle, width }} onClick={onClick}>
            {renderedChildren}
        </div>
    </Tooltip>;
};