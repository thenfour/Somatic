import { mdiWindowClose } from '@mdi/js';
import React from 'react';
import './AppPanelShell.css';
import { IconButton } from './Buttons/IconButton';
import { GlobalActionId } from '../keyb/ActionIds';
import { useActionHandler } from '../keyb/useActionHandler';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { Tooltip } from './basic/tooltip';
import { assert } from '../utils/utils';

export type AppPanelShellPropsCommon = {
    onClose?: () => void;
    className?: string;
    actions?: React.ReactNode;
    headerContent?: React.ReactNode;
    headerExtra?: React.ReactNode;
    role?: string;
    ariaLabel?: string;
    children: React.ReactNode;
};

export type AppPanelShellProps =
    // if you specify close action id (for tootltip), you have to provide a string title
    // -- either as a string,
    (AppPanelShellPropsCommon & {
        title: string;
        closeActionId: GlobalActionId;
    }) |
    // -- or as React node + string title
    (AppPanelShellPropsCommon & {
        title: React.ReactNode;
        titleString: string;
        closeActionId: GlobalActionId;
    }) |
    // or a string title not necessary when not specifying close action id
    (AppPanelShellPropsCommon & {
        title: React.ReactNode;
        closeActionId?: undefined;
    });

export const AppPanelShell: React.FC<AppPanelShellProps> = ({
    title,
    className,
    actions,
    headerContent,
    role,
    ariaLabel,
    children,
    headerExtra,
    onClose,
    closeActionId,
    ...props
}) => {
    const classes = ['app-panel', 'app-panel-shell'];
    if (className) classes.push(className);
    const mgr = useShortcutManager<GlobalActionId>();

    const tooltipText: string | undefined = React.useMemo(() => {
        if (!closeActionId) return undefined;
        const actionSuffix = mgr.getActionBindingLabelAsTooltipSuffix(closeActionId);
        const titleString = 'titleString' in props ? props.titleString : (typeof title === 'string' ? title : undefined);
        return `Close ${titleString} ${actionSuffix}`;
    }, [closeActionId, title, mgr]);


    return (
        <div className={classes.join(' ')} role={role} aria-label={ariaLabel}>
            <div className="app-panel-shell__header">
                <div className="app-panel-shell__header-top">
                    {onClose && (tooltipText ? <Tooltip title={tooltipText}><IconButton onClick={onClose} iconPath={mdiWindowClose} /></Tooltip> : <IconButton onClick={onClose} iconPath={mdiWindowClose} />)}
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
                {headerExtra && (
                    <div className="app-panel-shell__header-extra">
                        {headerExtra}
                    </div>
                )}
            </div>
            <div className="app-panel-shell__content">
                {children}
            </div>
        </div>
    );
};
