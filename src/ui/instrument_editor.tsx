import React, { useMemo, useState } from 'react';
import { AudioController } from '../audio/controller';
import { Song } from '../models/song';
import { Tic80Instrument, Tic80InstrumentDto } from '../models/instruments';
import { SomaticCaps, Tic80Caps } from '../models/tic80Capabilities';
import { assert, clamp, TryParseInt } from '../utils/utils';
import { WaveformCanvas, WaveformCanvasHover } from './waveform_canvas';
import { useClipboard } from '../hooks/useClipboard';
import { WaveformSelect } from './waveformEditor';
import { WaveformSwatch } from './waveformSwatch';
import './instrument_editor.css';

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
    onHoverChange?: (hover: WaveformCanvasHover | null) => void;
}> = ({ title, className, frames, loopStart, loopLength, minValue, maxValue, onChange, onHoverChange }) => {
    const frameCount = frames.length;
    const valueRange = maxValue - minValue;
    const canvasMaxValue = valueRange <= 0 ? 0 : valueRange;
    const clipboard = useClipboard();

    const handleCanvasChange = (nextValues: number[]) => {
        assert(nextValues.length === frameCount, 'Unexpected frame count in canvas change');
        const nextFrames = new Int8Array(nextValues);
        onChange(nextFrames, loopStart, loopLength);
    };

    const canvasValues = useMemo(() => {
        return [...frames]; // canvas does its own internal clamping.
    }, [frames]);

    const handleLoopStartChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        const nextStart = clamp(val, 0, Math.max(0, frameCount - 1));
        const nextLength = clamp(loopLength, 0, Math.max(0, frameCount - 1));
        onChange(frames, nextStart, nextLength);
    };

    const handleLoopLengthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        const maxLen = Math.max(0, frameCount - 1);
        const nextLength = clamp(val, 0, maxLen);
        const nextStart = clamp(loopStart, 0, maxLen);
        onChange(frames, nextStart, nextLength);
    };

    const handleRotateUp = () => {
        const nextFrames = new Int8Array(frames.map(v => clamp(v + 1, minValue, maxValue)));
        onChange(nextFrames, loopStart, loopLength);
    };

    const handleRotateDown = () => {
        const nextFrames = new Int8Array(frames.map(v => clamp(v - 1, minValue, maxValue)));
        onChange(nextFrames, loopStart, loopLength);
    };

    const handleRotateLeft = () => {
        if (frameCount === 0) return;
        const nextFrames = new Int8Array(frameCount);
        for (let i = 0; i < frameCount; i++) {
            nextFrames[i] = frames[(i + 1) % frameCount];
        }
        onChange(nextFrames, loopStart, loopLength);
    };

    const handleRotateRight = () => {
        if (frameCount === 0) return;
        const nextFrames = new Int8Array(frameCount);
        for (let i = 0; i < frameCount; i++) {
            nextFrames[i] = frames[(i - 1 + frameCount) % frameCount];
        }
        onChange(nextFrames, loopStart, loopLength);
    };

    const handleCopy = async () => {
        await clipboard.copyObjectToClipboard({
            frames: Array.from(frames),
            loopStart,
            loopLength,
        });
    };

    const handlePaste = async () => {
        const data = await clipboard.readObjectFromClipboard<{
            frames: number[];
            loopStart: number;
            loopLength: number;
        }>();
        if (!data || !Array.isArray(data.frames)) return;
        const nextFrames = new Int8Array(
            data.frames.slice(0, frameCount).map(v => clamp(v, minValue, maxValue))
        );
        // Pad with zeros if pasted data is shorter
        if (nextFrames.length < frameCount) {
            const padded = new Int8Array(frameCount);
            padded.set(nextFrames);
            onChange(padded, data.loopStart ?? loopStart, data.loopLength ?? loopLength);
        } else {
            onChange(nextFrames, data.loopStart ?? loopStart, data.loopLength ?? loopLength);
        }
    };

    return (
        <div className={`instrument-envelope-editor ${className || ''}`}>
            <div className="instrument-envelope-editor__header">
                <h4>{title}</h4>
                <div className="instrument-envelope-editor__loop-controls">
                    <label>
                        Loop start
                        <input
                            type="number"
                            min={0}
                            max={Math.max(0, frameCount - 1)}
                            value={loopStart}
                            onChange={handleLoopStartChange}
                        />
                    </label>
                    <label>
                        Loop len
                        <input
                            type="number"
                            min={0}
                            max={Math.max(0, frameCount - 1)}
                            value={loopLength}
                            onChange={handleLoopLengthChange}
                        />
                    </label>
                </div>
            </div>
            <div className="instrument-envelope-editor__content">
                <WaveformCanvas
                    values={canvasValues}
                    maxValue={canvasMaxValue}
                    // Envelopes tend to be more compact than full waveforms.
                    scale={{ x: 16, y: 12 }}
                    className="instrument-envelope"
                    onChange={handleCanvasChange}
                    supportsLoop={true}
                    loopStart={loopStart}
                    loopLength={loopLength}
                    onHoverChange={onHoverChange}
                />
                <div className="instrument-envelope-editor__controls">
                    <button onClick={handleRotateUp} title="Rotate up">↑</button>
                    <button onClick={handleRotateDown} title="Rotate down">↓</button>
                    <button onClick={handleRotateLeft} title="Rotate left">←</button>
                    <button onClick={handleRotateRight} title="Rotate right">→</button>
                    <button onClick={handleCopy} title="Copy">Copy</button>
                    <button onClick={handlePaste} title="Paste">Paste</button>
                </div>
            </div>
        </div>
    );
};

type InstrumentPanelProps = {
    song: Song;
    audio: AudioController;
    currentInstrument: number;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onClose: () => void;
};

export const InstrumentPanel: React.FC<InstrumentPanelProps> = ({ song, currentInstrument, onSongChange, onClose }) => {
    const instrumentIndex = currentInstrument;
    const instrument = song.instruments[instrumentIndex];
    const clipboard = useClipboard();
    const [hoveredWaveform, setHoveredWaveform] = useState<WaveformCanvasHover | null>(null);

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        onSongChange({
            description: 'Rename instrument',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.name = value;
            },
        });
    };

    const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = TryParseInt(e.target.value);
        if (val === null) return;
        onSongChange({
            description: 'Change instrument speed',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.speed = clamp(val, 0, Tic80Caps.sfx.speedMax);
            },
        });
    };

    const handleStereoLeftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange({
            description: 'Toggle stereo left',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.stereoLeft = checked;
            },
        });
    };

    const handleStereoRightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange({
            description: 'Toggle stereo right',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.stereoRight = checked;
            },
        });
    };

    const handleArpeggioReverseChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange({
            description: 'Toggle arpeggio reverse',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.arpeggioDown = checked;
            },
        });
    };

    const handlePitch16xChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const checked = e.target.checked;
        onSongChange({
            description: 'Toggle pitch 16x',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.pitch16x = checked;
            },
        });
    };

    const handleVolumeEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange({
            description: 'Edit volume envelope',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.volumeFrames = new Int8Array(frames);
                inst.volumeLoopStart = loopStart;
                inst.volumeLoopLength = loopLength;
            },
        });
    };

    const handleWaveEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange({
            description: 'Edit wave envelope',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.waveFrames = new Int8Array(frames);
                inst.waveLoopStart = loopStart;
                inst.waveLoopLength = loopLength;
            },
        });
    };

    const handleArpeggioEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange({
            description: 'Edit arpeggio envelope',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.arpeggioFrames = new Int8Array(frames);
                inst.arpeggioLoopStart = loopStart;
                inst.arpeggioLoopLength = loopLength;
            },
        });
    };

    const handlePitchEnvelopeChange = (frames: Int8Array, loopStart: number, loopLength: number) => {
        onSongChange({
            description: 'Edit pitch envelope',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.pitchFrames = new Int8Array(frames);
                inst.pitchLoopStart = loopStart;
                inst.pitchLoopLength = loopLength;
                //console.log('pitch envelope changed', frames, loopStart, loopLength);
            },
        });
    };

    const handleCopy = async () => {
        await clipboard.copyObjectToClipboard(instrument.toData());
    };

    const handlePaste = async () => {
        const data = await clipboard.readObjectFromClipboard<Tic80InstrumentDto>();
        onSongChange({
            description: 'Paste instrument',
            undoable: true,
            mutator: (s) => {
                s.instruments[instrumentIndex] = Tic80Instrument.fromData(data);
            },
        });
    };

    // get a list of waveformIDs used in order, removing adjascent dupes
    const usedWaveformIDs: { waveformId: number, isHovered: boolean, minIndex: number, len: number }[] = [];
    let lastWaveformID = null;
    for (let i = 0; i < instrument.waveFrames.length; i++) {
        const waveformId = instrument.waveFrames[i];
        if (waveformId !== lastWaveformID) {
            usedWaveformIDs.push({
                waveformId,
                isHovered: false, // to fill in later
                minIndex: i,
                len: 1,
            });
            lastWaveformID = waveformId;
        }
        else {
            // increment length of last entry
            usedWaveformIDs[usedWaveformIDs.length - 1].len++;
        }
    }
    // mark hovered waveform if any
    if (hoveredWaveform) {
        for (let entry of usedWaveformIDs) {
            if (hoveredWaveform.index >= entry.minIndex && hoveredWaveform.index < entry.minIndex + entry.len) {
                entry.isHovered = true;
                break;
            }
        }
    }

    return (
        <div className="instrument-panel app-panel">
            <div className="toolbar">
                <label htmlFor="instrument">Instrument Editor</label>
                {instrumentIndex === 0 && <div className='alertPanel'>!! instrument 0 is weird and should not be used.</div>}
                {instrumentIndex === SomaticCaps.noteCutInstrumentIndex && <div className='alertPanel'>!! This is the note-off sfx and should not be edited.</div>}
                <button onClick={handleCopy}>Copy</button>
                <button onClick={handlePaste}>Paste</button>
                <button onClick={onClose}>Close</button>
            </div>
            <div className="">
                <div className="field-row">
                    <div className='instrument-index'>{instrumentIndex.toString(16).toUpperCase()}:</div>
                    {/* <label htmlFor="instrument-name">Name</label> */}
                    <input
                        //id="instrument-name"
                        className='instrument-name'
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
                <InstrumentEnvelopeEditor
                    title="Volume"
                    frames={instrument.volumeFrames}
                    loopStart={instrument.volumeLoopStart}
                    loopLength={instrument.volumeLoopLength}
                    minValue={0}
                    maxValue={Tic80Caps.sfx.volumeMax}
                    onChange={handleVolumeEnvelopeChange}
                />
                <div style={{ display: "flex", gap: "8px" }}>
                    <InstrumentEnvelopeEditor
                        title="Waveforms"
                        frames={instrument.waveFrames}
                        loopStart={instrument.waveLoopStart}
                        loopLength={instrument.waveLoopLength}
                        minValue={0}
                        maxValue={Tic80Caps.waveform.count - 1}
                        onChange={handleWaveEnvelopeChange}
                        onHoverChange={(hover) => setHoveredWaveform(hover)}
                    />

                    <div className="waveform-swatch-previews" style={{ marginTop: 75 /* crude alignment with editor */ }}>
                        <WaveformSelect
                            onClickWaveform={(waveformId) => {
                                // set whole env to this waveform
                                onSongChange({
                                    description: 'Set waveform sequence',
                                    undoable: true,
                                    mutator: (s) => {
                                        const inst = s.instruments[instrumentIndex];
                                        inst.waveFrames = new Int8Array(inst.waveFrames.length).fill(waveformId);
                                    },
                                });
                            }}
                            song={song}
                            getOverlayText={(i) => {
                                const isNoise = song.waveforms[i]?.isNoise() ?? false;
                                return `${i.toString(16).toUpperCase()}${isNoise ? ' (Noise)' : ''}`;
                            }}
                            getWaveformDisplayStyle={(waveformId) => {
                                if (hoveredWaveform === null) {
                                    // no hover; just highlight all the USED waveforms
                                    if (instrument.waveFrames.includes(waveformId)) {
                                        return "normal";
                                    }
                                    return "muted";
                                }
                                if (hoveredWaveform && waveformId === hoveredWaveform.value) {
                                    return "selected";
                                }
                                // interesting but introduces a 4th display styl...
                                // if (instrument.waveFrames.includes(waveformId)) {
                                //     return "normal";
                                // }

                                if (waveformId === hoveredWaveform?.actualValue) {
                                    return "normal";
                                }

                                return "muted";
                            }}
                        />
                        {/* <div className="waveform-swatch-preview" style={{ visibility: (hoveredWaveform == null ? "hidden" : undefined) }}>
                            <span>actual</span>
                            <WaveformSwatch
                                value={song.waveforms[hoveredWaveform?.actualValue || 0]}
                                scale={4}
                            />
                        </div>
                        <div className="waveform-swatch-preview" style={{ visibility: (hoveredWaveform == null ? "hidden" : undefined) }}>
                            <span>hovered</span>
                            <WaveformSwatch
                                value={song.waveforms[hoveredWaveform?.value || 0]}
                                scale={4}
                            />
                        </div> */}
                    </div>
                </div>
                <div className='waveformSequence'>
                    <strong>Waveform sequence:</strong>
                    <div className='waveformSequence__list' style={{ display: "flex", gap: "3px", maxWidth: 600, flexWrap: "wrap" }}>
                        {usedWaveformIDs.map((waveformId, index) => (
                            <WaveformSwatch
                                key={index}
                                value={song.waveforms[waveformId.waveformId]}
                                displayStyle={waveformId.isHovered ? "normal" : "muted"}
                                scale={2}
                            />
                        ))}
                    </div>
                </div>
                <InstrumentEnvelopeEditor
                    title="Arpeggio"
                    frames={instrument.arpeggioFrames}
                    loopStart={instrument.arpeggioLoopStart}
                    loopLength={instrument.arpeggioLoopLength}
                    minValue={0}
                    maxValue={Tic80Caps.sfx.arpeggioMax}
                    onChange={handleArpeggioEnvelopeChange}
                />
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
                <InstrumentEnvelopeEditor
                    title="Pitch"
                    frames={instrument.pitchFrames}
                    loopStart={instrument.pitchLoopStart}
                    loopLength={instrument.pitchLoopLength}
                    minValue={Tic80Caps.sfx.pitchMin}
                    maxValue={Tic80Caps.sfx.pitchMax}
                    onChange={handlePitchEnvelopeChange}
                />
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
