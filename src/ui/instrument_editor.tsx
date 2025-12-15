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

    const instrument = song.instruments[selectedInstrument];

    return (
        <div className="instrument-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instrument Editor</label>
                <button onClick={onClose}>Close</button>
            </div>
            <div>
                {/*
                
                instrument (SFX) editor. graphical editor for the instruments described in
                models/instruments.ts

                refer to the TIC-80 SFX editor for the existing native tic-80 editor; the idea is to mimic this
                while sticking to web tech, ergonomics and react paradigms.
                https://github.com/nesbox/TIC-80/wiki/SFX-Editor

                for details about SFX params, ranges, behaviors for individual values,
                https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
                also see tic.h / sound.c located at /TIC-80/...

                refer also to Tic80Caps where we try to avoid hardcoding TIC-80 system limits/values.

                In this react component, we will first allow editing of the sfx fields:
                - instrument name
                - speed
                - stereo left/right enable/disable flags
                - arpeggio reverse flag
                - pitch 16x flag

                NOT needed (they are always ignored):
                - note (semitone-within-octave)
                - octave

                */}
            </div>
        </div>
    );
};
