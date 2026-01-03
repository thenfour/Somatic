// base button component with all options to support the various wrappers:


import React from "react";

import "./ButtonBase.css";

export interface ButtonBaseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    children?: React.ReactNode;
    highlighted?: boolean; // use for highlighting / selecetd state.
    className?: string;
}

export const ButtonBase: React.FC<ButtonBaseProps> = ({ children, className, highlighted, ...props }) => {
    const classes = [
        `somatic-button-base`,
        className,
        highlighted ? 'somatic-button-base--highlighted' : 'somatic-button-base--not-highlighted',
        props.disabled ? 'somatic-button-base--disabled' : 'somatic-button-base--enabled',
    ];

    return (
        <button
            className={classes.filter(Boolean).join(' ')}
            {...props}
        >
            {children}
        </button>
    );
};

