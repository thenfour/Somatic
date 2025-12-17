import React from 'react';
import { Tooltip } from './tooltip';

type HelpTooltipProps = {
    content: React.ReactNode;
    children: React.ReactNode;
    /** Optional aria-label override for the trigger wrapper. */
    label?: string;
    className?: string;
};

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ content, children, label, className }) => {
    return (
        <Tooltip title={content} className={className}>
            <span className="tooltip-trigger" tabIndex={0} aria-label={label} role="note">
                {children}
            </span>
        </Tooltip>
    );
};
