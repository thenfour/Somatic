import fileDialog from 'file-dialog';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { saveSync } from 'save-file';

import './AppStatusBar.css';
import './somatic.css';

import { LoopMode, SomaticTransportState } from './audio/backend';
import {tic80RowsToSeconds} from './utils/music/tic80Music';
import { Tic80AudioController } from './audio/controller';
import {serializeSongToCart} from './subsystem/tic80/tic80_cart_serializer';
import { importSongFromTicCartBytes } from './subsystem/tic80/tic80_import';
import { useAppInstancePresence } from './hooks/useAppPresence';
import { useClipboard } from './hooks/useClipboard';
import { useDebugMode } from './hooks/useDebugMode';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useRenderAlarm } from './hooks/useRenderAlarm';
import { useWriteBehindEffect } from './hooks/useWriteBehindEffect';
import { GlobalActionId } from './keyb/ActionIds';
import { useShortcutManager } from './keyb/KeyboardShortcutManager';
import { useActionHandler } from './keyb/useActionHandler';
import { KeyboardActionNoteInput } from './midi/keyboard_action_input';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
import { EditorState } from './models/editor_state';
import {CueSheetFieldValues, type ExportConfiguration} from './models/exportConfiguration';
import {buildSongMetadataPayload, Song} from './models/song';
import { AmigaModSubsystemFrontend } from './subsystem/AmigaMod/AmigaModSubsystemFrontend';
import { kSubsystem } from './subsystem/base/SubsystemBackendBase';
import { SomaticSubsystemFrontend } from './subsystem/base/SubsystemFrontendBase';
import { SidSubsystemFrontend } from './subsystem/Sid/SidSubsystemFrontend';
import { Tic80SubsystemFrontend } from './subsystem/tic80/tic80SubsystemFrontend';
import { AboutSomaticDialog } from './ui/AboutSomaticDialog';
import {AudioRenderDialog, AudioRenderPhase} from './ui/AudioRenderDialog';
import { AppStatusBar } from './ui/AppStatusBar';
import { ArrangementEditor } from './ui/ArrangementEditor';
import { useConfirmDialog } from './ui/basic/confirm_dialog';
import { DiscordLogo, GithubLogo } from './ui/basic/Socicon';
import { closeAllTooltips, Tooltip } from './ui/basic/tooltip';
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
import {Tic80AudioCaptureResult, Tic80Bridge, Tic80BridgeHandle} from './subsystem/tic80/Tic80Bridged';
import { useToasts } from './ui/toast_provider';
import { TransportControls } from './ui/TransportControls';
import { VersionAvatar } from './ui/VersionAvatar';
import { WaveformEditorPanel } from './ui/waveformEditor';
import { gLog } from './utils/logger';
import { OptimizeSong } from './subsystem/tic80/SongOptimizer';
import type { UndoSnapshot } from './utils/UndoStack';
import { UndoStack } from './utils/UndoStack';
import {clamp, numericRange} from './utils/utils';
import { importSongFromAmigaModBytes } from './subsystem/AmigaMod/AmigaModImport';
import { kPatternGridHighlightStyle, PatternGridHighlightStyle } from './models/patternGridHighlightStyle';
import Icon from "@mdi/react";
import {mdiCog} from "@mdi/js";
import {
   analyzeTic80CapturedWav,
   encodeAudioRender,
} from "./audio/audio_render_mediabunny";
import {
   type AudioRenderPreview,
   type AudioSourceAnalysis,
   createAudioRenderPreview,
} from "./audio/audio_render_processing";

const TIC80_FRAME_SIZES = [
    { id: "small", label: "Small", width: "256px", height: "144px" }, // smaller than this and it disappears
    { id: "medium", label: "Medium", width: "512px", height: "288px" },
    { id: "large", label: "Large", width: "768px", height: "432px" },
] as const;

const TIC80_FRAME_DEFAULT_INDEX = 0; // it's actually just not useful to see this; it's more of a debugging tool.

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
type PatternCellType = "note" | "instrument" | "volume" | "pan" | "command" | "param" | "somaticCommand" | "somaticParam";
type AudioRenderDialogState = {
   phase: AudioRenderPhase;
   fraction01: number;
   completedRows: number;
   totalRows: number;
   renderStartedAtMillis: number;
   renderCompletedAtMillis: number | null;
   totalAudioSeconds: number;
   result: Tic80AudioCaptureResult | null;
   analysis: AudioSourceAnalysis | null;
   preview: AudioRenderPreview | null;
};

const DEFAULT_LOOP_STATE: { loopMode: LoopMode; lastNonOffLoopMode: LoopMode } = {
    loopMode: "off",
    lastNonOffLoopMode: "pattern",
};

const getActivePatternCellType = (): PatternCellType | null => {
    if (typeof document === "undefined") return null;
    const active = document.activeElement;
    if (!active || !(active instanceof HTMLElement)) return null;
    const cellType = active.getAttribute("data-cell-type");
   return cellType === "note" || cellType === "instrument" || cellType === "volume" || cellType === "pan" || cellType === "command" || cellType === "param"
        || cellType === "somaticCommand" || cellType === "somaticParam"
        ? cellType
        : null;
};

const isEditingCommandOrParamCell = () => {
    const cellType = getActivePatternCellType();
   return cellType === "command" || cellType === "param" || cellType === "instrument" || cellType === "volume" || cellType === "pan" || cellType === "somaticCommand" || cellType === "somaticParam";
};

const isEditingNoteCell = () => getActivePatternCellType() === "note";

export const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const mgr = useShortcutManager<GlobalActionId>();
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const [disabledMidiDeviceIds, setDisabledMidiDeviceIds] = useLocalStorage<string[]>(
        "somatic-disabledMidiDeviceIds",
        []
    );
    const [highlightSelectedInstrumentInPatternGrid, setHighlightSelectedInstrumentInPatternGrid] = useLocalStorage(
        "somatic-highlightSelectedInstrumentInPatternGrid",
        true
    );
    const midiRef = React.useRef<MidiManager | null>(new MidiManager(disabledMidiDeviceIds));
    const keyboardNoteRef = React.useRef<KeyboardActionNoteInput | null>(null);
    const patternGridRef = React.useRef<PatternGridHandle | null>(null);
    const undoStackRef = React.useRef<UndoStack | null>(null);
    const audio = useMemo(() => new Tic80AudioController({ bridgeGetter: () => bridgeRef.current }), []);
    const { pushToast } = useToasts();
    const { confirm } = useConfirmDialog();
    const [song, setSong] = useLocalStorage<Song>("somatic-song", () => new Song(), {
        serialize: (s) => s.toJSON(),
        deserialize: (raw) => Song.fromJSON(raw),
    });

    const subsystemFrontendRef = React.useRef<SomaticSubsystemFrontend<Song> | null>(null);

    const appPresence = useAppInstancePresence("somatic");

    const [loopState, setLoopState] = useLocalStorage<{ loopMode: LoopMode; lastNonOffLoopMode: LoopMode }>(
        "somatic-loopState",
        DEFAULT_LOOP_STATE
    );

    const [editorState, setEditorState] = useState(() => new EditorState(loopState));

    React.useLayoutEffect(() => {
        closeAllTooltips();
    }, [editorState.activeSongPosition]);

    const { debugMode, setDebugMode } = useDebugMode();

    const [patternEditorOpen, setPatternEditorOpen] = useLocalStorage("somatic-patternEditorOpen", true);
    const [instrumentPanelOpen, setInstrumentPanelOpen] = useLocalStorage("somatic-instrumentPanelOpen", false);
    const [instrumentsPanelOpen, setInstrumentsPanelOpen] = useLocalStorage("somatic-instrumentsPanelOpen", true);
    const [waveformEditorPanelOpen, setWaveformEditorPanelOpen] = useLocalStorage(
        "somatic-waveformEditorPanelOpen",
        false
    );
    const [tic80FrameSizeIndex, setTic80FrameSizeIndex] = useLocalStorage<number>(
        "somatic-tic80FrameSizeIndex",
        TIC80_FRAME_DEFAULT_INDEX
    );
    const [showingOnScreenKeyboard, setShowingOnScreenKeyboard] = useLocalStorage("somatic-showOnScreenKeyboard", true);
    const [advancedEditPanelOpen, setAdvancedEditPanelOpen] = useLocalStorage("somatic-advancedEditPanelOpen", false);
    const [midiEnabled, setMidiEnabled] = useLocalStorage("somatic-midiEnabled", true);
    const [keyboardEnabled, setKeyboardEnabled] = useLocalStorage("somatic-keyboardEnabled", true);
    const [songStatsPanelOpen, setSongStatsPanelOpen] = useLocalStorage("somatic-songStatsPanelOpen", false);
    const [songSettingsPanelOpen, setSongSettingsPanelOpen] = useLocalStorage("somatic-songSettingsPanelOpen", false);
    const [encodingUtilsPanelOpen, setEncodingUtilsPanelOpen] = useLocalStorage(
        "somatic-encodingUtilsPanelOpen",
        false
    );
    const [patternGridHighlightStyle, setPatternGridHighlightStyle] = useLocalStorage<PatternGridHighlightStyle>(
        "somatic-patternGridHighlightStyle",
        kPatternGridHighlightStyle.valueByKey.sectionHeader
    );

    const [preferencesPanelOpen, setPreferencesPanelOpen] = useState(false);
    const [themePanelOpen, setThemePanelOpen] = useState(false);
    const [debugPanelOpen, setDebugPanelOpen] = useState(false);
    const [songStatsExportConfigurationIndex, setSongStatsExportConfigurationIndex] = useState(1);
    const [midiStatus, setMidiStatus] = useState<MidiStatus>("pending");
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [somaticTransportState, setSomaticTransportState] = useState<SomaticTransportState>(() =>
        audio.getSomaticTransportState()
    );
    const [bridgeReady, setBridgeReady] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
   const [audioRenderDialog, setAudioRenderDialog] = useState<AudioRenderDialogState | null>(null);
   const audioRenderAbortRef = React.useRef<AbortController | null>(null);
    const clipboard = useClipboard();

    const effectiveSongStatsExportConfigurationIndex = Math.min(
        songStatsExportConfigurationIndex,
        song.exportConfigurations.length - 1,
    );
    const songStatsData = useSongStatsData(song, effectiveSongStatsExportConfigurationIndex);

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
        }
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

    const getUndoSnapshot = useCallback(
        () => ({
            song: songRef.current.toData(),
            editor: editorRef.current.toData(),
        }),
        []
    );

    // auto-save to backend + localStorage
    const autoSave = useWriteBehindEffect<Song>(
        async (doc, { signal }) => {
            await audio.transmitEditedSong({
                song: doc,
                reason: "auto-save",
                audibleChannels: editorState.getAudibleChannels(doc),
               cursorChannelIndex: clamp(editorState.patternEditChannel, 0, doc.subsystem.channelCount - 1),
                cursorRowIndex: editorState.patternEditRow,
                cursorSongOrder: editorState.activeSongPosition,
                loopMode: editorState.loopMode,
                patternSelection: editorState.patternSelection,
                songOrderSelection: editorState.selectedArrangementPositions,
                auditionSongOrder: editorState.activeSongPosition,
                startPosition: editorState.activeSongPosition,
                startRow: editorState.patternEditRow,
            });
            localStorage.setItem("somatic-song", doc.toJSON());
        },
        {
            debounceMs: 1000, //
            maxWaitMs: 2500, //
        }
    );

    useRenderAlarm({
        name: "App",
    });

    const applyUndoSnapshot = useCallback(
        (snapshot: UndoSnapshot) => {
            autoSave.flush();
            const nextSong = Song.fromData(snapshot.song);
            const nextEditor = EditorState.fromData(snapshot.editor);
            setSong(nextSong);
            setEditorState(nextEditor);
            setLoopState({
                loopMode: nextEditor.loopMode,
                lastNonOffLoopMode: nextEditor.lastNonOffLoopMode,
            });
        },
        [autoSave, setLoopState]
    );

    const ensureUndoSnapshot = useCallback(
        (description: string) => {
            undoStackRef.current?.record(description, getUndoSnapshot);
        },
        [getUndoSnapshot]
    );
    const updateSong = useCallback(
        ({ mutator, description, undoable = true }: SongChangeArgs) => {
            if (undoable) {
                ensureUndoSnapshot(description);
            }
            setSong((prev) => {
                const next = prev.clone();
                mutator(next);
                return next;
            });
        },
        [ensureUndoSnapshot]
    );

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
            pushToast({ message: "Nothing to undo.", variant: "info" });
            return;
        }
        applyUndoSnapshot(entry.snapshot);
    }, [applyUndoSnapshot, getUndoSnapshot, pushToast]);

    const handleRedo = useCallback(() => {
        const stack = undoStackRef.current;
        if (!stack) return;
        const entry = stack.redo(getUndoSnapshot);
        if (!entry) {
            pushToast({ message: "Nothing to redo.", variant: "info" });
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

   // Loop mode and channel mute/solo state are bake inputs rather than
   // Song fields. Push those editor-only changes through the same serialized
   // update queue so active playback is re-baked without racing song edits.
   const livePlaybackControlsKey = `${editorState.loopMode}:${numericRange(0, song.subsystem.channelCount)
      .filter((channelIndex) => editorState.isChannelAudible(channelIndex))
      .join(",")}`;
   const previousLivePlaybackControlsKeyRef = React.useRef(livePlaybackControlsKey);
   useEffect(() => {
      if (previousLivePlaybackControlsKeyRef.current === livePlaybackControlsKey) {
         return;
      }
      previousLivePlaybackControlsKeyRef.current = livePlaybackControlsKey;
      autoSave.enqueue(song);
      void autoSave.flush();
   }, [livePlaybackControlsKey]);

    const songRef = React.useRef(song);
    const editorRef = React.useRef(editorState);

    useEffect(() => {
        songRef.current = song;
    }, [song]);
    useEffect(() => {
        editorRef.current = editorState;
    }, [editorState]);

   // Live audition must wait for the latest instrument configuration to reach the bridge.
   // A serial # prevents a delayed note-on from firing after its note-off.
   const auditionGenerationByNoteRef = React.useRef(new Map<number, number>()); // map note value -> serial
   const auditionNoteOn = useCallback(
      (s: Song, instrumentIndex: number, note: number, channel: number) => {
         const generation = (auditionGenerationByNoteRef.current.get(note) ?? 0) + 1;
         auditionGenerationByNoteRef.current.set(note, generation);
         void (async () => {
            autoSave.enqueue(s);
            await autoSave.flush();
            if (auditionGenerationByNoteRef.current.get(note) !== generation) {
               return;
            }
            audio.sfxNoteOn(s, instrumentIndex, note, channel);
         })();
      },
      [audio, autoSave],
   );
   const auditionNoteOff = useCallback(
      (note: number) => {
         auditionGenerationByNoteRef.current.set(
            note,
            (auditionGenerationByNoteRef.current.get(note) ?? 0) + 1,
         );
         audio.sfxNoteOff(note);
      },
      [audio],
   );

    const handleIncomingNoteOn = useCallback(
        (note: number) => {
          if (audioRenderAbortRef.current) return;
            const s = songRef.current;
            const ed = editorRef.current;
          const channel = clamp(ed.patternEditChannel, 0, s.subsystem.channelCount - 1);
            const allowPatternNoteEntry = isEditingNoteCell();
          auditionNoteOn(s, ed.currentInstrument, note, channel);

            if (ed.editingEnabled !== false && allowPatternNoteEntry) {
                const currentPosition = Math.max(0, Math.min(s.songOrder.length - 1, ed.activeSongPosition || 0));
               const currentPatternIndex = s.songOrder[currentPosition].patternIndex ?? 0;
                const patternEditStep = s.patternEditStep;

                updateSong({
                    description: "Insert note",
                    undoable: true,
                    mutator: (newSong) => {
                        const safePatternIndex = Math.max(
                            0,
                            Math.min(currentPatternIndex, newSong.patterns.length - 1)
                        );
                        const pat = newSong.patterns[safePatternIndex];
                        const existingCell = pat.getCell(channel, ed.patternEditRow);
                        pat.setCell(channel, ed.patternEditRow, {
                            ...existingCell,
                            midiNote: note,
                            instrumentIndex: ed.currentInstrument,
                        });
                    },
                });
                setEditorState((prev) => {
                    const next = prev.clone();
                    next.advancePatternEditRow(s, patternEditStep);
                    patternGridRef.current?.focusCellAdvancedToRow(next.patternEditRow);
                    return next;
                });
            }
        },
       [auditionNoteOn, updateSong]
    );

    const handleIncomingNoteOff = useCallback(
        (note: number) => {
          auditionNoteOff(note);
        },
       [auditionNoteOff]
    );

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
       const channel = clamp(editorState.patternEditChannel, 0, song.subsystem.channelCount - 1);
       auditionNoteOn(song, editorState.currentInstrument, midiNote, channel);
    };

    const handleNoteOff = (midiNote: number) => {
       auditionNoteOff(midiNote);
    };

    const createNewSong = async () => {
        const confirmed = await confirm({
            content: (
                <div>
                    <p>Create a new song? Your current song will be replaced.</p>
                    <p>Make sure you've saved your work first!</p>
                </div>
            ),
            defaultAction: "no",
            yesLabel: "Create New",
            noLabel: "Cancel",
        });

        if (!confirmed) return;

        const newSong = new Song();
        setSong(newSong);
        updateEditorState((s) => {
            s.setActiveSongPosition(newSong, 0);
        });
        undoStackRef.current?.clear();
        pushToast({ message: "New song created.", variant: "success" });
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
            s.setActiveSongPosition(loaded, 0);
        });
        undoStackRef.current?.clear();
    };

    const importTicCartFile = async () => {
        const files = (await fileDialog({ accept: ".tic" })) as FileList | File[] | undefined;
        const fileArray = files ? Array.from(files as any) : [];
        const file = fileArray[0] as File | undefined;
        if (!file) return;

        try {
            const buf = await file.arrayBuffer();
           const {song: importedSong, warnings, importedChunkNames} = importSongFromTicCartBytes(new Uint8Array(buf), {
                fileName: file.name,
            });

            setSong(importedSong);
            updateEditorState((s) => {
                s.setActiveSongPosition(importedSong, 0);
            });
            undoStackRef.current?.clear();

           pushToast({message: `TIC-80 cartridge imported (${importedChunkNames.join(", ")}).`, variant: "success"});
            if (warnings.length > 0) {
                console.warn("Import warnings:", warnings);
               pushToast({message: `Imported (${importedChunkNames.join(", ")}) with ${warnings.length} warning(s). See console.`, variant: "info"});
            }
        } catch (err) {
            console.error("Import failed", err);
            const msg = err instanceof Error ? err.message : "Unknown error";
            pushToast({ message: `Failed to import .tic: ${msg}`, variant: "error" });
        }
    };

    const importAmigaModFile = async () => {
        const files = (await fileDialog({ accept: ".mod" })) as FileList | File[] | undefined;
        const fileArray = files ? Array.from(files as any) : [];
        const file = fileArray[0] as File | undefined;
        if (!file) return;
        try {
            const buf = await file.arrayBuffer();

            const { song: importedSong, warnings } = importSongFromAmigaModBytes(new Uint8Array(buf), {
                fileName: file.name,
            });

            setSong(importedSong);
            updateEditorState((s) => {
                s.setActiveSongPosition(importedSong, 0);
            });
            undoStackRef.current?.clear();

            pushToast({ message: "Amiga MOD imported.", variant: "success" });
            if (warnings.length > 0) {
                console.warn("MOD import warnings:", warnings);
                pushToast({ message: `Imported with ${warnings.length} warning(s). See console.`, variant: "info" });
            }
        } catch (err) {
            console.error("Import failed", err);
            const msg = err instanceof Error ? err.message : "Unknown error";
            pushToast({ message: `Failed to import .mod: ${msg}`, variant: "error" });
        }
    };

    const saveSongFile = () => {
        saveSync(song.toJSON(), song.getFilename(".somatic"));
    };

   const renderSongToWav = async () => {
      if (audioRenderAbortRef.current) return; // no double-invoke

      const bridge = bridgeRef.current;
      if (!bridge?.isReady()) {
         pushToast({message: "TIC-80 is not ready to render audio.", variant: "error"});
         return;
      }

      // clone song to allow fixups for render-only (no looping, et al.)
      const songToRender = songRef.current.clone();

      // TODO: check songToRender.subsystemType for tic80

      const abortController = new AbortController();
      const totalRows = songToRender.getSongLengthRows();
      // todo: prevent many actions from being invoked (mgr.suspendShortcuts-ish but that's only
      // for keyboard, and it would prevent a hypothetical "abort audio render" action.
      audioRenderAbortRef.current = abortController;
      setAudioRenderDialog({
         phase: "preparing",
         fraction01: 0,
         completedRows: 0,
         totalRows,
         renderStartedAtMillis: performance.now(),
         renderCompletedAtMillis: null,
         totalAudioSeconds: tic80RowsToSeconds(totalRows, {
            tempo: songToRender.tempo,
            speed: songToRender.speed,
         }),
         result: null,
         analysis: null,
         preview: null,
      });

      try {
         const result = await audio.renderSongToWav({
            reason: "user export",
            song: songToRender,
            audibleChannels: editorRef.current.getAudibleChannels(songToRender),
            signal: abortController.signal,
            onProgress: (progress) => {
               if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;
               setAudioRenderDialog((state) => state
                  ? {...state, phase: "rendering", ...progress}
                  : state);
            },
         });

         if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;

         // successfully completed render... analyze immediately
         const renderCompletedAtMillis = performance.now();
         setAudioRenderDialog((state) => state ? {
            ...state,
            phase: "analyzing",
            fraction01: 0,
            completedRows: state.totalRows,
            renderCompletedAtMillis,
            result,
         } : state);

         const analysis = await analyzeTic80CapturedWav({
            wavBytes: result.bytes,
            signal: abortController.signal,
            onProgress: (progress) => {
               if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;
               setAudioRenderDialog((state) => state?.phase === "analyzing"
                  ? {...state, fraction01: progress.fraction01}
                  : state);
            },
         });
         if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;

         const preview = createAudioRenderPreview(analysis, songRef.current.audioRenderSettings);
         audioRenderAbortRef.current = null;
         setAudioRenderDialog((state) => state ? {
            ...state,
            phase: "review",
            fraction01: 1,
            analysis,
            preview,
         } : state);
      } catch (error) {
         if (error instanceof Error && error.name === "AbortError") {
            pushToast({message: "Audio render cancelled.", variant: "info"});
         } else {
            console.error("Audio render failed", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            pushToast({message: `Failed to render audio: ${message}`, variant: "error"});
         }
      } finally {
         if (audioRenderAbortRef.current === abortController) {
            audioRenderAbortRef.current = null;
            setAudioRenderDialog(null);
         }
      }
   };

   const cancelAudioRender = () => {
      const abortController = audioRenderAbortRef.current;
      if (!abortController || abortController.signal.aborted) return;
      setAudioRenderDialog((state) => state ? {...state, phase: "cancelling"} : state);
      abortController.abort();
   };

   const closeAudioRenderDialog = () => {
      if (audioRenderAbortRef.current) return;
      setAudioRenderDialog(null);
   };

   const updateAudioRenderSettings = (audioRenderSettings: Song["audioRenderSettings"]) => {
      updateSong({
         description: "Edit audio render settings",
         undoable: true,
         mutator: (s) => {
            s.audioRenderSettings = audioRenderSettings;
         },
      });
      setAudioRenderDialog((state) => state?.analysis
         ? {...state, preview: createAudioRenderPreview(state.analysis, audioRenderSettings)}
         : state);
   };

   const downloadAudioRender = async () => {
      const result = audioRenderDialog?.result;
      const analysis = audioRenderDialog?.analysis;
      if (!result || !analysis || audioRenderAbortRef.current) return;

      const settings = {
         ...songRef.current.audioRenderSettings,
         metadata: {...songRef.current.audioRenderSettings.metadata},
      };
      const abortController = new AbortController();
      audioRenderAbortRef.current = abortController;
      setAudioRenderDialog((state) => state ? {...state, phase: "encoding", fraction01: 0} : state);

      try {
         const encoded = await encodeAudioRender({
            sourceWavBytes: result.bytes,
            analysis,
            settings,
            signal: abortController.signal,
            onProgress: (progress) => {
               if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;
               setAudioRenderDialog((state) => state?.phase === "encoding"
                  ? {...state, fraction01: progress.fraction01}
                  : state);
            },
         });
         if (audioRenderAbortRef.current !== abortController || abortController.signal.aborted) return;

         const filename = songRef.current.getAudioRenderFilename(encoded.extensionWithDot);
         saveSync(new Blob([encoded.bytes as any], {type: encoded.mimeType}), filename);
         pushToast({message: `Downloaded ${filename}.`, variant: "success"});
         audioRenderAbortRef.current = null;
         setAudioRenderDialog((state) => state ? {
            ...state,
            phase: "review",
            fraction01: 1,
            preview: encoded.preview,
         } : state);
      } catch (error) {
         if (error instanceof Error && error.name === "AbortError") {
            pushToast({message: "Audio encoding cancelled.", variant: "info"});
         } else {
            console.error("Audio encoding failed", error);
            const message = error instanceof Error ? error.message : "Unknown error";
            pushToast({message: `Failed to encode audio: ${message}`, variant: "error"});
         }
         if (audioRenderAbortRef.current === abortController) {
            audioRenderAbortRef.current = null;
            setAudioRenderDialog((state) => state ? {...state, phase: "review", fraction01: 1} : state);
         }
      } finally {
         if (audioRenderAbortRef.current === abortController) {
            audioRenderAbortRef.current = null;
         }
      }
   };

    const exportCart = (exportConfiguration: ExportConfiguration) => {
        const cartData = serializeSongToCart(
            song,
            true,
            exportConfiguration,
            editorState.getAudibleChannels(song),
        );

        // Create a Blob from the Uint8Array
        const blob = new Blob([cartData as any /* workaround for Blob constructor typing */], {
            type: "application/octet-stream",
        });

        // Create a temporary download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
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
        if (
            !(await confirm({
                content: <p>Optimize the song to remove unused patterns, waveforms, and SFX?</p>,
            }))
        ) {
            return;
        }
        const result = OptimizeSong(song);
        console.log(result);
        ensureUndoSnapshot("Optimize song");
        setSong(result.optimizedSong.clone());
    };

    const copyNative = async () => {
        await clipboard.copyTextToClipboard(song.toJSON());
    };

    const pasteSong = async () => {
        try {
            const text = await clipboard.readTextFromClipboard();
            const loaded = Song.fromJSON(text);
            ensureUndoSnapshot("Paste song JSON");
            setSong(loaded);
            updateEditorState((s) => {
                s.setActiveSongPosition(loaded, 0);
            });
        } catch (err) {
            console.error("Paste failed", err);
            pushToast({
                message: "Failed to paste song from clipboard. Ensure it is valid song JSON.",
                variant: "error",
            });
        }
    };

   const copySongMetadataJson = async () => {
      const payload = buildSongMetadataPayload(song, CueSheetFieldValues);
      await clipboard.copyTextToClipboard(JSON.stringify(payload, null, 2));
   };

    const onPanic = () => {
        //setTransportState('stop');
        audio.panic();
    };

    const playSongWithFlush = useCallback(
        async (reason: string, startPosition: number, startRow: number, auditionSongOrder: number|null) => {
            gLog.info(`playSongWithFlush: song is ${somaticTransportState.isPlaying ? "playing" : "stopped"}`);
            if (somaticTransportState.isPlaying) {
                audio.panic();
            } else {
                audio.transmitAndPlay({
                    reason,
                    song: songRef.current,
                    cursorSongOrder: editorRef.current.activeSongPosition,
                   // patternEditChannel can be sidechannel (oob for audible channels)
                   cursorChannelIndex: clamp(editorRef.current.patternEditChannel, 0, songRef.current.subsystem.channelCount - 1),
                    cursorRowIndex: editorRef.current.patternEditRow,
                    patternSelection: editorRef.current.patternSelection,
                    audibleChannels: editorRef.current.getAudibleChannels(songRef.current),
                    startPosition,
                    startRow,
                    loopMode: editorRef.current.loopMode,
                    songOrderSelection: editorRef.current.selectedArrangementPositions,
                    auditionSongOrder,
                });
            }
        },
        [audio, somaticTransportState]
    );

    const onPlayPattern = () => {
        const ed = editorRef.current;
        void playSongWithFlush("play pattern", ed.activeSongPosition, 0, ed.activeSongPosition);
    };

    const onPlayAll = () => {
        void playSongWithFlush("play all", 0, 0, null);
    };

    const onPlayFromPosition = () => {
        const ed = editorRef.current;
        void playSongWithFlush(
            "play from position",
            ed.activeSongPosition,
            ed.patternEditRow,
            ed.activeSongPosition,
        );
    };

    useActionHandler<GlobalActionId>("ToggleDebugMode", () => setDebugMode((d) => !d));
    useActionHandler("Panic", onPanic);
    useActionHandler("Undo", handleUndo);
    useActionHandler("Redo", handleRedo);
    useActionHandler("TogglePreferencesPanel", () => setPreferencesPanelOpen((open) => !open));
    useActionHandler("ToggleDebugPanel", () => setDebugPanelOpen((open) => !open));
    useActionHandler("FocusPattern", () => patternGridRef.current?.focusPattern());
    useActionHandler("ToggleWaveformEditor", () => setWaveformEditorPanelOpen((open) => !open));
    useActionHandler("ToggleInstrumentPanel", () => setInstrumentPanelOpen((open) => !open));
    useActionHandler("ToggleInstrumentsPanel", () => setInstrumentsPanelOpen((open) => !open));
    useActionHandler("CycleTic80PanelSize", () => cycleTic80FrameSize());
    useActionHandler("ToggleOnScreenKeyboard", () => setShowingOnScreenKeyboard((open) => !open));
    useActionHandler("ToggleAdvancedEditPanel", () => setAdvancedEditPanelOpen((open) => !open));
    useActionHandler("ToggleVolumeColumn", () =>
        updateEditorState((s) => s.setShowVolumeColumn(!s.showVolumeColumn))
    );
    useActionHandler("TogglePanColumn", () =>
        updateEditorState((s) => s.setShowPanColumn(!s.showPanColumn))
    );
    useActionHandler("ToggleSomaticColumns", () =>
        updateEditorState((s) => s.setShowSomaticColumns(!s.showSomaticColumns))
    );
   useActionHandler("ToggleSideChannelData", () =>
      updateEditorState((s) => s.setShowSideChannelData(!s.showSideChannelData))
   );
    mgr.useActionHandler("TogglePatternEditor", () => {
        setPatternEditorOpen((open) => !open);
    });
    mgr.useActionHandler("ToggleEncodingUtilsPanel", () => {
        setEncodingUtilsPanelOpen((open) => !open);
    });
    useActionHandler("PlaySong", onPlayAll);
    useActionHandler("PlayFromPosition", onPlayFromPosition);
    useActionHandler("PlayPattern", onPlayPattern);
    useActionHandler("ToggleEditMode", toggleEditingEnabled);
    useActionHandler("DecreaseOctave", () => updateEditorState((s) => s.setOctave(songRef.current, s.octave - 1)));
    useActionHandler("IncreaseOctave", () => updateEditorState((s) => s.setOctave(songRef.current, s.octave + 1)));
    useActionHandler("DecreaseInstrument", () =>
        updateEditorState((s) => s.setCurrentInstrument(songRef.current, s.currentInstrument - 1))
    );
    useActionHandler("IncreaseInstrument", () =>
        updateEditorState((s) => s.setCurrentInstrument(songRef.current, s.currentInstrument + 1))
    );
    useActionHandler("IncreaseEditStep", () =>
        updateSong({
            description: "Increase edit step", //
            undoable: true,
            mutator: (s) => s.setPatternEditStep(s.patternEditStep + 1),
        })
    );
    useActionHandler("DecreaseEditStep", () =>
        updateSong({
            description: "Decrease edit step",
            undoable: true,
            mutator: (s) => s.setPatternEditStep(Math.max(0, s.patternEditStep - 1)),
        })
    );
    useActionHandler("IncreaseTempo", () =>
        updateSong({
            description: "Increase tempo",
            undoable: true,
            mutator: (s) => s.setTempo(Math.min(240, s.tempo + 1)),
        })
    );
    useActionHandler("DecreaseTempo", () =>
        updateSong({
            description: "Decrease tempo",
            undoable: true,
            mutator: (s) => s.setTempo(Math.max(1, s.tempo - 1)),
        })
    );
    useActionHandler("IncreaseSpeed", () =>
        updateSong({
            description: "Increase speed",
            undoable: true,
            mutator: (s) => s.setSpeed(Math.min(31, s.speed + 1)),
        })
    );
    useActionHandler("DecreaseSpeed", () =>
        updateSong({
            description: "Decrease speed",
            undoable: true,
            mutator: (s) => s.setSpeed(Math.max(1, s.speed - 1)),
        })
    );
    useActionHandler("NextSongOrder", () => {
        const nextPos = Math.min(song.songOrder.length - 1, editorState.activeSongPosition + 1);
        updateEditorState((s) => s.setActiveSongPosition(song, nextPos));
    });
    useActionHandler("PreviousSongOrder", () => {
        const prevPos = Math.max(0, editorState.activeSongPosition - 1);
        updateEditorState((s) => s.setActiveSongPosition(song, prevPos));
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
            const channelIndices = numericRange(0, song.subsystem.channelCount);
            channelIndices.forEach((ch) => {
                s.setChannelMute(ch, false);
                s.setChannelSolo(ch, false);
            });
        });
    });
    useActionHandler("TransposeSelectionDownSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-1, { scope: "selection", instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionUpSemitone", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(1, { scope: "selection", instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionDownOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(-12, { scope: "selection", instrumentIndex: null });
    });
    useActionHandler("TransposeSelectionUpOctave", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.transposeNotes(12, { scope: "selection", instrumentIndex: null });
    });
    useActionHandler("IncrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(1, { scope: "selection", instrumentIndex: null });
    });
    useActionHandler("DecrementInstrumentInSelection", () => {
        if (!patternGridRef.current) return;
        patternGridRef.current?.nudgeInstrumentInSelection(-1, { scope: "selection", instrumentIndex: null });
    });
    mgr.useActionHandler("ToggleCartStatsPanel", () => {
        setSongStatsPanelOpen((open) => !open);
    });
    mgr.useActionHandler("ToggleSongSettingsPanel", () => {
        setSongSettingsPanelOpen((open) => !open);
    });
   mgr.useActionHandler("RenderSongToWav", () => {
      void renderSongToWav();
   });

    useActionHandler("OpenFile", openSongFile);
    useActionHandler("ImportTicCart", () => {
        void importTicCartFile();
    });
    useActionHandler("SaveFile", saveSongFile);
    useActionHandler("NewFile", createNewSong);

    const handleBridgeReady = React.useCallback(
        (handle: Tic80BridgeHandle) => {
            // focus the pattern grid.
            patternGridRef.current?.focusPattern();
            setBridgeReady(true);
            autoSave.enqueue(song);
            autoSave.flush();
        },
        [audio, song]
    );

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
                                        onSelect={() => {
                                            void createNewSong();
                                        }}
                                        shortcut={mgr.getActionBindingLabel("NewFile")}
                                    >
                                        New Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => {
                                            void openSongFile();
                                        }}
                                        shortcut={mgr.getActionBindingLabel("OpenFile")}
                                    >
                                        Open Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => {
                                            void importTicCartFile();
                                        }}
                                        shortcut={mgr.getActionBindingLabel("ImportTicCart")}
                                    >
                                        Import TIC-80 cart...
                                    </DesktopMenu.Item>
                                    {debugMode && (
                                        <DesktopMenu.Item
                                            onSelect={() => {
                                                void importAmigaModFile();
                                            }}
                                            //shortcut={mgr.getActionBindingLabel("ImportAmigaMod")}
                                        >
                                            Import Amiga MOD...
                                        </DesktopMenu.Item>
                                    )}
                                    <DesktopMenu.Item
                                        onSelect={saveSongFile}
                                        shortcut={mgr.getActionBindingLabel("SaveFile")}
                                    >
                                        Save Song...
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        onSelect={() => {
                                            void copyNative();
                                        }}
                                    >
                                        Copy Song JSON
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        onSelect={() => {
                                            void pasteSong();
                                        }}
                                    >
                                        Paste Song JSON
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                            <DesktopMenu.Item
                               shortcut={mgr.getActionBindingLabel("CopyMetadata")}
                               onSelect={() => {
                                  void copySongMetadataJson();
                               }}
                            >
                               Copy Song Metadata JSON
                            </DesktopMenu.Item>
                            <DesktopMenu.Divider />
                            <DesktopMenu.Item
                               disabled={!bridgeReady || audioRenderDialog !== null || song.subsystemType !== kSubsystem.key.TIC80}
                               shortcut={mgr.getActionBindingLabel("RenderSongToWav")}
                               onSelect={() => {
                                  void renderSongToWav();
                               }}
                            >
                               Render Song to Audio...
                            </DesktopMenu.Item>
                            <DesktopMenu.Divider />
                                    <DesktopMenu.Sub>
                                        <DesktopMenu.SubTrigger>Export Cart</DesktopMenu.SubTrigger>
                                        <DesktopMenu.SubContent>
                                            {song.exportConfigurations.map((configuration, index) => (
                                                <DesktopMenu.Item
                                                    key={index}
                                                    onSelect={() => exportCart(configuration)}
                                                >
                                                    {configuration.name}
                                                </DesktopMenu.Item>
                                            ))}
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
                                            return entry ? `Undo ${entry.description}` : "Undo";
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
                                            return entry ? `Redo ${entry.description}` : "Redo";
                                        })()}
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        onSelect={() => {
                                            void optimizeSong();
                                        }}
                                    >
                                        Optimize Song...
                                    </DesktopMenu.Item>
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
                                        onSelect={() => setSongSettingsPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleSongSettingsPanel")}
                                    >
                                        Song Settings
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={patternEditorOpen}
                                        onSelect={() => setPatternEditorOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("TogglePatternEditor")}
                                    >
                                        Pattern Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={advancedEditPanelOpen}
                                        onSelect={() => setAdvancedEditPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleAdvancedEditPanel")}
                                    >
                                        Advanced Edit Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={editorState.showVolumeColumn}
                                        onSelect={() =>
                                            updateEditorState((s) => s.setShowVolumeColumn(!s.showVolumeColumn))
                                        }
                                        shortcut={mgr.getActionBindingLabel("ToggleVolumeColumn")}
                                    >
                                        Volume Column
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={editorState.showPanColumn}
                                        onSelect={() =>
                                            updateEditorState((s) => s.setShowPanColumn(!s.showPanColumn))
                                        }
                                        shortcut={mgr.getActionBindingLabel("TogglePanColumn")}
                                    >
                                        Pan Column
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={editorState.showSomaticColumns}
                                        onSelect={() =>
                                            updateEditorState((s) => s.setShowSomaticColumns(!s.showSomaticColumns))
                                        }
                                        shortcut={mgr.getActionBindingLabel("ToggleSomaticColumns")}
                                    >
                                        Somatic Columns
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                               checked={editorState.showSideChannelData}
                               onSelect={() =>
                                  updateEditorState((s) => s.setShowSideChannelData(!s.showSideChannelData))
                               }
                               shortcut={mgr.getActionBindingLabel("ToggleSideChannelData")}
                            >
                               Side-channel Data
                            </DesktopMenu.Item>
                            <DesktopMenu.Item
                                        checked={waveformEditorPanelOpen}
                                        onSelect={() => setWaveformEditorPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleWaveformEditor")}
                                    >
                                        Waveform Editor
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={instrumentPanelOpen}
                                        onSelect={() => setInstrumentPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleInstrumentPanel")}
                                    >
                                        Instrument Panel
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={instrumentsPanelOpen}
                                        onSelect={() => setInstrumentsPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleInstrumentsPanel")}
                                    >
                                        Instruments
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item
                                        checked={showingOnScreenKeyboard}
                                        onSelect={() => setShowingOnScreenKeyboard((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleOnScreenKeyboard")}
                                    >
                                        On-Screen Keyboard
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={songStatsPanelOpen}
                                        onSelect={() => setSongStatsPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleCartStatsPanel")}
                                    >
                                        Export cartridge metrics
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Item
                                        checked={encodingUtilsPanelOpen}
                                        onSelect={() => setEncodingUtilsPanelOpen((open) => !open)}
                                        shortcut={mgr.getActionBindingLabel("ToggleEncodingUtilsPanel")}
                                    >
                                        Encoding Utilities
                                    </DesktopMenu.Item>
                                    {debugMode && <DesktopMenu.Divider />}
                                    {debugMode && (
                                        <DesktopMenu.Item
                                            checked={themePanelOpen}
                                            onSelect={() => setThemePanelOpen((open) => !open)}
                                        >
                                            Theme Editor
                                        </DesktopMenu.Item>
                                    )}
                                    {debugMode && (
                                        <DesktopMenu.Item
                                            checked={debugPanelOpen}
                                            onSelect={() => setDebugPanelOpen((open) => !open)}
                                            shortcut={mgr.getActionBindingLabel("ToggleDebugPanel")}
                                        >
                                            Debug Panel
                                        </DesktopMenu.Item>
                                    )}
                                    <DesktopMenu.Item
                                        checked={tic80FrameSizeIndex !== 0}
                                        closeOnSelect={false}
                                        onSelect={() => cycleTic80FrameSize()}
                                        shortcut={mgr.getActionBindingLabel("CycleTic80PanelSize")}
                                    >
                                        TIC-80 Size
                                    </DesktopMenu.Item>
                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item checked={theme === "dark"} onSelect={onToggleTheme}>
                                        Dark Theme
                                    </DesktopMenu.Item>
                                </DesktopMenu.Content>
                            </DesktopMenu.Root>
                            <DesktopMenu.Root>
                                <DesktopMenu.Trigger caret={false}>Help</DesktopMenu.Trigger>
                                <DesktopMenu.Content>

                            <DesktopMenu.LinkItem href="https://github.com/nesbox/TIC-80/issues/261#issuecomment-566043505" target="_blank">
                               TIC-80 Pattern effect reference
                            </DesktopMenu.LinkItem>
                            <DesktopMenu.LinkItem href="https://github.com/thenfour/Somatic/wiki" target="_blank">
                               Somatic pattern effect reference
                            </DesktopMenu.LinkItem>


                            <DesktopMenu.Divider />

                                    <DesktopMenu.LinkItem href="https://tic80.com/" target="_blank">
                                        TIC-80 Homepage
                                    </DesktopMenu.LinkItem>
                                    <DesktopMenu.LinkItem
                                        href="https://github.com/nesbox/TIC-80/wiki/Music-Editor"
                                        target="_blank"
                                    >
                                        TIC-80 Music Editor
                                    </DesktopMenu.LinkItem>
                                    <DesktopMenu.LinkItem
                                        href="https://github.com/nesbox/TIC-80/wiki/ram"
                                        target="_blank"
                                    >
                                        TIC-80 memory map
                                    </DesktopMenu.LinkItem>

                                    <DesktopMenu.Divider />

                                    <DesktopMenu.LinkItem
                                        href="https://github.com/nesbox/TIC-80/wiki/ram"
                                        target="_blank"
                                    >
                                        Check out ticbuild
                                    </DesktopMenu.LinkItem>

                                    <DesktopMenu.Divider />

                                    <DesktopMenu.LinkItem href="https://github.com/thenfour/Somatic" target="_blank">
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            Visit Project on GitHub
                                            <GithubLogo />
                                        </div>
                                    </DesktopMenu.LinkItem>
                                    <DesktopMenu.LinkItem href="https://discord.gg/kkf9gQfKAd" target="_blank">
                                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                            Discord
                                            <DiscordLogo />
                                        </div>
                                    </DesktopMenu.LinkItem>

                                    <DesktopMenu.LinkItem href="https://ko-fi.com/E1E71QVJ5Z" target="_blank">
                                        <div style={{ maxWidth: 300, marginBottom: 8 }}>
                                            Somatic is free, a labor of love by tenfour; if you find it useful, please
                                            support by spreading the word or:
                                        </div>
                                        <img
                                            height="36"
                                            style={{ border: 0, height: 36 }}
                                            src="https://storage.ko-fi.com/cdn/kofi6.png?v=6"
                                            alt="Buy Me a Coffee at ko-fi.com"
                                        />
                                    </DesktopMenu.LinkItem>

                                    <DesktopMenu.Divider />
                                    <DesktopMenu.Item onSelect={() => setAboutOpen(true)}>
                                        About Somatic...
                                    </DesktopMenu.Item>
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

                    <Tooltip
                        title={`Click to edit song settings${mgr.getActionBindingLabelAsTooltipSuffix("ToggleSongSettingsPanel")}`}
                    >
                        <div
                            className="raw-button header-song-title"
                            onClick={() => setSongSettingsPanelOpen((x) => !x)}
                        >
                      <Icon path={mdiCog} size={1} />
                            <span>{song.name}</span>
                            <div className='song-metadata-in-header'>
                                <div>Tempo: {song.tempo}</div>
                         <div>Speed: {song.speed}</div>
                            </div>
                        </div>
                    </Tooltip>

                    {appPresence.otherInstanceActive && (
                        <div className="app-presence-contention-warning">
                            ⚠️You have multiple tabs open; that can cause conflicts
                        </div>
                    )}
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
                <div className="leftAsideStack">
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
                        onSetAdvancedEditPanelOpen={(open) => setAdvancedEditPanelOpen(open)}
                        highlightSelectedInstrument={highlightSelectedInstrumentInPatternGrid}
                        highlightStyle={patternGridHighlightStyle}
                    />
                )}
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
                        onOpenInstrumentEditor={() => setInstrumentPanelOpen(true)}
                        onClose={() => setInstrumentsPanelOpen(false)}
                    />
                )}
                {songStatsPanelOpen && (
                    <SongStatsAppPanel
                        data={songStatsData}
                        onClose={() => setSongStatsPanelOpen(false)}
                        exportConfigurations={song.exportConfigurations}
                        exportConfigurationIndex={effectiveSongStatsExportConfigurationIndex}
                        onExportConfigurationChange={setSongStatsExportConfigurationIndex}
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
                        patternGridHighlightStyle={patternGridHighlightStyle}
                        onSetPatternGridHighlightStyle={setPatternGridHighlightStyle}
                    />
                )}
                {themePanelOpen && <ThemeEditorPanel onClose={() => setThemePanelOpen(false)} />}
                {encodingUtilsPanelOpen && <EncodingUtilsPanel onClose={() => setEncodingUtilsPanelOpen(false)} />}
                {debugPanelOpen && <DebugPanel onClose={() => setDebugPanelOpen(false)} />}
            </div>
            <div className="main-app-footer appRow">
                {showingOnScreenKeyboard && (
                    <Keyboard
                        onNoteOn={handleNoteOn}
                        onNoteOff={handleNoteOff}
                        onClose={() => setShowingOnScreenKeyboard(false)}
                    />
                )}

                <AppStatusBar
                    song={song}
                    editorState={editorState}
                    currentColumnType={editorState.patternEditColumnType}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                    rightContent={
                        <>
                            <StatusChips
                                song={song}
                                bridgeReady={bridgeReady}
                                editorState={editorState}
                                toggleEditingEnabled={() =>
                                    updateEditorState((s) => s.setEditingEnabled(!s.editingEnabled))
                                }
                                toggleSongStatsPanel={() => setSongStatsPanelOpen((open) => !open)}
                                keyboardEnabled={keyboardEnabled}
                                toggleKeyboardEnabled={() => setKeyboardEnabled((enabled) => !enabled)}
                                somaticTransportState={somaticTransportState}
                                songStatsData={songStatsData}
                                midiStatus={midiStatus}
                                midiDevices={midiDevices}
                                midiEnabled={midiEnabled}
                                disabledMidiDeviceIds={disabledMidiDeviceIds}
                                toggleMidiEnabled={() => setMidiEnabled((enabled) => !enabled)}
                                audio={audio}
                                autoSave={autoSave}
                            />
                            <VersionAvatar onClick={() => setAboutOpen(true)} resolution={{ w: 6, h: 6 }} scale={5} />
                        </>
                    }
                />
            </div>
          <AudioRenderDialog
             open={audioRenderDialog !== null}
             phase={audioRenderDialog?.phase ?? "preparing"}
             fraction01={audioRenderDialog?.fraction01 ?? 0}
             completedRows={audioRenderDialog?.completedRows ?? 0}
             totalRows={audioRenderDialog?.totalRows ?? 0}
             renderStartedAtMillis={audioRenderDialog?.renderStartedAtMillis ?? null}
             renderCompletedAtMillis={audioRenderDialog?.renderCompletedAtMillis ?? null}
             totalAudioSeconds={audioRenderDialog?.totalAudioSeconds ?? 0}
             sourceWavByteLength={audioRenderDialog?.result?.bytes.byteLength ?? 0}
             analysis={audioRenderDialog?.analysis ?? null}
             preview={audioRenderDialog?.preview ?? null}
             settings={song.audioRenderSettings}
             onSettingsChange={updateAudioRenderSettings}
             onCancel={cancelAudioRender}
             onClose={closeAudioRenderDialog}
             onDownload={() => void downloadAudioRender()}
          />
            <AboutSomaticDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
        </div>
    );
};
