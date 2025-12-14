import fileDialog from 'file-dialog';
import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveSync } from 'save-file';

import './chromatic.css';

import { AudioController } from './audio/controller';
import { useLocalStorage } from './hooks/useLocalStorage';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { HelpPanel } from './ui/help_panel';
import { InstrumentPanel } from './ui/instrument_editor';
import { PatternGrid } from './ui/pattern_grid';
import { SongEditor } from './ui/song_editor';
import { Tic80Bridge, Tic80BridgeHandle } from './ui/Tic80Bridged';
import { Tic80Iframe } from './ui/Tic80EmbedIframe';

type SongMutator = (song: Song) => void;
type EditorStateMutator = (state: EditorState) => void;
type TransportState = 'stop' | 'play-pattern' | 'play-from-position' | 'play-all';
type Theme = 'light' | 'dark';

const useAudioController = (): AudioController => useMemo(() => new AudioController(), []);

const App: React.FC<{ theme: Theme; onToggleTheme: () => void }> = ({ theme, onToggleTheme }) => {
    const audio = useAudioController();
    const [song, setSong] = useState(() => new Song());
    const [editorState, setEditorState] = useState(() => new EditorState());
    const [instrumentPanelOpen, setInstrumentPanelOpen] = useState(false);
    const [helpPanelOpen, setHelpPanelOpen] = useState(false);
    const [transportState, setTransportState] = useState<TransportState>('stop');
    const bridgeRef = React.useRef<Tic80BridgeHandle>(null);

    useEffect(() => {
        audio.song = song;
    }, [audio, song]);

    useEffect(() => {
        const handleStop = () => setTransportState('stop');
        audio.on('stop', handleStop);
        return () => {
            audio.off('stop', handleStop);
        };
    }, [audio]);

    const updateSong = (mutator: SongMutator) => {
        setSong((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
    };

    const updateEditorState = (mutator: EditorStateMutator) => {
        setEditorState((prev) => {
            const next = prev.clone();
            mutator(next);
            return next;
        });
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
            s.setPattern(0);
            s.setSelectedPosition(0);
        });
    };

    const saveSongFile = () => {
        saveSync(song.toJSON(), 'song.cmt');
    };

    const exportLua = () => {
        saveSync(song.getLuaCode(), 'song.lua');
    };

    const copyNative = async () => {
        const text = song.toJSON();
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Copy failed', err);
            alert('Failed to copy song to clipboard.');
        }
    };

    const copyTic = async () => {
        const text = song.getLuaCode();
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Copy failed', err);
            alert('Failed to copy TIC-80 export to clipboard.');
        }
    };

    const pasteSong = async () => {
        try {
            const text = await navigator.clipboard.readText();
            const loaded = Song.fromJSON(text);
            setSong(loaded);
            updateEditorState((s) => {
                s.setPattern(0);
                s.setSelectedPosition(0);
            });
        } catch (err) {
            console.error('Paste failed', err);
            alert('Failed to paste song from clipboard. Ensure it is a valid song JSON.');
        }
    };

    const onStop = () => {
        setTransportState('stop');
        audio.stop();
    };

    const onPlayPattern = () => {
        setTransportState('play-pattern');
        audio.playPattern(song.patterns[editorState.pattern]);
    };

    const onPlayAll = () => {
        setTransportState('play-all');
        audio.playSong(0);
    };

    const onPlayFromPosition = () => {
        setTransportState('play-from-position');
        audio.playSong(editorState.selectedPosition);
    };

    return (
        <div className="app">
            <div className="stickyHeader">
                <div className="menu">
                    <div className="menu-group">
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
                        <button onClick={() => setInstrumentPanelOpen(!instrumentPanelOpen)}><span className="icon" aria-hidden="true">🎛️</span>Instruments</button>
                        <button onClick={() => setHelpPanelOpen(!helpPanelOpen)}><span className="icon" aria-hidden="true">❔</span>Help</button>
                        <button onClick={onToggleTheme}><span className="icon" aria-hidden="true">🌗</span>{theme === 'dark' ? 'Light' : 'Dark'} Mode</button>
                    </div>
                    <span className="menu-separator" aria-hidden="true">|</span>
                    <div className="menu-group">
                        <button className={transportState === 'stop' ? 'active' : undefined} onClick={onStop}>
                            <span className="icon">⏹</span>
                            <span className="caption">Stop</span>
                        </button>
                        <button className={transportState === 'play-pattern' ? 'active' : undefined} onClick={onPlayPattern}><span className="icon" aria-hidden="true">▶</span>Play Pattern</button>
                        <button className={transportState === 'play-from-position' ? 'active' : undefined} onClick={onPlayFromPosition}><span className="icon" aria-hidden="true">⏩</span>Play From Position</button>
                        <button className={transportState === 'play-all' ? 'active' : undefined} onClick={onPlayAll}><span className="icon" aria-hidden="true">🎵</span>Play All</button>
                    </div>
                    <div id="master-volume-container">
                        <label htmlFor="master-volume">master volume</label>
                        <input
                            type="range"
                            min="0"
                            max="500"
                            defaultValue={250}
                            id="master-volume"
                            onChange={(e) => audio.setVolume(e.target.valueAsNumber / 1000)}
                        />
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
            <div className="main-editor-area">
                <PatternGrid song={song} audio={audio} editorState={editorState} onSongChange={updateSong} />
                {instrumentPanelOpen && (
                    <InstrumentPanel
                        song={song}
                        audio={audio}
                        onSongChange={updateSong}
                        onClose={() => setInstrumentPanelOpen(false)}
                    />
                )}
                {helpPanelOpen && (
                    <HelpPanel onClose={() => setHelpPanelOpen(false)} />
                )}

                <div className="tic80-frame">
                    {/* <Tic80Iframe /> */}
                    <Tic80Bridge ref={bridgeRef} />
                </div>
            </div>
        </div>
    );
};

// just a splash which requires user gesture to continue (so the audio context etc are allowed to start)
const SplashScreen: React.FC<{ onContinue: () => void }> = ({ onContinue }) => (
    <div className="splash-screen" onClick={onContinue} onKeyDown={onContinue}>
        <h1>Chromatic</h1>
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

    return hasContinued ? <App theme={theme} onToggleTheme={toggleTheme} /> : <SplashScreen onContinue={() => setHasContinued(true)} />;
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<AppWrapper />);
