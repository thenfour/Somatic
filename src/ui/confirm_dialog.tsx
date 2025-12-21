import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ModalDialog } from './ModalDialog';

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

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const def = options?.defaultAction ?? 'yes';
                close(def === 'yes');
            } else if (e.key === 'Escape') {
                e.preventDefault();
                close(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, options, close]);

    const handleYes = () => close(true);
    const handleNo = () => close(false);

    return (
        <ConfirmDialogContext.Provider value={{ confirm }}>
            {children}
            {options && (
                <ModalDialog
                    isOpen={isOpen}
                    onBackdropClick={() => close(false)}
                    ariaLabel="Confirmation dialog"
                >
                    <div className="modal-dialog__body">
                        {options.content}
                    </div>
                    <div className="modal-dialog__footer">
                        <button
                            type="button"
                            className="modal-dialog__button modal-dialog__button--primary"
                            onClick={handleYes}
                            autoFocus={options.defaultAction !== 'no'}
                        >
                            {options.yesLabel}
                        </button>
                        <button
                            type="button"
                            className="modal-dialog__button"
                            onClick={handleNo}
                            autoFocus={options.defaultAction === 'no'}
                        >
                            {options.noLabel}
                        </button>
                    </div>
                </ModalDialog>
            )}
        </ConfirmDialogContext.Provider>
    );
};
