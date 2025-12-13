import React from 'react';

const shortcuts: Array<{ key: string; action: string }> = [
    {
        key: 'Arrow keys',
        action: 'Move focus across the pattern grid.',
    },
    {
        key: 'Page Up / Down',
        action: 'Jump to the first or last row of the pattern.',
    },
    {
        key: '0-9 A-G',
        action: 'Pattern notes (piano layout)',
    },
    {
        key: '0-F',
        action: 'Instrument column',
    },
    {
        key: '0 (on note cell)',
        action: 'Clear a note while focused on the note cell.',
    },
    {
        key: 'Play menu buttons',
        action: 'Play Pattern / From Position / All, or Stop.',
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
