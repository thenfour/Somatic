import React from 'react';

const shortcuts: Array<{ key: string; action: string }> = [
    // Global shortcuts
    {
        key: 'Escape',
        action: 'Toggle edit mode + panic',
    },
    {
        key: '[ / ]',
        action: 'Octave down / up.',
    },
    {
        key: 'Shift+[ / Shift+]',
        action: 'instrument down / up.',
    },
    {
        key: 'Alt+0',
        action: 'Play song from beginning / Stop.',
    },
    {
        key: 'Alt+8',
        action: 'Play song from current pattern.',
    },
    {
        key: 'Alt+9',
        action: 'Play song from current position',
    },
    {
        key: 'Alt+1',
        action: 'Focus the pattern grid.',
    },
    {
        key: 'Alt+2',
        action: 'Toggle waveform editor panel.',
    },
    {
        key: 'Alt+3',
        action: 'Toggle instrument panel.',
    },
    {
        key: 'Alt+4',
        action: 'Toggle TIC-80 panel.',
    },

    // Pattern grid navigation
    {
        key: 'Ctrl+Arrow Left/Right/Up/Down',
        action: 'Jump over cells',
    },
    {
        key: 'Page Up / Down',
        action: 'Jump by highlight block size.',
    },
    {
        key: 'Home',
        action: 'Jump to first row (same column).',
    },
    {
        key: 'End',
        action: 'Jump to last row (same column).',
    },
    {
        key: 'Ctrl+Home',
        action: 'Jump to first row, first column.',
    },
    {
        key: 'Ctrl+End',
        action: 'Jump to last row, last column.',
    },
    {
        key: 'Enter',
        action: 'Preview the current row.',
    },

    // Pattern editing (when edit mode enabled)
    {
        key: '0-9, A-F',
        action: 'instrument (0-F) or effect parameters.',
    },
    {
        key: 'M, C, J, S, P, V, D',
        action: 'Effect commands.',
    },
    {
        key: '0 (on note cell)',
        action: 'Clear the note.',
    },
    {
        key: 'Shift+Backspace (on note)',
        action: 'Insert note cut (^^^).',
    },
    {
        key: 'Backspace',
        action: 'Clear the current field (note/inst/cmd/param).',
    },
    {
        key: 'Delete',
        action: 'Clear the entire cell (all columns).',
    },

    // Selection and clipboard
    {
        key: 'Mouse drag',
        action: 'Select multiple cells.',
    },
];

export const HelpPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => (
    <div className="help-panel" role="dialog" aria-label="Keyboard shortcuts">
        <h2>Keyboard shortcuts</h2>
        <table>
            <thead>
                <tr>
                    <th>Action</th>
                    <th>Key</th>
                </tr>
            </thead>
            <tbody>
                {shortcuts.map((item) => (
                    <tr key={item.key}>
                        <td className="shortcut-key">{item.key}</td>
                        <td>{item.action}</td>
                    </tr>
                ))}
            </tbody>
        </table>

        <div className="help-panel__actions">
            <button onClick={onClose}>Close</button>
        </div>
    </div>
);
