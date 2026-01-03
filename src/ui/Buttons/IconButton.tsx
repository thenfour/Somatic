// mdi/js icons browse @ https://pictogrammers.com/library/mdi/

import React from "react";
import { ButtonBase, ButtonBaseProps } from "./ButtonBase";
import Icon from "@mdi/react";

type IconButtonProps = ButtonBaseProps & {
    iconPath?: string;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ children, className, iconPath, ...props }, ref) => {
        return (
            <ButtonBase ref={ref} className={`somatic-icon-button ${className ?? ""}`} {...props}>
                {iconPath && (
                    <div className="somatic-icon-button__icon">
                        <Icon path={iconPath} size={1} />
                    </div>
                )}
                {children && (
                    <div className="somatic-icon-button__content">
                        {children}
                    </div>
                )}
            </ButtonBase>
        );
    },
);

IconButton.displayName = "IconButton";