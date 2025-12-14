import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AudioController } from '../audio/controller';
import { NOTE_NAMES, NOTES_BY_NUM, OCTAVE_COUNT } from '../defs';
import { Wave, waveType } from '../models/instruments';
import { Song } from '../models/song';
import { Scope } from './scope';

const KEY_POSITIONS = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

type KeyboardProps = {
    instrument: Wave;
    audio: AudioController;
};

const Keyboard: React.FC<KeyboardProps> = ({ instrument, audio }) => {
    const [activeNote, setActiveNote] = useState<string | null>(null);

    const onMouseUp = useCallback(() => {
        setActiveNote(null);
        audio.stop();
    }, [audio]);

    useEffect(() => {
        window.addEventListener('mouseup', onMouseUp);
        return () => window.removeEventListener('mouseup', onMouseUp);
    }, [onMouseUp]);

    const playNote = (midiNoteValue: number, noteLabel: string) => {
        audio.playInstrument(instrument, midiNoteValue);
        setActiveNote(noteLabel);
    };

    const keys = [] as Array<{
        id: string;
        noteName: string;
        midiNoteValue: number;
        className: string;
        left: number;
    }>;
    for (let oct = 1; oct <= OCTAVE_COUNT; oct++) {
        for (let n = 0; n < 12; n++) {
            const midiNoteValue = oct * 12 + n - 11;
            const noteName = NOTE_NAMES[n] + oct;
            if (!NOTES_BY_NUM[midiNoteValue]) continue;
            const isBlack = [1, 3, 6, 8, 10].includes(n);
            keys.push({
                id: `${oct}-${n}`,
                noteName,
                midiNoteValue,
                className: `key ${isBlack ? 'black' : 'white'} ${activeNote === noteName ? 'active' : ''}`,
                left: ((oct - 1) * 7 + KEY_POSITIONS[n]) * 32,
            });
        }
    }

    return (
        <ul id="keyboard">
            {keys.map((key) => (
                <button
                    key={key.id}
                    className={key.className}
                    style={{ left: `${key.left}px` }}
                    onMouseDown={() => playNote(key.midiNoteValue, key.noteName)}
                >
                    {key.noteName}
                </button>
            ))}
        </ul>
    );
};

type HarmonicsInputsProps = {
    instrument: Wave;
    onChange: (harmonics: number[]) => void;
};

const HarmonixInputs: React.FC<HarmonicsInputsProps> = ({ instrument, onChange }) => (
    <fieldset>
        <legend>Harmonics</legend>
        <div id="harmonics">
            {instrument.harmonics.map((value, idx) => (
                <input
                    key={idx}
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={value}
                    onChange={(e) => {
                        const next = [...instrument.harmonics];
                        next[idx] = parseFloat(e.target.value);
                        onChange(next);
                    }}
                />
            ))}
        </div>
    </fieldset>
);

type PhaseFieldsProps = {
    instrument: Wave;
    onChange: (changes: Partial<Wave>) => void;
};

const PhaseFields: React.FC<PhaseFieldsProps> = ({ instrument, onChange }) => (
    <fieldset>
        <legend>Phase</legend>
        <label>
            Min
            <input
                type="number"
                min={0}
                max={32}
                value={instrument.phaseMin}
                onChange={(e) => onChange({ phaseMin: parseInt(e.target.value, 10) })}
            />
        </label>
        <label>
            Max
            <input
                type="number"
                min={0}
                max={32}
                value={instrument.phaseMax}
                onChange={(e) => onChange({ phaseMax: parseInt(e.target.value, 10) })}
            />
        </label>
        <label>
            Period
            <input
                type="number"
                min={0}
                max={256}
                value={instrument.phasePeriod}
                onChange={(e) => onChange({ phasePeriod: parseInt(e.target.value, 10) })}
            />
        </label>
    </fieldset>
);

type EnvelopeFieldsProps = {
    instrument: Wave;
    onChange: (changes: Partial<Wave>) => void;
};

const EnvelopeFields: React.FC<EnvelopeFieldsProps> = ({ instrument, onChange }) => (
    <fieldset>
        <legend>Envelope</legend>
        <label>
            Decay speed
            <input
                type="number"
                min={0}
                max={256}
                value={instrument.decaySpeed}
                onChange={(e) => onChange({ decaySpeed: parseInt(e.target.value, 10) })}
            />
        </label>
        <label>
            Decay to volume
            <input
                type="number"
                min={0}
                max={15}
                value={instrument.decayTo}
                onChange={(e) => onChange({ decayTo: parseInt(e.target.value, 10) })}
            />
        </label>
    </fieldset>
);

type VibratoFieldsProps = {
    instrument: Wave;
    onChange: (changes: Partial<Wave>) => void;
};

const VibratoFields: React.FC<VibratoFieldsProps> = ({ instrument, onChange }) => (
    <fieldset>
        <legend>Vibrato</legend>
        <label>
            Depth
            <input
                type="number"
                min={0}
                max={256}
                value={instrument.vibratoDepth}
                onChange={(e) => onChange({ vibratoDepth: parseInt(e.target.value, 10) })}
            />
        </label>
        <label>
            Period
            <input
                type="number"
                min={0}
                max={256}
                value={instrument.vibratoPeriod}
                onChange={(e) => onChange({ vibratoPeriod: parseInt(e.target.value, 10) })}
            />
        </label>
    </fieldset>
);

type InstrumentEditorProps = {
    instrument: Wave;
    onInstrumentChange: (updater: (inst: Wave) => void) => void;
    audio: AudioController;
};

const InstrumentEditor: React.FC<InstrumentEditorProps> = ({ instrument, onInstrumentChange, audio }) => {
    const [scrub, setScrub] = useState(0);

    const updateInstrument = (changes: Partial<Wave>) => {
        onInstrumentChange((inst) => Object.assign(inst, changes));
    };

    const disablePhase = instrument.waveType === waveType.NOISE || instrument.waveType === waveType.SINE || instrument.waveType === waveType.SAMPLE;
    const disableHarmonics = instrument.waveType === waveType.NOISE || instrument.waveType === waveType.SAMPLE;
    const disableEnvelope = instrument.waveType === waveType.SAMPLE;

    return (
        <div>
            <div className="section">
                <div className="left-col">
                    <label>
                        Instrument name
                        <input
                            type="text"
                            value={instrument.name}
                            onChange={(e) => updateInstrument({ name: e.target.value })}
                        />
                    </label>
                    <Scope instrument={instrument} scrub={scrub} audio={audio} />
                </div>
                <div id="parameters">
                    <div>
                        <label>
                            Wave type
                            <select
                                value={instrument.waveType}
                                onChange={(e) => updateInstrument({ waveType: parseInt(e.target.value, 10) as Wave['waveType'] })}
                            >
                                <option value={waveType.SQUARE}>Square</option>
                                <option value={waveType.TRIANGLE}>Triangle</option>
                                <option value={waveType.SINE}>Sine</option>
                                <option value={waveType.NOISE}>Noise</option>
                                <option value={waveType.SAMPLE}>Sample</option>
                            </select>
                        </label>
                    </div>
                    <div>
                        <label>
                            Transpose
                            <input
                                type="number"
                                min={-24}
                                max={24}
                                value={instrument.transpose}
                                onChange={(e) => updateInstrument({ transpose: parseInt(e.target.value, 10) })}
                            />
                        </label>
                    </div>
                    <div>
                        <label>
                            Pitch slide step
                            <input
                                type="number"
                                min={-256}
                                max={256}
                                value={instrument.slideStep}
                                onChange={(e) => updateInstrument({ slideStep: parseInt(e.target.value, 10) })}
                            />
                        </label>
                    </div>
                    {!disablePhase && <PhaseFields instrument={instrument} onChange={updateInstrument} />}
                    {!disableEnvelope && <EnvelopeFields instrument={instrument} onChange={updateInstrument} />}
                    {!disableEnvelope && <VibratoFields instrument={instrument} onChange={updateInstrument} />}
                    {!disableHarmonics && (
                        <div className="section">
                            <HarmonixInputs instrument={instrument} onChange={(harmonics) => updateInstrument({ harmonics })} />
                        </div>
                    )}
                </div>
            </div>
            <div className="section">
                <label htmlFor="scrub">Time</label>
                <input
                    id="scrub"
                    type="range"
                    min={0}
                    max={60}
                    value={scrub}
                    onChange={(e) => setScrub(parseInt(e.target.value, 10))}
                />
                <span id="scrub-value">{scrub}</span>
            </div>
            <Keyboard instrument={instrument} audio={audio} />
        </div>
    );
};

type InstrumentPanelProps = {
    song: Song;
    audio: AudioController;
    currentInstrument: number;
    onCurrentInstrumentChange: (inst: number) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
    onClose: () => void;
};

export const InstrumentPanel: React.FC<InstrumentPanelProps> = ({ song, audio, currentInstrument, onCurrentInstrumentChange, onSongChange, onClose }) => {
    const selectedInstrument = currentInstrument;

    const instrumentOptions = useMemo(
        () => song.instruments.map((inst, idx) => ({ idx, name: inst.name || `Instrument ${idx}` })),
        [song],
    );

    const onInstrumentChange = (updater: (inst: Wave) => void) => {
        onSongChange((s) => {
            const inst = s.instruments[selectedInstrument];
            updater(inst);
        });
    };

    const instrument = song.instruments[selectedInstrument] || new Wave();

    return (
        <div className="instrument-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instruments</label>
                <select
                    id="instrument"
                    value={selectedInstrument}
                    onChange={(e) => onCurrentInstrumentChange(parseInt(e.target.value, 10))}
                >
                    {instrumentOptions.map((opt) => (
                        <option key={opt.idx} value={opt.idx} disabled={opt.idx === 0}>
                            {opt.idx} - {opt.name}
                        </option>
                    ))}
                </select>
                <button onClick={onClose}>Close</button>
            </div>
            <InstrumentEditor instrument={instrument} onInstrumentChange={onInstrumentChange} audio={audio} />
        </div>
    );
};
