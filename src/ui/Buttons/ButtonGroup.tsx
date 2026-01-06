// originally for buttons only but it's extremely useful to put other input-like things
// together like this. Knobs for example.

import React from "react";


export const ButtonGroup: React.FC<{ children: React.ReactNode; className?: string, style?: React.CSSProperties }> = ({ children, className, style }) => {
    return (
        <div className={`somatic-button-group ${className || ""}`} style={style}    >
            {children}
        </div>
    );
};
