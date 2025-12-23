import React from 'react';
import { ActionRegistry } from '../keyb/KeyboardShortcutTypes';
import { ShortcutManagerProvider, useShortcutManager } from '../keyb/KeyboardShortcutManager';

const ModalActions = {
    Close: 'Close',
} as const;

type ModalActionId = keyof typeof ModalActions;

const gModalActionRegistry: ActionRegistry<ModalActionId> = {
    Close: {
        id: ModalActions.Close,
        defaultBindings: [
            { kind: 'character', key: 'Escape' },
        ],
    },
};



export type ModalDialogProps = {
    isOpen: boolean;
    children: React.ReactNode;
    /** Called when the user clicks on the backdrop (outside the dialog). */
    onBackdropClick?: () => void;
    /** Optional ARIA label for the dialog when there is no visible title element. */
    ariaLabel?: string;
    /** Id of an element that labels the dialog (e.g. a header). */
    ariaLabelledBy?: string;
};

export const ModalDialogInner: React.FC<ModalDialogProps> = ({
    isOpen,
    children,
    onBackdropClick,
    ariaLabel,
    ariaLabelledBy,
}) => {
    if (!isOpen) return null;
    const mgr = useShortcutManager<ModalActionId>();

    mgr.useActionHandler('Close', () => {
        onBackdropClick?.();
    });

    const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) {
            onBackdropClick?.();
        }
    };

    return (
        <div className="modal-backdrop" onClick={handleBackdropClick}>
            <div
                className="modal-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
            >
                {children}
            </div>
        </div>
    );
};


export const ModalDialog: React.FC<ModalDialogProps> = (props) => {
    if (!props.isOpen) return null;

    return (
        <ShortcutManagerProvider<ModalActionId>
            name="ModalDialog"
            actions={gModalActionRegistry}
            attachTo={document}
            eventPhase="capture"
        >
            <ModalDialogInner {...props} />
        </ShortcutManagerProvider>
    );
};
