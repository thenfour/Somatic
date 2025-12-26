import fileDialog from 'file-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveSync } from 'save-file';

import './AppStatusBar.css';
import './somatic.css';

import { LoopMode, SomaticTransportState } from './audio/backend';
import { AudioController } from './audio/controller';
import { serializeSongToCart } from './audio/tic80_cart_serializer';
import { useAppInstancePresence } from './hooks/useAppPresence';
import { useClipboard } from './hooks/useClipboard';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useRenderAlarm } from './hooks/useRenderAlarm';
import { useWriteBehindEffect } from './hooks/useWriteBehindEffect';
import { useShortcutManager } from './keyb/KeyboardShortcutManager';
import { useActionHandler } from './keyb/useActionHandler';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { calculateSongPositionInSeconds, gChannelsArray, ToTic80ChannelIndex } from './models/tic80Capabilities';
import { AboutSomaticDialog } from './ui/AboutSomaticDialog';
import { AppStatusBar } from './ui/AppStatusBar';
import { ArrangementEditor } from './ui/ArrangementEditor';
import { useConfirmDialog } from './ui/confirm_dialog';
import { DesktopMenu } from './ui/DesktopMenu/DesktopMenu';
import { InstrumentPanel } from './ui/instrument_editor';
import { Keyboard } from './ui/keyboard';
import { MidiStatusIndicator } from './ui/MidiStatusIndicator';
import { MusicStateDisplay } from './ui/MusicStateDisplay';
import { PatternGrid, PatternGridHandle } from './ui/pattern_grid';
import { PreferencesPanel } from './ui/preferences_panel';
import { SongEditor } from './ui/song_editor';
import { SongStats, SongStatsAppPanel, useSongStatsData } from './ui/SongStats';
import { Theme, ThemeEditorPanel } from './ui/theme_editor_panel';
import { Tic80Bridge, Tic80BridgeHandle } from './ui/Tic80Bridged';
import { useToasts } from './ui/toast_provider';
import { Tooltip } from './ui/tooltip';
import { TransportTime } from './ui/transportTime';
import { WaveformEditorPanel } from './ui/waveformEditor';
import { gLog } from './utils/logger';
import { OptimizeSong } from './utils/SongOptimizer';
import type { UndoSnapshot } from './utils/UndoStack';
import { UndoStack } from './utils/UndoStack';
import { CharMap } from './utils/utils';
import { GlobalActionId } from './keyb/ActionIds';

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

const kKeyboardNoteActions: Array<{ actionId: GlobalActionId; semitoneIndex: number; }> = [
    { actionId: 'KeyboardNote01_C', semitoneIndex: 1 },
    { actionId: 'KeyboardNote02_Csharp', semitoneIndex: 2 },
    { actionId: 'KeyboardNote03_D', semitoneIndex: 3 },
    { actionId: 'KeyboardNote04_Dsharp', semitoneIndex: 4 },
    { actionId: 'KeyboardNote05_E', semitoneIndex: 5 },
    { actionId: 'KeyboardNote06_F', semitoneIndex: 6 },
    { actionId: 'KeyboardNote07_Fsharp', semitoneIndex: 7 },
    { actionId: 'KeyboardNote08_G', semitoneIndex: 8 },
    { actionId: 'KeyboardNote09_Gsharp', semitoneIndex: 9 },
    { actionId: 'KeyboardNote10_A', semitoneIndex: 10 },
    { actionId: 'KeyboardNote11_Asharp', semitoneIndex: 11 },
    { actionId: 'KeyboardNote12_B', semitoneIndex: 12 },
    { actionId: 'KeyboardNote13_C', semitoneIndex: 13 },
    { actionId: 'KeyboardNote14_Csharp', semitoneIndex: 14 },
    { actionId: 'KeyboardNote15_D', semitoneIndex: 15 },
    { actionId: 'KeyboardNote16_Dsharp', semitoneIndex: 16 },
    { actionId: 'KeyboardNote17_E', semitoneIndex: 17 },
    { actionId: 'KeyboardNote18_F', semitoneIndex: 18 },
    { actionId: 'KeyboardNote19_Fsharp', semitoneIndex: 19 },
    { actionId: 'KeyboardNote20_G', semitoneIndex: 20 },
    { actionId: 'KeyboardNote21_Gsharp', semitoneIndex: 21 },
    { actionId: 'KeyboardNote22_A', semitoneIndex: 22 },
    { actionId: 'KeyboardNote23_Asharp', semitoneIndex: 23 },
    { actionId: 'KeyboardNote24_B', semitoneIndex: 24 },
    { actionId: 'KeyboardNote25_C', semitoneIndex: 25 },
];


export const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const keyboardShortcutMgr = useShortcutManager<GlobalActionId>();
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const [disabledMidiDeviceIds, setDisabledMidiDeviceIds] = useLocalStorage<string[]>("somatic-disabledMidiDeviceIds", []);
    const midiRef = React.useRef<MidiManager | null>(new MidiManager(disabledMidiDeviceIds));
    const patternGridRef = React.useRef<PatternGridHandle | null>(null);
    const undoStackRef = React.useRef<UndoStack | null>(null);
    const audio = useMemo(() => new AudioController({ bridgeGetter: () => bridgeRef.current }), []);
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

    const appPresence = useAppInstancePresence("somatic");

    const [editorState, setEditorState] = useState(() => new EditorState());

    const [instrumentPanelOpen, setInstrumentPanelOpen] = useLocalStorage("somatic-instrumentPanelOpen", false);
    const [waveformEditorPanelOpen, setWaveformEditorPanelOpen] = useLocalStorage("somatic-waveformEditorPanelOpen", false);
    const [tic80FrameSizeIndex, setTic80FrameSizeIndex] = useLocalStorage<number>("somatic-tic80FrameSizeIndex", TIC80_FRAME_DEFAULT_INDEX);
    const [showingOnScreenKeyboard, setShowingOnScreenKeyboard] = useLocalStorage("somatic-showOnScreenKeyboard", true);
    const [advancedEditPanelOpen, setAdvancedEditPanelOpen] = useLocalStorage("somatic-advancedEditPanelOpen", false);
    const [midiEnabled, setMidiEnabled] = useLocalStorage("somatic-midiEnabled", true);
    const [keyboardEnabled, setKeyboardEnabled] = useLocalStorage("somatic-keyboardEnabled", true);

    const [preferencesPanelOpen, setPreferencesPanelOpen] = useState(false);
    const [themePanelOpen, setThemePanelOpen] = useState(false);
    const [songStatsPanelOpen, setSongStatsPanelOpen] = useState(false);
    const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [somaticTransportState, setSomaticTransportState] = useState<SomaticTransportState>(() => audio.getSomaticTransportState());
    const [bridgeReady, setBridgeReady] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [embedMode, setEmbedMode] = useState<"iframe" | "toplevel">("iframe");
    const clipboard = useClipboard();

    const songStatsData = useSongStatsData(song);

    // in order of cycle
    const LOOP_MODE_OPTIONS: { value: LoopMode; label: string }[] = [
        { value: "off", label: "Off" },
        { value: "song", label: "Song" },
        { value: "selectionInSongOrder", label: "Selection in Song Order" },
        { value: "pattern", label: "Pattern" },
        { value: "halfPattern", label: "1/2 pattern" },
        { value: "quarterPattern", label: "1/4 pattern" },
        { value: "selectionInPattern", label: "Selection in Pattern" },
    ];

    if (!undoStackRef.current) {
        undoStackRef.current = new UndoStack(200);
    }

    useEffect(() => {
        midiRef.current?.setDisabledDeviceIds(disabledMidiDeviceIds);
    }, [disabledMidiDeviceIds]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const params = new URLSearchParams(window.location.search);
            const mode = params.get("embed");
            if (mode === "toplevel") {
                setEmbedMode("toplevel");
            } else {
                setEmbedMode("iframe");
            }
        } catch {
            // ignore
        }
    }, []);

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
    };

    const switchEmbedMode = (mode: "iframe" | "toplevel") => {
        if (typeof window === "undefined") return;
        try {
            const url = new URL(window.location.href);
            url.searchParams.set("embed", mode);
            window.location.href = url.toString();
        } catch {
            // fall back: simple search string change
            const base = window.location.origin + window.location.pathname;
            const search = `?embed=${mode}`;
            const hash = window.location.hash || "";
            window.location.href = base + search + hash;
        }
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
            audibleChannels: editorState.getAudibleChannels(),
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
        autoSave.flush(); // immediately apply changes to instrument; user is playing a note maybe testing their tweaks.
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
        //autoSave.flush();
        audio.sfxNoteOff(note);
    }, [audio, autoSave]);

    // Register note handlers once for MIDI.
    useEffect(() => {
        const cleanups: Array<() => void> = [];
        if (midiRef.current) {
            cleanups.push(midiRef.current.onNoteOn((evt) => handleIncomingNoteOn(evt.note)));
            cleanups.push(midiRef.current.onNoteOff((evt) => handleIncomingNoteOff(evt.note)));
        }

        return () => {
            cleanups.forEach((fn) => fn());
        };
    }, [handleIncomingNoteOff, handleIncomingNoteOn]);

    // Keyboard note input is implemented via global actions mapped to physical keys.
    const activeKeyboardNotesRef = React.useRef<Map<GlobalActionId, number>>(new Map());

    useEffect(() => {
        const cleanups: Array<() => void> = [];
        for (const { actionId, semitoneIndex } of kKeyboardNoteActions) {
            cleanups.push(keyboardShortcutMgr.registerHandler(actionId, (ctx) => {
                if (!keyboardEnabled)
                    return;

                if (ctx.eventType === 'keydown') {
                    const e = ctx.event;
                    if (e.metaKey || e.ctrlKey || e.altKey)
                        return;
                    if (e.repeat)
                        return;
                    if (isEditingCommandOrParamCell())
                        return;
                    if (activeKeyboardNotesRef.current.has(actionId))
                        return;

                    const octave = editorRef.current.octave;
                    const note = semitoneIndex + (octave - 1) * 12;
                    activeKeyboardNotesRef.current.set(actionId, note);
                    handleIncomingNoteOn(note);
                    return;
                }

                // keyup
                const note = activeKeyboardNotesRef.current.get(actionId);
                if (note == null)
                    return;

                activeKeyboardNotesRef.current.delete(actionId);
                handleIncomingNoteOff(note);
            }));
        }
        return () => {
            cleanups.forEach((fn) => fn());
        };
    }, [handleIncomingNoteOff, handleIncomingNoteOn, keyboardEnabled, keyboardShortcutMgr]);

    // If keyboard note input is disabled while notes are held, release them.
    useEffect(() => {
        if (keyboardEnabled)
            return;
        for (const note of activeKeyboardNotesRef.current.values()) {
            handleIncomingNoteOff(note);
        }
        activeKeyboardNotesRef.current.clear();
    }, [keyboardEnabled, handleIncomingNoteOff]);

    // Keep sources enabled/disabled in sync.
    useEffect(() => {
        midiRef.current?.setEnabled(midiEnabled);
    }, [midiEnabled]);

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
                audibleChannels: editorRef.current.getAudibleChannels(),
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

    const setLoopMode = (mode: LoopMode) => {
        updateEditorState((s) => s.setLoopMode(mode));
    };

    const handleLoopModeChange: React.ChangeEventHandler<HTMLSelectElement> = (evt) => {
        const next = evt.target.value as LoopMode;
        setLoopMode(next);
    };

    const handleNextLoopMode = () => {
        const current = editorRef.current.loopMode;
        const idx = LOOP_MODE_OPTIONS.findIndex(option => option.value === current);
        const nextIdx = (idx + 1) % LOOP_MODE_OPTIONS.length;
        setLoopMode(LOOP_MODE_OPTIONS[nextIdx].value);
    };

    const handlePreviousLoopMode = () => {
        const current = editorRef.current.loopMode;
        const idx = LOOP_MODE_OPTIONS.findIndex(option => option.value === current);
        const prevIdx = (idx - 1 + LOOP_MODE_OPTIONS.length) % LOOP_MODE_OPTIONS.length;
        setLoopMode(LOOP_MODE_OPTIONS[prevIdx].value);
    };

    const handleToggleLoop = () => {
        const current = editorRef.current.loopMode;
        if (current === "off") {
            setLoopMode(editorRef.current.lastNonOffLoopMode);
        } else {
            setLoopMode("off");
        }
    };

    useActionHandler("Panic", onPanic);
    useActionHandler("Undo", handleUndo);
    useActionHandler("Redo", handleRedo);
    useActionHandler("TogglePreferencesPanel", () => setPreferencesPanelOpen(open => !open));
    useActionHandler("FocusPattern", () => patternGridRef.current?.focusPattern());
    useActionHandler("ToggleWaveformEditor", () => setWaveformEditorPanelOpen(open => !open));
    useActionHandler("ToggleInstrumentPanel", () => setInstrumentPanelOpen(open => !open));
    useActionHandler("CycleTic80PanelSize", () => cycleTic80FrameSize());
    useActionHandler("ToggleOnScreenKeyboard", () => setShowingOnScreenKeyboard(open => !open));
    useActionHandler("ToggleAdvancedEditPanel", () => setAdvancedEditPanelOpen(open => !open));
    useActionHandler("PlaySong", onPlayAll);
    useActionHandler("PlayFromPosition", onPlayFromPosition);
    useActionHandler("PlayPattern", onPlayPattern);
    useActionHandler("SetLoopOff", () => setLoopMode("off"));
    useActionHandler("SetLoopSong", () => setLoopMode("song"));
    useActionHandler("SetLoopSelectionInSongOrder", () => setLoopMode("selectionInSongOrder"));
    useActionHandler("SetLoopSelectionInPattern", () => setLoopMode("selectionInPattern"));
    useActionHandler("SetLoopPattern", () => setLoopMode("pattern"));
    useActionHandler("SetLoopHalfPattern", () => setLoopMode("halfPattern"));
    useActionHandler("SetLoopQuarterPattern", () => setLoopMode("quarterPattern"));
    useActionHandler("NextLoopMode", handleNextLoopMode);
    useActionHandler("PreviousLoopMode", handlePreviousLoopMode);
    useActionHandler("ToggleLoopModeOff", handleToggleLoop);
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

    const currentAbsRow = song.rowsPerPattern * editorState.activeSongPosition + editorState.patternEditRow;
    const cursorPositionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentAbsRow,
    });

    const currentAbsPlayheadRow = song.rowsPerPattern * (somaticTransportState.currentSomaticSongPosition || 0) + (somaticTransportState.currentSomaticRowIndex || 0);
    const playheadPositionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentAbsPlayheadRow,
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
                        <DesktopMenu.Bar>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>File</DesktopMenu.Trigger>
                                <DesktopMenu.Content>
                                    <DesktopMenu.Item
                                        onSelect={() => { void createNewSong(); }}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("NewFile")}
                                    >
                                        New Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => { void openSongFile(); }}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("OpenFile")}
                                    >
                                        Open Song...
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
                                    <DesktopMenu.Item onSelect={() => { void optimizeSong(); }}>Optimize Song...</DesktopMenu.Item>
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
                                        onSelect={() => setWaveformEditorPanelOpen(open => !open)}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleWaveformEditor")}
                                    >
                                        Waveform Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={instrumentPanelOpen}
                                        onSelect={() => setInstrumentPanelOpen(open => !open)}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleInstrumentPanel")}
                                    >
                                        Instrument Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={showingOnScreenKeyboard}
                                        onSelect={() => setShowingOnScreenKeyboard(open => !open)}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleOnScreenKeyboard")}
                                    >
                                        On-Screen Keyboard
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={advancedEditPanelOpen}
                                        onSelect={() => setAdvancedEditPanelOpen(open => !open)}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleAdvancedEditPanel")}
                                    >
                                        Advanced Edit Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={preferencesPanelOpen}
                                        onSelect={() => setPreferencesPanelOpen((open) => !open)}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("TogglePreferencesPanel")}
                                    >
                                        Preferences Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={themePanelOpen}
                                        onSelect={() => setThemePanelOpen((open) => !open)}
                                    >
                                        Theme Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={tic80FrameSizeIndex !== 0}
                                        closeOnSelect={false}
                                        onSelect={() => cycleTic80FrameSize()}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("CycleTic80PanelSize")}
                                    >
                                        TIC-80 Bridge Size
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Sub>
                                        <DesktopMenu.SubTrigger>TIC-80 Embed Variant</DesktopMenu.SubTrigger>
                                        <DesktopMenu.SubContent>
                                            <DesktopMenu.Item
                                                checked={embedMode === "iframe"}
                                                onSelect={() => switchEmbedMode("iframe")}
                                            >
                                                Iframe (default)
                                            </DesktopMenu.Item>
                                            <DesktopMenu.Item
                                                checked={embedMode === "toplevel"}
                                                onSelect={() => switchEmbedMode("toplevel")}
                                            >
                                                Top-level (experimental)
                                            </DesktopMenu.Item>
                                        </DesktopMenu.SubContent>
                                    </DesktopMenu.Sub>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={editorState.editingEnabled}
                                        onSelect={toggleEditingEnabled}
                                        shortcut={keyboardShortcutMgr.getActionBindingLabel("ToggleEditMode")}
                                    >
                                        Editing Mode Enabled
                                    </DesktopMenu.Item>
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
                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/thenfour/Somatic', '_blank', 'noopener')}>Visit Project on GitHub</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://discord.gg/kkf9gQfKAd', '_blank', 'noopener')}>The 7jam Discord</DesktopMenu.Item>

                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => window.open('https://reverietracker.github.io/chromatic/', '_blank', 'noopener')}>This project was based on Chromatic by Gasman</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/nesbox/TIC-80/wiki/Music-Editor', '_blank', 'noopener')}>TIC-80 Music Editor</DesktopMenu.Item>
                                    <DesktopMenu.Item onSelect={() => window.open('https://github.com/nesbox/TIC-80/wiki/ram', '_blank', 'noopener')}>TIC-80 memory map</DesktopMenu.Item>

                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => window.open('https://ko-fi.com/E1E71QVJ5Z', '_blank', 'noopener')}>
                                        <div style={{ maxWidth: 300, marginBottom: 8 }}>Somatic is free; if you find it useful, please consider supporting me 🙏:</div>
                                        <img height='36' style={{ border: 0, height: 36 }} src='https://storage.ko-fi.com/cdn/kofi6.png?v=6' alt='Buy Me a Coffee at ko-fi.com' />
                                    </DesktopMenu.Item>

                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => setAboutOpen(true)}>About Somatic...</DesktopMenu.Item>

                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                        </DesktopMenu.Bar>
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
                            <div>Current position of {somaticTransportState.isPlaying ? "playhead" : "cursor"}.</div>
                            <div>Total song length: <TransportTime positionSeconds={totalSongSeconds} /></div>
                        </div>)}
                        >
                            <div>
                                <TransportTime className="main-transport-time" positionSeconds={somaticTransportState.isPlaying ? playheadPositionSeconds : cursorPositionSeconds} />
                            </div>
                        </Tooltip>

                        <div className="loop-controls">
                            <Tooltip title={`Toggle loop mode (${keyboardShortcutMgr.getActionBindingLabel("ToggleLoopModeOff")})`}>
                                <button
                                    type="button"
                                    className={editorState.loopMode !== "off" ? "button-toggle button-toggle--on" : "button-toggle button-toggle--off"}
                                    onClick={handleToggleLoop}
                                >
                                    {CharMap.Refresh}
                                </button>
                            </Tooltip>
                            <select
                                className={`loop-mode-select ${editorState.loopMode !== "off" ? "loop-mode-select--on" : "loop-mode-select--off"}`}
                                value={editorState.loopMode == "off" ? editorState.lastNonOffLoopMode : editorState.loopMode}
                                onChange={handleLoopModeChange}
                            >
                                {LOOP_MODE_OPTIONS.filter(opt => opt.value !== "off").map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                    </div>
                    {appPresence.otherInstanceActive && <div className="app-presence-contention-warning">
                        ⚠️You have multiple tabs open; that can cause conflicts
                    </div>}
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
                        <SongStats
                            data={songStatsData}
                            onTogglePanel={() => setSongStatsPanelOpen(open => !open)}
                        />
                        <MusicStateDisplay bridgeReady={bridgeReady} audio={audio} musicState={somaticTransportState} song={song} />

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
                />
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
                {songStatsPanelOpen && (
                    <SongStatsAppPanel
                        data={songStatsData}
                        onClose={() => setSongStatsPanelOpen(false)}
                    />
                )}
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
