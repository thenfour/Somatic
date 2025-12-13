import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveSync } from 'save-file';
import fileDialog from 'file-dialog';

import './chromatic.css';

import { AudioController } from './audio/controller';
import { EditorState } from './models/editor_state';
import { Song } from './models/song';
import { InstrumentPanel } from './ui/instrument_editor';
import { PatternGrid } from './ui/pattern_grid';
import { SongEditor } from './ui/song_editor';

type SongMutator = (song: Song) => void;
type EditorStateMutator = (state: EditorState) => void;

const useAudioController = (): AudioController => useMemo(() => new AudioController(), []);

const App: React.FC = () => {
    const audio = useAudioController();
    const [song, setSong] = useState(() => new Song());
    const [editorState, setEditorState] = useState(() => new EditorState());
    const [instrumentPanelOpen, setInstrumentPanelOpen] = useState(false);

    useEffect(() => {
        audio.song = song;
    }, [audio, song]);

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

    const onPlayPattern = () => {
        audio.playPattern(song.patterns[editorState.pattern]);
    };

    const onPlayAll = () => {
        audio.playSong(0);
    };

    const onPlayFromPosition = () => {
        audio.playSong(editorState.selectedPosition);
    };

    return (
        <div className="app">
            <div className="stickyHeader">
                <div className="menu">
                    <button onClick={openSongFile}>Open</button>
                    <button onClick={saveSongFile}>Save</button>
                    <button onClick={copyNative}>Copy Native</button>
                    <button onClick={copyTic}>Copy Tic-80</button>
                    <button onClick={pasteSong}>Paste</button>
                    <button onClick={exportLua}>Export</button>
                    <button onClick={() => setInstrumentPanelOpen(true)}>Instruments</button>
                    <button onClick={() => audio.stop()}>Stop</button>
                    <button onClick={onPlayPattern}>Play Pattern</button>
                    <button onClick={onPlayAll}>Play All</button>
                    <button onClick={onPlayFromPosition}>Play From Position</button>
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
                    {instrumentPanelOpen && (
                        <InstrumentPanel
                            song={song}
                            audio={audio}
                            onSongChange={updateSong}
                            onClose={() => setInstrumentPanelOpen(false)}
                        />
                    )}
                </div>

                <SongEditor
                    song={song}
                    audio={audio}
                    editorState={editorState}
                    onSongChange={updateSong}
                    onEditorStateChange={updateEditorState}
                />
            </div>
            <PatternGrid song={song} audio={audio} editorState={editorState} onSongChange={updateSong} />
        </div>
    );
};

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<App />);
