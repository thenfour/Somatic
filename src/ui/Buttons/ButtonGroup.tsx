// originally for buttons only but it's extremely useful to put other input-like things
// together like this. Knobs for example.

import React from "react";


export type ButtonGroupOrientation = "horizontal" | "vertical";

export type ButtonGroupProps = {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    orientation?: ButtonGroupOrientation;
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ children, className, style, orientation = "horizontal" }) => {
    const orientationClass = orientation === "vertical" ? "somatic-button-group--vertical" : "somatic-button-group--horizontal";
    return (
        <div className={`somatic-button-group ${orientationClass} ${className || ""}`} style={style}    >
            {children}
        </div>
    );
};
