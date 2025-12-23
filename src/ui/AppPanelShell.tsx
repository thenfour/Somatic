import React from 'react';
import './AppPanelShell.css';

export type AppPanelShellProps = {
    title: React.ReactNode;
    className?: string;
    actions?: React.ReactNode;
    headerContent?: React.ReactNode;
    role?: string;
    ariaLabel?: string;
    children: React.ReactNode;
};

export const AppPanelShell: React.FC<AppPanelShellProps> = ({
    title,
    className,
    actions,
    headerContent,
    role,
    ariaLabel,
    children,
}) => {
    const classes = ['app-panel', 'app-panel-shell'];
    if (className) classes.push(className);

    return (
        <div className={classes.join(' ')} role={role} aria-label={ariaLabel}>
            <div className="app-panel-shell__header">
                <div className="app-panel-shell__title-group">
                    <h2 className="app-panel-shell__title">{title}</h2>
                    {headerContent && (
                        <div className="app-panel-shell__subtitle">{headerContent}</div>
                    )}
                </div>
                {actions && (
                    <div className="app-panel-shell__actions">
                        {actions}
                    </div>
                )}
            </div>
            <div className="app-panel-shell__content">
                {children}
            </div>
        </div>
    );
};
