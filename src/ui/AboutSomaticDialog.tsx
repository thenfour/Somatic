import React from 'react';
import { buildInfo } from '../buildInfo';
import { getBuildVersionTag } from '../utils/versionString';
import { DateValue } from './basic/DateValue';
import { ModalDialog } from './basic/ModalDialog';
import { Button } from './Buttons/PushButton';

export interface AboutSomaticDialogProps {
    open: boolean;
    onClose: () => void;
}

export const AboutSomaticDialog: React.FC<AboutSomaticDialogProps> = ({ open, onClose }) => {

    const versionString = getBuildVersionTag(buildInfo);

    const buildDate: Date = new Date(buildInfo.buildDate);
    const lastCommitDate: Date | null = buildInfo.lastCommitDate ? new Date(buildInfo.lastCommitDate) : null;

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
                <p>
                    <strong>Privacy:</strong> Somatic does not collect, store, or transmit any personal data.
                </p>
                <hr />
                <h3>Version {versionString}</h3>
                <ul className="about-dialog__build-info">
                    <li>
                        <strong>Build date:</strong>{' '}
                        {!!buildInfo.buildDate ? <DateValue value={buildDate} /> : 'unknown'}
                    </li>
                    {buildInfo.lastCommitDate && <li>
                        <strong>Last commit date:</strong>{' '}
                        <DateValue value={lastCommitDate!} />
                    </li>}
                    {buildInfo.commitHash && <li>
                        <strong>Commit hash:</strong>{' '}
                        {buildInfo.commitHash}
                    </li>}
                </ul>
            </div>
            <div className="modal-dialog__footer">
                <Button
                    type="button"
                    onClick={onClose}
                >
                    Close
                </Button>
            </div>
        </ModalDialog>
    );
};
