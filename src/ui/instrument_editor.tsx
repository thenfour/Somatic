import { mdiArrowDown, mdiArrowLeft, mdiArrowRight, mdiArrowUp, mdiContentCopy, mdiContentPaste } from '@mdi/js';
import React, { useMemo, useState } from 'react';
import { AudioController } from '../audio/controller';
import { useClipboard } from '../hooks/useClipboard';
import { ModSource, SomaticEffectKind, SomaticInstrumentWaveEngine, Tic80Instrument, Tic80InstrumentDto } from '../models/instruments';
import { Song } from '../models/song';
import { SomaticCaps, Tic80Caps } from '../models/tic80Capabilities';
import { gTic80Palette } from '../theme/ticPalette';
import { assert, clamp, secondsTo60HzFrames } from '../utils/utils';
import { AppPanelShell } from './AppPanelShell';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { CheckboxButton } from './Buttons/CheckboxButton';
import { IconButton } from './Buttons/IconButton';
import { Button } from './Buttons/PushButton';
import { RadioButton } from './Buttons/RadioButton';
import { InstrumentChip } from './InstrumentChip';
import { MorphSampleImportTab } from './MorphSampleImportTab';
import { WaveformMorphGradientEditor } from './WaveformMorphGradientEditor';
import { Dropdown, DropdownOption } from './basic/Dropdown';
import { PaletteSwatch } from './basic/PaletteSwatch';
import { Tab, TabPanel } from './basic/Tabs';
import { ContinuousKnob, ContinuousParamConfig } from './basic/oldknob';
import { Tooltip } from './basic/tooltip';
import './instrument_editor.css';
import { WaveformSelect } from './waveformEditor';
import { WaveformSwatch } from './waveformSwatch';
import { WaveformCanvas, WaveformCanvasHover } from './waveform_canvas';

const PWMDutyConfig: ContinuousParamConfig = {
    resolutionSteps: 32,
    default: 15,
    center: 15,
    convertTo01: (v) => v / 31,
    convertFrom01: (v01) => v01 * 31,
    format: (v) => v.toFixed(0),
};

const SpeedConfig: ContinuousParamConfig = {
    resolutionSteps: Tic80Caps.sfx.speedMax + 1,
    default: 0,
    center: 0,
    convertTo01: (v) => v / Tic80Caps.sfx.speedMax,
    convertFrom01: (v01) => v01 * Tic80Caps.sfx.speedMax,
    format: (v) => v.toFixed(0),
};

const PWMDepthConfig: ContinuousParamConfig = {
    resolutionSteps: 32,
    default: 8,
    center: 0,
    convertTo01: (v) => v / 31,
    convertFrom01: (v01) => v01 * 31,
    format: (v) => v.toFixed(0),
};

const LowpassDurationConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    center: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const LowpassCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    center: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const WavefoldAmountConfig: ContinuousParamConfig = {
    resolutionSteps: 256,
    default: 127,
    center: 0,
    convertTo01: (v) => v / 255,
    convertFrom01: (v01) => v01 * 255,
    format: (v) => v.toFixed(0),
};

const WavefoldDurationConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    center: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const WavefoldCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    center: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const HardSyncStrengthConfig: ContinuousParamConfig = {
    resolutionSteps: 64,
    default: 4,
    center: 1,
    convertTo01: (v) => (v - 1) / 7,
    convertFrom01: (v01) => 1 + v01 * 7,
    format: (v) => `${v.toFixed(2)}x`,
};

const HardSyncDecayConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 0,
    center: 0,
    convertTo01: (v) => v / 4,
    convertFrom01: (v01) => v01 * 4,
    format: (v) => `${Math.round(v * 1000)} ms`,
};

const HardSyncCurveConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 0,
    center: 0,
    convertTo01: (v) => (v + 1) / 2,
    convertFrom01: (v01) => v01 * 2 - 1,
    format: (v) => v.toFixed(2),
};

const LfoRateConfig: ContinuousParamConfig = {
    resolutionSteps: 240,
    default: 2,
    center: 0,
    convertTo01: (v) => Math.min(1, Math.max(0, v) / 12),
    convertFrom01: (v01) => v01 * 12,
    format: (v) => `${v.toFixed(2)} Hz`,
};

// const LoopStartConfig: ContinuousParamConfig = {
//     resolutionSteps: Tic80Caps.sfx.envelopeFrameCount,
//     default: 0,
//     convertTo01: (v) => v / (Tic80Caps.sfx.envelopeFrameCount - 1),
//     convertFrom01: (v01) => v01 * (Tic80Caps.sfx.envelopeFrameCount - 1),
//     format: (v) => v.toFixed(0),
// };

// const LoopLengthConfig: ContinuousParamConfig = {
//     resolutionSteps: Tic80Caps.sfx.envelopeFrameCount,
//     default: 0,
//     convertTo01: (v) => v / (Tic80Caps.sfx.envelopeFrameCount - 1),
//     convertFrom01: (v01) => v01 * (Tic80Caps.sfx.envelopeFrameCount - 1),
//     format: (v) => v.toFixed(0),
// };

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
        center: 0,
        convertTo01: (v) => frameCount <= 1 ? 0 : v / (frameCount - 1),
        convertFrom01: (v01) => frameCount <= 1 ? 0 : v01 * (frameCount - 1),
        format: (v) => v.toFixed(0),
    }), [frameCount]);

    const loopLengthConfig: ContinuousParamConfig = useMemo(() => ({
        resolutionSteps: Math.max(1, frameCount),
        default: 0,
        center: 0,
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
                <ButtonGroup>
                    <IconButton onClick={handleRotateUp} title="Rotate up" iconPath={mdiArrowUp}></IconButton>
                    <IconButton onClick={handleRotateDown} title="Rotate down" iconPath={mdiArrowDown}></IconButton>
                    <IconButton onClick={handleRotateLeft} title="Rotate left" iconPath={mdiArrowLeft}></IconButton>
                    <IconButton onClick={handleRotateRight} title="Rotate right" iconPath={mdiArrowRight}></IconButton>
                    <IconButton onClick={handleCopy} title="Copy" iconPath={mdiContentCopy}></IconButton>
                    <IconButton onClick={handlePaste} title="Paste" iconPath={mdiContentPaste}></IconButton>
                </ButtonGroup>
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
    const [selectedMorphSubtab, setSelectedMorphSubtab] = useState<string>('gradient');

    const songOrderKey = useMemo(
        () => song.songOrder.map((item) => clamp(item.patternIndex ?? 0, 0, song.patterns.length - 1)).join(','),
        [song.songOrder, song.patterns.length],
    );

    const patternSignatureKey = useMemo(
        () => song.patterns.map((p) => p.contentSignature()).join('|'),
        [song.patterns],
    );

    const instrumentUsageCount = useMemo(() => {
        let total = 0;
        for (const orderItem of song.songOrder) {
            const patternIndex = clamp(orderItem.patternIndex ?? 0, 0, song.patterns.length - 1);
            total += song.countInstrumentNotesInPattern(patternIndex, instrumentIndex);
        }
        return total;
    }, [instrumentIndex, song.rowsPerPattern, songOrderKey, patternSignatureKey, song]);

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

    const handleStereoLeftChange = (checked: boolean) => {
        onSongChange({
            description: 'Toggle stereo left',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.stereoLeft = checked;
            },
        });
    };

    const handleStereoRightChange = (checked: boolean) => {
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

                if (engine === 'morph') {
                    if (!inst.morphGradientNodes || inst.morphGradientNodes.length === 0) {
                        const src = s.waveforms[inst.sourceWaveformIndex] ?? s.waveforms[0];
                        const amps = src ? new Uint8Array(src.amplitudes) : new Uint8Array(Tic80Caps.waveform.pointCount);
                        inst.morphGradientNodes = [
                            { amplitudes: new Uint8Array(amps), durationSeconds: 0.5, curveN11: 0 },
                            { amplitudes: new Uint8Array(amps), durationSeconds: 0.5, curveN11: 0 },
                        ];
                    }
                }
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

    const setEffectKind = (kind: SomaticEffectKind) => {
        onSongChange({
            description: 'Set effect kind',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.effectKind = kind;
                if (kind === SomaticEffectKind.none) {
                    inst.effectAmount = 0;
                    inst.effectDurationSeconds = 0;
                    inst.effectCurveN11 = 0;
                } else if (kind === SomaticEffectKind.wavefold && inst.effectAmount < 0) {
                    inst.effectAmount = 0;
                } else if (kind === SomaticEffectKind.hardSync && inst.effectAmount < 1) {
                    inst.effectAmount = 1;
                }
            },
        });
    };

    const setEffectModSource = (source: ModSource) => {
        onSongChange({
            description: 'Set effect mod source',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.effectModSource = source;
            },
        });
    };

    const setEffectAmount = (value: number) => {
        onSongChange({
            description: 'Set effect amount',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const k = inst.effectKind;
                if (k === SomaticEffectKind.hardSync) {
                    inst.effectAmount = clamp(value, 1, 8);
                } else {
                    inst.effectAmount = clamp(value, 0, 255);
                }
            },
        });
    };

    const setEffectDuration = (value: number) => {
        onSongChange({
            description: 'Set effect duration',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.effectDurationSeconds = clamp(value, 0, 4);
            },
        });
    };

    const setEffectCurve = (value: number) => {
        onSongChange({
            description: 'Set effect curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.effectCurveN11 = clamp(value, -1, 1);
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
    const showNativeWaveformEnvelope = !instrument.isKRateProcessing();
    const showSourceWaveform = !showNativeWaveformEnvelope && instrument.waveEngine === 'native';

    const highlightOptions: DropdownOption<string | null>[] = useMemo(() => {
        const options: DropdownOption<string | null>[] = [
            { value: null, label: 'None' },
            // use PALETTE_KEYS / PALETTE_CONTRAST_KEYS from ticPalette.ts.
            ...gTic80Palette.map((paletteEntry, i) => ({
                value: paletteEntry.cssExpression,
                label: <PaletteSwatch
                    key={i}
                    color={paletteEntry.cssColor}
                    contrast={paletteEntry.contrastCssExpression}
                ><span>{paletteEntry.index}</span></PaletteSwatch>,
            })),
        ];
        return options
    }, [gTic80Palette]);

    return (
        <AppPanelShell
            className="instrument-panel"
            onClose={onClose}
            title={<>
                Instrument
                <Tooltip title="This instrument uses effects processing that will render at 60Hz" disabled={!instrument.isKRateProcessing()}>
                    <span className="k-rate-badge" style={{ visibility: instrument.isKRateProcessing() ? undefined : "hidden" }}>K-rate</span>
                </Tooltip>
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
                    <ButtonGroup>
                        <Button onClick={handleCopy}>Copy</Button>
                        <Button onClick={handlePaste}>Paste</Button>
                        {/* <Divider />
                        <Button onClick={onClose}>Close</Button> */}
                    </ButtonGroup>
                </>
            )}
        >
            <div className="instrument-usage">
                {instrumentUsageCount > 0
                    ? `Used ${instrumentUsageCount} ${instrumentUsageCount === 1 ? "time" : "times"} in the song.`
                    : "Not used in the song."}
            </div>
            <div>
                {instrumentIndex === 0 && <div className='alertPanel'>!! instrument 0 is weird and should not be used.</div>}
                {instrumentIndex === SomaticCaps.noteCutInstrumentIndex && <div className='alertPanel'>!! This is the note-off sfx and should not be edited.</div>}
            </div>

            <div className="field-row">
                <ButtonGroup>
                    <ContinuousKnob
                        label='Speed'
                        value={instrument.speed}
                        config={SpeedConfig}
                        onChange={setSpeed}
                    />
                </ButtonGroup>
                <Dropdown<string | null>
                    value={instrument.highlightColor}
                    renderTriggerLabel={
                        (option, defaultRender) => {
                            if (!option || !option.value) {
                                return <>Highlight: None</>;
                            }
                            return <span>Highlight: {option.label}</span>
                        }}
                    onChange={(newColor) => {
                        onSongChange({
                            description: 'Set instrument highlight color',
                            undoable: true,
                            mutator: (s) => {
                                const inst = s.instruments[instrumentIndex];
                                inst.highlightColor = newColor;
                            }
                        });
                    }}
                    options={highlightOptions}
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
                            <ButtonGroup>
                                <CheckboxButton
                                    //type="checkbox"
                                    checked={instrument.stereoLeft}
                                    onChange={handleStereoLeftChange}
                                >L</CheckboxButton>
                                <CheckboxButton
                                    checked={instrument.stereoRight}
                                    onChange={handleStereoRightChange}
                                >R</CheckboxButton>
                            </ButtonGroup>
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
                        <ButtonGroup>
                            <Tooltip title="The native TIC-80 waveform engine.">
                                <RadioButton selected={instrument.waveEngine === 'native'} onClick={() => handleSetWaveEngine('native')}>Native</RadioButton>
                            </Tooltip>
                            <Tooltip title="Morph between two waveforms over time.">
                                <RadioButton selected={instrument.waveEngine === 'morph'} onClick={() => handleSetWaveEngine('morph')}>Morph</RadioButton>
                            </Tooltip>
                            <Tooltip title="PWM waveform synthesis.">
                                <RadioButton selected={instrument.waveEngine === 'pwm'} onClick={() => handleSetWaveEngine('pwm')}>PWM</RadioButton>
                            </Tooltip>
                        </ButtonGroup>


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

                        {instrument.waveEngine === 'native' && instrument.isKRateProcessing() && (
                            <div style={{ marginTop: 8 }}>
                                <div style={{ maxWidth: 520 }}>
                                    Native + effects uses a single configured source waveform.
                                </div>
                            </div>
                        )}

                        {instrument.waveEngine === 'morph' && (
                            <TabPanel
                                selectedTabId={selectedMorphSubtab}
                                handleTabChange={(_, tabId) => setSelectedMorphSubtab(tabId as string)}
                                tablListStyle={{ marginTop: 12 }}
                            >
                                <Tab thisTabId="gradient" summaryTitle="Gradient" canBeDefault={true}>
                                    <WaveformMorphGradientEditor
                                        song={song}
                                        instrument={instrument}
                                        instrumentIndex={instrumentIndex}
                                        onSongChange={onSongChange}
                                    />
                                </Tab>
                                <Tab thisTabId="import" summaryTitle="Import sample">
                                    <MorphSampleImportTab
                                        song={song}
                                        instrument={instrument}
                                        instrumentIndex={instrumentIndex}
                                        onSongChange={onSongChange}
                                    />
                                </Tab>
                            </TabPanel>
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
                        <fieldset>
                            <legend>LFO</legend>
                            <div className="field-row">
                                <ContinuousKnob
                                    label='rate'
                                    value={instrument.lfoRateHz}
                                    config={LfoRateConfig}
                                    onChange={setLfoRate}
                                />
                                <span style={{ marginLeft: 8 }}>Global; not retriggered.</span>
                            </div>
                        </fieldset>
                        <fieldset style={{ marginTop: 12 }}>
                            <legend>Effect (wavefold / hard sync)</legend>
                            <div className="field-row">
                                <label>Type</label>
                                <RadioButton selected={instrument.effectKind === SomaticEffectKind.none} onClick={() => setEffectKind(SomaticEffectKind.none)}>None</RadioButton>
                                <RadioButton selected={instrument.effectKind === SomaticEffectKind.wavefold} onClick={() => setEffectKind(SomaticEffectKind.wavefold)}>Wavefold</RadioButton>
                                <RadioButton selected={instrument.effectKind === SomaticEffectKind.hardSync} onClick={() => setEffectKind(SomaticEffectKind.hardSync)}>Hard Sync</RadioButton>
                            </div>
                            <div className="field-row">
                                <label>Mod source</label>
                                <RadioButton selected={instrument.effectModSource === 'envelope'} onClick={() => setEffectModSource('envelope')}>Envelope</RadioButton>
                                <RadioButton selected={instrument.effectModSource === 'lfo'} onClick={() => setEffectModSource('lfo')}>LFO</RadioButton>
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label={instrument.effectKind === SomaticEffectKind.hardSync ? 'strength (x)' : 'strength'}
                                    value={instrument.effectAmount}
                                    config={instrument.effectKind === SomaticEffectKind.hardSync ? HardSyncStrengthConfig : WavefoldAmountConfig}
                                    onChange={setEffectAmount}
                                />
                                <ContinuousKnob
                                    label='decay'
                                    value={instrument.effectDurationSeconds}
                                    config={instrument.effectKind === SomaticEffectKind.hardSync ? HardSyncDecayConfig : WavefoldDurationConfig}
                                    onChange={setEffectDuration}
                                />
                                <ContinuousKnob
                                    label='curve'
                                    value={instrument.effectCurveN11}
                                    config={instrument.effectKind === SomaticEffectKind.hardSync ? HardSyncCurveConfig : WavefoldCurveConfig}
                                    onChange={setEffectCurve}
                                />
                            </div>
                            <div>
                                {Math.floor(secondsTo60HzFrames(instrument.effectDurationSeconds))} ticks @ 60Hz
                            </div>
                        </fieldset>

                        <fieldset>
                            <legend>Lowpass</legend>
                            <div className="field-row">
                                <CheckboxButton
                                    checked={instrument.lowpassEnabled}
                                    onChange={(checked) => {
                                        onSongChange({
                                            description: 'Toggle lowpass',
                                            undoable: true,
                                            mutator: (s) => {
                                                const inst = s.instruments[instrumentIndex];
                                                inst.lowpassEnabled = checked;
                                            },
                                        });
                                    }}
                                >

                                    {instrument.lowpassEnabled ? 'Enabled' : 'Disabled'}
                                </CheckboxButton>
                            </div>
                            <label>Mod source</label>
                            <ButtonGroup>
                                <RadioButton selected={instrument.lowpassModSource === 'envelope'} onClick={() => setLowpassModSource('envelope')}>Envelope</RadioButton>
                                <RadioButton selected={instrument.lowpassModSource === 'lfo'} onClick={() => setLowpassModSource('lfo')}>LFO</RadioButton>
                            </ButtonGroup>
                            <ButtonGroup>
                                <ContinuousKnob
                                    label='decay'
                                    value={instrument.lowpassDurationSeconds}
                                    config={LowpassDurationConfig}
                                    onChange={setLowpassDuration}
                                />
                                <ContinuousKnob
                                    label='curve'
                                    value={instrument.lowpassCurveN11}
                                    config={LowpassCurveConfig}
                                    onChange={setLowpassCurve}
                                />
                            </ButtonGroup>
                            <div>
                                {Math.floor(secondsTo60HzFrames(instrument.lowpassDurationSeconds))} ticks @ 60Hz
                            </div>
                        </fieldset>
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
