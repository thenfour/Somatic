// mdi/js icons browse @ https://pictogrammers.com/library/mdi/

import React from "react";
import { ButtonBase, ButtonBaseProps } from "./ButtonBase";
import Icon from "@mdi/react";

type IconButtonProps = ButtonBaseProps & {
    iconPath?: string;
    size?: number;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ children, className, iconPath, size = 17, ...props }, ref) => {


        const style: React.CSSProperties = {};
        if (size != null) {
            (style as any)["--icon-size"] = `${size}px`;
            style.width = "var(--icon-size)";
            style.height = "var(--icon-size)";
        }

        return (
            <ButtonBase ref={ref} className={`somatic-icon-button ${className ?? ""}`} {...props}>
                {iconPath && (
                    <div className="somatic-icon-button__icon">
                        <Icon path={iconPath} size={size == null ? 1 : undefined} style={style} />
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