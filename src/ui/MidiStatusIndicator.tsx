import React, { useMemo } from 'react';
import { MidiDevice, MidiStatus } from '../midi/midi_manager';
import { Tooltip } from './tooltip';

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
    const connectedMidiInputs = useMemo(() => {
        return midiDevices.filter((d) => d.state === 'connected' && !disabledMidiDeviceIds.includes(d.id)).length;
    }, [midiDevices, disabledMidiDeviceIds]);

    const midiIndicatorState = midiStatus === 'ready'
        ? (midiEnabled ? (connectedMidiInputs > 0 ? 'ok' : 'warn') : 'off')
        : 'off';

    const midiIndicatorLabel = midiStatus === 'ready'
        ? (midiEnabled
            ? (connectedMidiInputs > 0 ? `MIDI (${connectedMidiInputs})` : 'MIDI ready (no devices)')
            : 'MIDI off')
        : midiStatus === 'pending'
            ? 'MIDI initializing'
            : midiStatus === 'unsupported'
                ? 'MIDI unsupported'
                : midiStatus === 'denied'
                    ? 'MIDI access denied'
                    : 'MIDI error';

    const connectedDevices = useMemo(() => {
        return midiDevices.filter((d) => d.state === 'connected' && !disabledMidiDeviceIds.includes(d.id));
    }, [midiDevices, disabledMidiDeviceIds]);

    const tooltipContent = (
        <div>
            <div>
                <strong>{midiIndicatorLabel}</strong>
                {shortcutLabel && <span>({shortcutLabel})</span>}
            </div>
            {midiStatus === 'ready' && midiEnabled && (
                <>
                    {connectedDevices.length > 0 ? (
                        <div>
                            <div>Connected devices:</div>
                            <ul>
                                {connectedDevices.map((device) => (
                                    <li key={device.id}>
                                        {device.name}
                                        {device.manufacturer && ` (${device.manufacturer})`}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <div>No devices connected</div>
                    )}
                </>
            )}
            <div>
                Click to {midiEnabled ? 'disable' : 'enable'}
            </div>
        </div>
    );

    const ariaLabel = midiEnabled && connectedMidiInputs > 0
        ? `${midiIndicatorLabel}: ${connectedMidiInputs} input${connectedMidiInputs === 1 ? '' : 's'} connected. Click to disable.`
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
