import React, { useEffect, useMemo, useState } from "react";
import { Song } from "../models/song";
import {
    MorphSampleImportAutoWindowParamsDto,
    MorphSampleImportStateDto,
    MorphSampleImportWindowDto,
    Tic80Instrument,
    WaveformMorphGradientNode,
} from "../models/instruments";
import { SomaticCaps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";
import { decodeFloat32PcmFromDto, decodeWavFileToDto } from "../audio/wav_reader";
import { autoSelectWindows, buildMorphGradientFromSampleImport, extractSingleChannelPcm, windowDtoToFrames } from "../audio/morph_sample_import";
import { ContinuousKnob, ContinuousParamConfig } from "./basic/oldknob";
import { WaveformVisualizer } from "./WaveformVisualizer";
import { MorphSampleFileImportButton } from "./MorphSampleFileImportButton";
import { MorphSampleWindowItem } from "./MorphSampleWindowItem";

const SourceDuration01Config: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 1,
    convertTo01: (v) => clamp(v, 0, 1),
    convertFrom01: (v01) => clamp(v01, 0, 1),
    format: (v) => `${Math.round(v * 100)}%`,
};

const TargetDurationSecondsConfig: ContinuousParamConfig = {
    resolutionSteps: SomaticCaps.maxMorphGradientTotalDurationSeconds * 20,
    default: 4,
    convertTo01: (v) => clamp(v / SomaticCaps.maxMorphGradientTotalDurationSeconds, 0, 1),
    convertFrom01: (v01) => clamp(v01, 0, 1) * SomaticCaps.maxMorphGradientTotalDurationSeconds,
    format: (v) => `${v.toFixed(2)} s`,
};

const AutoWindowCountConfig: ContinuousParamConfig = {
    resolutionSteps: SomaticCaps.maxMorphGradientNodes,
    default: 4,
    convertTo01: (v) => (clamp(Math.trunc(v), 1, SomaticCaps.maxMorphGradientNodes) - 1) / (SomaticCaps.maxMorphGradientNodes - 1),
    convertFrom01: (v01) => 1 + Math.round(clamp(v01, 0, 1) * (SomaticCaps.maxMorphGradientNodes - 1)),
    format: (v) => `${Math.trunc(v)}`,
};

const PerWindowDurationWaveformsConfig: ContinuousParamConfig = {
    resolutionSteps: 400,
    default: 2,
    convertTo01: (v) => clamp((v - 1) / 63, 0, 1),
    convertFrom01: (v01) => 1 + v01 * 63,
    format: (v) => `${v.toFixed(2)}x`,
};

const PlacementExponentConfig: ContinuousParamConfig = {
    resolutionSteps: 200,
    default: 1,
    convertTo01: (v) => clamp((v - 0.25) / (4 - 0.25), 0, 1),
    convertFrom01: (v01) => 0.25 + clamp(v01, 0, 1) * (4 - 0.25),
    format: (v) => v.toFixed(2),
};

const WindowCountConfig: ContinuousParamConfig = {
    resolutionSteps: SomaticCaps.maxMorphGradientNodes,
    default: 4,
    convertTo01: (v) => (clamp(Math.trunc(v), 1, SomaticCaps.maxMorphGradientNodes) - 1) / (SomaticCaps.maxMorphGradientNodes - 1),
    convertFrom01: (v01) => 1 + Math.round(clamp(v01, 0, 1) * (SomaticCaps.maxMorphGradientNodes - 1)),
    format: (v) => `${Math.trunc(v)}`,
};

function ensureImportState(instrument: Tic80Instrument): MorphSampleImportStateDto {
    return instrument.morphSampleImport ?? {
        sample: undefined,
        autoWindowParams: {
            sourceDuration01: 1,
            targetDurationSeconds: 4,
            windowCount: 4,
            perWindowDurationWaveforms: 2,
            placementExponent: 1,
        },
        windows: [],
    };
}

function nodesEqual(a: WaveformMorphGradientNode[], b: WaveformMorphGradientNode[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const na = a[i];
        const nb = b[i];
        if (!na || !nb) return false;
        if (na.durationSeconds !== nb.durationSeconds) return false;
        if (na.curveN11 !== nb.curveN11) return false;
        if (na.amplitudes.length !== nb.amplitudes.length) return false;
        for (let j = 0; j < na.amplitudes.length; j++) {
            if (na.amplitudes[j] !== nb.amplitudes[j]) return false;
        }
    }
    return true;
}

export const MorphSampleImportTab: React.FC<{
    song: Song;
    instrument: Tic80Instrument;
    instrumentIndex: number;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
}> = ({ song, instrument, instrumentIndex, onSongChange }) => {
    const state = ensureImportState(instrument);

    const [isImporting, setIsImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [autoWindowError, setAutoWindowError] = useState<string | null>(null);
    const [showSelectedWindowHighlights, setShowSelectedWindowHighlights] = useState(true);
    const [showAutoWindowPreviewHighlights, setShowAutoWindowPreviewHighlights] = useState(true);

    const decoded = useMemo(() => {
        if (!state.sample) return null;
        try {
            return decodeFloat32PcmFromDto(state.sample);
        } catch (e: any) {
            return null;
        }
    }, [state.sample]);

    const monoSamples = useMemo(() => {
        if (!decoded) return null;
        return extractSingleChannelPcm(decoded);
    }, [decoded]);

    const highlightWindows = useMemo(() => {
        if (!monoSamples) return [];
        return state.windows.map((w) => {
            const f = windowDtoToFrames(w, monoSamples.length);
            return { beginFrame: f.beginFrame, frameLength: f.frameLength };
        });
    }, [monoSamples, state.windows]);

    const previewHighlightWindows = useMemo(() => {
        if (!monoSamples) return [];
        const result = autoSelectWindows({ frameCount: monoSamples.length, params: state.autoWindowParams });
        if (!result.ok) return [];
        return result.windows.map((w) => {
            const f = windowDtoToFrames(w, monoSamples.length);
            return { beginFrame: f.beginFrame, frameLength: f.frameLength };
        });
    }, [monoSamples, state.autoWindowParams]);

    const toggleButtonStyle = (selected: boolean): React.CSSProperties => {
        return {
            background: selected ? "var(--panel-strong)" : "transparent",
            padding: "4px 8px",
        };
    };

    const dottedMarkers = useMemo(() => {
        if (!monoSamples) return [];
        const end = Math.floor(monoSamples.length * clamp(state.autoWindowParams.sourceDuration01, 0, 1));
        return [0, end];
    }, [monoSamples, state.autoWindowParams.sourceDuration01]);

    const setImportState = (mutate: (s: MorphSampleImportStateDto) => void, description: string) => {
        onSongChange({
            description,
            undoable: true,
            mutator: (s) => {
                const inst = s.instruments[instrumentIndex];
                inst.morphSampleImport = inst.morphSampleImport ?? ensureImportState(inst);
                mutate(inst.morphSampleImport);
            },
        });
    };

    const handleImport = async (file: File) => {
        setImportError(null);
        setAutoWindowError(null);
        setIsImporting(true);
        try {
            const dto = await decodeWavFileToDto(file);
            setImportState(
                (st) => {
                    st.sample = dto;
                },
                "Import WAV sample",
            );
        } catch (e: any) {
            setImportError(e?.message ?? String(e));
        } finally {
            setIsImporting(false);
        }
    };

    const handleClearSample = () => {
        setImportError(null);
        setAutoWindowError(null);
        setImportState(
            (st) => {
                st.sample = undefined;
            },
            "Clear imported sample",
        );
    };

    const handleAutoWindow = () => {
        setAutoWindowError(null);
        if (!monoSamples) {
            setAutoWindowError("Import a sample first.");
            return;
        }
        const result = autoSelectWindows({ frameCount: monoSamples.length, params: state.autoWindowParams });
        if (!result.ok) {
            setAutoWindowError(result.error);
            return;
        }
        setImportState(
            (st) => {
                st.windows = result.windows;
            },
            "Auto-window imported sample",
        );
    };

    const setAutoWindowParams = (next: Partial<MorphSampleImportAutoWindowParamsDto>) => {
        setImportState(
            (st) => {
                st.autoWindowParams = { ...st.autoWindowParams, ...next };
            },
            "Update sample import params",
        );
    };

    const setWindows = (next: MorphSampleImportWindowDto[]) => {
        setImportState(
            (st) => {
                st.windows = next;
            },
            "Update sample windows",
        );
    };

    const resizeWindows = (nextCount: number) => {
        const count = clamp(Math.trunc(nextCount), 1, SomaticCaps.maxMorphGradientNodes);
        const current = state.windows.slice();

        if (current.length === count) return;

        if (current.length > count) {
            setWindows(current.slice(0, count));
            return;
        }

        // Add new windows at the end without disturbing existing ones.
        const toAdd = count - current.length;
        for (let i = 0; i < toAdd; i++) {
            current.push({ begin01: 0, lengthWaveforms: 2 });
        }
        setWindows(current);
    };

    // Automatically regenerate the morph gradient when we have sample+windows.
    useEffect(() => {
        if (!decoded) return;
        if (state.windows.length === 0) return;
        if (instrument.waveEngine !== "morph") return;

        const handle = window.setTimeout(() => {
            const nextNodes = buildMorphGradientFromSampleImport({
                decoded,
                windows: state.windows,
                targetDurationSeconds: state.autoWindowParams.targetDurationSeconds,
            });

            if (nodesEqual(instrument.morphGradientNodes ?? [], nextNodes)) {
                return;
            }

            onSongChange({
                description: "Update morph gradient from sample",
                undoable: true,
                mutator: (s) => {
                    const inst = s.instruments[instrumentIndex];
                    inst.morphGradientNodes = nextNodes;
                },
            });
        }, 200);

        return () => window.clearTimeout(handle);
    }, [decoded, instrument.waveEngine, instrument.morphGradientNodes, instrumentIndex, onSongChange, state.autoWindowParams.targetDurationSeconds, state.windows]);

    // zoom to the source duration.
    const sourceSlice = useMemo(() => {
        if (!monoSamples) return null;
        const end = Math.floor(monoSamples.length * clamp(state.autoWindowParams.sourceDuration01, 0, 1));
        return monoSamples.slice(0, end);
    }, [monoSamples, state.autoWindowParams.sourceDuration01]);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <MorphSampleFileImportButton disabled={isImporting} onFileSelected={handleImport} />
                <button type="button" onClick={handleClearSample} disabled={!state.sample}>
                    Clear sample
                </button>
                {state.sample && (
                    <span style={{ fontSize: 12, opacity: 0.8 }}>
                        {state.sample.fileName} ({state.sample.channelCount}ch @ {state.sample.sampleRateHz}Hz)
                    </span>
                )}
            </div>

            {importError && <div className="alertPanel">{importError}</div>}

            {!state.sample && (
                <div style={{ maxWidth: 620 }}>
                    Import a .wav to generate a morphing waveform gradient.
                </div>
            )}

            {monoSamples && (
                <>
                    <WaveformVisualizer
                        samples={sourceSlice ?? monoSamples}
                        height={140}
                        highlights={showSelectedWindowHighlights ? highlightWindows : []}
                        secondaryHighlights={showAutoWindowPreviewHighlights ? previewHighlightWindows : []}
                        dottedMarkers={dottedMarkers}
                    />

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            type="button"
                            style={toggleButtonStyle(showSelectedWindowHighlights)}
                            onClick={() => setShowSelectedWindowHighlights((v) => !v)}
                        >
                            Windows
                        </button>
                        <button
                            type="button"
                            style={toggleButtonStyle(showAutoWindowPreviewHighlights)}
                            onClick={() => setShowAutoWindowPreviewHighlights((v) => !v)}
                        >
                            Auto-window preview
                        </button>
                        <span style={{ fontSize: 12, opacity: 0.8 }}>
                            Toggle highlight overlays
                        </span>
                    </div>

                    <div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <strong>Auto-window</strong>
                            <div className="field-row">
                                <ContinuousKnob
                                    label="Source duration"
                                    value={state.autoWindowParams.sourceDuration01}
                                    config={SourceDuration01Config}
                                    onChange={(v) => setAutoWindowParams({ sourceDuration01: clamp(v, 0, 1) })}
                                />
                                <ContinuousKnob
                                    label="Target duration"
                                    value={state.autoWindowParams.targetDurationSeconds}
                                    config={TargetDurationSecondsConfig}
                                    onChange={(v) => setAutoWindowParams({ targetDurationSeconds: clamp(v, 0, SomaticCaps.maxMorphGradientTotalDurationSeconds) })}
                                />
                                <ContinuousKnob
                                    label="# windows"
                                    value={state.autoWindowParams.windowCount}
                                    config={AutoWindowCountConfig}
                                    onChange={(v) => setAutoWindowParams({ windowCount: clamp(Math.trunc(v), 1, SomaticCaps.maxMorphGradientNodes) })}
                                />
                            </div>
                            <div className="field-row">
                                <ContinuousKnob
                                    label="Per-window duration"
                                    value={state.autoWindowParams.perWindowDurationWaveforms}
                                    config={PerWindowDurationWaveformsConfig}
                                    onChange={(v) => setAutoWindowParams({ perWindowDurationWaveforms: Math.max(1, v) })}
                                />
                                <ContinuousKnob
                                    label="Placement exp"
                                    value={state.autoWindowParams.placementExponent}
                                    config={PlacementExponentConfig}
                                    onChange={(v) => setAutoWindowParams({ placementExponent: Math.max(0.01, v) })}
                                />
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <button type="button" onClick={handleAutoWindow}>
                                        Auto-window
                                    </button>
                                    {autoWindowError && <span style={{ fontSize: 12 }} className="alertPanel">{autoWindowError}</span>}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                            <strong>Windows</strong>
                            <span style={{ fontSize: 12, opacity: 0.8 }}>
                                Each window becomes a morph gradient node (max {SomaticCaps.maxMorphGradientNodes}).
                            </span>
                        </div>

                        <div className="field-row">
                            <ContinuousKnob
                                label="# windows"
                                value={state.windows.length || 1}
                                config={WindowCountConfig}
                                onChange={(v) => resizeWindows(v)}
                            />
                            <div style={{ fontSize: 12, opacity: 0.8, maxWidth: 520 }}>
                                Tip: Auto-window will overwrite window positions and lengths.
                            </div>
                        </div>

                        {state.windows.length === 0 && (
                            <div style={{ maxWidth: 620 }}>
                                No windows selected. Click <strong>Auto-window</strong> or add windows with the knob above.
                            </div>
                        )}

                        {state.windows.map((w, idx) => (
                            <MorphSampleWindowItem
                                key={idx}
                                index={idx}
                                window={w}
                                monoSamples={monoSamples}
                                gradientNode={instrument.morphGradientNodes?.[idx]}
                                onChange={(next) => {
                                    const copy = state.windows.slice();
                                    copy[idx] = next;
                                    setWindows(copy);
                                }}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};
