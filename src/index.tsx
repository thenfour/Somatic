import fileDialog from 'file-dialog';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveSync } from 'save-file';

import './chromatic.css';

import { AudioController } from './audio/controller';
import type { MusicState } from './audio/backend';
import { useLocalStorage } from './hooks/useLocalStorage';
import { MidiDevice, MidiManager, MidiStatus } from './midi/midi_manager';
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

type SongMutator = (song: Song) => void;
type EditorStateMutator = (state: EditorState) => void;
type TransportState = 'stop' | 'play-pattern' | 'play-from-position' | 'play-all';
type Theme = 'light' | 'dark';

const MusicStateDisplay: React.FC<{ musicState: MusicState }> = ({ musicState }) => {
    return <div className='musicState-panel'>
        <div className='flags'>
            <div className='key'>c_pos</div><div className='value'>{musicState.chromaticSongPosition}</div>
            <div className='key'>t_trk</div><div className='value'>{musicState.tic80TrackIndex}</div>
            <div className='key'>t_frm</div><div className='value'>{musicState.tic80FrameIndex}</div>
            <div className='key'>t_row</div><div className='value'>{musicState.tic80RowIndex}</div>
            {/* <div className='key'>t_lup</div><div className='value'>{state.isLooping ? 'Yes' : 'No'}</div> */}
        </div>
    </div>;
};

const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);
    const midiRef = React.useRef<MidiManager | null>(new MidiManager());
    const patternGridRef = React.useRef<PatternGridHandle | null>(null);
    const audio = useMemo(() => new AudioController({ bridgeGetter: () => bridgeRef.current }), []);
    const { pushToast } = useToasts();
    const { confirm } = useConfirmDialog();
    const [song, setSong] = useState(() => {
        try {
            const saved = localStorage.getItem('chromatic-song');
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
    const [transportState, setTransportState] = useState<TransportState>('stop');
    const [midiStatus, setMidiStatus] = useState<MidiStatus>('pending');
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [musicState, setMusicState] = useState(() => audio.getMusicState());

    const connectedMidiInputs = useMemo(() => midiDevices.filter((d) => d.state === 'connected').length, [midiDevices]);
    const midiIndicatorState = midiStatus === 'ready'
        ? (connectedMidiInputs > 0 ? 'ok' : 'warn')
        : 'off';
    const midiIndicatorLabel = midiStatus === 'ready'
        ? (connectedMidiInputs > 0 ? `MIDI listening (${connectedMidiInputs})` : 'MIDI ready (no devices)')
        : midiStatus === 'pending'
            ? 'MIDI initializing'
            : midiStatus === 'unsupported'
                ? 'MIDI unsupported'
                : midiStatus === 'denied'
                    ? 'MIDI access denied'
                    : 'MIDI error';
    const midiIndicatorTitle = connectedMidiInputs > 0
        ? `${midiIndicatorLabel}: ${connectedMidiInputs} input${connectedMidiInputs === 1 ? '' : 's'} connected`
        : midiIndicatorLabel;

    const toggleEditingEnabled = () => updateEditorState((s) => s.setEditingEnabled(!s.editingEnabled));

    useEffect(() => {
        let animationFrameId: number;
        const poll = () => {
            setMusicState(audio.getMusicState());
            animationFrameId = requestAnimationFrame(poll);
        };
        animationFrameId = requestAnimationFrame(poll);
        return () => cancelAnimationFrame(animationFrameId);
    }, [audio]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button';

            const isBracketLeft = e.code === 'BracketLeft';
            const isBracketRight = e.code === 'BracketRight';
            const isDigit1 = e.code === 'Digit1';
            const hasMeta = e.metaKey || e.ctrlKey;

            // pretty-print key combo.
            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey) parts.push('Meta');
            parts.push(e.code);
            const combo = parts.join('+');
            console.log(`Key combo pressed: ${combo}`);

            if (e.altKey && !hasMeta && isDigit1) {
                e.preventDefault();
                patternGridRef.current?.focusPattern();
                return;
            }
            if (isEditable) return;
            if (e.repeat) return;
            if (hasMeta || e.altKey) return;

            if (!e.shiftKey && isBracketLeft) {
                e.preventDefault();
                updateEditorState((s) => s.setOctave(s.octave - 1));
                return;
            }
            if (!e.shiftKey && isBracketRight) {
                e.preventDefault();
                updateEditorState((s) => s.setOctave(s.octave + 1));
                return;
            }
            if (e.shiftKey && isBracketLeft) {
                e.preventDefault();
                updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument - 1));
                return;
            }
            if (e.shiftKey && isBracketRight) {
                e.preventDefault();
                updateEditorState((s) => s.setCurrentInstrument(s.currentInstrument + 1));
                return;
            }
        };

        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    useEffect(() => {
        audio.setSong(song);
    }, [audio, song]);

    useEffect(() => {
        const handleStop = () => setTransportState('stop');
        const off = audio.onStop(handleStop);
        return () => {
            off();
        };
    }, [audio]);

    const songRef = React.useRef(song);
    const editorRef = React.useRef(editorState);

    useEffect(() => { songRef.current = song; }, [song]);
    useEffect(() => { editorRef.current = editorState; }, [editorState]);

    useEffect(() => {
        const midi = midiRef.current;
        if (!midi) return;

        let offDevices: (() => void) | null = null;
        let offNoteOn: (() => void) | null = null;
        let offNoteOff: (() => void) | null = null;

        midi.init().then(() => {
            setMidiStatus(midi.getStatus());
            setMidiDevices(midi.getDevices());

            offDevices = midi.onDevicesChanged((list) => {
                setMidiDevices(list);
                setMidiStatus(midi.getStatus());
            });

            offNoteOn = midi.onNoteOn((evt) => {
                const s = songRef.current;
                const ed = editorRef.current;
                //const instIdx = clamp(ed.currentInstrument, 0, s.instruments.length - 1);
                //const instrument = s.instruments[instIdx];
                const channel = ToTic80ChannelIndex(ed.patternEditChannel);
                //if (instrument) {
                audio.sfxNoteOn(ed.currentInstrument, evt.note, channel);
                //}

                if (ed.editingEnabled !== false) {
                    const currentPosition = Math.max(0, Math.min(s.songOrder.length - 1, ed.selectedPosition || 0));
                    const currentPatternIndex = s.songOrder[currentPosition] ?? 0;
                    setSong((prev) => {
                        const newSong = prev.clone();
                        const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, newSong.patterns.length - 1));
                        const pat = newSong.patterns[safePatternIndex];
                        //const ch = pat.channels[ed.patternEditChannel];
                        //const rowIndex = clamp(ed.patternEditRow, 0, song.row - 1);
                        //const existingRow = ch.getRow(rowIndex);
                        //ch.setRow(row, 'note', evt.note);
                        //ch.setRow(row, 'instrument', instIdx);
                        const existingCell = pat.getCell(channel, ed.patternEditRow);
                        pat.setCell(channel, ed.patternEditRow, { ...existingCell, midiNote: evt.note, instrumentIndex: ed.currentInstrument });
                        return newSong;
                    });
                }
            });

            offNoteOff = midi.onNoteOff(() => {
                const ed = editorRef.current;
                audio.sfxNoteOff(ed.patternEditChannel);
            });
        });

        return () => {
            offDevices?.();
            offNoteOn?.();
            offNoteOff?.();
        };
    }, [audio]);

    // handlers for clicking the keyboard view note on / off
    const handleNoteOn = (midiNote: number) => {
        const s = song;
        //const instIdx = clamp(editorState.currentInstrument, 0, s.instruments.length - 1);
        //const instrument = s.instruments[instIdx];
        //const channel = Math.max(0, Math.min(3, editorState.patternEditChannel || 0));
        //if (instrument) {
        audio.sfxNoteOn(editorState.currentInstrument, midiNote, editorState.patternEditChannel);
        //}
    };

    const handleNoteOff = (_midiNote: number) => {
        //const channel = clamp(editorState.patternEditChannel, 0, 3);
        audio.sfxNoteOff(editorState.patternEditChannel);
    };

    const updateSong = (mutator: SongMutator) => {
        setSong((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
    };

    // Save song to localStorage whenever it changes
    useEffect(() => {
        try {
            localStorage.setItem('chromatic-song', song.toJSON());
        } catch (err) {
            console.error('Failed to save song to localStorage', err);
        }
    }, [song]);

    const updateEditorState = (mutator: EditorStateMutator) => {
        setEditorState((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
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
            s.setSelectedPosition(0);
        });
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
            s.setSelectedPosition(0);
        });
    };

    const saveSongFile = () => {
        saveSync(song.toJSON(), 'song.cmt');
    };

    const exportLua = () => {
        saveSync("todo", 'song.lua');
    };

    const copyNative = async () => {
        const text = song.toJSON();
        console.log(song.toData());
        try {
            await navigator.clipboard.writeText(text);
            pushToast({ message: 'Song copied to clipboard.', variant: 'success' });
        } catch (err) {
            console.error('Copy failed', err);
            pushToast({ message: 'Failed to copy song to clipboard.', variant: 'error' });
        }
    };

    const copyTic = async () => {
        const text = "todo";
        try {
            await navigator.clipboard.writeText(text);
            pushToast({ message: 'TIC-80 export copied to clipboard.', variant: 'success' });
        } catch (err) {
            console.error('Copy failed', err);
            pushToast({ message: 'Failed to copy TIC-80 export to clipboard.', variant: 'error' });
        }
    };

    const pasteSong = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const loaded = Song.fromJSON(text);
            setSong(loaded);
            updateEditorState((s) => {
                s.setSelectedPosition(0);
            });
            pushToast({ message: 'Song pasted from clipboard.', variant: 'success' });
        } catch (err) {
            console.error('Paste failed', err);
            pushToast({ message: 'Failed to paste song from clipboard. Ensure it is valid song JSON.', variant: 'error' });
        }
    };

    const onStop = () => {
        setTransportState('stop');
        audio.stop();
    };

    const onPlayPattern = () => {
        setTransportState('play-pattern');
        const currentPosition = Math.max(0, Math.min(song.songOrder.length - 1, editorState.selectedPosition || 0));
        const currentPatternIndex = song.songOrder[currentPosition] ?? 0;
        const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, song.patterns.length - 1));
        audio.playPattern(song.patterns[safePatternIndex]);
    };

    const onPlayAll = () => {
        setTransportState('play-all');
        audio.playSong(0);
    };

    const onPlayFromPosition = () => {
        setTransportState('play-from-position');
        audio.playSong(editorState.selectedPosition, editorState.patternEditRow);
    };

    const onPanic = () => {
        setTransportState('stop');
        audio.panic();
    };

    return (
        <div className="app">
            <div className="stickyHeader appRow">
                <div className="menu">
                    <div className="menu-group">
                        <button onClick={createNewSong}><span className="icon" aria-hidden="true">📄</span>New</button>
                        <button onClick={openSongFile}><span className="icon" aria-hidden="true">📂</span>Open</button>
                        <button onClick={saveSongFile}><span className="icon" aria-hidden="true">💾</span>Save</button>
                        <button onClick={exportLua}><span className="icon" aria-hidden="true">📤</span>Export</button>
                    </div>
                    <span className="menu-separator" aria-hidden="true">|</span>
                    <div className="menu-group">
                        <button onClick={copyNative}><span className="icon" aria-hidden="true">📋</span>Copy Native</button>
                        <button onClick={copyTic}><span className="icon" aria-hidden="true">🧾</span>Copy Tic-80</button>
                        <button onClick={pasteSong}><span className="icon" aria-hidden="true">📥</span>Paste</button>
                    </div>
                    <span className="menu-separator" aria-hidden="true">|</span>
                    <div className="menu-group">
                        <button className={waveformEditorPanelOpen ? "active" : ""} onClick={() => setWaveformEditorPanelOpen(!waveformEditorPanelOpen)}><span className="icon" aria-hidden="true">♒</span>Wav</button>
                        <button className={instrumentPanelOpen ? "active" : ""} onClick={() => setInstrumentPanelOpen(!instrumentPanelOpen)}><span className="icon" aria-hidden="true">🎛️</span>Ins</button>
                        <button className={preferencesPanelOpen ? "active" : ""} onClick={() => setPreferencesPanelOpen(!preferencesPanelOpen)}><span className="icon" aria-hidden="true">⚙️</span></button>
                        <button className={themePanelOpen ? "active" : ""} onClick={() => setThemePanelOpen(!themePanelOpen)}><span className="icon" aria-hidden="true">🎨</span></button>
                        <button className={helpPanelOpen ? "active" : ""} onClick={() => setHelpPanelOpen(!helpPanelOpen)}><span className="icon" aria-hidden="true">❔</span></button>
                        <button className={tic80PanelOpen ? "active" : ""} onClick={() => setTic80PanelOpen(!tic80PanelOpen)}><span className="icon" aria-hidden="true">👾</span>Tic-80</button>
                        <button onClick={onToggleTheme}><span className="icon" aria-hidden="true">🌗</span>{theme === 'dark' ? 'Light' : 'Dark'}</button>
                    </div>
                    <span className="menu-separator" aria-hidden="true">|</span>
                    <div className="menu-group">
                        <button onClick={onPanic} title="Stop all audio"><span className="icon" aria-hidden="true">‼</span>Panic</button>
                        <button className={transportState === 'stop' ? 'active' : undefined} onClick={onStop}>
                            <span className="icon">⏹</span>
                            <span className="caption">Stop</span>
                        </button>
                        <button className={transportState === 'play-all' ? 'active' : undefined} onClick={onPlayAll}><span className="icon" aria-hidden="true">▶</span>Song</button>
                        <button className={transportState === 'play-pattern' ? 'active' : undefined} onClick={onPlayPattern}><span className="icon" aria-hidden="true">▶</span>Pat</button>
                        <button className={transportState === 'play-from-position' ? 'active' : undefined} onClick={onPlayFromPosition}><span className="icon" aria-hidden="true">⏩</span>From Position</button>
                    </div>
                    <div className="right-controls">
                        <button
                            className={`edit-toggle ${editorState.editingEnabled ? 'edit-toggle--on' : 'edit-toggle--off'}`}
                            onClick={toggleEditingEnabled}
                            aria-pressed={editorState.editingEnabled}
                            aria-label={editorState.editingEnabled ? 'Disable editing in pattern editor' : 'Enable editing in pattern editor'}
                        >
                            <span className="edit-toggle__dot" aria-hidden="true" />
                            <span className="edit-toggle__label">{editorState.editingEnabled ? 'Edit mode: On' : 'Edit mode: Off'}</span>
                        </button>
                        <div
                            className={`midi-indicator midi-indicator--${midiIndicatorState}`}
                            title={midiIndicatorTitle}
                            aria-label={midiIndicatorTitle}
                            role="status"
                        >
                            <span className="midi-indicator__dot" aria-hidden="true" />
                            <span className="midi-indicator__label">{midiIndicatorLabel}</span>
                        </div>
                        <MusicStateDisplay musicState={musicState} />
                        {/* <div id="master-volume-container">
                            <label htmlFor="master-volume">master volume</label>
                            <input
                                type="range"
                                min="0"
                                max="500"
                                defaultValue={250}
                                id="master-volume"
                                onChange={(e) => audio.setVolume(e.target.valueAsNumber / 1000)}
                            />
                        </div> */}
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
                    <Tic80Bridge ref={bridgeRef} />
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
        <h1>Chromatic</h1>
        <p>A tracker for TIC-80</p>
        <button style={{ pointerEvents: 'none' }}>Click to Continue</button>
    </div>
);

// just wrapps <App /> to gate on user gesture via splash screen
const AppWrapper: React.FC = () => {
    const [hasContinued, setHasContinued] = useState(false);
    const [theme, setTheme] = useLocalStorage<Theme>('chromatic-theme', 'light');

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
                {hasContinued
                    ? <App theme={theme} onToggleTheme={toggleTheme} />
                    : <SplashScreen onContinue={() => setHasContinued(true)} />}
            </ConfirmDialogProvider>
        </ToastProvider>
    );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<AppWrapper />);
