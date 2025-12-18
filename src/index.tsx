import fileDialog from 'file-dialog';
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { saveSync } from 'save-file';

import './somatic.css';

import type { MusicState } from './audio/backend';
import { AudioController } from './audio/controller';
import { serializeSongToCart } from './audio/tic80_cart_serializer';
import { ClipboardProvider, useClipboard } from './hooks/useClipboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
import { KeyboardNoteInput } from './midi/keyboard_input';
import { NoteInputSource } from './midi/note_input';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { ToTic80ChannelIndex } from './models/tic80Capabilities';
import { ArrangementEditor } from './ui/ArrangementEditor';
import { ConfirmDialogProvider, useConfirmDialog } from './ui/confirm_dialog';
import { HelpPanel } from './ui/help_panel';
import { InstrumentPanel } from './ui/instrument_editor';
import { Keyboard } from './ui/keyboard';
import { PatternGrid, PatternGridHandle } from './ui/pattern_grid';
import { PreferencesPanel } from './ui/preferences_panel';
import { SongEditor } from './ui/song_editor';
import { ThemeEditorPanel } from './ui/theme_editor_panel';
import { Tic80Bridge, Tic80BridgeHandle } from './ui/Tic80Bridged';
import { ToastProvider, useToasts } from './ui/toast_provider';
import { WaveformEditorPanel } from './ui/waveformEditor';
import { useWriteBehindEffect } from './hooks/useWriteBehindEffect';
import { SongStats } from './ui/SongStats';
import { OptimizeSong } from './utils/SongOptimizer';
import { UndoStack } from './utils/UndoStack';
import type { UndoSnapshot } from './utils/UndoStack';
import { DesktopMenu } from './ui/DesktopMenu';

type SongMutator = (song: Song) => void;
type EditorStateMutator = (state: EditorState) => void;
//type TransportState = 'stop' | 'play-pattern' | 'play-from-position' | 'play-all';
type Theme = 'light' | 'dark';
type PatternCellType = 'note' | 'instrument' | 'command' | 'param';

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
    return cellType === 'command' || cellType === 'param';
};

const MusicStateDisplay: React.FC<{ musicState: MusicState }> = ({ musicState }) => {
    return <div className='musicState-panel'>
        <div className='flags'>
            {musicState.isPlaying ? <>
                <div className='key'>Order:</div><div className='value'>{musicState.somaticSongPosition}</div>
                <div className='key'>Row:</div><div className='value'>{musicState.tic80RowIndex}</div>
            </> : <>Stopped</>}
        </div>
    </div>;
};

const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const midiRef = React.useRef<MidiManager | null>(new MidiManager());
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
    const [instrumentPanelOpen, setInstrumentPanelOpen] = useState(false);
    const [waveformEditorPanelOpen, setWaveformEditorPanelOpen] = useState(false);
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [preferencesPanelOpen, setPreferencesPanelOpen] = useState(false);
    const [tic80PanelOpen, setTic80PanelOpen] = useState(true);
    const [themePanelOpen, setThemePanelOpen] = useState(false);
    //const [transportState, setTransportState] = useState<TransportState>('stop');
    const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [midiEnabled, setMidiEnabled] = useState(true);
    const [keyboardEnabled, setKeyboardEnabled] = useState(true);
    const [musicState, setMusicState] = useState(() => audio.getMusicState());
    const clipboard = useClipboard();

    if (!undoStackRef.current) {
        undoStackRef.current = new UndoStack(200);
    }

    const connectedMidiInputs = useMemo(() => midiDevices.filter((d) => d.state === 'connected').length, [midiDevices]);
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
    const midiIndicatorTitle = midiEnabled && connectedMidiInputs > 0
        ? `${midiIndicatorLabel}: ${connectedMidiInputs} input${connectedMidiInputs === 1 ? '' : 's'} connected. Click to disable.`
        : midiEnabled
            ? `${midiIndicatorLabel}. Click to disable.`
            : `${midiIndicatorLabel}. Click to enable.`;

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
        audio.setSong(doc, "Auto-save");
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




    const applyUndoSnapshot = useCallback((snapshot: UndoSnapshot) => {
        autoSave.flush();
        setSong(Song.fromData(snapshot.song));
        setEditorState(EditorState.fromData(snapshot.editor));
    }, [autoSave]);

    const ensureUndoSnapshot = useCallback(() => {
        undoStackRef.current?.record(getUndoSnapshot);
    }, [getUndoSnapshot]);

    const updateSong = useCallback((mutator: SongMutator) => {
        ensureUndoSnapshot();
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
        const snapshot = stack.undo(getUndoSnapshot);
        if (!snapshot) {
            pushToast({ message: 'Nothing to undo.', variant: 'info' });
            return;
        }
        applyUndoSnapshot(snapshot);
    }, [applyUndoSnapshot, getUndoSnapshot, pushToast]);

    const handleRedo = useCallback(() => {
        const stack = undoStackRef.current;
        if (!stack) return;
        const snapshot = stack.redo(getUndoSnapshot);
        if (!snapshot) {
            pushToast({ message: 'Nothing to redo.', variant: 'info' });
            return;
        }
        applyUndoSnapshot(snapshot);
    }, [applyUndoSnapshot, getUndoSnapshot, pushToast]);


    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button';

            const isBracketLeft = e.key === '[';// .code === 'BracketLeft';
            const isBracketRight = e.key === ']';// .code === 'BracketRight';
            const isDigit1 = e.code === 'Digit1';
            const hasMeta = e.metaKey || e.ctrlKey;
            const lowerKey = e.key.toLowerCase();

            // pretty-print key combo.
            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey) parts.push('Meta');
            parts.push(e.code);
            const combo = parts.join('+');
            console.log(`Key combo pressed: code:${combo} key:${e.key} repeat:${e.repeat}`);

            if (!isEditable && hasMeta && !e.altKey && lowerKey === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
                return;
            }
            if (!isEditable && hasMeta && !e.altKey && !e.shiftKey && lowerKey === 'y') {
                e.preventDefault();
                handleRedo();
                return;
            }

            if (e.altKey && !hasMeta && isDigit1) {
                e.preventDefault();
                patternGridRef.current?.focusPattern();
                return;
            }
            if (e.altKey && !hasMeta && e.code === 'Digit2') {
                e.preventDefault();
                // toggle waveform editor
                setWaveformEditorPanelOpen((open) => !open);
                return;
            }
            // alt+3 = toggle instrument panel
            if (e.altKey && !hasMeta && e.code === 'Digit3') {
                e.preventDefault();
                setInstrumentPanelOpen((open) => !open);
                return;
            }
            // alt+4 = toggle tic80 panel
            if (e.altKey && !hasMeta && e.code === 'Digit4') {
                e.preventDefault();
                setTic80PanelOpen((open) => !open);
                return;
            }
            // alt+0 = play / stop
            if (e.altKey && !hasMeta && e.code === 'Digit0') {
                e.preventDefault();
                autoSave.flush();
                if (audio.getMusicState().somaticSongPosition >= 0) {
                    audio.stop();
                } else {
                    audio.playSong(0);
                }
            }
            // alt+9 = play from position
            if (e.altKey && !hasMeta && e.code === 'Digit9') {
                e.preventDefault();
                autoSave.flush();
                audio.playSong(editorState.activeSongPosition, editorState.patternEditRow);
            }
            // alt+8 = play from pattern
            if (e.altKey && !hasMeta && e.code === 'Digit8') {
                e.preventDefault();
                autoSave.flush();
                audio.playSong(editorState.activeSongPosition, 0);
            }
            if (e.code === 'Escape') {
                e.preventDefault();
                // toggle edit mode
                toggleEditingEnabled();
                // and *also* panic.
                audio.panic();
                return;
            }
            if (isEditable) return;
            if (e.repeat) return;
            if (hasMeta || e.altKey) return;

            if (e.key === '[') {
                e.preventDefault();
                updateEditorState((s) => s.setOctave(s.octave - 1));
                return;
            }
            if (e.key === ']') {
                e.preventDefault();
                updateEditorState((s) => s.setOctave(s.octave + 1));
                return;
            }
            if (e.key === '{') {
                e.preventDefault();
                updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument - 1));
                return;
            }
            if (e.key === '}') {
                e.preventDefault();
                updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument + 1));
                return;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleRedo, handleUndo]);

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
        audio.sfxNoteOn(ed.currentInstrument, note);

        if (ed.editingEnabled !== false && !skipNoteEntry) {
            const currentPosition = Math.max(0, Math.min(s.songOrder.length - 1, ed.activeSongPosition || 0));
            const currentPatternIndex = s.songOrder[currentPosition] ?? 0;
            const rowsPerPattern = s.rowsPerPattern;
            const patternEditStep = s.patternEditStep;
            updateSong((newSong) => {
                const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, newSong.patterns.length - 1));
                const pat = newSong.patterns[safePatternIndex];
                const existingCell = pat.getCell(channel, ed.patternEditRow);
                pat.setCell(channel, ed.patternEditRow, { ...existingCell, midiNote: note, instrumentIndex: ed.currentInstrument });
            });
            setEditorState((prev) => {
                const next = prev.clone();
                next.advancePatternEditRow(patternEditStep, rowsPerPattern);
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
        //const s = song;
        //const instIdx = clamp(editorState.currentInstrument, 0, s.instruments.length - 1);
        //const instrument = s.instruments[instIdx];
        //const channel = Math.max(0, Math.min(3, editorState.patternEditChannel || 0));
        autoSave.flush();
        //if (instrument) {
        audio.sfxNoteOn(editorState.currentInstrument, midiNote);
        //}
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
        saveSync(song.toJSON(), 'song.somatic');
    };

    const exportCart = (variant: "debug" | "release") => {
        const cartData = serializeSongToCart(song, true, variant);

        // Create a Blob from the Uint8Array
        const blob = new Blob([cartData as any /* workaround for Blob constructor typing */], { type: 'application/octet-stream' });

        // Create a temporary download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'song.tic';

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
        ensureUndoSnapshot();
        setSong(result.optimizedSong.clone());
    };

    const copyNative = async () => {
        await clipboard.copyTextToClipboard(song.toJSON());
    };

    const pasteSong = async () => {
        try {
            const text = await clipboard.readTextFromClipboard();
            const loaded = Song.fromJSON(text);
            ensureUndoSnapshot();
            setSong(loaded);
            updateEditorState((s) => {
                s.setActiveSongPosition(0);
            });
        } catch (err) {
            console.error('Paste failed', err);
            pushToast({ message: 'Failed to paste song from clipboard. Ensure it is valid song JSON.', variant: 'error' });
        }
    };

    const onStop = () => {
        //setTransportState('stop');
        audio.stop();
    };

    const onPlayPattern = () => {
        autoSave.flush();
        audio.playSong(editorState.activeSongPosition, 0);
    };

    const onPlayAll = () => {
        //setTransportState('play-all');
        autoSave.flush();
        audio.playSong(0);
    };

    const onPlayFromPosition = () => {
        //setTransportState('play-from-position');
        autoSave.flush();
        audio.playSong(editorState.activeSongPosition, editorState.patternEditRow);
    };

    const onPanic = () => {
        //setTransportState('stop');
        audio.panic();
    };

    const handleBridgeReady = React.useCallback((handle: Tic80BridgeHandle) => {
        //console.log('[App] Bridge ready, uploading current song');
        //audio.setSong(song, "Bridge ready; initial upload");
        autoSave.enqueue(song);
        autoSave.flush();
    }, [audio, song]);

    return (
        <div className="app">
            <div className="stickyHeader appRow">
                <div className="menu">
                    <nav className="desktop-menu-bar">
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>File</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item onSelect={() => { void createNewSong(); }}>New Song…</DesktopMenu.Item>
                                <DesktopMenu.Item onSelect={() => { void openSongFile(); }}>Open Song…</DesktopMenu.Item>
                                <DesktopMenu.Item onSelect={saveSongFile}>Save Song</DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Sub>
                                    <DesktopMenu.SubTrigger>Export Cart</DesktopMenu.SubTrigger>
                                    <DesktopMenu.SubContent>
                                        <DesktopMenu.Item onSelect={() => exportCart('debug')}>Debug Build</DesktopMenu.Item>
                                        <DesktopMenu.Item onSelect={() => exportCart('release')}>Release Build</DesktopMenu.Item>
                                    </DesktopMenu.SubContent>
                                </DesktopMenu.Sub>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => { void optimizeSong(); }}>Optimize Song…</DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                        <DesktopMenu.Root>
                            <DesktopMenu.Trigger caret={false}>Edit</DesktopMenu.Trigger>
                            <DesktopMenu.Content>
                                <DesktopMenu.Item onSelect={handleUndo} shortcut="Ctrl+Z">Undo</DesktopMenu.Item>
                                <DesktopMenu.Item onSelect={handleRedo} shortcut="Ctrl+Shift+Z / Ctrl+Y">Redo</DesktopMenu.Item>
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
                                    onSelect={() => setWaveformEditorPanelOpen((open) => !open)}
                                    shortcut="Alt+2"
                                >
                                    Waveform Editor
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={instrumentPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setInstrumentPanelOpen((open) => !open)}
                                    shortcut="Alt+3"
                                >
                                    Instrument Panel
                                </DesktopMenu.Item>
                                <DesktopMenu.Item
                                    checked={preferencesPanelOpen}
                                    closeOnSelect={false}
                                    onSelect={() => setPreferencesPanelOpen((open) => !open)}
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
                                    onSelect={() => setTic80PanelOpen((open) => !open)}
                                    shortcut="Alt+4"
                                >
                                    TIC-80 Bridge
                                </DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item
                                    checked={editorState.editingEnabled}
                                    closeOnSelect={false}
                                    onSelect={toggleEditingEnabled}
                                    shortcut="Esc"
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
                                <DesktopMenu.Item onSelect={() => setHelpPanelOpen(true)}>Keyboard Shortcuts…</DesktopMenu.Item>
                                <DesktopMenu.Divider />
                                <DesktopMenu.Item onSelect={() => window.open('https://github.com/thenfour/chromatic', '_blank', 'noopener')}>Visit Project on GitHub</DesktopMenu.Item>
                            </DesktopMenu.Content>
                        </DesktopMenu.Root>
                    </nav>
                    <div className="menu-transport">
                        <button onClick={onPanic} title="Stop all audio"><span className="icon" aria-hidden="true"></span>Panic</button>
                        <button className={undefined/*'active'*/} onClick={onStop}>
                            <span className="icon">⏹</span>
                            <span className="caption">Stop</span>
                        </button>
                        <button className={undefined/*transportState === 'play-all' ? 'active' : undefined*/} onClick={onPlayAll}><span className="icon" aria-hidden="true">▶</span>Song</button>
                        <button className={undefined/*transportState === 'play-pattern' ? 'active' : undefined*/} onClick={onPlayPattern}><span className="icon" aria-hidden="true">▶</span>Pat</button>
                        <button className={undefined/*transportState === 'play-from-position' ? 'active' : undefined*/} onClick={onPlayFromPosition}><span className="icon" aria-hidden="true">▶</span>From Position</button>
                    </div>
                    <div className="right-controls">
                        <button
                            className={`edit-toggle ${editorState.editingEnabled ? 'edit-toggle--on' : 'edit-toggle--off'}`}
                            onClick={toggleEditingEnabled}
                            aria-pressed={editorState.editingEnabled}
                            aria-label={editorState.editingEnabled ? 'Disable editing in pattern editor' : 'Enable editing in pattern editor'}
                        >
                            <span className="edit-toggle__dot" aria-hidden="true" />
                            <span className={`edit-toggle__label`}>Edit</span>
                        </button>
                        <button
                            className={`midi-indicator midi-indicator--${midiIndicatorState}`}
                            title={midiIndicatorTitle}
                            aria-label={midiIndicatorTitle}
                            onClick={toggleMidiEnabled}
                        >
                            <span className="midi-indicator__dot" aria-hidden="true" />
                            <span className="midi-indicator__label">{midiIndicatorLabel}</span>

                        </button>
                        <button
                            className={`midi-indicator midi-indicator--${keyboardIndicatorState}`}
                            title={keyboardIndicatorTitle}
                            aria-label={keyboardIndicatorTitle}
                            onClick={toggleKeyboardEnabled}
                        >
                            <span className="midi-indicator__dot" aria-hidden="true" />
                            <span className="midi-indicator__label">{keyboardIndicatorLabel}</span>

                        </button>
                        <span className="autoSaveIndicator__label">sync:{autoSave.state.status}</span>
                        <SongStats song={song} />
                        <MusicStateDisplay musicState={musicState} />

                    </div>
                </div>

                <div className="instrument-panel-positioner">
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
                <ArrangementEditor
                    song={song}
                    editorState={editorState}
                    musicState={musicState}
                    onEditorStateChange={updateEditorState}
                    onSongChange={updateSong}
                />
                <PatternGrid
                    ref={patternGridRef}
                    song={song}
                    audio={audio}
                    musicState={musicState}
                    editorState={editorState}
                    onEditorStateChange={updateEditorState}
                    onSongChange={updateSong}
                />
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
                        onClose={() => setPreferencesPanelOpen(false)}
                    />
                )}
                {themePanelOpen && (
                    <ThemeEditorPanel onClose={() => setThemePanelOpen(false)} />
                )}
                {helpPanelOpen && (
                    <HelpPanel onClose={() => setHelpPanelOpen(false)} />
                )}

                <div className={tic80PanelOpen ? "tic80-frame" : "tic80-frame hidden"}>
                    {/* <Tic80Iframe /> */}
                    <Tic80Bridge ref={bridgeRef} onReady={handleBridgeReady} />
                </div>
            </div>
            <div className="footer appRow">
                <Keyboard
                    onNoteOn={handleNoteOn}
                    onNoteOff={handleNoteOff}
                />
            </div>
        </div>
    );
};

// just a splash which requires user gesture to continue (so the audio context etc are allowed to start)
const SplashScreen: React.FC<{ onContinue: () => void }> = ({ onContinue }) => (
    <div className="splash-screen" onClick={onContinue} onKeyDown={onContinue}>
        <h1>Somatic</h1>
        <div className='subtitle subtitle1'>A tracker for TIC-80</div>
        <div className='subtitle subtitle2'>By tenfour</div>
        <button className='clickToContinueButton' style={{ pointerEvents: 'none' }}>Click to Continue</button>
    </div>
);

// just wrapps <App /> to gate on user gesture via splash screen
const AppWrapper: React.FC = () => {
    const [hasContinued, setHasContinued] = useState(false);
    const [theme, setTheme] = useLocalStorage<Theme>('somatic-theme', 'light');

    useEffect(() => {
        const el = document.documentElement;
        if (!el) return;
        if (theme === 'dark') {
            el.classList.add('theme-dark');
        } else {
            el.classList.remove('theme-dark');
        }
    }, [theme]);

    const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

    return (
        <ToastProvider>
            <ConfirmDialogProvider>
                <ClipboardProvider>
                    {hasContinued
                        ? <App theme={theme} onToggleTheme={toggleTheme} />
                        : <SplashScreen onContinue={() => setHasContinued(true)} />}
                </ClipboardProvider>
            </ConfirmDialogProvider>
        </ToastProvider>
    );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<AppWrapper />);
