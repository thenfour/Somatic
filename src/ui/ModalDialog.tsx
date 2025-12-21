import React from 'react';

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

export const ModalDialog: React.FC<ModalDialogProps> = ({
    isOpen,
    children,
    onBackdropClick,
    ariaLabel,
    ariaLabelledBy,
}) => {
    if (!isOpen) return null;

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
