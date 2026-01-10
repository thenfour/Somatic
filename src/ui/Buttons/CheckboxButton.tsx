// drop-in replacement for checkbox input

import React from 'react';

import { ButtonBase, ButtonBaseProps } from './ButtonBase';
import Icon from '@mdi/react';
import { mdiCheck, mdiCheckBold } from '@mdi/js';

export interface CheckboxButtonProps extends Omit<ButtonBaseProps, "onChange" | "highlighted"> {
    checked?: boolean;
    showCheckmark?: boolean;
    onChange?: (newValue: boolean) => void;
}

export const CheckboxButton = React.forwardRef<HTMLButtonElement, CheckboxButtonProps>(
    ({ children, className, checked, onChange, showCheckmark = true, ...props }, ref) => {
        const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            if (onChange) {
                onChange(!checked);
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
                {showCheckmark && checked && <div className="somatic-checkbox-button__checkmark checkbox-button-checked"><Icon path={mdiCheckBold} /></div>}
                {showCheckmark && !checked && <div className="somatic-checkbox-button__checkmark checkbox-button-unchecked"></div>}
                {children}
            </ButtonBase>
        );
    },
);

CheckboxButton.displayName = "CheckboxButton";