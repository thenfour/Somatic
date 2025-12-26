import React, { useMemo } from 'react';
import { MidiDevice, MidiStatus } from '../midi/midi_manager';
import { Tooltip } from './basic/tooltip';

interface MidiStatusIndicatorProps {
    midiStatus: MidiStatus;
    midiDevices: MidiDevice[];
    midiEnabled: boolean;
    disabledMidiDeviceIds: string[];
    onToggleMidiEnabled: () => void;
    shortcutLabel?: string;
}

export const MidiStatusIndicator: React.FC<MidiStatusIndicatorProps> = ({
    midiStatus,
    midiDevices,
    midiEnabled,
    disabledMidiDeviceIds,
    onToggleMidiEnabled,
    shortcutLabel,
}) => {
    const { connected, listening, connectedButDisabled } = useMemo(() => {
        const connectedDevices = midiDevices.filter((d) => d.state === 'connected');
        const connectedListening = midiEnabled
            ? connectedDevices.filter((d) => !disabledMidiDeviceIds.includes(d.id))
            : [];
        const connectedDisabled = connectedDevices.filter((d) => disabledMidiDeviceIds.includes(d.id));
        return {
            connected: connectedDevices,
            listening: connectedListening,
            connectedButDisabled: connectedDisabled,
        };
    }, [midiDevices, disabledMidiDeviceIds, midiEnabled]);

    const midiIndicatorState = midiStatus !== 'ready'
        ? 'off'
        : !midiEnabled
            ? 'off'
            : listening.length > 0
                ? 'ok'
                : 'warn';

    const midiIndicatorLabel = (() => {
        if (midiStatus === 'pending') return 'MIDI initializing';
        if (midiStatus === 'unsupported') return 'MIDI unsupported';
        if (midiStatus === 'denied') return 'MIDI access denied';
        if (midiStatus === 'error') return 'MIDI error';
        if (!midiEnabled) return 'MIDI off';
        if (listening.length > 0) return `MIDI listening (${listening.length}/${connected.length})`;
        if (connected.length > 0) return `MIDI ready (${connected.length} available, none listening)`;
        return 'MIDI ready (no devices)';
    })();

    const tooltipContent = (
        <div style={{ maxWidth: 360 }}>
            <div>
                <strong>{midiIndicatorLabel}</strong>
                {shortcutLabel && <span> ({shortcutLabel})</span>}
            </div>

            {midiStatus === 'ready' ? (
                <div style={{ marginTop: 6 }}>
                    <div>Listening: {midiEnabled ? listening.length : 0}</div>
                    <div>Available: {connected.length}</div>
                    <div>Available but disabled: {connectedButDisabled.length}</div>
                    <div>MIDI globally: {midiEnabled ? 'enabled' : 'disabled'}</div>
                    {connected.length === 0 && <div>No MIDI devices reported by the OS.</div>}
                    {connected.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                            <div>Devices:</div>
                            <ul>
                                {midiDevices.map((device) => {
                                    const isDisabled = disabledMidiDeviceIds.includes(device.id);
                                    return (
                                        <li key={device.id}>
                                            {device.name}{device.manufacturer ? ` (${device.manufacturer})` : ''}
                                            {` - ${isDisabled ? 'disabled in prefs' : (midiEnabled ? 'listening' : 'muted (global off)')}`}
                                            {!isDisabled && !midiEnabled && ' (muted)'}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
                </div>
            ) : (
                <div style={{ marginTop: 6 }}>
                    {midiStatus === 'pending' && 'Waiting for MIDI access...'}
                    {midiStatus === 'unsupported' && 'Web MIDI API not supported in this browser.'}
                    {midiStatus === 'denied' && 'Permission to use MIDI was denied.'}
                    {midiStatus === 'error' && 'An error occurred while initializing MIDI.'}
                </div>
            )}

            <div style={{ marginTop: 8 }}>
                Click to {midiEnabled ? 'disable' : 'enable'}
            </div>
        </div>
    );

    const ariaLabel = midiEnabled && listening.length > 0
        ? `${midiIndicatorLabel}: ${listening.length} input${listening.length === 1 ? '' : 's'} listening. Click to disable.`
        : midiEnabled
            ? `${midiIndicatorLabel}. Click to disable.`
            : `${midiIndicatorLabel}. Click to enable.`;

    return (
        <Tooltip title={tooltipContent}>
            <button
                className={`midi-indicator midi-indicator--${midiIndicatorState}`}
                aria-label={ariaLabel}
                onClick={onToggleMidiEnabled}
            >
                <span className="midi-indicator__dot" aria-hidden="true" />
                <span className="midi-indicator__label">{midiIndicatorLabel}</span>
            </button>
        </Tooltip>
    );
};
