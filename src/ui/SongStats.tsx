// TIC-80 specific

import React, { useEffect, useMemo, useState } from "react";
import { lzCompress, lzDecompress } from "../audio/encoding";
import { serializeSongForTic80Bridge, serializeSongToCartDetailed, SongCartDetails, Tic80SerializedSong } from "../audio/tic80_cart_serializer";
import { useClipboard } from "../hooks/useClipboard";
import { useRenderAlarm } from "../hooks/useRenderAlarm";
import { useWriteBehindEffect } from "../hooks/useWriteBehindEffect";
import { Song } from "../models/song";
import { analyzePatternColumns, OptimizeSong, PatternColumnAnalysisResult } from "../utils/SongOptimizer";
import { compareBuffers, formatBytes } from "../utils/utils";
//import { generateAllMemoryMaps } from "../utils/memoryMapStats";
import { Tic80MemoryMap } from "../../bridge/memory_layout";
import { MemoryRegion } from "../utils/bitpack/MemoryRegion";
import { AppPanelShell } from "./AppPanelShell";
import { BarValue, SizeValue } from "./basic/BarValue";
import { KeyValueTable } from "./basic/KeyValueTable";
import { Tooltip } from "./basic/tooltip";
import { Button } from "./Buttons/PushButton";
import { MemoryMapTextSummary, MemoryMapVis } from "./MemoryMapVis";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { CheckboxButton } from "./Buttons/CheckboxButton";
import { GlobalActions } from "../keyb/ActionIds";
import { gTic80AllChannelsAudible } from "../models/tic80Capabilities";

type ChunkInfo = {
    name: string; //
    size: number;//
    color: string;
};

type PayloadSizeReport = {
    rawBytes: number;
    compressedBytes: number;
    //luaStringBytes: number;
};

type Stats = {
    chunks: ChunkInfo[];
    patternPayload: PayloadSizeReport;
    patternColumnStats: PatternColumnAnalysisResult;
    //roundTripStatus: string;
};

type SongSerialized = {
    cartridge: SongCartDetails;
    bridge: Tic80SerializedSong;
};

export type SongStatsData = {
    input: SongSerialized | null;
    breakdown: Stats;
    totalSize: number;
    patternCompressionRatio: number;
};

export const useSongStatsData = (song: Song, variant: "debug" | "release"): SongStatsData => {
    const [input, setInput] = useState<SongSerialized | null>(null);

    // These are tuning constants; we currently don't expose UI to tweak them.
    const windowSize = 16;
    const minMatchLength = 4;
    const maxMatchLength = 30;
    const useRLE = false;

    const [debouncedSong, setDebouncedSong] = useState<Song | null>(null);

    // Minimal work in useWriteBehindEffect - just handle debouncing
    const cartWriter = useWriteBehindEffect<Song, Song>(async (doc) => {
        // Just pass through the song
        return doc;
    }, {
        debounceMs: 1200,
        maxWaitMs: 5000,
        onSuccess: (next) => {
            setDebouncedSong(next);
        },
        onError: (error) => {
            console.error("Error in debounce:", error);
            setDebouncedSong(null);
        },
    });

    useEffect(() => {
        cartWriter.enqueue(song);
    }, [song]);

    // Do all the heavy work synchronously
    useEffect(() => {
        if (!debouncedSong) {
            setInput(null);
            return;
        }

        try {
            const cartDetails = serializeSongToCartDetailed(debouncedSong, true, variant, gTic80AllChannelsAudible);

            const optimizedDoc = OptimizeSong(debouncedSong).optimizedSong;
            const bridge = serializeSongForTic80Bridge({
                song: optimizedDoc,
                loopMode: "off",
                cursorSongOrder: 0,
                cursorChannelIndex: 0,
                cursorRowIndex: 0,
                patternSelection: null,
                audibleChannels: gTic80AllChannelsAudible,
                startPosition: 0,
                startRow: 0,
                songOrderSelection: null,
            });

            setInput({ cartridge: cartDetails, bridge });
        } catch (error) {
            console.error("Error generating song stats:", error);
            setInput(null);
        }
    }, [debouncedSong, variant]);

    const breakdown = useMemo<Stats>(() => {
        if (!input) return {
            chunks: [],
            patternPayload: {
                rawBytes: 0,
                compressedBytes: 0,
                //luaStringBytes: 0,
            },
            patternColumnStats: {
                totalColumns: 0,
                distinctColumns: 0,
                columnPayload: {
                    rawBytes: 0,
                    compressedBytes: 0,
                    //luaStringBytes: 0,
                },
            },
            //roundTripStatus: "no data",
        };

        const result: ChunkInfo[] = [];
        //result.push({ name: 'Code (playroutine only)', size: input.cartridge.codeChunk.length - input.cartridge.generatedCode.length, color: 'var(--tic-1)' });
        //result.push({ name: 'Code (generated songdata)', size: input.cartridge.generatedCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Code (whole playroutine)', size: input.cartridge.wholePlayroutineCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Waveforms', size: input.cartridge.waveformChunk.length, color: 'var(--tic-3)' });
        result.push({ name: 'SFX', size: input.cartridge.sfxChunk.length, color: 'var(--tic-4)' });
        result.push({ name: 'Patterns', size: input.cartridge.patternSerializationPlan.patternRamData.length, color: 'var(--tic-5)' });
        result.push({ name: 'Tracks', size: input.cartridge.trackChunk.length, color: 'var(--tic-6)' });

        let rawBytes = 0;
        let compressedBytes = 0;
        //let luaStringBytes = 0;
        //let status = "ok";
        try {
            for (const patternData of input.cartridge.patternSerializationPlan.patternChunks) {
                const patternCompressed = lzCompress(patternData, {
                    minMatchLength,
                    maxMatchLength,
                    windowSize,
                    useRLE,
                });

                const decompressed = lzDecompress(patternCompressed);
                const compareResult = compareBuffers(patternData, decompressed);

                if (!compareResult.match) {
                    console.error("Decompressed pattern does not match original!", { patternData, decompressed });
                    //status = `Roundtrip error: ${compareResult.description}`;
                }

                rawBytes += patternData.length;
                compressedBytes += patternCompressed.length;
                //luaStringBytes += base85Encode(patternCompressed).length;
            }
        } catch (e) {
            console.error("Error calculating pattern compression stats:", e);
            //status = `Exception thrown`;
        }

        const patternColumnStats = analyzePatternColumns(input.cartridge.optimizeResult.optimizedSong);

        return {
            chunks: result,
            patternPayload: {
                rawBytes,
                compressedBytes,
                //luaStringBytes,
            },
            patternColumnStats,
            //roundTripStatus: status,
        };
    }, [input]);

    const totalSize = Math.max(1, input?.cartridge.cartridge.length || 0);
    const patternCompressionRatio = breakdown.patternPayload.rawBytes > 0
        ? (breakdown.patternPayload.compressedBytes / breakdown.patternPayload.rawBytes)
        : 1;
    //const error = (input?.bridge.patternData.length || 0) > SomaticCaps.maxPatternLengthToBridge;

    return { input, breakdown, totalSize, patternCompressionRatio };
};

export const SongStatsAppPanel: React.FC<{ data: SongStatsData; onClose: () => void; variant: "debug" | "release"; onVariantChange: (variant: "debug" | "release") => void }> = ({ data, onClose, variant, onVariantChange }) => {
    const { input, breakdown, totalSize, patternCompressionRatio } = data;
    const clipboard = useClipboard();

    const handleCopyGeneratedCode = async () => {
        console.log(input?.cartridge);
        await clipboard.copyTextToClipboard(input?.cartridge.wholePlayroutineCode || "");
    };

    const body = !input ? (
        <div>No data yet.</div>
    ) : (
        <div style={{ minWidth: 420 }}>
            <ButtonGroup>
                <CheckboxButton
                    checked={variant === "debug"}
                    onChange={() => onVariantChange(variant === "debug" ? "release" : "debug")}
                >
                    Debug
                </CheckboxButton>
                <CheckboxButton
                    checked={variant === "release"}
                    onChange={() => onVariantChange("release")}
                >
                    Release
                </CheckboxButton>
            </ButtonGroup>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
                Cart size: <SizeValue value={input.cartridge.cartridge.length} />
            </div>

            <div
                style={{
                    height: 12,
                    display: 'flex',
                    width: '100%',
                    background: 'var(--panel-strong)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginBottom: 8,
                    border: '1px solid var(--border)',
                }}
            >
                {breakdown.chunks.length > 0 ? breakdown.chunks.map((c, idx) => (
                    <div key={idx} title={`${c.name}: ${c.size} bytes`} style={{ flex: c.size || 1, background: c.color }} />
                )) : <div style={{ flex: 1, background: 'var(--border)' }} />}
            </div>

            <div>
                {breakdown.chunks.map((c, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 12, height: 12, background: c.color, borderRadius: 2 }} />
                        <div style={{ flex: 1 }}>{c.name}</div>
                        <div style={{ color: 'var(--muted)', minWidth: 90, textAlign: 'right', display: "flex" }}>
                            <SizeValue value={c.size} /> · {((c.size / totalSize) * 100).toFixed(1)}%
                        </div>
                    </div>
                ))}

                {(() => {
                    const rawMax = Math.max(
                        breakdown.patternPayload.rawBytes,
                        breakdown.patternColumnStats.columnPayload.rawBytes,
                    );

                    const extraSongDataMax = Math.max(
                        input.cartridge.extraSongDataDetails.binaryPayload.length,
                        input.cartridge.extraSongDataDetails.compressedPayload.length,
                        input.cartridge.extraSongDataDetails.base85Payload.length,
                    );

                    const kv = {
                        Cart: {
                            'Serialization took': `${input.cartridge.elapsedMillis} ms`,
                            Patterns: input.cartridge.optimizeResult.usedPatternColumnCount,
                            'Columns used/distinct': `${breakdown.patternColumnStats.totalColumns} / ${breakdown.patternColumnStats.distinctColumns}`,
                            SFX: input.cartridge.optimizeResult.usedSfxCount,
                            Waveforms: input.cartridge.optimizeResult.usedWaveformCount,
                        },
                        'Playback Features': {
                            'Wave morph': input.cartridge.optimizeResult.featureUsage.waveMorph,
                            PWM: input.cartridge.optimizeResult.featureUsage.pwm,
                            Lowpass: input.cartridge.optimizeResult.featureUsage.lowpass,
                            Wavefold: input.cartridge.optimizeResult.featureUsage.wavefold,
                            'Hard sync': input.cartridge.optimizeResult.featureUsage.hardSync,
                            LFO: input.cartridge.optimizeResult.featureUsage.lfo,
                        },
                        'Pattern Payload Sizes': {
                            'RAW': <BarValue value={breakdown.patternColumnStats.columnPayload.rawBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.rawBytes} />} />,
                            'LZ': <BarValue value={breakdown.patternColumnStats.columnPayload.compressedBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.compressedBytes} />} />,
                            //'Lua': <BarValue value={breakdown.patternColumnStats.columnPayload.luaStringBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.luaStringBytes} />} />,
                            'Pattern compression ratio': `${(patternCompressionRatio * 100).toFixed(1)}%`,
                            //Status: breakdown.roundTripStatus,
                        },
                        "Somatic-specific song data": {
                            "k-rate instruments": input.cartridge.extraSongDataDetails.krateInstruments.length,
                            'Extra song data size': <BarValue value={input.cartridge.extraSongDataDetails.binaryPayload.length} max={extraSongDataMax} label={<SizeValue value={input.cartridge.extraSongDataDetails.binaryPayload.length} />} />,
                            '(compressed)': <BarValue value={input.cartridge.extraSongDataDetails.compressedPayload.length} max={extraSongDataMax} label={<SizeValue value={input.cartridge.extraSongDataDetails.compressedPayload.length} />} />,
                            '(base85 encoded)': <BarValue value={input.cartridge.extraSongDataDetails.base85Payload.length} max={extraSongDataMax} label={<SizeValue value={input.cartridge.extraSongDataDetails.base85Payload.length} />} />,
                        },
                        //"bytes per morph entry": MORPH_ENTRY_BYTES,
                    };

                    const ramPatternCount = input.cartridge.patternSerializationPlan.compressedPatternsInRam.length;
                    const luaPatternCount = input.cartridge.patternSerializationPlan.patternsInLuaCount;

                    const mapBlocks = [
                        ...input.cartridge.memoryRegions.bridgeMap,
                        ...input.bridge.mapBlocksToTransmit.map(r => r.region),
                    ];

                    return (
                        <>
                            <div style={{ marginTop: 24, marginBottom: 12 }}>
                                <div style={{ fontWeight: 600, marginBottom: 12 }}>TIC-80 Memory Layout</div>
                                {(() => {
                                    return (
                                        <>
                                            <div style={{ marginBottom: 16 }}>
                                                <Tooltip title={<MemoryMapTextSummary root={Tic80MemoryMap.Waveforms} regions={[input.cartridge.memoryRegions.waveforms]} />}>
                                                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>Waveforms</div>
                                                </Tooltip>
                                                <MemoryMapVis root={Tic80MemoryMap.Waveforms} regions={[input.cartridge.memoryRegions.waveforms]} />
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <Tooltip title={<MemoryMapTextSummary root={Tic80MemoryMap.Sfx} regions={[input.cartridge.memoryRegions.sfx]} />}>
                                                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>SFX</div>
                                                </Tooltip>
                                                <MemoryMapVis root={Tic80MemoryMap.Sfx} regions={[input.cartridge.memoryRegions.sfx]} />
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <Tooltip title={<MemoryMapTextSummary root={Tic80MemoryMap.Map} regions={mapBlocks} />}>
                                                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>Map (Bridge Runtime)</div>
                                                </Tooltip>
                                                <MemoryMapVis root={Tic80MemoryMap.Map} regions={mapBlocks} />
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <Tooltip title={<MemoryMapTextSummary root={Tic80MemoryMap.MusicPatterns} regions={input.cartridge.memoryRegions.patterns} />}>
                                                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>Music Patterns (Cartridge)</div>
                                                </Tooltip>
                                                <MemoryMapVis root={Tic80MemoryMap.MusicPatterns} regions={input.cartridge.memoryRegions.patterns} />
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <Tooltip title={<MemoryMapTextSummary root={Tic80MemoryMap.MusicPatterns} regions={[...input.cartridge.memoryRegions.patterns, ...input.cartridge.memoryRegions.patternsRuntime]} />}>
                                                    <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>Music Patterns (Runtime)</div>
                                                </Tooltip>
                                                <MemoryMapVis root={Tic80MemoryMap.MusicPatterns} regions={[...input.cartridge.memoryRegions.patterns, ...input.cartridge.memoryRegions.patternsRuntime]} />
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <div style={{ fontSize: 12, marginBottom: 4, color: 'var(--muted)' }}>Music Patterns (compound)</div>
                                                <MemoryMapVis root={new MemoryRegion({
                                                    name: 'Music Patterns (compound)',
                                                    address: 0,
                                                    size: ramPatternCount + luaPatternCount,
                                                })} regions={
                                                    [
                                                        new MemoryRegion({
                                                            name: 'Pattern RAM Data',
                                                            address: 0,
                                                            size: ramPatternCount,
                                                        }),
                                                        new MemoryRegion({
                                                            name: 'Pattern Code',
                                                            address: ramPatternCount,
                                                            size: luaPatternCount,
                                                        }),
                                                    ]} />
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            <KeyValueTable
                                value={kv}
                                maxDepth={4}
                                sortKeys={false}
                                maxStringLength={200}
                            />

                        </>
                    );
                })()}
            </div>
        </div>
    );

    return (
        <AppPanelShell
            className="song-stats-panel"
            title="Song Stats"
            onClose={onClose}
            closeActionId={GlobalActions.ToggleCartStatsPanel}
            actions={(
                <>
                    <Button onClick={handleCopyGeneratedCode} disabled={!input}>Copy generated code</Button>
                    {/* <Button onClick={onClose}>Close</Button> */}
                </>
            )}
        >
            {body}
        </AppPanelShell>
    );
};
export const SongStats: React.FC<{ data: SongStatsData; onTogglePanel: () => void }> = ({ data, onTogglePanel }) => {
    useRenderAlarm({
        name: 'SongStats',
    });

    return (
        <Tooltip title={`Cartridge size: ${data.totalSize} bytes. Click to show cartridge info`}>
            <Button
                className={`songStatsPanel`}
                onClick={onTogglePanel}
            >
                <div className="cartSize__label" style={{ cursor: 'pointer' }}>
                    {formatBytes(data.totalSize)}
                </div>
            </Button>
        </Tooltip>
    );
};

