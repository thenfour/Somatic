import React from 'react';

type TooltipProps = {
    content: React.ReactNode;
    label?: string;
};

export const Tooltip: React.FC<TooltipProps> = ({ content, label = '?' }) => (
    <span className="tooltip" role="note">
        <span className="tooltip-trigger" tabIndex={0} aria-label="Show help">
            {label}
        </span>
        <span className="tooltip-content">{content}</span>
    </span>
);
