import { SomaticTransportState } from "../audio/backend";
import { AudioController } from "../audio/controller";
import { WriteBehind } from "../hooks/useWriteBehindEffect";
import { GlobalActionId } from "../keyb/ActionIds";
import { useShortcutManager } from "../keyb/KeyboardShortcutManager";
import { MidiDevice, MidiStatus } from "../midi/midi_manager";
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { DotIndicator } from "./basic/DotIndicator";
import { Tooltip } from "./basic/tooltip";
import { Button } from "./Buttons/PushButton";
import { MidiStatusIndicator } from "./MidiStatusIndicator";
import { MusicStateDisplay } from "./MusicStateDisplay";
import { SongStats, SongStatsData } from "./SongStats";

import "./StatusChips.css";



interface StatusChipsProps {
    song: Song;
    bridgeReady: boolean;
    editorState: EditorState;
    toggleEditingEnabled: () => void;
    toggleSongStatsPanel: () => void;
    keyboardEnabled: boolean;
    toggleKeyboardEnabled: () => void;
    somaticTransportState: SomaticTransportState;
    songStatsData: SongStatsData;
    midiStatus: MidiStatus;
    midiDevices: MidiDevice[];
    midiEnabled: boolean;
    disabledMidiDeviceIds: string[];
    toggleMidiEnabled: () => void;
    audio: AudioController;
    autoSave: WriteBehind<Song>;
};

export const StatusChips: React.FC<StatusChipsProps> = ({ song,//
    bridgeReady, editorState,//
    toggleEditingEnabled, toggleSongStatsPanel, keyboardEnabled, toggleKeyboardEnabled,//
    somaticTransportState, songStatsData,
    midiStatus, midiDevices, midiEnabled, disabledMidiDeviceIds, toggleMidiEnabled,
    audio, autoSave,
}) => {
    const mgr = useShortcutManager<GlobalActionId>();

    const keyboardIndicatorState = keyboardEnabled ? 'ok' : 'off';
    //const keyboardIndicatorLabel = keyboardEnabled ? 'Keyb note inp' : 'Keyb off';
    const keyboardIndicatorTitle = keyboardEnabled ? 'Keyboard note input enabled. Click to disable.' : 'Keyboard note input disabled. Click to enable.';

    return <div className="status-chips">
        <Tooltip title={`Toggle pattern edit mode (${mgr.getActionBindingLabel("ToggleEditMode")})`}>
            <Button
                className={`edit-toggle ${editorState.editingEnabled ? 'edit-toggle--on' : 'edit-toggle--off'}`}
                onClick={toggleEditingEnabled}
                aria-pressed={editorState.editingEnabled}
                aria-label={editorState.editingEnabled ? 'Disable editing in pattern editor' : 'Enable editing in pattern editor'}
            >
                {/* <span className="edit-toggle__dot" aria-hidden="true" /> */}
                <DotIndicator active={editorState.editingEnabled} />
                <span className={`edit-toggle__label`}>Pat edit</span>
            </Button>
        </Tooltip>
        <MidiStatusIndicator
            midiStatus={midiStatus}
            midiDevices={midiDevices}
            midiEnabled={midiEnabled}
            disabledMidiDeviceIds={disabledMidiDeviceIds}
            onToggleMidiEnabled={toggleMidiEnabled}
            shortcutLabel={mgr.getActionBindingLabel("ToggleMidiNoteInput")}
        />
        <Tooltip title={`${keyboardIndicatorTitle} (${mgr.getActionBindingLabel("ToggleKeyboardNoteInput")})`}>
            <Button
                className={`midi-indicator midi-indicator--${keyboardIndicatorState}`}
                title={keyboardIndicatorTitle}
                aria-label={keyboardIndicatorTitle}
                onClick={toggleKeyboardEnabled}
            >
                <DotIndicator active={keyboardEnabled} />
                <span className="midi-indicator__label">Keyb note inp</span>
            </Button>
        </Tooltip>
        <Tooltip title="Sync status with TIC-80 (auto-save)">
            <span className="autoSaveIndicator__label">sync:{autoSave.state.status}</span>
        </Tooltip>
        <SongStats
            data={songStatsData}
            onTogglePanel={toggleSongStatsPanel}
        />
        <MusicStateDisplay bridgeReady={bridgeReady} audio={audio} musicState={somaticTransportState} song={song} />
    </div>
};