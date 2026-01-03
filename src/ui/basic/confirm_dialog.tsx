import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';
import { ShortcutManagerProvider, useShortcutManager } from '../../keyb/KeyboardShortcutManager';
import { useActionHandler } from '../../keyb/useActionHandler';
import type { ActionRegistry } from '../../keyb/KeyboardShortcutTypes';
import { Button } from '../Buttons/PushButton';

export type ConfirmDialogOptions = {
    content: React.ReactNode;
    /** Which button is activated when the user presses Enter. Defaults to 'yes'. */
    defaultAction?: 'yes' | 'no';
    yesLabel?: string;
    noLabel?: string;
};

export type ConfirmDialogContextValue = {
    confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
};

const ConfirmDialogActions = {
    ConfirmDefault: 'ConfirmDefault',
} as const;

type ConfirmDialogActionId = keyof typeof ConfirmDialogActions;

const gConfirmDialogActionRegistry: ActionRegistry<ConfirmDialogActionId> = {
    ConfirmDefault: {
        id: ConfirmDialogActions.ConfirmDefault,
        defaultBindings: [
            { kind: 'character', key: 'Enter' },
        ],
    },
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | undefined>(undefined);

export const useConfirmDialog = (): ConfirmDialogContextValue => {
    const ctx = useContext(ConfirmDialogContext);
    if (!ctx) {
        throw new Error('useConfirmDialog must be used within a ConfirmDialogProvider');
    }
    return ctx;
};

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
    const resolverRef = useRef<((result: boolean) => void) | null>(null);

    const close = useCallback((result: boolean) => {
        if (resolverRef.current) {
            resolverRef.current(result);
            resolverRef.current = null;
        }
        setIsOpen(false);
        setOptions(null);
    }, []);

    const confirm = useCallback((opts: ConfirmDialogOptions) => {
        return new Promise<boolean>((resolve) => {
            resolverRef.current = resolve;
            setOptions({
                content: opts.content,
                defaultAction: opts.defaultAction ?? 'yes',
                yesLabel: opts.yesLabel ?? 'Yes',
                noLabel: opts.noLabel ?? 'No',
            });
            setIsOpen(true);
        });
    }, []);

    const handleYes = () => close(true);
    const handleNo = () => close(false);

    const DialogContent: React.FC = () => {
        const mgr = useShortcutManager<ConfirmDialogActionId>();
        // Enter triggers the current default action; Escape closes.
        mgr.useActionHandler('ConfirmDefault', () => {
            const def = options?.defaultAction ?? 'yes';
            close(def === 'yes');
        });

        return (
            <ModalDialog
                isOpen={isOpen}
                onBackdropClick={() => close(false)}
                ariaLabel="Confirmation dialog"
            >
                <div className="modal-dialog__body">
                    {options?.content}
                </div>
                <div className="modal-dialog__footer">
                    <Button
                        type="button"
                        onClick={handleYes}
                        tabIndex={0}
                        autoFocus={options?.defaultAction !== 'no'}
                    >
                        {options?.yesLabel}
                    </Button>
                    <Button
                        type="button"
                        onClick={handleNo}
                        tabIndex={0}
                        autoFocus={options?.defaultAction === 'no'}
                    >
                        {options?.noLabel}
                    </Button>
                </div>
            </ModalDialog>
        );
    };

    return (
        <ConfirmDialogContext.Provider value={{ confirm }}>
            {children}
            {options && (
                <ShortcutManagerProvider<ConfirmDialogActionId>
                    name="ConfirmDialog"
                    actions={gConfirmDialogActionRegistry}
                    attachTo={document}
                    eventPhase="capture"
                >
                    <DialogContent />
                </ShortcutManagerProvider>
            )}
        </ConfirmDialogContext.Provider>
    );
};
