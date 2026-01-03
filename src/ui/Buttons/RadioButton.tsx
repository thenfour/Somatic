//import "./RadioButton.css"

import { ButtonBase } from "./ButtonBase";

export interface RadioButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {

    selected?: boolean;

    children: React.ReactNode;
    className?: string;
}

export const RadioButton: React.FC<RadioButtonProps> = ({ children, className, ...props }) => {
    return <ButtonBase
        className={`somatic-radio-button ${className}`}
        highlighted={props.selected}
        {...props}
    >
        {children}
    </ButtonBase>;
};