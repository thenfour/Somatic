import React, { useMemo, useState } from 'react';
import { AudioController } from '../audio/controller';
import { Song } from '../models/song';
import { ModSource, SomaticInstrumentWaveEngine, Tic80Instrument, Tic80InstrumentDto } from '../models/instruments';
import { SomaticCaps, Tic80Caps } from '../models/tic80Capabilities';
import { assert, clamp } from '../utils/utils';
import { WaveformCanvas, WaveformCanvasHover } from './waveform_canvas';
import { useClipboard } from '../hooks/useClipboard';
import { WaveformSelect } from './waveformEditor';
import { WaveformSwatch } from './waveformSwatch';
import './instrument_editor.css';
import { AppPanelShell } from './AppPanelShell';
import { RadioButton } from './basic/RadioButton';
import { Tooltip } from './basic/tooltip';
import { ContinuousKnob, ContinuousParamConfig } from './basic/knob';
import { TabPanel, Tab } from './basic/Tabs';
import { InstrumentChip } from './InstrumentChip';

const PWMDutyConfig: ContinuousParamConfig = {
    resolutionSteps: 32,
    default: 15,
    convertTo01: (v) => v / 31,
    convertFrom01: (v01) => v01 * 31,
    format: (v) => v.toFixed(0),
};

const SpeedConfig: ContinuousParamConfig = {
    resolutionSteps: Tic80Caps.sfx.speedMax + 1,
    default: 0,
    convertTo01: (v) => v / Tic80Caps.sfx.speedMax,
    convertFrom01: (v01) => v01 * Tic80Caps.sfx.speedMax,
    format: (v) => v.toFixed(0),
};

const PWMDepthConfig: ContinuousParamConfig = {
    resolutionSteps: 32,
    default: 0,
    convertTo01: (v) => v / 31,
    convertFrom01: (v01) => v01 * 31,
    format: (v) => v.toFixed(0),
};

const PWMPhaseConfig: ContinuousParamConfig = {
    resolutionSteps: 100,
    default: 0,
    convertTo01: (v) => v,
    convertFrom01: (v01) => v01,
    format: (v) => `${Math.round(v * 100)}%`,
};

const MorphDurationConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0.032,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const MorphCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const LowpassDurationConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const LowpassCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const WavefoldAmountConfig: ContinuousParamConfig = {
    resolutionSteps: 256,
    default: 0,
    convertTo01: (v) => v / 255,
    convertFrom01: (v01) => v01 * 255,
    format: (v) => v.toFixed(0),
};

const WavefoldDurationConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const WavefoldCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const HardSyncStrengthConfig: ContinuousParamConfig = {
    resolutionSteps: 64,
    default: 1,
    convertTo01: (v) => (v - 1) / 7,
    convertFrom01: (v01) => 1 + v01 * 7,
    format: (v) => `${v.toFixed(2)}x`,
};

const HardSyncDecayConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const HardSyncCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const LfoRateConfig: ContinuousParamConfig = {
    resolutionSteps: 240,
    default: 2,
    convertTo01: (v) => Math.min(1, Math.max(0, v) / 12),
    convertFrom01: (v01) => v01 * 12,
    format: (v) => `${v.toFixed(2)} Hz`,
};

const LoopStartConfig: ContinuousParamConfig = {
    resolutionSteps: Tic80Caps.sfx.envelopeFrameCount,
    default: 0,
    convertTo01: (v) => v / (Tic80Caps.sfx.envelopeFrameCount - 1),
    convertFrom01: (v01) => v01 * (Tic80Caps.sfx.envelopeFrameCount - 1),
    format: (v) => v.toFixed(0),
};

const LoopLengthConfig: ContinuousParamConfig = {
    resolutionSteps: Tic80Caps.sfx.envelopeFrameCount,
    default: 0,
    convertTo01: (v) => v / (Tic80Caps.sfx.envelopeFrameCount - 1),
    convertFrom01: (v01) => v01 * (Tic80Caps.sfx.envelopeFrameCount - 1),
    format: (v) => v.toFixed(0),
};

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

    const loopStartConfig: ContinuousParamConfig = useMemo(() => ({
        resolutionSteps: Math.max(1, frameCount),
        default: 0,
        convertTo01: (v) => frameCount <= 1 ? 0 : v / (frameCount - 1),
        convertFrom01: (v01) => frameCount <= 1 ? 0 : v01 * (frameCount - 1),
        format: (v) => v.toFixed(0),
    }), [frameCount]);

    const loopLengthConfig: ContinuousParamConfig = useMemo(() => ({
        resolutionSteps: Math.max(1, frameCount),
        default: 0,
        convertTo01: (v) => frameCount <= 1 ? 0 : v / (frameCount - 1),
        convertFrom01: (v01) => frameCount <= 1 ? 0 : v01 * (frameCount - 1),
        format: (v) => v.toFixed(0),
    }), [frameCount]);

    const handleLoopStartChange = (value: number) => {
        const nextStart = clamp(value, 0, Math.max(0, frameCount - 1));
        const nextLength = clamp(loopLength, 0, Math.max(0, frameCount - 1));
        onChange(frames, nextStart, nextLength);
    };

    const handleLoopLengthChange = (value: number) => {
        const maxLen = Math.max(0, frameCount - 1);
        const nextLength = clamp(value, 0, maxLen);
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
                    <ContinuousKnob
                        label='Loop start'
                        value={loopStart}
                        config={loopStartConfig}
                        onChange={handleLoopStartChange}
                    />
                    <ContinuousKnob
                        label='Loop len'
                        value={loopLength}
                        config={loopLengthConfig}
                        onChange={handleLoopLengthChange}
                    />
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
    const [selectedTab, setSelectedTab] = useState<string>('volume');

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

    //  for NATIVE wave engine type, calculate sequence.
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

    const handleSetWaveEngine = (engine: SomaticInstrumentWaveEngine) => {
        onSongChange({
            description: 'Set wave engine',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.waveEngine = engine;
            },
        });
    };

    const setPWMDuty = (value: number) => {
        onSongChange({
            description: 'Set PWM duty cycle',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.pwmDuty = value;
            },
        });
    };

    const setSpeed = (value: number) => {
        onSongChange({
            description: 'Change instrument speed',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.speed = clamp(value, 0, Tic80Caps.sfx.speedMax);
            },
        });
    };

    const setPWMDepth = (value: number) => {
        onSongChange({
            description: 'Set PWM depth',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.pwmDepth = clamp(value, 0, 31);
            },
        });
    };

    const setPWMPhase = (value: number) => {
        onSongChange({
            description: 'Set PWM phase',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.pwmPhase01 = clamp(value, 0, 1);
            },
        });
    };

    const setMorphDuration = (value: number) => {
        onSongChange({
            description: 'Set morph duration',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.morphDurationSeconds = clamp(value, 0, 4);
            },
        });
    };

    const setMorphCurve = (value: number) => {
        onSongChange({
            description: 'Set morph curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.morphCurveN11 = clamp(value, -1, 1);
            },
        });
    };

    const setLowpassDuration = (value: number) => {
        onSongChange({
            description: 'Set lowpass duration',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.lowpassDurationSeconds = clamp(value, 0, 4);
            },
        });
    };

    const setLowpassCurve = (value: number) => {
        onSongChange({
            description: 'Set lowpass curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.lowpassCurveN11 = clamp(value, -1, 1);
            },
        });
    };

    const setHardSyncEnabled = (enabled: boolean) => {
        onSongChange({
            description: 'Toggle hard sync',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.hardSyncEnabled = enabled;
            },
        });
    };

    const setHardSyncStrength = (value: number) => {
        onSongChange({
            description: 'Set hard sync strength',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.hardSyncStrength = clamp(value, 1, 8);
            },
        });
    };

    const setHardSyncDecay = (value: number) => {
        onSongChange({
            description: 'Set hard sync decay',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.hardSyncDecaySeconds = clamp(value, 0, 4);
            },
        });
    };

    const setHardSyncCurve = (value: number) => {
        onSongChange({
            description: 'Set hard sync curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.hardSyncCurveN11 = clamp(value, -1, 1);
            },
        });
    };

    const setLfoRate = (value: number) => {
        onSongChange({
            description: 'Set LFO rate',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.lfoRateHz = Math.max(0, value);
            },
        });
    };

    const setLowpassModSource = (source: ModSource) => {
        onSongChange({
            description: 'Set lowpass mod source',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.lowpassModSource = source;
            },
        });
    };

    const setWavefoldModSource = (source: ModSource) => {
        onSongChange({
            description: 'Set wavefold mod source',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.wavefoldModSource = source;
            },
        });
    };

    const setHardSyncModSource = (source: ModSource) => {
        onSongChange({
            description: 'Set hard sync mod source',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.hardSyncModSource = source;
            },
        });
    };

    const setWavefoldAmount = (value: number) => {
        onSongChange({
            description: 'Set wavefold amount',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.wavefoldAmt = clamp(value, 0, 255);
            },
        });
    };

    const setWavefoldDuration = (value: number) => {
        onSongChange({
            description: 'Set wavefold duration',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.wavefoldDurationSeconds = clamp(value, 0, 4);
            },
        });
    };

    const setWavefoldCurve = (value: number) => {
        onSongChange({
            description: 'Set wavefold curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.wavefoldCurveN11 = clamp(value, -1, 1);
            },
        });
    };


    {/* there are 3 possibilities:
- morph = show source waveform + morph B
- no k-rate processing = show native waveform envelope
- else, show source waveform

show render slot if there are k-rate effects enabled

*/}

    const showRenderWaveformSlot = instrument.isKRateProcessing();
    const showMorphB = instrument.waveEngine === 'morph';
    const showNativeWaveformEnvelope = !instrument.isKRateProcessing();
    const showSourceWaveform = !showNativeWaveformEnvelope;


    return (
        <AppPanelShell
            className="instrument-panel"
            title={<>
                Instrument
                {instrument.isKRateProcessing() && (
                    // indicate when the instrument uses k-rate effects
                    <Tooltip title="This instrument uses effects processing that will render at 60Hz">
                        <span className="k-rate-badge">K-rate</span>
                    </Tooltip>
                )}
            </>}
            actions={(
                <>
                    <div className='instrument-index'>
                        {/* {instrumentIndex.toString(16).toUpperCase()}: */}
                        <InstrumentChip
                            instrumentIndex={instrumentIndex}
                            instrument={instrument}
                            children={<span className="instrument-chip-index">{instrument.getIndexString(instrumentIndex)}</span>}
                        />
                    </div>
                    {/* <label htmlFor="instrument-name">Name</label> */}
                    <input
                        //id="instrument-name"
                        className='instrument-name'
                        type="text"
                        value={instrument.name}
                        onChange={handleNameChange}
                    />
                    <button onClick={handleCopy}>Copy</button>
                    <button onClick={handlePaste}>Paste</button>
                    <button onClick={onClose}>Close</button>
                </>
            )}
        >
            <div>
                {instrumentIndex === 0 && <div className='alertPanel'>!! instrument 0 is weird and should not be used.</div>}
                {instrumentIndex === SomaticCaps.noteCutInstrumentIndex && <div className='alertPanel'>!! This is the note-off sfx and should not be edited.</div>}
            </div>

            <div className="field-row">
                <ContinuousKnob
                    label='Speed'
                    value={instrument.speed}
                    config={SpeedConfig}
                    onChange={setSpeed}
                />

            </div>

            <TabPanel
                selectedTabId={selectedTab}
                handleTabChange={(_, tabId) => setSelectedTab(tabId as string)}
            >
                <Tab thisTabId="volume" summaryTitle="Volume" canBeDefault={true}>
                    <div className="instrument-tab-content">
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
                    </div>
                </Tab>

                <Tab thisTabId="waveform" summaryTitle="Waveform">
                    <div className="instrument-tab-content">
                        <Tooltip title="The native TIC-80 waveform engine.">
                            <RadioButton selected={instrument.waveEngine === 'native'} onClick={() => handleSetWaveEngine('native')}>Native</RadioButton>
                        </Tooltip>
                        <Tooltip title="Morph between two waveforms over time.">
                            <RadioButton selected={instrument.waveEngine === 'morph'} onClick={() => handleSetWaveEngine('morph')}>Morph</RadioButton>
                        </Tooltip>
                        <Tooltip title="PWM waveform synthesis.">
                            <RadioButton selected={instrument.waveEngine === 'pwm'} onClick={() => handleSetWaveEngine('pwm')}>PWM</RadioButton>
                        </Tooltip>


                        {showSourceWaveform && (
                            <div style={{ display: "flex", gap: "16px", padding: 8 }}>
                                <strong>Source Waveform</strong>
                                <WaveformSelect
                                    song={song}
                                    onClickWaveform={(waveformId) => {
                                        onSongChange({
                                            description: 'Set source waveform',
                                            undoable: true,
                                            mutator: (s) => {
                                                const inst = s.instruments[instrumentIndex];
                                                inst.sourceWaveformIndex = waveformId;
                                            },
                                        });
                                    }}
                                    getOverlayText={(i) => {
                                        const isNoise = song.waveforms[i]?.isNoise() ?? false;
                                        return `${i.toString(16).toUpperCase()}${isNoise ? ' (Noise)' : ''}`;
                                    }}
                                    getWaveformDisplayStyle={(waveformId) => {
                                        if (waveformId === instrument.sourceWaveformIndex) {
                                            return "selected";
                                        }
                                        return "muted";
                                    }}
                                />
                            </div>)}
                        {showMorphB && (
                            <div style={{ display: "flex", gap: "16px", padding: 8 }}>
                                <strong>Morph Waveform B</strong>
                                <WaveformSelect
                                    song={song}
                                    onClickWaveform={(waveformId) => {
                                        onSongChange({
                                            description: 'Set morph B waveform',
                                            undoable: true,
                                            mutator: (s) => {
                                                const inst = s.instruments[instrumentIndex];
                                                inst.morphWaveB = waveformId;
                                            },
                                        });
                                    }}
                                    getOverlayText={(i) => {
                                        const isNoise = song.waveforms[i]?.isNoise() ?? false;
                                        return `${i.toString(16).toUpperCase()}${isNoise ? ' (Noise)' : ''}`;
                                    }}
                                    getWaveformDisplayStyle={(waveformId) => {
                                        if (waveformId === instrument.morphWaveB) {
                                            return "selected";
                                        }
                                        return "muted";
                                    }}
                                />
                            </div>
                        )}

                        {instrument.waveEngine === 'native' && instrument.isKRateProcessing() && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ maxWidth: 520 }}>
                                    Native + effects uses a single configured source waveform.
                                </div>
                            </div>
                        )}

                        {instrument.waveEngine === 'morph' && (
                            <div>
                                <div className="field-row">
                                    <ContinuousKnob
                                        label='Morph duration'
                                        value={instrument.morphDurationSeconds}
                                        config={MorphDurationConfig}
                                        onChange={setMorphDuration}
                                    />
                                </div>
                                <div>
                                    {Math.floor(instrument.morphDurationSeconds * 1000 / (1000 / 60))} ticks @ 60Hz
                                </div>
                                <div className="field-row">
                                    <ContinuousKnob
                                        label='Morph curve'
                                        value={instrument.morphCurveN11}
                                        config={MorphCurveConfig}
                                        onChange={setMorphCurve}
                                    />
                                </div>
                            </div>
                        )}

                        {instrument.waveEngine === 'pwm' && (
                            <div>
                                <div style={{ maxWidth: 520 }}>
                                    PWM uses the configured waveform slot for live synthesis.
                                </div>
                                <div style={{ maxWidth: 520, marginTop: 4 }}>
                                    PWM speed is controlled by the instrument LFO rate in the Effects tab;
                                    there is no separate PWM speed control.
                                </div>
                                <div className="field-row">
                                    <ContinuousKnob
                                        label='PWM duty cycle'
                                        value={instrument.pwmDuty}
                                        config={PWMDutyConfig}
                                        onChange={setPWMDuty}
                                    />
                                </div>
                                <div className="field-row">
                                    <ContinuousKnob
                                        label='PWM depth'
                                        value={instrument.pwmDepth}
                                        config={PWMDepthConfig}
                                        onChange={setPWMDepth}
                                    />
                                </div>

                                <div className="field-row">
                                    <ContinuousKnob
                                        label='PWM phase'
                                        value={instrument.pwmPhase01}
                                        config={PWMPhaseConfig}
                                        onChange={setPWMPhase}
                                    />
                                </div>
                            </div>
                        )}

                        {
                            showRenderWaveformSlot && (

                                <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: 8 }}>
                                    <strong>waveform rendering slot</strong>
                                    <div style={{ maxWidth: 400 }}>
                                        when doing k-rate processing, we have to render the waveform to a slot.
                                        note: this means this instrument must be monophonic.
                                    </div>
                                    <div style={{ display: "flex", gap: "16px", padding: 8 }}>
                                        <WaveformSelect
                                            song={song}
                                            onClickWaveform={(waveformId) => {
                                                onSongChange({
                                                    description: 'Set PWM waveform slot',
                                                    undoable: true,
                                                    mutator: (s) => {
                                                        const inst = s.instruments[instrumentIndex];
                                                        inst.renderWaveformSlot = waveformId;
                                                    },
                                                });
                                            }}
                                            getOverlayText={(i) => {
                                                const isNoise = song.waveforms[i]?.isNoise() ?? false;
                                                return `${i.toString(16).toUpperCase()}${isNoise ? ' (Noise)' : ''}`;
                                            }}
                                            getWaveformDisplayStyle={(waveformId) => {
                                                if (waveformId === instrument.renderWaveformSlot) {
                                                    return "selected";
                                                }
                                                return "muted";
                                            }}
                                        />
                                    </div>
                                </div>
                            )
                        }

                        {showNativeWaveformEnvelope && (
                            <>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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

                                    <div>
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
                            </>
                        )}
                    </div>
                </Tab>

                <Tab thisTabId="effects" summaryTitle="Effects">
                    <div className="instrument-tab-content">
                        <div style={{ marginTop: 12 }}>
                            <h4>LFO</h4>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='rate'
                                    value={instrument.lfoRateHz}
                                    config={LfoRateConfig}
                                    onChange={setLfoRate}
                                />
                                <span style={{ marginLeft: 8 }}>Global; not retriggered.</span>
                            </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                            <h4>Hard Sync</h4>
                            <div className="field-row">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={instrument.hardSyncEnabled}
                                        onChange={(e) => setHardSyncEnabled(e.target.checked)}
                                    />
                                    Enabled
                                </label>
                            </div>
                            <div className="field-row">
                                <label>Mod source</label>
                                <RadioButton selected={instrument.hardSyncModSource === 'envelope'} onClick={() => setHardSyncModSource('envelope')}>Envelope</RadioButton>
                                <RadioButton selected={instrument.hardSyncModSource === 'lfo'} onClick={() => setHardSyncModSource('lfo')}>LFO</RadioButton>
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='strength'
                                    value={instrument.hardSyncStrength}
                                    config={HardSyncStrengthConfig}
                                    onChange={setHardSyncStrength}
                                />
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='decay'
                                    value={instrument.hardSyncDecaySeconds}
                                    config={HardSyncDecayConfig}
                                    onChange={setHardSyncDecay}
                                />
                            </div>
                            <div>
                                {Math.floor(instrument.hardSyncDecaySeconds * 1000 / (1000 / 60))} ticks @ 60Hz
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='curve'
                                    value={instrument.hardSyncCurveN11}
                                    config={HardSyncCurveConfig}
                                    onChange={setHardSyncCurve}
                                />
                            </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                            <h4>Wavefold</h4>
                            <div className="field-row">
                                <label>Mod source</label>
                                <RadioButton selected={instrument.wavefoldModSource === 'envelope'} onClick={() => setWavefoldModSource('envelope')}>Envelope</RadioButton>
                                <RadioButton selected={instrument.wavefoldModSource === 'lfo'} onClick={() => setWavefoldModSource('lfo')}>LFO</RadioButton>
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='strength'
                                    value={instrument.wavefoldAmt}
                                    config={WavefoldAmountConfig}
                                    onChange={setWavefoldAmount}
                                />
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='decay'
                                    value={instrument.wavefoldDurationSeconds}
                                    config={WavefoldDurationConfig}
                                    onChange={setWavefoldDuration}
                                />
                            </div>
                            <div>
                                {Math.floor(instrument.wavefoldDurationSeconds * 1000 / (1000 / 60))} ticks @ 60Hz
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='curve'
                                    value={instrument.wavefoldCurveN11}
                                    config={WavefoldCurveConfig}
                                    onChange={setWavefoldCurve}
                                />
                            </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                            <h4>Lowpass</h4>
                            <div className="field-row">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={instrument.lowpassEnabled}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            onSongChange({
                                                description: 'Toggle lowpass',
                                                undoable: true,
                                                mutator: (s) => {
                                                    const inst = s.instruments[instrumentIndex];
                                                    inst.lowpassEnabled = checked;
                                                },
                                            });
                                        }}
                                    />
                                    Enabled
                                </label>
                            </div>
                            <div className="field-row">
                                <label>Mod source</label>
                                <RadioButton selected={instrument.lowpassModSource === 'envelope'} onClick={() => setLowpassModSource('envelope')}>Envelope</RadioButton>
                                <RadioButton selected={instrument.lowpassModSource === 'lfo'} onClick={() => setLowpassModSource('lfo')}>LFO</RadioButton>
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='decay'
                                    value={instrument.lowpassDurationSeconds}
                                    config={LowpassDurationConfig}
                                    onChange={setLowpassDuration}
                                />
                            </div>
                            <div>
                                {Math.floor(instrument.lowpassDurationSeconds * 1000 / (1000 / 60))} ticks @ 60Hz
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='curve'
                                    value={instrument.lowpassCurveN11}
                                    config={LowpassCurveConfig}
                                    onChange={setLowpassCurve}
                                />
                            </div>
                        </div>
                    </div>
                </Tab>

                <Tab thisTabId="pitch" summaryTitle="Pitch">
                    <div className="instrument-tab-content">
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
                </Tab>
            </TabPanel>
        </AppPanelShell>
    );
};
