import React from 'react';
import { AudioController } from '../audio/controller';
import { Song } from '../models/song';
import { Tic80Caps } from '../models/tic80Capabilities';
import { clamp, TryParseInt } from '../utils/utils';

type InstrumentPanelProps = {
    song: Song;
    audio: AudioController;
    currentInstrument: number;
    onSongChange: (mutator: (song: Song) => void) => void;
    onClose: () => void;
};

export const InstrumentPanel: React.FC<InstrumentPanelProps> = ({ song, currentInstrument, onSongChange, onClose }) => {
    const instrumentIndex = currentInstrument;
    const instrument = song.instruments[instrumentIndex];

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.name = value;
        });
    };

    const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.speed = clamp(val, 0, Tic80Caps.sfx.speedMax);
        });
    };

    const handleStereoLeftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.stereoLeft = checked;
        });
    };

    const handleStereoRightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.stereoRight = checked;
        });
    };

    const handleArpeggioReverseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.arpeggioDown = checked;
        });
    };

    const handlePitch16xChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.pitch16x = checked;
        });
    };

    if (!instrument) {
        return (
            <div className="instrument-panel">
                <div className="toolbar">
                    <label htmlFor="instrument">Instrument Editor</label>
                    <button onClick={onClose}>Close</button>
                </div>
                <div className="section">
                    <p>No instrument selected.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="instrument-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instrument Editor</label>
                <button onClick={onClose}>Close</button>
            </div>
            <div className="">
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
                <div className="field-row">
                    <label htmlFor="instrument-name">Name</label>
                    <input
                        id="instrument-name"
                        type="text"
                        value={instrument.name}
                        onChange={handleNameChange}
                    />
                </div>
                <div className="field-row">
                    <label htmlFor="instrument-speed">Speed</label>
                    <input
                        id="instrument-speed"
                        type="number"
                        min={0}
                        max={Tic80Caps.sfx.speedMax}
                        value={instrument.speed}
                        onChange={handleSpeedChange}
                    />
                </div>
                <div className="field-row">
                    <label>Stereo</label>
                    <label>
                        <input
                            type="checkbox"
                            checked={instrument.stereoLeft}
                            onChange={handleStereoLeftChange}
                        />
                        L
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={instrument.stereoRight}
                            onChange={handleStereoRightChange}
                        />
                        R
                    </label>
                </div>
                <div className="field-row">
                    <label>
                        <input
                            type="checkbox"
                            checked={instrument.arpeggioDown}
                            onChange={handleArpeggioReverseChange}
                        />
                        Arpeggio reverse
                    </label>
                </div>
                <div className="field-row">
                    <label>
                        <input
                            type="checkbox"
                            checked={instrument.pitch16x}
                            onChange={handlePitch16xChange}
                        />
                        Pitch 16x
                    </label>
                </div>
            </div>
        </div>
    );
};
