import React, { useState } from 'react';
import { AudioController } from '../audio/controller';
import { Tic80Instrument } from '../models/instruments';
import { Song } from '../models/song';

type InstrumentPanelProps = {
    song: Song;
    audio: AudioController;
    currentInstrument: number;
    onSongChange: (mutator: (song: Song) => void) => void;
    onClose: () => void;
};

export const InstrumentPanel: React.FC<InstrumentPanelProps> = ({ song, audio, currentInstrument, onSongChange, onClose }) => {
    const selectedInstrument = currentInstrument;

    const instrument = song.instruments[selectedInstrument] || new Tic80Instrument();

    return (
        <div className="instrument-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instrument Editor</label>
                <button onClick={onClose}>Close</button>
            </div>
            <div>
                <div>Name: {instrument.name || `(unnamed)`}</div>
            </div>
        </div>
    );
};
