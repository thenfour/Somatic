// drop-in replacement for checkbox input

import React from 'react';

import { ButtonBase, ButtonBaseProps } from './ButtonBase';

export interface CheckboxButtonProps extends ButtonBaseProps {
    checked?: boolean;
}

export const CheckboxButton = React.forwardRef<HTMLButtonElement, CheckboxButtonProps>(
    ({ children, className, checked, ...props }, ref) => {
        const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            if (props.onChange) {
                props.onChange({
                    ...event,
                    target: {
                        ...event.target,
                        checked: !checked,
                    } as any,
                });
            }
        };

        return (
            <ButtonBase
                ref={ref}
                className={`somatic-checkbox-button ${className ?? ''}`}
                highlighted={checked}
                onClick={handleClick}
                {...props}
            >
                {children}
            </ButtonBase>
        );
    },
);

CheckboxButton.displayName = "CheckboxButton";