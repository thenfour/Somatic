import React, { useEffect, useState } from "react";
import { useClipboard } from '../hooks/useClipboard';
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Tic80Waveform, Tic80WaveformDto } from "../models/waveform";
import { WaveformCanvas } from "./waveform_canvas";
import '/src/waveform.css';
import { WaveformSwatch, WaveformSwatchDisplayStyle } from "./waveformSwatch";
import './waveformEditor.css';
import { AppPanelShell } from './AppPanelShell';
import { calculateSongUsage, getMaxWaveformUsedIndex, SongUsage } from "../utils/SongOptimizer";
import { Button } from "./Buttons/PushButton";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { IconButton } from "./Buttons/IconButton";
import { mdiContentCopy, mdiContentPaste } from "@mdi/js";
import { Tooltip } from "./basic/tooltip";
import { GlobalActions } from "../keyb/ActionIds";

export const WaveformSelect: React.FC<{
    song: Song;
    onClickWaveform: (waveformId: number) => void;
    getWaveformDisplayStyle: (waveformId: number) => WaveformSwatchDisplayStyle;
    getOverlayText: (waveformId: number) => string;
}> = ({ getWaveformDisplayStyle, getOverlayText, song, onClickWaveform }) => {
    const waveformCount = Math.min(song.waveforms.length, Tic80Caps.waveform.count);
    const scale = 3;

    return (
        <div className="waveform-select">
            {Array.from({ length: waveformCount }, (_, index) => {
                const waveform = song.waveforms[index];
                return (
                    <WaveformSwatch
                        key={index}
                        value={waveform}
                        scale={scale}
                        displayStyle={getWaveformDisplayStyle(index)}
                        onClick={() => onClickWaveform(index)}
                        overlayText={getOverlayText(index)}
                    />
                );
            })}
        </div>
    );
};

export const WaveformEditor: React.FC<{
    song: Song;
    editingWaveformId: number;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
}> = ({ song, editingWaveformId, editorState, onSongChange }) => {
    const waveform = song.waveforms[editingWaveformId];
    if (!waveform) {
        return (
            <div className="waveform-editor">
                <p>No waveform selected.</p>
            </div>
        );
    }

    const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
    const maxAmp = amplitudeRange - 1;

    const handleCanvasChange = (nextValues: number[]) => {
        onSongChange({
            description: 'Edit waveform samples',
            undoable: true,
            mutator: (s) => {
                const wf = s.waveforms[editingWaveformId];
                if (!wf) return;
                const len = Math.min(wf.amplitudes.length, nextValues.length);
                for (let i = 0; i < len; i += 1) {
                    const v = Math.max(0, Math.min(maxAmp, nextValues[i] ?? 0));
                    wf.amplitudes[i] = v;
                }
            },
        });
    };

    return (
        <WaveformCanvas
            values={Array.from(waveform.amplitudes)}
            maxValue={maxAmp}
            scale={16}
            onChange={handleCanvasChange}
        />
    );
};

export const WaveformEditorPanel: React.FC<{
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onClose: () => void;

}> = ({ song, editorState, onSongChange, onClose }) => {

    const [editingWaveformId, setEditingWaveformId] = useState<number>(0);
    const [mixPercent, setMixPercent] = useState<number>(100);
    const [harmonic, setHarmonic] = useState<number>(1);
    const clipboard = useClipboard();

    const [songUsage, setSongUsage] = useState<SongUsage | null>(null);

    useEffect(() => {
        const usage = calculateSongUsage(song);
        setSongUsage(usage);
    }, [song]);

    const applyGeneratedWaveform = (generator: (index: number, pointCount: number, maxAmp: number) => number) => {
        const waveform = song.waveforms[editingWaveformId];
        if (!waveform) return;

        const pointCount = Tic80Caps.waveform.pointCount;
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        const mix = Math.max(0, Math.min(100, mixPercent)) / 100;

        onSongChange({
            description: 'Generate waveform',
            undoable: true,
            mutator: (s) => {
                const wf = s.waveforms[editingWaveformId];
                if (!wf) return;
                const len = Math.min(wf.amplitudes.length, pointCount);
                for (let i = 0; i < len; i += 1) {
                    const current = Math.max(0, Math.min(maxAmp, wf.amplitudes[i] ?? 0));
                    const generated = Math.max(0, Math.min(maxAmp, generator(i, pointCount, maxAmp)));
                    const blended = Math.round(current * (1 - mix) + generated * mix);
                    wf.amplitudes[i] = blended;
                }
            },
        });
    };

    const makePhase = (index: number, pointCount: number) => {
        return (harmonic * index) / pointCount;
    };

    const handlePulse = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            // simple 50% duty pulse
            const frac = phase - Math.floor(phase);
            return frac < 0.5 ? maxAmp : 0;
        });
    };

    const handleSaw = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            const frac = phase - Math.floor(phase);
            return Math.round(frac * maxAmp);
        });
    };

    const handleTriangle = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount);
            const frac = phase - Math.floor(phase);
            const tri = frac < 0.5 ? frac * 2 : (1 - frac) * 2;
            return Math.round(tri * maxAmp);
        });
    };

    const handleSine = () => {
        applyGeneratedWaveform((i, pointCount, maxAmp) => {
            const phase = makePhase(i, pointCount); // 0..harmonic
            const angle = 2 * Math.PI * phase;
            const s = (Math.sin(angle) + 1) / 2; // 0..1
            return Math.round(s * maxAmp);
        });
    };

    const handleNoise = () => {
        applyGeneratedWaveform((_i, _pointCount, maxAmp) => {
            return Math.floor(Math.random() * (maxAmp + 1));
        });
    };

    const handleShift = (direction: 1 | -1) => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange({
            description: direction > 0 ? 'Shift waveform up' : 'Shift waveform down',
            undoable: true,
            mutator: (s) => {
                const wf = s.waveforms[editingWaveformId];
                if (!wf) return;
                for (let i = 0; i < wf.amplitudes.length; i += 1) {
                    const current = Math.max(0, Math.min(maxAmp, wf.amplitudes[i] ?? 0));
                    let next = current + direction;
                    if (next < 0) next = maxAmp;
                    if (next > maxAmp) next = 0;
                    wf.amplitudes[i] = next;
                }
            },
        });
    };

    const handleNormalize = () => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange({
            description: 'Normalize waveform',
            undoable: true,
            mutator: (s) => {
                const wf = s.waveforms[editingWaveformId];
                if (!wf) return;

                // Find the min and max values in the waveform
                let min = maxAmp;
                let max = 0;
                for (let i = 0; i < wf.amplitudes.length; i += 1) {
                    const val = wf.amplitudes[i];
                    if (val < min) min = val;
                    if (val > max) max = val;
                }

                // If the waveform is flat, nothing to normalize
                if (min === max) return;

                // Scale to use the full range
                const range = max - min;
                for (let i = 0; i < wf.amplitudes.length; i += 1) {
                    const val = wf.amplitudes[i];
                    wf.amplitudes[i] = Math.round(((val - min) / range) * maxAmp);
                }
            },
        });
    };

    const handleLowpass = () => {
        const amplitudeRange = Tic80Caps.waveform.amplitudeRange;
        const maxAmp = amplitudeRange - 1;
        onSongChange({
            description: 'Lowpass filter waveform',
            undoable: true,
            mutator: (s) => {
                const wf = s.waveforms[editingWaveformId];
                if (!wf) return;

                // Simple 3-point moving average lowpass filter
                const original = new Uint8Array(wf.amplitudes);
                const len = original.length;

                for (let i = 0; i < len; i += 1) {
                    const prev = original[(i - 1 + len) % len];
                    const curr = original[i];
                    const next = original[(i + 1) % len];
                    // Weighted average: 25% prev + 50% current + 25% next
                    const filtered = (prev * 0.25 + curr * 0.5 + next * 0.25);
                    wf.amplitudes[i] = Math.round(Math.max(0, Math.min(maxAmp, filtered)));
                }
            },
        });
    };

    const handleCopy = async () => {
        const waveform = song.waveforms[editingWaveformId];
        await clipboard.copyObjectToClipboard(waveform.toData());
    };

    const handlePaste = async () => {
        const data = await clipboard.readObjectFromClipboard<Tic80WaveformDto>();
        if (!data) return;
        onSongChange({
            description: 'Paste waveform',
            undoable: true,
            mutator: (s) => {
                s.waveforms[editingWaveformId] = Tic80Waveform.fromData(data);
            },
        });
    };

    return (
        <AppPanelShell
            className="waveform-editor-panel"
            title="Waveform Editor"
            onClose={onClose}
            closeActionId={GlobalActions.ToggleWaveformEditor}
        >
            <WaveformSelect
                onClickWaveform={setEditingWaveformId}
                getWaveformDisplayStyle={(waveformId) => {
                    if (waveformId === editingWaveformId) {
                        return "selected";
                    }
                    if (songUsage && songUsage.usedWaveforms.has(waveformId)) {
                        return "normal";
                    }
                    return "muted";
                }}
                getOverlayText={(waveformIndex) => {
                    const used = songUsage ? songUsage.usedWaveforms.has(waveformIndex) : false;
                    const isNoise = song.waveforms[waveformIndex]?.isNoise() ?? false;
                    return `${waveformIndex.toString(16).toUpperCase()}${used ? '*' : ''}${isNoise ? ' (Noise)' : ''}`;
                }}
                song={song}
            />


            <WaveformEditor
                song={song}
                editorState={editorState}
                onSongChange={onSongChange}
                editingWaveformId={editingWaveformId}
            />

            <div className="waveform-editor-controls">
                <ButtonGroup>
                    <Tooltip title="Copy waveform to clipboard">
                        <IconButton onClick={handleCopy} iconPath={mdiContentCopy} />
                    </Tooltip>
                    <Tooltip title="Paste waveform from clipboard">
                        <IconButton onClick={handlePaste} iconPath={mdiContentPaste} />
                    </Tooltip>
                </ButtonGroup>
                {/* <div className="waveform-editor-controls__row">
                    <button type="button" onClick={handleCopy}>Copy</button>
                    <button type="button" onClick={handlePaste}>Paste</button>
                </div> */}
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Mix</span>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={mixPercent}
                        onChange={(e) => setMixPercent(Number(e.target.value))}
                    />
                    <span className="waveform-editor-controls__value">{mixPercent}%</span>
                </div>
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Harmonic</span>
                    <ButtonGroup>
                        {[1, 2, 3, 4, 5].map((h) => (
                            <Button
                                key={h}
                                highlighted={h === harmonic}
                                //className={h === harmonic ? "waveform-editor-controls__button waveform-editor-controls__button--active" : "waveform-editor-controls__button"}
                                onClick={() => setHarmonic(h)}
                            >
                                {h}
                            </Button>
                        ))}
                    </ButtonGroup>
                </div>

                <ButtonGroup>
                    <Button onClick={handlePulse}>Pulse</Button>
                    <Button onClick={handleSaw}>Saw</Button>
                    <Button onClick={handleTriangle}>Tri</Button>
                    <Button onClick={handleSine}>Sine</Button>
                    <Button onClick={handleNoise}>Random</Button>
                </ButtonGroup>
                <div className="waveform-editor-controls__row">
                    <span className="waveform-editor-controls__label">Shift</span>
                    <ButtonGroup>
                        <Button onClick={() => handleShift(1)}>Up</Button>
                        <Button onClick={() => handleShift(-1)}>Down</Button>
                        <Button onClick={handleNormalize}>Normalize</Button>
                        <Button onClick={handleLowpass}>Lowpass</Button>
                    </ButtonGroup>
                </div>
            </div>
        </AppPanelShell>
    );
};

