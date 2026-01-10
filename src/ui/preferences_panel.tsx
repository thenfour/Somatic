import React from 'react';
import type { MidiDevice, MidiStatus } from '../midi/midi_manager';
import { KeyboardShortcutConfigurator } from '../keyb/KeyboardShortcutConfigurator';
import { AppPanelShell } from './AppPanelShell';
import { Button } from './Buttons/PushButton';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { CheckboxButton } from './Buttons/CheckboxButton';

interface MidiDeviceChipProps {
    device: MidiDevice;
    isEnabled: boolean;
    onDisconnect: () => void;
    onEnabled: () => void;
};

export const MidiDeviceChip: React.FC<MidiDeviceChipProps> = ({ device, isEnabled, onDisconnect, onEnabled }) => {
    // const connected = device.state === "connected";
    // const statusText = isEnabled
    //     ? (connected ? "Connected" : "Disconnected")
    //     : "Disabled";

    return (
        <div className="midi-device-chip">
            <div className="midi-device-chip__main">
                <div>
                    <strong>{device.name}</strong>
                    {device.manufacturer ? ` (${device.manufacturer})` : ''}
                </div>
                <div className="midi-device-chip__meta">
                    <span className={`badge ${isEnabled ? 'badge--ok' : 'badge--muted'}`}>{isEnabled ? 'listening' : 'disabled'}</span>
                </div>
            </div>
            <div className="midi-device-chip__actions">
                {isEnabled ? (
                    <button type="button" onClick={onDisconnect}>Disable</button>
                ) : (
                    <button type="button" onClick={onEnabled}>Enable</button>
                )}
            </div>
        </div>
    );
};

type PreferencesPanelProps = {
    midiStatus: MidiStatus;
    midiDevices: MidiDevice[];
    disabledMidiDeviceIds: string[];
    onClose: () => void;
    onDisconnectMidiDevice: (device: MidiDevice) => void;
    onEnableMidiDevice: (device: MidiDevice) => void;
    highlightSelectedInstrumentInPatternGrid: boolean;
    onSetHighlightSelectedInstrumentInPatternGrid: (enabled: boolean) => void;
};


export const PreferencesPanel: React.FC<PreferencesPanelProps> = ({ midiStatus, midiDevices, disabledMidiDeviceIds, onClose, onDisconnectMidiDevice, onEnableMidiDevice, highlightSelectedInstrumentInPatternGrid, onSetHighlightSelectedInstrumentInPatternGrid }) => (
    <AppPanelShell
        className="preferences-panel"
        onClose={onClose}
        role="dialog"
        ariaLabel="Preferences"
        title="Preferences"
    // actions={(
    //     <Button onClick={onClose}>Close</Button>
    // )}
    >
        <fieldset>
            <legend>Editor</legend>
            <ButtonGroup>
                <CheckboxButton
                    checked={highlightSelectedInstrumentInPatternGrid}
                    onChange={onSetHighlightSelectedInstrumentInPatternGrid}
                >
                    Highlight selected instrument in pattern editor
                </CheckboxButton>
            </ButtonGroup>
        </fieldset>
        <section>
            <h3>MIDI</h3>
            <div className="preferences-panel__summary">
                <div><strong>Status:</strong> {midiStatus}</div>
                <div><strong>Devices detected:</strong> {midiDevices.length}</div>
                <div><strong>Listening:</strong> {midiDevices.filter(d => !disabledMidiDeviceIds.includes(d.id)).length}</div>
                <div><strong>Disabled:</strong> {midiDevices.filter(d => disabledMidiDeviceIds.includes(d.id)).length}</div>
            </div>
            <div className="midi-device-list">
                {midiDevices.length === 0 && <div className="midi-device-list__empty">No MIDI devices detected.</div>}
                {midiDevices.map((d) => (
                    <MidiDeviceChip
                        key={d.id}
                        device={d}
                        isEnabled={!disabledMidiDeviceIds.includes(d.id)}
                        onDisconnect={() => onDisconnectMidiDevice(d)}
                        onEnabled={() => onEnableMidiDevice(d)}
                    />
                ))}
            </div>
        </section>

        <KeyboardShortcutConfigurator />
    </AppPanelShell>
);
