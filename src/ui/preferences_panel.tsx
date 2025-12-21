import React from 'react';
import type { MidiDevice, MidiStatus } from '../midi/midi_manager';
import { KeyboardShortcutConfigurator } from '../keyb/KeyboardShortcutConfigurator';

interface MidiDeviceChipProps {
    device: MidiDevice;
    isEnabled: boolean;
    onDisconnect: () => void;
    onEnabled: () => void;
};

export const MidiDeviceChip: React.FC<MidiDeviceChipProps> = ({ device, isEnabled, onDisconnect, onEnabled }) => {


    const statusText = isEnabled ? device.state === "connected" ? 'Connected' : '?' : 'Disabled';

    return <div className="midi-device-chip">
        <strong>{device.name}</strong> {device.manufacturer ? `(${device.manufacturer})` : ''} - {statusText}
        {isEnabled ? <button onClick={onDisconnect}>Disconnect</button> : <button onClick={onEnabled}>Enable</button>}
    </div>
};

type PreferencesPanelProps = {
    midiStatus: MidiStatus;
    midiDevices: MidiDevice[];
    disabledMidiDeviceIds: string[];
    onClose: () => void;
    onDisconnectMidiDevice: (device: MidiDevice) => void;
    onEnableMidiDevice: (device: MidiDevice) => void;
};


export const PreferencesPanel: React.FC<PreferencesPanelProps> = ({ midiStatus, midiDevices, disabledMidiDeviceIds, onClose, onDisconnectMidiDevice, onEnableMidiDevice }) => (
    <div className="preferences-panel app-panel" role="dialog" aria-label="Preferences">
        <h2>Preferences</h2>

        <section>
            <h3>MIDI</h3>
            <p>Status: {midiStatus}</p>
            <ul>
                {midiDevices.length === 0 && <li>No MIDI devices detected.</li>}
                {midiDevices.map((d) => (
                    <li key={d.id}>
                        <MidiDeviceChip
                            device={d}
                            isEnabled={!disabledMidiDeviceIds.includes(d.id)}
                            onDisconnect={() => onDisconnectMidiDevice(d)}
                            onEnabled={() => onEnableMidiDevice(d)}
                        />
                    </li>
                ))}
            </ul>
        </section>

        <KeyboardShortcutConfigurator />

        <div className="preferences-panel__actions">
            <button onClick={onClose}>Close</button>
        </div>
    </div>
);
