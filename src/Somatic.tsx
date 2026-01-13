import fileDialog from 'file-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveSync } from 'save-file';

import './AppStatusBar.css';
import './somatic.css';

import { LoopMode, SomaticTransportState } from './audio/backend';
import { Tic80AudioController } from './audio/controller';
import { importSongFromTicCartBytes } from './audio/import';
import { serializeSongToCart } from './audio/tic80_cart_serializer';
import { useAppInstancePresence } from './hooks/useAppPresence';
import { useClipboard } from './hooks/useClipboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useRenderAlarm } from './hooks/useRenderAlarm';
import { useWriteBehindEffect } from './hooks/useWriteBehindEffect';
import { GlobalActionId } from './keyb/ActionIds';
import { useShortcutManager } from './keyb/KeyboardShortcutManager';
import { useActionHandler } from './keyb/useActionHandler';
import { KeyboardActionNoteInput } from './midi/keyboard_action_input';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { AmigaModSubsystemFrontend } from './subsystem/AmigaMod/AmigaModSubsystemFrontend';
import { kSubsystem } from './subsystem/base/SubsystemBackendBase';
import { SomaticSubsystemFrontend } from './subsystem/base/SubsystemFrontendBase';
import { SidSubsystemFrontend } from './subsystem/Sid/SidSubsystemFrontend';
import { Tic80SubsystemFrontend } from './subsystem/tic80/tic80SubsystemFrontend';
import { AboutSomaticDialog } from './ui/AboutSomaticDialog';
import { AppStatusBar } from './ui/AppStatusBar';
import { ArrangementEditor } from './ui/ArrangementEditor';
import { useConfirmDialog } from './ui/basic/confirm_dialog';
import { DiscordLogo, GithubLogo } from './ui/basic/Socicon';
import { Tooltip } from './ui/basic/tooltip';
import { DebugPanel } from './ui/debug_panel';
import { DesktopMenu } from './ui/DesktopMenu/DesktopMenu';
import { EditorStateControls } from './ui/EditorStateControls';
import { EncodingUtilsPanel } from './ui/EncodingUtilsPanel';
import { InstrumentPanel } from './ui/instrument_editor';
import { InstrumentsPanel } from './ui/InstrumentsPanel';
import { Keyboard } from './ui/keyboard';
import { PatternGrid, PatternGridHandle } from './ui/pattern_grid';
import { PreferencesPanel } from './ui/preferences_panel';
import { SongSettingsPanel } from './ui/SongSettingsPanel';
import { SongStatsAppPanel, useSongStatsData } from './ui/SongStats';
import { StatusChips } from './ui/StatusChips';
import { Theme, ThemeEditorPanel } from './ui/theme_editor_panel';
import { Tic80Bridge, Tic80BridgeHandle } from './ui/Tic80Bridged';
import { useToasts } from './ui/toast_provider';
import { TransportControls } from './ui/TransportControls';
import { VersionAvatar } from './ui/VersionAvatar';
import { WaveformEditorPanel } from './ui/waveformEditor';
import { gLog } from './utils/logger';
import { OptimizeSong } from './utils/SongOptimizer';
import type { UndoSnapshot } from './utils/UndoStack';
import { UndoStack } from './utils/UndoStack';
import { numericRange } from './utils/utils';

const TIC80_FRAME_SIZES = [

    { id: 'small', label: 'Small', width: '256px', height: '144px' },// smaller than this and it disappears
    { id: 'medium', label: 'Medium', width: '512px', height: '288px' },
    { id: 'large', label: 'Large', width: '768px', height: '432px' },
] as const;

const TIC80_FRAME_DEFAULT_INDEX = 1;

type SongMutator = (song: Song) => void;
type SongChangeArgs = {
    mutator: SongMutator;
    description: string;
    /**
     * Whether this change should record an undo point.
     * Defaults to true; set to false for transient or programmatic changes.
     */
    undoable: boolean;
};
type EditorStateMutator = (state: EditorState) => void;
type PatternCellType = 'note' | 'instrument' | 'command' | 'param';


const DEFAULT_LOOP_STATE: { loopMode: LoopMode; lastNonOffLoopMode: LoopMode } = {
    loopMode: "off",
    lastNonOffLoopMode: "pattern",
};

const getActivePatternCellType = (): PatternCellType | null => {
    if (typeof document === 'undefined') return null;
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLElement)) return null;
    const cellType = active.getAttribute('data-cell-type');
    return cellType === 'note' || cellType === 'instrument' || cellType === 'command' || cellType === 'param'
        ? cellType
        : null;
};

const isEditingCommandOrParamCell = () => {
    const cellType = getActivePatternCellType();
    return cellType === 'command' || cellType === 'param' || cellType === 'instrument';
};


export const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const mgr = useShortcutManager<GlobalActionId>();
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const [disabledMidiDeviceIds, setDisabledMidiDeviceIds] = useLocalStorage<string[]>("somatic-disabledMidiDeviceIds", []);
    const [highlightSelectedInstrumentInPatternGrid, setHighlightSelectedInstrumentInPatternGrid] = useLocalStorage("somatic-highlightSelectedInstrumentInPatternGrid", true);
    const midiRef = React.useRef<MidiManager | null>(new MidiManager(disabledMidiDeviceIds));
    const keyboardNoteRef = React.useRef<KeyboardActionNoteInput | null>(null);
    const patternGridRef = React.useRef<PatternGridHandle | null>(null);
    const undoStackRef = React.useRef<UndoStack | null>(null);
    const audio = useMemo(() => new Tic80AudioController({ bridgeGetter: () => bridgeRef.current }), []);
    const { pushToast } = useToasts();
    const { confirm } = useConfirmDialog();
    const [song, setSong] = useLocalStorage<Song>(
        "somatic-song",
        () => new Song(),
        {
            serialize: (s) => s.toJSON(),
            deserialize: (raw) => Song.fromJSON(raw),
        }
    );

    const subsystemFrontendRef = React.useRef<SomaticSubsystemFrontend<Song> | null>(null);

    const appPresence = useAppInstancePresence("somatic");

    const [loopState, setLoopState] = useLocalStorage<{ loopMode: LoopMode; lastNonOffLoopMode: LoopMode }>(
        "somatic-loopState",
        DEFAULT_LOOP_STATE,
    );

    const [editorState, setEditorState] = useState(() => new EditorState(loopState));

    const [debugMode, setDebugMode] = useLocalStorage("somatic-debugMode", false);

    const [patternEditorOpen, setPatternEditorOpen] = useLocalStorage("somatic-patternEditorOpen", true);
    const [instrumentPanelOpen, setInstrumentPanelOpen] = useLocalStorage("somatic-instrumentPanelOpen", false);
    const [instrumentsPanelOpen, setInstrumentsPanelOpen] = useLocalStorage("somatic-instrumentsPanelOpen", true);
    const [waveformEditorPanelOpen, setWaveformEditorPanelOpen] = useLocalStorage("somatic-waveformEditorPanelOpen", false);
    const [tic80FrameSizeIndex, setTic80FrameSizeIndex] = useLocalStorage<number>("somatic-tic80FrameSizeIndex", TIC80_FRAME_DEFAULT_INDEX);
    const [showingOnScreenKeyboard, setShowingOnScreenKeyboard] = useLocalStorage("somatic-showOnScreenKeyboard", true);
    const [advancedEditPanelOpen, setAdvancedEditPanelOpen] = useLocalStorage("somatic-advancedEditPanelOpen", false);
    const [midiEnabled, setMidiEnabled] = useLocalStorage("somatic-midiEnabled", true);
    const [keyboardEnabled, setKeyboardEnabled] = useLocalStorage("somatic-keyboardEnabled", true);
    const [songStatsPanelOpen, setSongStatsPanelOpen] = useLocalStorage("somatic-songStatsPanelOpen", false);
    const [songSettingsPanelOpen, setSongSettingsPanelOpen] = useLocalStorage("somatic-songSettingsPanelOpen", false);
    const [encodingUtilsPanelOpen, setEncodingUtilsPanelOpen] = useLocalStorage("somatic-encodingUtilsPanelOpen", false);

    const [preferencesPanelOpen, setPreferencesPanelOpen] = useState(false);
    const [themePanelOpen, setThemePanelOpen] = useState(false);
    const [debugPanelOpen, setDebugPanelOpen] = useState(false);
    const [songStatsVariant, setSongStatsVariant] = useState<"debug" | "release">("release");
    const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [somaticTransportState, setSomaticTransportState] = useState<SomaticTransportState>(() => audio.getSomaticTransportState());
    const [bridgeReady, setBridgeReady] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const clipboard = useClipboard();

    const songStatsData = useSongStatsData(song, songStatsVariant);

    if (!undoStackRef.current) {
        undoStackRef.current = new UndoStack(200);
    }

    useEffect(() => {
        switch (song.subsystemType) {
            case kSubsystem.key.TIC80:
                subsystemFrontendRef.current = new Tic80SubsystemFrontend();
                break;
            case kSubsystem.key.AMIGAMOD:
                subsystemFrontendRef.current = new AmigaModSubsystemFrontend();
                break;
            case kSubsystem.key.SID:
                subsystemFrontendRef.current = new SidSubsystemFrontend();
                break;
            default:
                throw new Error(`Unsupported subsystem type: ${song.subsystemType}`);
        };
    }, [song.subsystemType]);

    useEffect(() => {
        midiRef.current?.setDisabledDeviceIds(disabledMidiDeviceIds);
    }, [disabledMidiDeviceIds]);

    const toggleEditingEnabled = () => updateEditorState((s) => s.setEditingEnabled(!s.editingEnabled));

    const toggleMidiEnabled = () => {
        const newEnabled = !midiEnabled;
        setMidiEnabled(newEnabled);
        midiRef.current?.setEnabled(newEnabled);
    };

    const toggleKeyboardEnabled = () => {
        const newEnabled = !keyboardEnabled;
        setKeyboardEnabled(newEnabled);
    };

    const cycleTic80FrameSize = () => {
        setTic80FrameSizeIndex((prev) => (prev + 1) % TIC80_FRAME_SIZES.length);
    };

    useEffect(() => {
        let animationFrameId: number;
        const poll = () => {
            // getMusicState() returns the same object instance when nothing changed,
            // so React will bail out of setState if the reference is unchanged.
            setSomaticTransportState(audio.getSomaticTransportState());
            animationFrameId = requestAnimationFrame(poll);
        };
        animationFrameId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(animationFrameId);
    }, [audio]);

    const getUndoSnapshot = useCallback(() => ({
        song: songRef.current.toData(),
        editor: editorRef.current.toData(),
    }), []);

    // auto-save to backend + localStorage
    const autoSave = useWriteBehindEffect<Song>(async (doc, { signal }) => {
        await audio.transmit({
            song: doc,
            reason: 'auto-save',
            audibleChannels: editorState.getAudibleChannels(doc),
            cursorChannelIndex: editorState.patternEditChannel,
            cursorRowIndex: editorState.patternEditRow,
            cursorSongOrder: editorState.activeSongPosition,
            loopMode: editorState.loopMode,
            patternSelection: editorState.patternSelection,
            songOrderSelection: editorState.selectedArrangementPositions,
            startPosition: editorState.activeSongPosition,
            startRow: editorState.patternEditRow,
        });
        localStorage.setItem('somatic-song', doc.toJSON());
    }, {
        debounceMs: 1000,//
        maxWaitMs: 2500,//
    });

    useRenderAlarm({
        name: 'App',
    });

    const applyUndoSnapshot = useCallback((snapshot: UndoSnapshot) => {
        autoSave.flush();
        const nextSong = Song.fromData(snapshot.song);
        const nextEditor = EditorState.fromData(snapshot.editor);
        setSong(nextSong);
        setEditorState(nextEditor);
        setLoopState({
            loopMode: nextEditor.loopMode,
            lastNonOffLoopMode: nextEditor.lastNonOffLoopMode,
        });
    }, [autoSave, setLoopState]);

    const ensureUndoSnapshot = useCallback((description: string) => {
        undoStackRef.current?.record(description, getUndoSnapshot);
    }, [getUndoSnapshot]);
    const updateSong = useCallback(({ mutator, description, undoable = true }: SongChangeArgs) => {
        if (undoable) {
            ensureUndoSnapshot(description);
        }
        setSong((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
    }, [ensureUndoSnapshot]);

    const updateEditorState = useCallback((mutator: EditorStateMutator) => {
        setEditorState((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
    }, []);

    const handleUndo = useCallback(() => {
        const stack = undoStackRef.current;
        if (!stack) return;
        const entry = stack.undo(getUndoSnapshot);
        if (!entry) {
            pushToast({ message: 'Nothing to undo.', variant: 'info' });
            return;
        }
        applyUndoSnapshot(entry.snapshot);
    }, [applyUndoSnapshot, getUndoSnapshot, pushToast]);

    const handleRedo = useCallback(() => {
        const stack = undoStackRef.current;
        if (!stack) return;
        const entry = stack.redo(getUndoSnapshot);
        if (!entry) {
            pushToast({ message: 'Nothing to redo.', variant: 'info' });
            return;
        }
        applyUndoSnapshot(entry.snapshot);
    }, [applyUndoSnapshot, getUndoSnapshot, pushToast]);

    useEffect(() => {
        autoSave.enqueue(song);
        autoSave.flush();
    }, [audio]);

    useEffect(() => {
        autoSave.enqueue(song);
    }, [song]);

    const songRef = React.useRef(song);
    const editorRef = React.useRef(editorState);

    useEffect(() => { songRef.current = song; }, [song]);
    useEffect(() => { editorRef.current = editorState; }, [editorState]);

    const handleIncomingNoteOn = useCallback((note: number) => {
        const s = songRef.current;
        const ed = editorRef.current;
        const channel = ed.patternEditChannel;
        const skipNoteEntry = isEditingCommandOrParamCell();
        autoSave.flush(); // immediately apply changes to instrument; user is playing a note maybe testing their tweaks.
        audio.sfxNoteOn(s, ed.currentInstrument, note, ed.patternEditChannel);

        if (ed.editingEnabled !== false && !skipNoteEntry) {
            const currentPosition = Math.max(0, Math.min(s.songOrder.length - 1, ed.activeSongPosition || 0));
            const currentPatternIndex = s.songOrder[currentPosition].patternIndex ?? 0;
            const rowsPerPattern = s.rowsPerPattern;
            const patternEditStep = s.patternEditStep;

            updateSong({
                description: 'Insert note',
                undoable: true,
                mutator: (newSong) => {
                    const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, newSong.patterns.length - 1));
                    const pat = newSong.patterns[safePatternIndex];
                    const existingCell = pat.getCell(channel, ed.patternEditRow);
                    pat.setCell(channel, ed.patternEditRow, { ...existingCell, midiNote: note, instrumentIndex: ed.currentInstrument });
                },
            });
            setEditorState((prev) => {
                const next = prev.clone();
                next.advancePatternEditRow(patternEditStep, rowsPerPattern);
                patternGridRef.current?.focusCellAdvancedToRow(next.patternEditRow);
                return next;
            });
        }
    }, [audio, autoSave, updateSong]);

    const handleIncomingNoteOff = useCallback((note: number) => {
        //autoSave.flush();
        audio.sfxNoteOff(note);
    }, [audio, autoSave]);

    // Register note handlers once for each source (MIDI + keyboard).
    useEffect(() => {
        if (!keyboardNoteRef.current) {
            keyboardNoteRef.current = new KeyboardActionNoteInput({
                shortcutMgr: { registerHandler: mgr.registerHandler },
                getOctave: () => editorRef.current.octave,
                shouldIgnoreKeyDown: () => isEditingCommandOrParamCell(),
            });
            keyboardNoteRef.current.init();
        }

        const cleanups: Array<() => void> = [];
        if (midiRef.current) {
            cleanups.push(midiRef.current.onNoteOn((evt) => handleIncomingNoteOn(evt.note)));
            cleanups.push(midiRef.current.onNoteOff((evt) => handleIncomingNoteOff(evt.note)));
        }
        if (keyboardNoteRef.current) {
            cleanups.push(keyboardNoteRef.current.onNoteOn((evt) => handleIncomingNoteOn(evt.note)));
            cleanups.push(keyboardNoteRef.current.onNoteOff((evt) => handleIncomingNoteOff(evt.note)));
        }

        return () => {
            cleanups.forEach((fn) => fn());
        };
    }, [handleIncomingNoteOff, handleIncomingNoteOn, mgr.registerHandler]);

    // Keep sources enabled/disabled in sync.
    useEffect(() => {
        midiRef.current?.setEnabled(midiEnabled);
    }, [midiEnabled]);

    useEffect(() => {
        keyboardNoteRef.current?.setEnabled(keyboardEnabled);
    }, [keyboardEnabled]);

    useEffect(() => {
        const midi = midiRef.current;
        if (!midi) return;

        let offDevices: (() => void) | null = null;

        midi.init().then(() => {
            setMidiStatus(midi.getStatus());
            setMidiDevices(midi.getDevices());

            offDevices = midi.onDevicesChanged((list) => {
                setMidiDevices(list);
                setMidiStatus(midi.getStatus());
            });
        });

        return () => {
            offDevices?.();
        };
    }, [audio]);

    // handlers for clicking the keyboard view note on / off
    const handleNoteOn = (midiNote: number) => {
        autoSave.flush();
        audio.sfxNoteOn(song, editorState.currentInstrument, midiNote, editorState.patternEditChannel);
    };

    const handleNoteOff = (midiNote: number) => {
        //autoSave.flush();
        audio.sfxNoteOff(midiNote);
    };

    const createNewSong = async () => {
        const confirmed = await confirm({
            content: (
                <div>
                    <p>Create a new song? Your current song will be replaced.</p>
                    <p>Make sure you've saved your work first!</p>
                </div>
            ),
            defaultAction: 'no',
            yesLabel: 'Create New',
            noLabel: 'Cancel',
        });

        if (!confirmed) return;

        setSong(new Song());
        updateEditorState((s) => {
            s.setActiveSongPosition(0);
        });
        undoStackRef.current?.clear();
        pushToast({ message: 'New song created.', variant: 'success' });
    };

    const openSongFile = async () => {
        const files = (await fileDialog()) as FileList | File[] | undefined;
        const fileArray = files ? Array.from(files as any) : [];
        const file = fileArray[0] as File | undefined;
        if (!file) return;
        const text = await file.text();
        const loaded = Song.fromJSON(text);
        setSong(loaded);
        updateEditorState((s) => {
            s.setActiveSongPosition(0);
        });
        undoStackRef.current?.clear();
    };

    const importTicCartFile = async () => {
        const files = (await fileDialog({ accept: '.tic' })) as FileList | File[] | undefined;
        const fileArray = files ? Array.from(files as any) : [];
        const file = fileArray[0] as File | undefined;
        if (!file) return;

        try {
            const buf = await file.arrayBuffer();
            const { song: importedSong, warnings } = importSongFromTicCartBytes(new Uint8Array(buf), { fileName: file.name });

            setSong(importedSong);
            updateEditorState((s) => {
                s.setActiveSongPosition(0);
            });
            undoStackRef.current?.clear();

            pushToast({ message: 'TIC-80 cartridge imported.', variant: 'success' });
            if (warnings.length > 0) {
                console.warn('Import warnings:', warnings);
                pushToast({ message: `Imported with ${warnings.length} warning(s). See console.`, variant: 'info' });
            }
        } catch (err) {
            console.error('Import failed', err);
            const msg = err instanceof Error ? err.message : 'Unknown error';
            pushToast({ message: `Failed to import .tic: ${msg}`, variant: 'error' });
        }
    };

    const saveSongFile = () => {
        saveSync(song.toJSON(), song.getFilename(".somatic"));
    };

    const exportCart = (variant: "debug" | "release") => {
        const cartData = serializeSongToCart(song, true, variant, editorState.getAudibleChannels(song));

        // Create a Blob from the Uint8Array
        const blob = new Blob([cartData as any /* workaround for Blob constructor typing */], { type: 'application/octet-stream' });

        // Create a temporary download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = song.getFilename(".tic");

        // Trigger the download
        document.body.appendChild(link);
        link.click();

        // Clean up
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        //pushToast({ message: 'TIC-80 cartridge exported.', variant: 'success' });
    };

    const optimizeSong = async () => {
        if (!await confirm({
            content: <p>Optimize the song to remove unused patterns, waveforms, and SFX?</p>,
        })) {
            return;
        }
        const result = OptimizeSong(song);
        console.log(result);
        ensureUndoSnapshot('Optimize song');
        setSong(result.optimizedSong.clone());
    };

    const copyNative = async () => {
        await clipboard.copyTextToClipboard(song.toJSON());
    };

    const pasteSong = async () => {
        try {
            const text = await clipboard.readTextFromClipboard();
            const loaded = Song.fromJSON(text);
            ensureUndoSnapshot('Paste song JSON');
            setSong(loaded);
            updateEditorState((s) => {
                s.setActiveSongPosition(0);
            });
        } catch (err) {
            console.error('Paste failed', err);
            pushToast({ message: 'Failed to paste song from clipboard. Ensure it is valid song JSON.', variant: 'error' });
        }
    };

    const onPanic = () => {
        //setTransportState('stop');
        audio.panic();
    };

    const playSongWithFlush = useCallback(async (reason: string, startPosition: number, startRow: number) => {
        gLog.info(`playSongWithFlush: song is ${somaticTransportState.isPlaying ? 'playing' : 'stopped'}`);
        if (somaticTransportState.isPlaying) {
            audio.panic();
        } else {
            audio.transmitAndPlay({
                reason,
                song: songRef.current,
                cursorSongOrder: editorRef.current.activeSongPosition,
                cursorChannelIndex: editorRef.current.patternEditChannel,
                cursorRowIndex: editorRef.current.patternEditRow,
                patternSelection: editorRef.current.patternSelection,
                audibleChannels: editorRef.current.getAudibleChannels(songRef.current),
                startPosition,
                startRow,
                loopMode: editorRef.current.loopMode,
                songOrderSelection: editorRef.current.selectedArrangementPositions,
            });
        }
    }, [audio, somaticTransportState]);

    const onPlayPattern = () => {
        const ed = editorRef.current;
        void playSongWithFlush("play pattern", ed.activeSongPosition, 0);
    };

    const onPlayAll = () => {
        void playSongWithFlush("play all", 0, 0);
    };

    const onPlayFromPosition = () => {
        const ed = editorRef.current;
        void playSongWithFlush("play from position", ed.activeSongPosition, ed.patternEditRow);
    };

    useActionHandler<GlobalActionId>("ToggleDebugMode", () => setDebugMode(d => !d));
    useActionHandler("Panic", onPanic);
    useActionHandler("Undo", handleUndo);
    useActionHandler("Redo", handleRedo);
    useActionHandler("TogglePreferencesPanel", () => setPreferencesPanelOpen(open => !open));
    useActionHandler("ToggleDebugPanel", () => setDebugPanelOpen(open => !open));
    useActionHandler("FocusPattern", () => patternGridRef.current?.focusPattern());
    useActionHandler("ToggleWaveformEditor", () => setWaveformEditorPanelOpen(open => !open));
    useActionHandler("ToggleInstrumentPanel", () => setInstrumentPanelOpen(open => !open));
    useActionHandler("ToggleInstrumentsPanel", () => setInstrumentsPanelOpen(open => !open));
    useActionHandler("CycleTic80PanelSize", () => cycleTic80FrameSize());
    useActionHandler("ToggleOnScreenKeyboard", () => setShowingOnScreenKeyboard(open => !open));
    useActionHandler("ToggleAdvancedEditPanel", () => setAdvancedEditPanelOpen(open => !open));
    mgr.useActionHandler("TogglePatternEditor", () => {
        setPatternEditorOpen(open => !open);
    });
    mgr.useActionHandler("ToggleEncodingUtilsPanel", () => {
        setEncodingUtilsPanelOpen(open => !open);
    });
    useActionHandler("PlaySong", onPlayAll);
    useActionHandler("PlayFromPosition", onPlayFromPosition);
    useActionHandler("PlayPattern", onPlayPattern);
    useActionHandler("ToggleEditMode", toggleEditingEnabled);
    useActionHandler("DecreaseOctave", () => updateEditorState((s) => s.setOctave(s.octave - 1)));
    useActionHandler("IncreaseOctave", () => updateEditorState((s) => s.setOctave(s.octave + 1)));
    useActionHandler("DecreaseInstrument", () => updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument - 1)));
    useActionHandler("IncreaseInstrument", () => updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument + 1)));
    useActionHandler("IncreaseEditStep", () => updateSong({
        description: 'Increase edit step',//
        undoable: true,
        mutator: (s) => s.setPatternEditStep(s.patternEditStep + 1)
    }));
    useActionHandler("DecreaseEditStep", () => updateSong({
        description: 'Decrease edit step',
        undoable: true,
        mutator: (s) => s.setPatternEditStep(Math.max(0, s.patternEditStep - 1))
    }));
    useActionHandler("IncreaseTempo", () => updateSong({
        description: 'Increase tempo',
        undoable: true,
        mutator: (s) => s.setTempo(Math.min(240, s.tempo + 1))
    }));
    useActionHandler("DecreaseTempo", () => updateSong({
        description: 'Decrease tempo',
        undoable: true,
        mutator: (s) => s.setTempo(Math.max(1, s.tempo - 1))
    }));
    useActionHandler("IncreaseSpeed", () => updateSong({
        description: 'Increase speed',
        undoable: true,
        mutator: (s) => s.setSpeed(Math.min(31, s.speed + 1))
    }));
    useActionHandler("DecreaseSpeed", () => updateSong({
        description: 'Decrease speed',
        undoable: true,
        mutator: (s) => s.setSpeed(Math.max(1, s.speed - 1))
    }));
    useActionHandler("NextSongOrder", () => {
        const nextPos = Math.min(song.songOrder.length - 1, editorState.activeSongPosition + 1);
        updateEditorState((s) => s.setActiveSongPosition(nextPos));
    });
    useActionHandler("PreviousSongOrder", () => {
        const prevPos = Math.max(0, editorState.activeSongPosition - 1);
        updateEditorState((s) => s.setActiveSongPosition(prevPos));
    });
    useActionHandler("ToggleKeyboardNoteInput", toggleKeyboardEnabled);
    useActionHandler("ToggleMidiNoteInput", toggleMidiEnabled);

    useActionHandler("ToggleMuteChannel1", () => {
        updateEditorState((s) => s.setChannelMute(0, !s.isChannelExplicitlyMuted(0)));
    });
    useActionHandler("ToggleMuteChannel2", () => {
        updateEditorState((s) => s.setChannelMute(1, !s.isChannelExplicitlyMuted(1)));
    });
    useActionHandler("ToggleMuteChannel3", () => {
        updateEditorState((s) => s.setChannelMute(2, !s.isChannelExplicitlyMuted(2)));
    });
    useActionHandler("ToggleMuteChannel4", () => {
        updateEditorState((s) => s.setChannelMute(3, !s.isChannelExplicitlyMuted(3)));
    });
    useActionHandler("ToggleSoloChannel1", () => {
        updateEditorState((s) => s.setChannelSolo(0, !s.isChannelExplicitlySoloed(0)));
    });
    useActionHandler("ToggleSoloChannel2", () => {
        updateEditorState((s) => s.setChannelSolo(1, !s.isChannelExplicitlySoloed(1)));
    });
    useActionHandler("ToggleSoloChannel3", () => {
        updateEditorState((s) => s.setChannelSolo(2, !s.isChannelExplicitlySoloed(2)));
    });
    useActionHandler("ToggleSoloChannel4", () => {
        updateEditorState((s) => s.setChannelSolo(3, !s.isChannelExplicitlySoloed(3)));
    });
    useActionHandler("UnmuteUnsoloAllChannels", () => {
        updateEditorState((s) => {
            const channelIndices = numericRange(0, song.subsystem.channelCount - 1);
            channelIndices.forEach((ch) => {
                s.setChannelMute(ch, false);
                s.setChannelSolo(ch, false);
            });
        });
    });
    useActionHandler("ExportCartRelease", () => exportCart('release'));
    useActionHandler("TransposeSelectionDownSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-1, { scope: 'selection', instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionUpSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(1, { scope: 'selection', instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionDownOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-12, { scope: 'selection', instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionUpOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(12, { scope: 'selection', instrumentIndex: null });
    });
    useActionHandler("IncrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(1, { scope: 'selection', instrumentIndex: null });
    });
    useActionHandler("DecrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(-1, { scope: 'selection', instrumentIndex: null });
    });
    mgr.useActionHandler("ToggleCartStatsPanel", () => {
        setSongStatsPanelOpen(open => !open);
    });
    mgr.useActionHandler("ToggleSongSettingsPanel", () => {
        setSongSettingsPanelOpen(open => !open);
    });
    mgr.useActionHandler("ExportReleaseBuild", () => {
        exportCart("release");
    });
    mgr.useActionHandler("ExportDebugBuild", () => {
        exportCart("debug");
    });

    useActionHandler("OpenFile", openSongFile);
    useActionHandler("ImportTicCart", () => { void importTicCartFile(); });
    useActionHandler("SaveFile", saveSongFile);
    useActionHandler("NewFile", createNewSong);

    const handleBridgeReady = React.useCallback((handle: Tic80BridgeHandle) => {
        // focus the pattern grid.
        patternGridRef.current?.focusPattern();
        setBridgeReady(true);
        autoSave.enqueue(song);
        autoSave.flush();
    }, [audio, song]);

    const handleDisconnectMidiDevice = (device: MidiDevice) => {
        setDisabledMidiDeviceIds((prev) => {
            if (prev.includes(device.id)) return prev;
            return [...prev, device.id];
        });
    };

    const handleEnableMidiDevice = (device: MidiDevice) => {
        setDisabledMidiDeviceIds((prev) => prev.filter((id) => id !== device.id));
    };

    return (
        <div className="app">
            <div className="stickyHeader appRow">
                <div className="menu">
                    <nav className="desktop-menu-bar">
                        <DesktopMenu.Bar>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>File</DesktopMenu.Trigger>
                                <DesktopMenu.Content>
                                    <DesktopMenu.Item
                                        onSelect={() => { void createNewSong(); }}
                                        shortcut={mgr.getActionBindingLabel("NewFile")}
                                    >
                                        New Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => { void openSongFile(); }}
                                        shortcut={mgr.getActionBindingLabel("OpenFile")}
                                    >
                                        Open Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => { void importTicCartFile(); }}
                                        shortcut={mgr.getActionBindingLabel("ImportTicCart")}
                                    >
                                        Import...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={saveSongFile}
                                        shortcut={mgr.getActionBindingLabel("SaveFile")}
                                    >
                                        Save Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => { void copyNative(); }}>Copy Song JSON</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => { void pasteSong(); }}>Paste Song JSON</DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Sub>
                                        <DesktopMenu.SubTrigger>Export Cart</DesktopMenu.SubTrigger>
                                        <DesktopMenu.SubContent>
                                            <DesktopMenu.Item
                                                onSelect={() => exportCart('debug')}
                                                shortcut={mgr.getActionBindingLabel("ExportDebugBuild")}
                                            >
                                                Debug Build
                                            </DesktopMenu.Item>
                                            <DesktopMenu.Item
                                                onSelect={() => exportCart('release')}
                                                shortcut={mgr.getActionBindingLabel("ExportReleaseBuild")}
                                            >
                                                Release Build
                                            </DesktopMenu.Item>
                                        </DesktopMenu.SubContent>
                                    </DesktopMenu.Sub>
                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>Edit</DesktopMenu.Trigger>
                                <DesktopMenu.Content>
                                    <DesktopMenu.Item
                                        onSelect={handleUndo}
                                        shortcut={mgr.getActionBindingLabel("Undo")}
                                        disabled={!undoStackRef.current || !undoStackRef.current.canUndo()}
                                    >
                                        {(() => {
                                            const stack = undoStackRef.current;
                                            const entry = stack?.peekUndo();
                                            return entry ? `Undo ${entry.description}` : 'Undo';
                                        })()}
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={handleRedo}
                                        shortcut={mgr.getActionBindingLabel("Redo")}
                                        disabled={!undoStackRef.current || !undoStackRef.current.canRedo()}
                                    >
                                        {(() => {
                                            const stack = undoStackRef.current;
                                            const entry = stack?.peekRedo();
                                            return entry ? `Redo ${entry.description}` : 'Redo';
                                        })()}
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => { void optimizeSong(); }}>Optimize Song...</DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={editorState.editingEnabled}
                                        onSelect={toggleEditingEnabled}
                                        shortcut={mgr.getActionBindingLabel("ToggleEditMode")}
                                    >
                                        Enable pattern editing
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={preferencesPanelOpen}
                                        onSelect={() => setPreferencesPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("TogglePreferencesPanel")}
                                    >
                                        Preferences
                                    </DesktopMenu.Item>
                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>View</DesktopMenu.Trigger>
                                <DesktopMenu.Content>
                                    <DesktopMenu.Item
                                        checked={songSettingsPanelOpen}
                                        onSelect={() => setSongSettingsPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleSongSettingsPanel")}
                                    >
                                        Song Settings
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={patternEditorOpen}
                                        onSelect={() => setPatternEditorOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("TogglePatternEditor")}
                                    >
                                        Pattern Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={advancedEditPanelOpen}
                                        onSelect={() => setAdvancedEditPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleAdvancedEditPanel")}
                                    >
                                        Advanced Edit Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={waveformEditorPanelOpen}
                                        onSelect={() => setWaveformEditorPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleWaveformEditor")}
                                    >
                                        Waveform Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={instrumentPanelOpen}
                                        onSelect={() => setInstrumentPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleInstrumentPanel")}
                                    >
                                        Instrument Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={instrumentsPanelOpen}
                                        onSelect={() => setInstrumentsPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleInstrumentsPanel")}
                                    >
                                        Instruments
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={showingOnScreenKeyboard}
                                        onSelect={() => setShowingOnScreenKeyboard(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleOnScreenKeyboard")}
                                    >
                                        On-Screen Keyboard
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={songStatsPanelOpen}
                                        onSelect={() => setSongStatsPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleCartStatsPanel")}
                                    >
                                        Export cartridge metrics
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={encodingUtilsPanelOpen}
                                        onSelect={() => setEncodingUtilsPanelOpen(open => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleEncodingUtilsPanel")}
                                    >
                                        Encoding Utilities
                                    </DesktopMenu.Item>
                                    {debugMode && <DesktopMenu.Divider />
                                    }
                                    {debugMode && <DesktopMenu.Item
                                        checked={themePanelOpen}
                                        onSelect={() => setThemePanelOpen((open) => !open)}
                                    >
                                        Theme Editor
                                    </DesktopMenu.Item>}
                                    {debugMode && <DesktopMenu.Item
                                        checked={debugPanelOpen}
                                        onSelect={() => setDebugPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleDebugPanel")}
                                    >
                                        Debug Panel
                                    </DesktopMenu.Item>}
                                    <DesktopMenu.Item
                                        checked={tic80FrameSizeIndex !== 0}
                                        closeOnSelect={false}
                                        onSelect={() => cycleTic80FrameSize()}
                                        shortcut={mgr.getActionBindingLabel("CycleTic80PanelSize")}
                                    >
                                        TIC-80 Size
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={theme === 'dark'}
                                        onSelect={onToggleTheme}
                                    >
                                        Dark Theme
                                    </DesktopMenu.Item>
                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>Help</DesktopMenu.Trigger>
                                <DesktopMenu.Content>
                                    <DesktopMenu.Item onSelect={() => window.open('https://tic80.com/', '_blank', 'noopener')}>TIC-80 Homepage</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/nesbox/TIC-80/wiki/Music-Editor', '_blank', 'noopener')}>TIC-80 Music Editor</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/nesbox/TIC-80/wiki/ram', '_blank', 'noopener')}>TIC-80 memory map</DesktopMenu.Item>

                                    <DesktopMenu.Divider />

                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/thenfour/Somatic', '_blank', 'noopener')}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            Visit Project on GitHub
                                            <GithubLogo />
                                        </div>
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://discord.gg/kkf9gQfKAd', '_blank', 'noopener')}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            Discord
                                            <DiscordLogo />
                                        </div>
                                    </DesktopMenu.Item>

                                    <DesktopMenu.Item onSelect={() => window.open('https://ko-fi.com/E1E71QVJ5Z', '_blank', 'noopener')}>
                                        <div style={{ maxWidth: 300, marginBottom: 8 }}>Somatic is free, a labor of love by tenfour; if you find it useful, please support by spreading the word or:</div>
                                        <img height='36' style={{ border: 0, height: 36 }} src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' alt='Buy Me a Coffee at ko-fi.com' />
                                    </DesktopMenu.Item>

                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => setAboutOpen(true)}>About Somatic...</DesktopMenu.Item>

                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                        </DesktopMenu.Bar>
                    </nav>


                    <TransportControls
                        song={song}
                        bridgeReady={bridgeReady}
                        onPanic={onPanic}
                        onPlayAll={onPlayAll}
                        onPlayPattern={onPlayPattern}
                        onPlayFromPosition={onPlayFromPosition}
                        editorState={editorState}
                        updateEditorState={updateEditorState}
                        setLoopState={setLoopState}
                        somaticTransportState={somaticTransportState}
                    />

                    <Tooltip title={`Click to edit song settings${mgr.getActionBindingLabelAsTooltipSuffix("ToggleSongSettingsPanel")}`}>
                        <div className='raw-button header-song-title' onClick={() => setSongSettingsPanelOpen(x => !x)}>
                            {song.name}
                        </div>
                    </Tooltip>

                    {appPresence.otherInstanceActive && <div className="app-presence-contention-warning">
                        ⚠️You have multiple tabs open; that can cause conflicts
                    </div>}
                </div>

                <div className="app-header-row">
                    <EditorStateControls
                        song={song}
                        audio={audio}
                        editorState={editorState}
                        onSongChange={updateSong}
                        onEditorStateChange={updateEditorState}
                    />

                </div>

                {/* 
                <SongEditor
                    song={song}
                    audio={audio}
                    editorState={editorState}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                /> 
                */}
            </div>
            <div className="main-editor-area  appRow">
                <div className='leftAsideStack'>
                    <ArrangementEditor
                        song={song}
                        editorState={editorState}
                        musicState={somaticTransportState}
                        onEditorStateChange={updateEditorState}
                        onSongChange={updateSong}
                    />
                    {/* When booting (bridge ! ready), force a visible size so it can take focus and convince the browser to make the iframe run in high-performance; see #56 */}
                    {(() => {
                        const effectiveIndex = !bridgeReady ? TIC80_FRAME_DEFAULT_INDEX : tic80FrameSizeIndex;
                        const size = TIC80_FRAME_SIZES[effectiveIndex] ?? TIC80_FRAME_SIZES[TIC80_FRAME_DEFAULT_INDEX];
                        const frameStyle: React.CSSProperties = {
                            "--tic80-frame-width": size.width,
                            "--tic80-frame-height": size.height,
                        } as React.CSSProperties;
                        return (
                            <div className="tic80-frame" style={frameStyle}>
                                {/* <Tic80Iframe /> */}
                                <Tic80Bridge ref={bridgeRef} onReady={handleBridgeReady} />
                            </div>
                        );
                    })()}
                </div>
                {patternEditorOpen && (
                    <PatternGrid
                        ref={patternGridRef}
                        song={song}
                        audio={audio}
                        musicState={somaticTransportState}
                        editorState={editorState}
                        onEditorStateChange={updateEditorState}
                        onSongChange={updateSong}
                        advancedEditPanelOpen={advancedEditPanelOpen}
                        onSetAdvancedEditPanelOpen={open => setAdvancedEditPanelOpen(open)}
                        highlightSelectedInstrument={highlightSelectedInstrumentInPatternGrid}
                    />)}
                {songSettingsPanelOpen && (
                    <SongSettingsPanel
                        song={song}
                        audio={audio}
                        editorState={editorState}
                        onSongChange={updateSong}
                        onEditorStateChange={updateEditorState}
                        onClose={() => setSongSettingsPanelOpen(false)}
                    />
                )}
                {waveformEditorPanelOpen && (
                    <WaveformEditorPanel
                        song={song}
                        editorState={editorState}
                        onSongChange={updateSong}
                        onClose={() => setWaveformEditorPanelOpen(false)}
                    />
                )}
                {instrumentPanelOpen && (
                    <InstrumentPanel
                        song={song}
                        audio={audio}
                        currentInstrument={editorState.currentInstrument}
                        //onCurrentInstrumentChange={(inst) => updateEditorState((s) => s.setCurrentInstrument(inst))}
                        onSongChange={updateSong}
                        onClose={() => setInstrumentPanelOpen(false)}
                    />
                )}
                {instrumentsPanelOpen && (
                    <InstrumentsPanel
                        song={song}
                        editorState={editorState}
                        onSongChange={updateSong}
                        onEditorStateChange={updateEditorState}
                        onClose={() => setInstrumentsPanelOpen(false)}
                    />
                )}
                {songStatsPanelOpen && (
                    <SongStatsAppPanel
                        data={songStatsData}
                        onClose={() => setSongStatsPanelOpen(false)}
                        variant={songStatsVariant}
                        onVariantChange={setSongStatsVariant}
                    />
                )}

                {preferencesPanelOpen && (
                    <PreferencesPanel
                        midiStatus={midiStatus}
                        midiDevices={midiDevices}
                        disabledMidiDeviceIds={disabledMidiDeviceIds}
                        onClose={() => setPreferencesPanelOpen(false)}
                        onDisconnectMidiDevice={handleDisconnectMidiDevice}
                        onEnableMidiDevice={handleEnableMidiDevice}
                        highlightSelectedInstrumentInPatternGrid={highlightSelectedInstrumentInPatternGrid}
                        onSetHighlightSelectedInstrumentInPatternGrid={setHighlightSelectedInstrumentInPatternGrid}
                    />
                )}
                {themePanelOpen && (
                    <ThemeEditorPanel onClose={() => setThemePanelOpen(false)} />
                )}
                {encodingUtilsPanelOpen && (
                    <EncodingUtilsPanel onClose={() => setEncodingUtilsPanelOpen(false)} />
                )}
                {debugPanelOpen && (
                    <DebugPanel onClose={() => setDebugPanelOpen(false)} />
                )}
            </div>
            <div className="main-app-footer appRow">
                {showingOnScreenKeyboard && <Keyboard
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                />}

                <AppStatusBar
                    song={song}
                    editorState={editorState}
                    currentColumnType={editorState.patternEditColumnType}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                    rightContent={<>
                        <StatusChips
                            song={song}
                            bridgeReady={bridgeReady}
                            editorState={editorState}
                            toggleEditingEnabled={() => updateEditorState(s => s.setEditingEnabled(!s.editingEnabled))}
                            toggleSongStatsPanel={() => setSongStatsPanelOpen(open => !open)}
                            keyboardEnabled={keyboardEnabled}
                            toggleKeyboardEnabled={() => setKeyboardEnabled(enabled => !enabled)}
                            somaticTransportState={somaticTransportState}
                            songStatsData={songStatsData}
                            midiStatus={midiStatus}
                            midiDevices={midiDevices}
                            midiEnabled={midiEnabled}
                            disabledMidiDeviceIds={disabledMidiDeviceIds}
                            toggleMidiEnabled={() => setMidiEnabled(enabled => !enabled)}
                            audio={audio}
                            autoSave={autoSave}
                        />
                        <VersionAvatar
                            onClick={() => setAboutOpen(true)}
                            resolution={{ w: 6, h: 6 }}
                            scale={5}
                        />
                    </>
                    }
                />
            </div>
            <AboutSomaticDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </div>
    );
};
