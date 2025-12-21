import fileDialog from 'file-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveSync } from 'save-file';

import './AppStatusBar.css';
import './somatic.css';

import { AudioController } from './audio/controller';
import { serializeSongToCart } from './audio/tic80_cart_serializer';
import { useClipboard } from './hooks/useClipboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useWriteBehindEffect } from './hooks/useWriteBehindEffect';
import { KeyboardNoteInput } from './midi/keyboard_input';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { calculateBpm, calculateSongPositionInSeconds, gChannelsArray, ToTic80ChannelIndex } from './models/tic80Capabilities';
import { AppStatusBar } from './ui/AppStatusBar';
import { ArrangementEditor } from './ui/ArrangementEditor';
import { useConfirmDialog } from './ui/confirm_dialog';
import { DesktopMenu } from './ui/DesktopMenu';
import { InstrumentPanel } from './ui/instrument_editor';
import { Keyboard } from './ui/keyboard';
import { PatternGrid, PatternGridHandle } from './ui/pattern_grid';
import { PreferencesPanel } from './ui/preferences_panel';
import { SongEditor } from './ui/song_editor';
import { SongStats } from './ui/SongStats';
import { Theme, ThemeEditorPanel } from './ui/theme_editor_panel';
import { Tic80Bridge, Tic80BridgeHandle } from './ui/Tic80Bridged';
import { useToasts } from './ui/toast_provider';
import { Tooltip } from './ui/tooltip';
import { WaveformEditorPanel } from './ui/waveformEditor';
import { OptimizeSong } from './utils/SongOptimizer';
import type { UndoSnapshot } from './utils/UndoStack';
import { UndoStack } from './utils/UndoStack';
import { useActionHandler } from './keyb/useActionHandler';
import { useShortcutManager } from './keyb/KeyboardShortcutManager';
import { CharMap } from './utils/utils';
import { ShortcutScopeProvider } from './keyb/KeyboardShortcutScope';
import { useRenderAlarm } from './hooks/useRenderAlarm';
import { MusicStateDisplay } from './ui/MusicStateDisplay';
import { MidiStatusIndicator } from './ui/MidiStatusIndicator';
import { AboutSomaticDialog } from './ui/AboutSomaticDialog';
import { TransportTime } from './ui/transportTime';

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

const FPS_UPDATE_INTERVAL_MS = 500;

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
    const keyboardShortcutMgr = useShortcutManager();
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const [disabledMidiDeviceIds, setDisabledMidiDeviceIds] = useLocalStorage<string[]>("somatic-disabledMidiDeviceIds", []);
    const midiRef = React.useRef<MidiManager | null>(new MidiManager(disabledMidiDeviceIds));
    const keyboardRef = React.useRef<KeyboardNoteInput | null>(null);
    const patternGridRef = React.useRef<PatternGridHandle | null>(null);
    const undoStackRef = React.useRef<UndoStack | null>(null);
    const audio = useMemo(() => new AudioController({ bridgeGetter: () => bridgeRef.current }), []);
    const { pushToast } = useToasts();
    const { confirm } = useConfirmDialog();
    const [song, setSong] = useState(() => {
        try {
            const saved = localStorage.getItem('somatic-song');
            if (saved) {
                return Song.fromJSON(saved);
            }
        } catch (err) {
            console.error('Failed to load song from localStorage', err);
        }
        return new Song();
    });
    const [editorState, setEditorState] = useState(() => new EditorState());

    const [instrumentPanelOpen, setInstrumentPanelOpen] = useLocalStorage("somatic-instrumentPanelOpen", false);
    const [waveformEditorPanelOpen, setWaveformEditorPanelOpen] = useLocalStorage("somatic-waveformEditorPanelOpen", false);
    const [tic80PanelOpen, setTic80PanelOpen] = useLocalStorage("somatic-tic80PanelOpen", true);
    const [showingOnScreenKeyboard, setShowingOnScreenKeyboard] = useLocalStorage("somatic-showOnScreenKeyboard", true);
    const [showingArrangementEditor, setShowingArrangementEditor] = useLocalStorage("somatic-showArrangementEditor", true);
    const [advancedEditPanelOpen, setAdvancedEditPanelOpen] = useLocalStorage("somatic-advancedEditPanelOpen", false);
    const [midiEnabled, setMidiEnabled] = useLocalStorage("somatic-midiEnabled", true);
    const [keyboardEnabled, setKeyboardEnabled] = useLocalStorage("somatic-keyboardEnabled", true);

    const [preferencesPanelOpen, setPreferencesPanelOpen] = useState(false);
    const [themePanelOpen, setThemePanelOpen] = useState(false);
    const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [musicState, setMusicState] = useState(() => audio.getMusicState());
    const [bridgeReady, setBridgeReady] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const clipboard = useClipboard();

    if (!undoStackRef.current) {
        undoStackRef.current = new UndoStack(200);
    }

    useEffect(() => {
        midiRef.current?.setDisabledDeviceIds(disabledMidiDeviceIds);
    }, [disabledMidiDeviceIds]);

    const keyboardIndicatorState = keyboardEnabled ? 'ok' : 'off';
    const keyboardIndicatorLabel = keyboardEnabled ? 'Keyb note inp' : 'Keyb off';
    const keyboardIndicatorTitle = keyboardEnabled ? 'Keyboard note input enabled. Click to disable.' : 'Keyboard note input disabled. Click to enable.';

    const toggleEditingEnabled = () => updateEditorState((s) => s.setEditingEnabled(!s.editingEnabled));

    const toggleMidiEnabled = () => {
        const newEnabled = !midiEnabled;
        setMidiEnabled(newEnabled);
        midiRef.current?.setEnabled(newEnabled);
    };

    const toggleKeyboardEnabled = () => {
        const newEnabled = !keyboardEnabled;
        setKeyboardEnabled(newEnabled);
        keyboardRef.current?.setEnabled(newEnabled);
    };

    useEffect(() => {
        let animationFrameId: number;
        const poll = () => {
            setMusicState(audio.getMusicState());
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
        audio.transmitSong(doc, "Auto-save", editorState.getAudibleChannels());
        localStorage.setItem('somatic-song', doc.toJSON());
    }, {
        debounceMs: 1000,//
        maxWaitMs: 2500,//
        // onSuccess: () => {
        //     pushToast({
        //         message: 'Song auto-saved.', variant: 'info', durationMs: 1000
        //     });
        // }
    });

    useRenderAlarm({
        name: 'App',
    });

    const applyUndoSnapshot = useCallback((snapshot: UndoSnapshot) => {
        autoSave.flush();
        setSong(Song.fromData(snapshot.song));
        setEditorState(EditorState.fromData(snapshot.editor));
    }, [autoSave]);

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
        const channel = ToTic80ChannelIndex(ed.patternEditChannel);
        const skipNoteEntry = isEditingCommandOrParamCell();
        autoSave.flush();
        audio.sfxNoteOn(s, ed.currentInstrument, note, ed.patternEditChannel);

        if (ed.editingEnabled !== false && !skipNoteEntry) {
            const currentPosition = Math.max(0, Math.min(s.songOrder.length - 1, ed.activeSongPosition || 0));
            const currentPatternIndex = s.songOrder[currentPosition] ?? 0;
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
        autoSave.flush();
        audio.sfxNoteOff(note);
    }, [audio, autoSave]);

    // Register note handlers once for each source (MIDI + keyboard).
    useEffect(() => {
        if (!keyboardRef.current) {
            keyboardRef.current = new KeyboardNoteInput({ getOctave: () => editorRef.current.octave });
            keyboardRef.current.init();
        }

        const cleanups: Array<() => void> = [];
        if (midiRef.current) {
            cleanups.push(midiRef.current.onNoteOn((evt) => handleIncomingNoteOn(evt.note)));
            cleanups.push(midiRef.current.onNoteOff((evt) => handleIncomingNoteOff(evt.note)));
        }
        if (keyboardRef.current) {
            cleanups.push(keyboardRef.current.onNoteOn((evt) => handleIncomingNoteOn(evt.note)));
            cleanups.push(keyboardRef.current.onNoteOff((evt) => handleIncomingNoteOff(evt.note)));
        }

        return () => {
            cleanups.forEach((fn) => fn());
        };
    }, [handleIncomingNoteOff, handleIncomingNoteOn]);

    // Keep sources enabled/disabled in sync.
    useEffect(() => {
        midiRef.current?.setEnabled(midiEnabled);
    }, [midiEnabled]);

    useEffect(() => {
        keyboardRef.current?.setEnabled(keyboardEnabled);
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
        autoSave.flush();
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

    const saveSongFile = () => {
        saveSync(song.toJSON(), song.getFilename(".somatic"));
    };

    const exportCart = (variant: "debug" | "release") => {
        const cartData = serializeSongToCart(song, true, variant, editorState.getAudibleChannels());

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

    const onPlayPattern = () => {
        autoSave.flush();
        if (audio.getMusicState().isPlaying) {
            audio.panic();
        } else {
            audio.playSong(editorState.activeSongPosition, 0);
        }
    };

    const onPlayAll = () => {
        autoSave.flush();
        if (audio.getMusicState().isPlaying) {
            audio.panic();
        } else {
            audio.playSong(0, 0);
        }
    };

    const onPlayFromPosition = () => {
        autoSave.flush();
        if (audio.getMusicState().isPlaying) {
            audio.panic();
        } else {
            audio.playSong(editorState.activeSongPosition, editorState.patternEditRow);
        }
    };


    useActionHandler("Panic", onPanic);
    useActionHandler("Undo", handleUndo);
    useActionHandler("Redo", handleRedo);
    useActionHandler("TogglePreferencesPanel", () => setPreferencesPanelOpen(open => !open));
    useActionHandler("FocusPattern", () => patternGridRef.current?.focusPattern());
    useActionHandler("ToggleWaveformEditor", () => setWaveformEditorPanelOpen(open => !open));
    useActionHandler("ToggleInstrumentPanel", () => setInstrumentPanelOpen(open => !open));
    useActionHandler("ToggleTic80Panel", () => setTic80PanelOpen(open => !open));
    useActionHandler("ToggleOnScreenKeyboard", () => setShowingOnScreenKeyboard(open => !open));
    useActionHandler("ToggleArrangementEditor", () => setShowingArrangementEditor(open => !open));
    useActionHandler("ToggleAdvancedEditPanel", () => setAdvancedEditPanelOpen(open => !open));
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
            for (const ch of gChannelsArray) {
                s.setChannelMute(ch, false);
                s.setChannelSolo(ch, false);
            }
        });
    });
    useActionHandler("ExportCartRelease", () => exportCart('release'));
    useActionHandler("TransposeSelectionDownSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-1, 'selection');
    });
    useActionHandler("TransposeSelectionUpSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(1, 'selection');
    });
    useActionHandler("TransposeSelectionDownOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-12, 'selection');
    });
    useActionHandler("TransposeSelectionUpOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(12, 'selection');
    });
    useActionHandler("IncrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(1, 'selection');
    });
    useActionHandler("DecrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(-1, 'selection');
    });

    useActionHandler("OpenFile", openSongFile);
    useActionHandler("SaveFile", saveSongFile);
    useActionHandler("NewFile", createNewSong);

    const handleBridgeReady = React.useCallback((handle: Tic80BridgeHandle) => {
        //console.log('[App] Bridge ready, uploading current song');
        //audio.setSong(song, "Bridge ready; initial upload");
        // focus the pattern grid.
        patternGridRef.current?.focusPattern();
        setBridgeReady(true);
        autoSave.enqueue(song);
        autoSave.flush();
    }, [audio, song]);

    // useActionHandler("PlayStop", () => {
    //     if (audio.getMusicState().isPlaying) {
    //         onPanic();
    //     } else {
    //         onPlayFromPosition();
    //     }
    // });

    const handleDisconnectMidiDevice = (device: MidiDevice) => {
        setDisabledMidiDeviceIds((prev) => {
            if (prev.includes(device.id)) return prev;
            return [...prev, device.id];
        });
    };

    const handleEnableMidiDevice = (device: MidiDevice) => {
        setDisabledMidiDeviceIds((prev) => prev.filter((id) => id !== device.id));
    };

    const currentAbsRow = song.rowsPerPattern * editorState.activeSongPosition + editorState.patternEditRow;
    const cursorPositionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentAbsRow,
    });

    const totalSongSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: song.songOrder.length * song.rowsPerPattern,
    });

    return (
        <div className="app">
            <div className="stickyHeader appRow">
                <div className="menu">
                    <nav className="desktop-menu-bar">
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>File</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item
                                    onSelect={() => { void createNewSong(); }}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("NewFile")}
                                >
                                    New Song…
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    onSelect={() => { void openSongFile(); }}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("OpenFile")}
                                >
                                    Open Song…
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    onSelect={saveSongFile}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("SaveFile")}
                                >
                                    Save Song
                                </DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Sub>
                                    <DesktopMenu.SubTrigger>Export Cart</DesktopMenu.SubTrigger>
                                    <DesktopMenu.SubContent>
                                        <DesktopMenu.Item onSelect={() => exportCart('debug')}>
                                            Debug Build
                                        </DesktopMenu.Item>
                                        <DesktopMenu.Item
                                            onSelect={() => exportCart('release')}
                                            shortcut={keyboardShortcutMgr.getActionBindingLabel("ExportCartRelease")}
                                        >
                                            Release Build
                                        </DesktopMenu.Item>
                                    </DesktopMenu.SubContent>
                                </DesktopMenu.Sub>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => { void optimizeSong(); }}>Optimize Song…</DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>Edit</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item
                                    onSelect={handleUndo}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("Undo")}
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
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("Redo")}
                                    disabled={!undoStackRef.current || !undoStackRef.current.canRedo()}
                                >
                                    {(() => {
                                        const stack = undoStackRef.current;
                                        const entry = stack?.peekRedo();
                                        return entry ? `Redo ${entry.description}` : 'Redo';
                                    })()}
                                </DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => { void copyNative(); }}>Copy Song JSON</DesktopMenu.Item>
                                <DesktopMenu.Item onSelect={() => { void pasteSong(); }}>Paste Song JSON</DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>View</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item
                                    checked={waveformEditorPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setWaveformEditorPanelOpen(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleWaveformEditor")}
                                >
                                    Waveform Editor
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={instrumentPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setInstrumentPanelOpen(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleInstrumentPanel")}
                                >
                                    Instrument Panel
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={showingOnScreenKeyboard}
                                    closeOnSelect={false}
                                    onSelect={() => setShowingOnScreenKeyboard(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleOnScreenKeyboard")}
                                >
                                    On-Screen Keyboard
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={showingArrangementEditor}
                                    closeOnSelect={false}
                                    onSelect={() => setShowingArrangementEditor(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleArrangementEditor")}
                                >
                                    Arrangement Editor
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={advancedEditPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setAdvancedEditPanelOpen(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleAdvancedEditPanel")}
                                >
                                    Advanced Edit Panel
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={preferencesPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setPreferencesPanelOpen((open) => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("TogglePreferencesPanel")}
                                >
                                    Preferences Panel
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={themePanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setThemePanelOpen((open) => !open)}
                                >
                                    Theme Editor
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={tic80PanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setTic80PanelOpen(open => !open)}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleTic80Panel")}
                                >
                                    TIC-80 Bridge
                                </DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item
                                    checked={editorState.editingEnabled}
                                    closeOnSelect={false}
                                    onSelect={toggleEditingEnabled}
                                    shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleEditMode")}
                                >
                                    Editing Mode Enabled
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={theme === 'dark'}
                                    closeOnSelect={false}
                                    onSelect={onToggleTheme}
                                >
                                    Dark Theme
                                </DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>Help</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item onSelect={() => window.open('https://github.com/thenfour/Somatic', '_blank', 'noopener')}>Visit Project on GitHub</DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => window.open('https://reverietracker.github.io/chromatic/', '_blank', 'noopener')}>This project was based on Chromatic by Gasman</DesktopMenu.Item>
                                <DesktopMenu.Item onSelect={() => window.open('https://github.com/nesbox/TIC-80/wiki/Music-Editor', '_blank', 'noopener')}>TIC-80 Music Editor</DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => setAboutOpen(true)}>About Somatic…</DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                    </nav>
                    <div className={`menu-transport ${bridgeReady ? 'menu-transport--ready' : 'menu-transport--not-ready'}`}>
                        <Tooltip title={keyboardShortcutMgr.getActionBindingLabel("Panic")}>
                            <button className={undefined/*'active'*/} onClick={onPanic}>
                                <span className="icon">⏹</span>
                                <span className="caption">Stop</span>
                            </button>
                        </Tooltip>
                        <Tooltip title={keyboardShortcutMgr.getActionBindingLabel("PlaySong")}>
                            <button className={undefined/*transportState === 'play-all' ? 'active' : undefined*/} onClick={onPlayAll} title={keyboardShortcutMgr.getActionBindingLabel("PlaySong")}><span className="icon" aria-hidden="true">
                                {CharMap.RightTriangle}
                            </span>
                                Song
                            </button>
                        </Tooltip>
                        <Tooltip title={keyboardShortcutMgr.getActionBindingLabel("PlayPattern")}>
                            <button className={undefined/*transportState === 'play-pattern' ? 'active' : undefined*/} onClick={onPlayPattern} title={keyboardShortcutMgr.getActionBindingLabel("PlayPattern")}><span className="icon" aria-hidden="true">
                                {CharMap.RightTriangleOutlined}
                            </span>Pat</button>
                        </Tooltip>
                        <Tooltip title={keyboardShortcutMgr.getActionBindingLabel("PlayFromPosition")}>
                            <button className={undefined/*transportState === 'play-from-position' ? 'active' : undefined*/} onClick={onPlayFromPosition} title={keyboardShortcutMgr.getActionBindingLabel("PlayFromPosition")}><span className="icon" aria-hidden="true">
                                {CharMap.RightTriangleOutlined}
                            </span>Pos</button>
                        </Tooltip>
                        <Tooltip title={(<div>
                            <div>Current position of cursor.</div>
                            <div>Total song length: <TransportTime positionSeconds={totalSongSeconds} /></div>
                        </div>)}
                        >
                            <div>
                                <TransportTime className="main-transport-time" positionSeconds={cursorPositionSeconds} />
                            </div>
                        </Tooltip>
                    </div>
                    <div className="right-controls">
                        <Tooltip title={`Toggle editing (${keyboardShortcutMgr.getActionBindingLabel("ToggleEditMode")})`}>
                            <button
                                className={`edit-toggle ${editorState.editingEnabled ? 'edit-toggle--on' : 'edit-toggle--off'}`}
                                onClick={toggleEditingEnabled}
                                aria-pressed={editorState.editingEnabled}
                                aria-label={editorState.editingEnabled ? 'Disable editing in pattern editor' : 'Enable editing in pattern editor'}
                            >
                                <span className="edit-toggle__dot" aria-hidden="true" />
                                <span className={`edit-toggle__label`}>Edit</span>
                            </button>
                        </Tooltip>
                        <MidiStatusIndicator
                            midiStatus={midiStatus}
                            midiDevices={midiDevices}
                            midiEnabled={midiEnabled}
                            disabledMidiDeviceIds={disabledMidiDeviceIds}
                            onToggleMidiEnabled={toggleMidiEnabled}
                            shortcutLabel={keyboardShortcutMgr.getActionBindingLabel("ToggleMidiNoteInput")}
                        />
                        <Tooltip title={`${keyboardIndicatorTitle} (${keyboardShortcutMgr.getActionBindingLabel("ToggleKeyboardNoteInput")})`}>
                            <button
                                className={`midi-indicator midi-indicator--${keyboardIndicatorState}`}
                                title={keyboardIndicatorTitle}
                                aria-label={keyboardIndicatorTitle}
                                onClick={toggleKeyboardEnabled}
                            >
                                <span className="midi-indicator__dot" aria-hidden="true" />
                                <span className="midi-indicator__label">{keyboardIndicatorLabel}</span>
                            </button>
                        </Tooltip>
                        <Tooltip title="Sync status with TIC-80 (auto-save)">
                            <span className="autoSaveIndicator__label">sync:{autoSave.state.status}</span>
                        </Tooltip>
                        <SongStats song={song} />
                        <MusicStateDisplay bridgeReady={bridgeReady} audio={audio} musicState={musicState} song={song} />

                    </div>
                </div>

                <SongEditor
                    song={song}
                    audio={audio}
                    editorState={editorState}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                />
            </div>
            <div className="main-editor-area  appRow">
                {showingArrangementEditor && <ArrangementEditor
                    song={song}
                    editorState={editorState}
                    musicState={musicState}
                    onEditorStateChange={updateEditorState}
                    onSongChange={updateSong}
                />}
                <ShortcutScopeProvider scope="PatternGrid">
                    <PatternGrid
                        ref={patternGridRef}
                        song={song}
                        audio={audio}
                        musicState={musicState}
                        editorState={editorState}
                        onEditorStateChange={updateEditorState}
                        onSongChange={updateSong}
                        advancedEditPanelOpen={advancedEditPanelOpen}
                        onSetAdvancedEditPanelOpen={open => setAdvancedEditPanelOpen(open)}
                    />
                </ShortcutScopeProvider>
                {waveformEditorPanelOpen && (
                    <WaveformEditorPanel
                        song={song}
                        editorState={editorState}
                        onSongChange={updateSong}
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
                {preferencesPanelOpen && (
                    <PreferencesPanel
                        midiStatus={midiStatus}
                        midiDevices={midiDevices}
                        disabledMidiDeviceIds={disabledMidiDeviceIds}
                        onClose={() => setPreferencesPanelOpen(false)}
                        onDisconnectMidiDevice={handleDisconnectMidiDevice}
                        onEnableMidiDevice={handleEnableMidiDevice}
                    />
                )}
                {themePanelOpen && (
                    <ThemeEditorPanel onClose={() => setThemePanelOpen(false)} />
                )}

                {/* When booting (bridge ! ready), we have to show it so it can take focus and convince the browser to make the iframe run in high-performance; see #56 */}
                <div className={tic80PanelOpen || !bridgeReady ? "tic80-frame" : "tic80-frame hidden"}>
                    {/* <Tic80Iframe /> */}
                    <Tic80Bridge ref={bridgeRef} onReady={handleBridgeReady} />
                </div>
            </div>
            <div className="footer appRow">
                {showingOnScreenKeyboard && <Keyboard
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                />}
                <AppStatusBar
                    song={song}
                    editorState={editorState}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                />
            </div>
            <AboutSomaticDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </div>
    );
};
