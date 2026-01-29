// originally for buttons only but it's extremely useful to put other input-like things
// together like this. Knobs for example.

import React from "react";


export type ButtonGroupOrientation = "horizontal" | "vertical";

export type ButtonGroupProps = {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    orientation?: ButtonGroupOrientation;
    variant?: "default" | "subtle";
};

export const ButtonGroup: React.FC<ButtonGroupProps> = ({ children, className, style, orientation = "horizontal", variant = "default" }) => {
    const orientationClass = orientation === "vertical" ? "somatic-button-group--vertical" : "somatic-button-group--horizontal";
    const variantClass = variant === "subtle" ? "somatic-button-group--subtle" : "somatic-button-group--default";
    return (
        <div className={`somatic-button-group ${orientationClass} ${variantClass} ${className || ""}`} style={style}    >
            {children}
        </div>
    );
};
