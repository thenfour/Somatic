import React from "react";
import "./DotIndicator.css";

export type VersionAvatarPropsCommon = {
    className?: string;
    style?: React.CSSProperties;
}

export type DotIndicatorProps = (VersionAvatarPropsCommon & {
    active: boolean; // simpler boolean version to state; active vs inactive
}) | (VersionAvatarPropsCommon & {
    state: 'active' | 'inactive' | "warning" | "disabled" | "error";
});

export const DotIndicator: React.FC<DotIndicatorProps> = (props) => {
    const { className, style } = props;
    let state: 'active' | 'inactive' | "warning" | "disabled" | "error";
    if ('active' in props) {
        state = props.active ? 'active' : 'inactive';
    } else {
        state = props.state;
    }
    return <span
        className={`dot-indicator dot-indicator--${state} ${className ?? ''}`}
        style={style}
        aria-label={
            state === 'active' ? 'Active' :
                state === 'inactive' ? 'Inactive' :
                    state === 'warning' ? 'Warning' :
                        state === 'disabled' ? 'Disabled' :
                            state === 'error' ? 'Error' : ''
        }
    />;
}

