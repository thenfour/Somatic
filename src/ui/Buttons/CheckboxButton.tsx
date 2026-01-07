// drop-in replacement for checkbox input

import React from 'react';

import { ButtonBase, ButtonBaseProps } from './ButtonBase';

export interface CheckboxButtonProps extends Omit<ButtonBaseProps, "onChange"> {
    checked?: boolean;
    //onChange?: (event: React.MouseEvent<HTMLButtonElement> & { target: { checked: boolean } }) => void;
    onChange?: (newValue: boolean) => void;
}

export const CheckboxButton = React.forwardRef<HTMLButtonElement, CheckboxButtonProps>(
    ({ children, className, checked, onChange, ...props }, ref) => {
        const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            if (onChange) {
                onChange(!checked);
                // props.onChange({
                //     ...event,
                //     target: {
                //         ...event.target,
                //         checked: !checked,
                //     } as any,
                // });
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