import React, { useEffect, useMemo, useState } from "react";
import { MORPH_ENTRY_BYTES } from "../../bridge/morphSchema";
import { base85Encode, lzCompress, lzDecompress } from "../audio/encoding";
import { serializeSongForTic80Bridge, serializeSongToCartDetailed, SongCartDetails, Tic80SerializedSong } from "../audio/tic80_cart_serializer";
import { useClipboard } from "../hooks/useClipboard";
import { useRenderAlarm } from "../hooks/useRenderAlarm";
import { useWriteBehindEffect } from "../hooks/useWriteBehindEffect";
import { Song } from "../models/song";
import { gAllChannelsAudible, SomaticCaps } from "../models/tic80Capabilities";
import { analyzePatternColumns, OptimizeSong, PatternColumnAnalysisResult } from "../utils/SongOptimizer";
import { compareBuffers, formatBytes } from "../utils/utils";
import { AppPanelShell } from "./AppPanelShell";
import { BarValue, SizeValue } from "./basic/BarValue";
import { KeyValueTable } from "./basic/KeyValueTable";
import { Tooltip } from "./basic/tooltip";
import { Button } from "./Buttons/PushButton";

type ChunkInfo = {
    name: string; //
    size: number;//
    color: string;
};

type PayloadSizeReport = {
    rawBytes: number;
    compressedBytes: number;
    luaStringBytes: number;
};

type Stats = {
    chunks: ChunkInfo[];
    patternPayload: PayloadSizeReport;
    patternColumnStats: PatternColumnAnalysisResult;
    roundTripStatus: string;
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
    error: boolean;
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
            const cartDetails = serializeSongToCartDetailed(debouncedSong, true, variant, gAllChannelsAudible);

            const optimizedDoc = OptimizeSong(debouncedSong).optimizedSong;
            const bridge = serializeSongForTic80Bridge({
                song: optimizedDoc,
                loopMode: "off",
                cursorSongOrder: 0,
                cursorChannelIndex: 0,
                cursorRowIndex: 0,
                patternSelection: null,
                audibleChannels: gAllChannelsAudible,
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
                luaStringBytes: 0,
            },
            patternColumnStats: {
                totalColumns: 0,
                distinctColumns: 0,
                columnPayload: {
                    rawBytes: 0,
                    compressedBytes: 0,
                    luaStringBytes: 0,
                },
            },
            roundTripStatus: "no data",
        };

        const result: ChunkInfo[] = [];
        result.push({ name: 'Code (playroutine only)', size: input.cartridge.codeChunk.length - input.cartridge.generatedCode.length, color: 'var(--tic-1)' });
        result.push({ name: 'Code (generated songdata)', size: input.cartridge.generatedCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Code (whole playroutine)', size: input.cartridge.wholePlayroutineCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Waveforms', size: input.cartridge.waveformChunk.length, color: 'var(--tic-3)' });
        result.push({ name: 'SFX', size: input.cartridge.sfxChunk.length, color: 'var(--tic-4)' });
        result.push({ name: 'Patterns', size: input.cartridge.patternChunk.length, color: 'var(--tic-5)' });
        result.push({ name: 'Tracks', size: input.cartridge.trackChunk.length, color: 'var(--tic-6)' });

        let rawBytes = 0;
        let compressedBytes = 0;
        let luaStringBytes = 0;
        let status = "ok";
        try {
            for (const patternData of input.cartridge.realPatternChunks) {
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
                    status = `Roundtrip error: ${compareResult.description}`;
                }

                rawBytes += patternData.length;
                compressedBytes += patternCompressed.length;
                luaStringBytes += base85Encode(patternCompressed).length;
            }
        } catch (e) {
            console.error("Error calculating pattern compression stats:", e);
            status = `Exception thrown`;
        }

        const patternColumnStats = analyzePatternColumns(input.cartridge.optimizeResult.optimizedSong);

        return {
            chunks: result,
            patternPayload: {
                rawBytes,
                compressedBytes,
                luaStringBytes,
            },
            patternColumnStats,
            roundTripStatus: status,
        };
    }, [input]);

    const totalSize = Math.max(1, input?.cartridge.cartridge.length || 0);
    const patternCompressionRatio = breakdown.patternPayload.rawBytes > 0
        ? (breakdown.patternPayload.compressedBytes / breakdown.patternPayload.rawBytes)
        : 1;
    const error = (input?.bridge.patternData.length || 0) > SomaticCaps.maxPatternLengthToBridge;

    return { input, breakdown, totalSize, patternCompressionRatio, error };
};

export const SongStatsAppPanel: React.FC<{ data: SongStatsData; onClose: () => void; variant: "debug" | "release"; onVariantChange: (variant: "debug" | "release") => void }> = ({ data, onClose, variant, onVariantChange }) => {
    const { input, breakdown, totalSize, patternCompressionRatio } = data;
    const clipboard = useClipboard();

    const handleCopyGeneratedCode = async () => {
        await clipboard.copyTextToClipboard(input?.cartridge.wholePlayroutineCode || "");
    };

    const body = !input ? (
        <div>No data yet.</div>
    ) : (
        <div style={{ minWidth: 420 }}>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                        type="radio"
                        name="variant"
                        value="debug"
                        checked={variant === "debug"}
                        onChange={() => onVariantChange("debug")}
                    />
                    Debug
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input
                        type="radio"
                        name="variant"
                        value="release"
                        checked={variant === "release"}
                        onChange={() => onVariantChange("release")}
                    />
                    Release
                </label>
            </div>
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
                    // const lzMax = Math.max(
                    //     breakdown.patternPayload.compressedBytes,
                    //     breakdown.patternColumnStats.columnPayload.compressedBytes,
                    // );
                    // const luaMax = Math.max(
                    //     breakdown.patternPayload.luaStringBytes,
                    //     breakdown.patternColumnStats.columnPayload.luaStringBytes,
                    // );
                    const bridgeMax = Math.max(
                        input.bridge.waveformData.length,
                        input.bridge.sfxData.length,
                        input.bridge.patternData.length,
                        input.bridge.trackData.length,
                        input.bridge.songOrderData.length,
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
                            //'RAW (pattern-based)': <BarValue value={breakdown.patternPayload.rawBytes} max={rawMax} label={formatBytes(breakdown.patternPayload.rawBytes)} />,
                            'RAW': <BarValue value={breakdown.patternColumnStats.columnPayload.rawBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.rawBytes} />} />,
                            //'LZ (pattern-based)': <BarValue value={breakdown.patternPayload.compressedBytes} max={rawMax} label={formatBytes(breakdown.patternPayload.compressedBytes)} />,
                            'LZ': <BarValue value={breakdown.patternColumnStats.columnPayload.compressedBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.compressedBytes} />} />,
                            //'Lua (pattern data)': <BarValue value={breakdown.patternPayload.luaStringBytes} max={rawMax} label={formatBytes(breakdown.patternPayload.luaStringBytes)} />,
                            'Lua': <BarValue value={breakdown.patternColumnStats.columnPayload.luaStringBytes} max={rawMax} label={<SizeValue value={breakdown.patternColumnStats.columnPayload.luaStringBytes} />} />,
                            'Pattern compression ratio': `${(patternCompressionRatio * 100).toFixed(1)}%`,
                            Status: breakdown.roundTripStatus,
                        },
                        Bridge: {
                            Waveforms: <BarValue value={input.bridge.waveformData.length} max={bridgeMax} label={`${input.bridge.optimizeResult.usedWaveformCount} (${input.bridge.waveformData.length} bytes)`} />,
                            SFX: <BarValue value={input.bridge.sfxData.length} max={bridgeMax} label={`${input.bridge.optimizeResult.usedSfxCount} (${input.bridge.sfxData.length} bytes)`} />,
                            Patterns: <BarValue value={input.bridge.patternData.length} max={bridgeMax} label={`${input.bridge.optimizeResult.usedPatternColumnCount} (${input.bridge.patternData.length} bytes)`} />,
                            Tracks: <BarValue value={input.bridge.trackData.length} max={bridgeMax} label={`${input.bridge.trackData.length} bytes`} />,
                            'Song order': <BarValue value={input.bridge.songOrderData.length} max={bridgeMax} label={`${input.bridge.songOrderData.length} bytes`} />,
                        },
                        "MORPH_ENTRY_BYTES": MORPH_ENTRY_BYTES,
                    };

                    return (
                        <KeyValueTable
                            value={kv}
                            maxDepth={4}
                            sortKeys={false}
                            maxStringLength={200}
                        />
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
        <Tooltip title="Toggle Song Stats panel">
            <button
                type="button"
                className={`songStatsPanel ${data.error ? 'error' : ''}`}
                onClick={onTogglePanel}
            >
                <div className="cartSize__label" style={{ cursor: 'pointer' }}>
                    cart: {formatBytes(data.totalSize)}
                </div>
            </button>
        </Tooltip>
    );
};

