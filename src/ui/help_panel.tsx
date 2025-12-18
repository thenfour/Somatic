import React from 'react';

const shortcuts: Array<{ key: string; action: string }> = [
    // Global + transport
    {
        key: 'Escape',
        action: 'Toggle edit mode and panic (stop all sound).',
    },
    {
        key: '[ / ]',
        action: 'Octave down / up.',
    },
    {
        key: 'Shift+[ / Shift+]',
        action: 'Current instrument down / up.',
    },
    {
        key: 'Ctrl/Cmd+Z',
        action: 'Undo last edit (song + cursor).',
    },
    {
        key: 'Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y',
        action: 'Redo the last undone edit.',
    },
    {
        key: 'Alt+0',
        action: 'Play song from the beginning / Stop.',
    },
    {
        key: 'Alt+8',
        action: 'Play from the current pattern.',
    },
    {
        key: 'Alt+9',
        action: 'Play from the current song position & row.',
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
        action: 'Toggle TIC-80 bridge panel.',
    },
    {
        key: 'Alt+5',
        action: 'Toggle on-screen keyboard.',
    },

    // Pattern grid navigation
    {
        key: 'Arrow keys',
        action: 'Move between cells.',
    },
    {
        key: 'Ctrl+Arrow Left/Right',
        action: 'Jump to previous/next channel (same column).',
    },
    {
        key: 'Ctrl+Arrow Up/Down',
        action: 'Jump 4 rows up/down (wrap song order).',
    },
    {
        key: 'Page Up / Page Down',
        action: 'Jump by the highlight block size.',
    },
    {
        key: 'Home / End',
        action: 'Jump to first/last row (same column).',
    },
    {
        key: 'Ctrl+Home / Ctrl+End',
        action: 'Jump to top-left / bottom-right of the pattern.',
    },
    {
        key: 'Enter',
        action: 'Preview the current row.',
    },

    // Pattern editing (edit mode)
    {
        key: 'Computer keyboard (- Z S X ...)',
        action: 'Enter notes using the QWERTY piano layout.',
    },
    {
        key: '0-9, A-F',
        action: 'Enter instrument hex values or effect parameters.',
    },
    {
        key: 'M, C, J, S, P, V, D',
        action: 'Enter effect commands.',
    },
    {
        key: 'Shift+Backspace (note column)',
        action: 'Insert a note cut (^^^).',
    },
    {
        key: '0 (note column)',
        action: 'Clear the note.',
    },
    {
        key: 'Backspace',
        action: 'Clear the focused field (note/inst/cmd/param).',
    },
    {
        key: 'Delete',
        action: 'Clear the entire cell (all columns).',
    },

    // Selection + clipboard
    {
        key: 'Mouse drag',
        action: 'Select multiple cells.',
    },
    {
        key: 'Ctrl/Cmd+C or Ctrl+Insert',
        action: 'Copy selection to clipboard.',
    },
    {
        key: 'Ctrl/Cmd+V or Shift+Insert',
        action: 'Paste selection.',
    },
    {
        key: 'Ctrl/Cmd+X or Shift+Delete',
        action: 'Cut selection.',
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
