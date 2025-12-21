import React from 'react';
import { ModalDialog } from './ModalDialog';

export interface AboutSomaticDialogProps {
    open: boolean;
    onClose: () => void;
}

export const AboutSomaticDialog: React.FC<AboutSomaticDialogProps> = ({ open, onClose }) => {
    return (
        <ModalDialog
            isOpen={open}
            onBackdropClick={onClose}
            ariaLabel="About Somatic"
        >
            <div className="modal-dialog__body">
                <h2>Somatic</h2>
                <p>
                    Somatic is a music tracker for the TIC-80.
                </p>
                <p>
                    Project home:{' '}
                    <a
                        href="https://github.com/thenfour/Somatic"
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        github.com/thenfour/Somatic
                    </a>
                </p>
            </div>
            <div className="modal-dialog__footer">
                <button
                    type="button"
                    className="modal-dialog__button modal-dialog__button--primary"
                    onClick={onClose}
                >
                    Close
                </button>
            </div>
        </ModalDialog>
    );
};
