import React from 'react';
import { Tooltip } from './tooltip';

type HelpTooltipProps = {
    content: React.ReactNode;
    className?: string;
};

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ content, className }) => {
    return (
        <Tooltip title={content} className={className}>
            <span className='help-tooltip'>?</span>
        </Tooltip>
    );
};
