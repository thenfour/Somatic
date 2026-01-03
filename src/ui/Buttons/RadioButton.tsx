//import "./RadioButton.css"

import React from "react";
import { ButtonBase } from "./ButtonBase";

export interface RadioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {

    selected?: boolean;

    children: React.ReactNode;
    className?: string;
}

export const RadioButton = React.forwardRef<HTMLButtonElement, RadioButtonProps>(
    ({ children, className, ...props }, ref) => {
        return (
            <ButtonBase
                ref={ref}
                className={`somatic-radio-button ${className}`}
                highlighted={props.selected}
                {...props}
            >
                {children}
            </ButtonBase>
        );
    },
);

RadioButton.displayName = "RadioButton";
