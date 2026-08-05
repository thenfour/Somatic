//import "./RadioButton.css"

import React from "react";
import { ButtonBase } from "./ButtonBase";

export interface RadioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {

    selected?: boolean;

    children: React.ReactNode;
    className?: string;
}

export const RadioButton = React.forwardRef<HTMLButtonElement, RadioButtonProps>(
    ({ children, className, selected, ...props }, ref) => {
        return (
            <ButtonBase
                ref={ref}
                className={`somatic-radio-button ${className}`}
                highlighted={selected}
                {...props}
            >
                {children}
            </ButtonBase>
        );
    },
);

RadioButton.displayName = "RadioButton";
