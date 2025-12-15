import React from 'react';
import { AudioController } from '../audio/controller';
import { Song } from '../models/song';
import { Tic80Caps } from '../models/tic80Capabilities';
import { clamp, TryParseInt } from '../utils/utils';

/*

 instrument (SFX) editor components. graphical editors for the instruments described in
 models/instruments.ts

 refer to the TIC-80 SFX editor for the existing native tic-80 editor; the idea is to mimic this
 while sticking to web tech, ergonomics and react paradigms.
 https://github.com/nesbox/TIC-80/wiki/SFX-Editor

 for details about SFX params, ranges, behaviors for individual values,
 https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#waveforms
 also see tic.h / sound.c located at /TIC-80/...

 refer also to Tic80Caps where we try to avoid hardcoding TIC-80 system limits/values.

*/
export const InstrumentEnvelopeEditor: React.FC<{
    title: string;
    className?: string;
    frames: Int8Array;
    loopStart: number;
    loopLength: number;
    minValue: number; // min value (inclusive) per frame
    maxValue: number; // max value (inclusive) per frame
    onChange: (frames: Int8Array, loopStart: number, loopLength: number) => void;
}> = ({ title, className, frames, loopStart, loopLength, minValue, maxValue, onChange }) => {
    // Implementation of the envelope editor goes here
    return (
        <div className={`instrument-envelope-editor ${className || ''}`}>
            <h3>{title}</h3>
            {/* 
            
            Envelope editor UI.
            Similar to the graphical waveform editor; render an SVG that allows click & drag drawing

            */}
        </div>
    );
};

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

    const handleVolumeEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.volumeFrames = new Int8Array(frames);
            inst.volumeLoopStart = loopStart;
            inst.volumeLoopLength = loopLength;
        });
    };

    const handleWaveEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.waveFrames = new Int8Array(frames);
            inst.waveLoopStart = loopStart;
            inst.waveLoopLength = loopLength;
        });
    };

    const handleArpeggioEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.arpeggioFrames = new Int8Array(frames);
            inst.arpeggioLoopStart = loopStart;
            inst.arpeggioLoopLength = loopLength;
        });
    };

    const handlePitchEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange((s) => {
            const inst = s.instruments[instrumentIndex];
            inst.pitchFrames = new Int8Array(frames);
            inst.pitchLoopStart = loopStart;
            inst.pitchLoopLength = loopLength;
        });
    };

    return (
        <div className="instrument-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instrument Editor</label>
                <button onClick={onClose}>Close</button>
            </div>
            <div className="">
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
                <InstrumentEnvelopeEditor
                    title="Volume Envelope"
                    frames={instrument.volumeFrames}
                    loopStart={instrument.volumeLoopStart}
                    loopLength={instrument.volumeLoopLength}
                    minValue={0}
                    maxValue={Tic80Caps.sfx.volumeMax}
                    onChange={handleVolumeEnvelopeChange}
                />
                <InstrumentEnvelopeEditor
                    title="Waveform Envelope"
                    frames={instrument.waveFrames}
                    loopStart={instrument.waveLoopStart}
                    loopLength={instrument.waveLoopLength}
                    minValue={0}
                    maxValue={Tic80Caps.waveform.count - 1}
                    onChange={handleWaveEnvelopeChange}
                />
                <InstrumentEnvelopeEditor
                    title="Arpeggio Envelope"
                    frames={instrument.arpeggioFrames}
                    loopStart={instrument.arpeggioLoopStart}
                    loopLength={instrument.arpeggioLoopLength}
                    minValue={0}
                    maxValue={Tic80Caps.sfx.arpeggioMax}
                    onChange={handleArpeggioEnvelopeChange}
                />
                <InstrumentEnvelopeEditor
                    title="Pitch Envelope"
                    frames={instrument.pitchFrames}
                    loopStart={instrument.pitchLoopStart}
                    loopLength={instrument.pitchLoopLength}
                    minValue={Tic80Caps.sfx.pitchMin}
                    maxValue={Tic80Caps.sfx.pitchMax}
                    onChange={handlePitchEnvelopeChange}
                />
            </div>
        </div>
    );
};
