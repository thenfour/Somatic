import React, {useEffect, useRef, useState} from 'react';

import {
    getPatternSideChannelValidationIssues,
    PATTERN_SIDE_CHANNEL_MAX_LENGTH,
} from '../models/pattern';
import {ModalDialog} from './basic/ModalDialog';
import {Button} from './Buttons/PushButton';
import './SideChannelDataEditorDialog.css';

export type SideChannelDataEditorDialogProps = {
    rowIndex: number | null;
    initialValue: string;
    onSave: (value: string) => void;
    onCancel: () => void;
};

function RunNextFrame(callback: () => void): () => void {
    const frame = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frame);
}

export const SideChannelDataEditorDialog: React.FC<SideChannelDataEditorDialogProps> = ({
    rowIndex,
    initialValue,
    onSave,
    onCancel,
}) => {
    const [draft, setDraft] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isOpen = rowIndex !== null;
    const issues = getPatternSideChannelValidationIssues(draft);

    useEffect(() => {
        if (!isOpen) return;

        setDraft(initialValue);

        // on open, focus.
        RunNextFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        });
    }, [isOpen, rowIndex]);

    const save = () => {
        if (issues.length > 0) return;
        onSave(draft);
    };

    return (
        <ModalDialog
            isOpen={isOpen}
            className="side-channel-editor-dialog"
            onBackdropClick={onCancel}
            ariaLabel={`Edit side-channel data for pattern row ${rowIndex ?? ''}`}
        >
            <div className="modal-dialog__body">
                <input
                    ref={inputRef}
                    className="side-channel-editor-input"
                    type="text"
                    value={draft}
                    maxLength={PATTERN_SIDE_CHANNEL_MAX_LENGTH}
                    aria-label="Side-channel data"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            save();
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            e.stopPropagation();
                            onCancel();
                        }
                    }}
                />
                {issues.map((issue) => (
                    <div key={issue} className="side-channel-editor-error">{issue}</div>
                ))}
            </div>
            <div className="modal-dialog__footer">
                <Button type="button" onClick={save} disabled={issues.length > 0}>Save</Button>
                <Button type="button" onClick={onCancel}>Cancel</Button>
            </div>
        </ModalDialog>
    );
};
