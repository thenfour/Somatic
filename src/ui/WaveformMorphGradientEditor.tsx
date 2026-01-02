import { useState } from "react";
import { useClipboard } from "../hooks/useClipboard";
import { Tic80Instrument } from "../models/instruments";
import { Song } from "../models/song";
import { SomaticCaps, Tic80Caps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";
import { MorphGradientPreview } from "./MorphGradientPreview";
import { Tic80Waveform } from "../models/waveform";
import { Tic80WaveformDto } from "../models/waveform";
import { WaveformSwatch } from "./waveformSwatch";
import { WaveformCanvas } from "./waveform_canvas";
import { ContinuousKnob, ContinuousParamConfig } from "./basic/oldknob";


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


export const WaveformMorphGradientEditor: React.FC<{
    song: Song;
    instrument: Tic80Instrument;
    instrumentIndex: number;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
}> = ({ song, instrument, instrumentIndex, onSongChange }) => {
    const [expandedIndex, setExpandedIndex] = useState<number | null>(0);
    const clipboard = useClipboard();
    const nodes = instrument.morphGradientNodes ?? [];

    const canAdd = nodes.length < SomaticCaps.maxMorphGradientNodes;

    const addNode = () => {
        onSongChange({
            description: 'Add morph gradient node',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const existing = inst.morphGradientNodes ?? [];
                if (existing.length >= SomaticCaps.maxMorphGradientNodes) {
                    throw new Error(`Too many morph gradient nodes (max ${SomaticCaps.maxMorphGradientNodes})`);
                }
                const last = existing[existing.length - 1];
                const amps = last?.amplitudes ? new Uint8Array(last.amplitudes) : new Uint8Array(Tic80Caps.waveform.pointCount);
                existing.push({
                    amplitudes: amps,
                    durationSeconds: 0.5,
                    curveN11: 0,
                });
                inst.morphGradientNodes = existing;
            },
        });
        setExpandedIndex(nodes.length);
    };

    const removeNode = (index: number) => {
        onSongChange({
            description: 'Remove morph gradient node',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const existing = inst.morphGradientNodes ?? [];
                if (index < 0 || index >= existing.length) {
                    throw new Error(`Invalid morph gradient node index ${index}`);
                }
                existing.splice(index, 1);
                inst.morphGradientNodes = existing;
            },
        });
        setExpandedIndex((prev) => {
            if (prev == null) return prev;
            if (prev === index) return null;
            if (prev > index) return prev - 1;
            return prev;
        });
    };

    const setNodeDuration = (index: number, value: number) => {
        onSongChange({
            description: 'Set morph node duration',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const n = inst.morphGradientNodes?.[index];
                if (!n) throw new Error(`Missing morph node ${index}`);
                n.durationSeconds = clamp(value, 0, 4);
            },
        });
    };

    const setNodeCurve = (index: number, value: number) => {
        onSongChange({
            description: 'Set morph node curve',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const n = inst.morphGradientNodes?.[index];
                if (!n) throw new Error(`Missing morph node ${index}`);
                n.curveN11 = clamp(value, -1, 1);
            },
        });
    };

    const setNodeWaveform = (index: number, nextValues: number[]) => {
        const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;
        onSongChange({
            description: 'Edit morph node waveform',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const n = inst.morphGradientNodes?.[index];
                if (!n) throw new Error(`Missing morph node ${index}`);
                const len = Math.min(Tic80Caps.waveform.pointCount, nextValues.length);
                for (let i = 0; i < len; i++) {
                    n.amplitudes[i] = clamp(Math.trunc(nextValues[i] ?? 0), 0, maxAmp);
                }
            },
        });
    };

    const handleCopyNode = async (index: number) => {
        const n = instrument.morphGradientNodes?.[index];
        if (!n) return;
        const wf = new Tic80Waveform({ name: '', amplitudes: [...n.amplitudes] });
        await clipboard.copyObjectToClipboard(wf.toData());
    };

    const handlePasteNode = async (index: number) => {
        const data = await clipboard.readObjectFromClipboard<Tic80WaveformDto>();
        if (!data) return;
        const wf = Tic80Waveform.fromData(data);
        const maxAmp = Tic80Caps.waveform.amplitudeRange - 1;
        onSongChange({
            description: 'Paste waveform into morph node',
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                const n = inst.morphGradientNodes?.[index];
                if (!n) throw new Error(`Missing morph node ${index}`);
                const len = Math.min(Tic80Caps.waveform.pointCount, wf.amplitudes.length);
                for (let i = 0; i < len; i++) {
                    n.amplitudes[i] = clamp(Math.trunc(wf.amplitudes[i] ?? 0), 0, maxAmp);
                }
            },
        });
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            <div style={{ maxWidth: 520 }}>
                Morph gradients are embedded per-instrument waveforms (not TIC-80 global waveforms).
            </div>

            <MorphGradientPreview nodes={nodes} />

            {nodes.map((node, idx) => {
                const isExpanded = expandedIndex === idx;
                const wf = new Tic80Waveform({ name: '', amplitudes: [...node.amplitudes] });

                return (
                    <div key={idx} style={{ border: '1px solid var(--panel-border)', padding: 8 }}>
                        <div
                            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                            onClick={() => setExpandedIndex(isExpanded ? null : idx)}
                        >
                            <WaveformSwatch value={wf} scale={2} displayStyle={isExpanded ? 'selected' : 'muted'} overlayText={`${idx + 1}`} />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <strong>Node {idx + 1}</strong>
                                <div style={{ fontSize: 12 }}>
                                    dur: {Math.round(node.durationSeconds * 1000)}ms, curve: {node.curveN11.toFixed(2)}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void handleCopyNode(idx);
                                }}
                            >
                                Copy
                            </button>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void handlePasteNode(idx);
                                }}
                            >
                                Paste
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); removeNode(idx); }}>Remove</button>
                        </div>

                        {isExpanded && (
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <WaveformCanvas
                                    values={Array.from(node.amplitudes)}
                                    maxValue={Tic80Caps.waveform.amplitudeRange - 1}
                                    scale={16}
                                    onChange={(next) => setNodeWaveform(idx, next)}
                                />

                                <div className="field-row">
                                    <ContinuousKnob
                                        label='Duration'
                                        value={node.durationSeconds}
                                        config={MorphDurationConfig}
                                        onChange={(v) => setNodeDuration(idx, v)}
                                    />
                                    <ContinuousKnob
                                        label='Curve'
                                        value={node.curveN11}
                                        config={MorphCurveConfig}
                                        onChange={(v) => setNodeCurve(idx, v)}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            <div>
                <button disabled={!canAdd} onClick={addNode}>Add node</button>
                {!canAdd && <span style={{ marginLeft: 8 }}>(max {SomaticCaps.maxMorphGradientNodes})</span>}
            </div>
        </div>
    );
};
