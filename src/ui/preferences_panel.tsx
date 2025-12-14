import React from 'react';
import type { MidiDevice, MidiStatus } from '../midi/midi_manager';

type PreferencesPanelProps = {
    midiStatus: MidiStatus;
    midiDevices: MidiDevice[];
    onClose: () => void;
};

export const PreferencesPanel: React.FC<PreferencesPanelProps> = ({ midiStatus, midiDevices, onClose }) => (
    <div className="preferences-panel" role="dialog" aria-label="Preferences">
        <h2>Preferences</h2>

        <section>
            <h3>MIDI</h3>
            <p>Status: {midiStatus}</p>
            <ul>
                {midiDevices.length === 0 && <li>No MIDI devices detected.</li>}
                {midiDevices.map((d) => (
                    <li key={d.id}>
                        <strong>{d.name}</strong> {d.manufacturer ? `(${d.manufacturer})` : ''} — {d.state}
                    </li>
                ))}
            </ul>
        </section>

        <div className="preferences-panel__actions">
            <button onClick={onClose}>Close</button>
        </div>
    </div>
);
