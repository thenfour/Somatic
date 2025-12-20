import React, { useEffect, useMemo, useState } from "react";
import { Song } from "../models/song";
import { useWriteBehindEffect } from "../hooks/useWriteBehindEffect";
import { serializeSongForTic80Bridge, serializeSongToCart, serializeSongToCartDetailed, SongCartDetails, Tic80SerializedSong } from "../audio/tic80_cart_serializer";
import { Tooltip } from "./tooltip";
import { compareBuffers, formatBytes } from "../utils/utils";
import { useClipboard } from "../hooks/useClipboard";
import { base85Encode, lzCompress, lzDecompress } from "../audio/encoding";
import { OptimizeSong } from "../utils/SongOptimizer";
import { gAllChannelsAudible, SomaticCaps } from "../models/tic80Capabilities";
import { useRenderAlarm } from "../hooks/useRenderAlarm";

type ChunkInfo = {
    name: string; //
    size: number;//
    color: string;
};

type Stats = {
    chunks: ChunkInfo[];
    patternUncompressedSize: number;
    patternCompressedSize: number;
    patternCompressionRatio: number;
    roundTripStatus: string;
};

type SongSerialized = {
    cartridge: SongCartDetails;
    bridge: Tic80SerializedSong;
};

export const SongStats: React.FC<{ song: Song }> = ({ song }) => {
    const [input, setInput] = useState<SongSerialized | null>(null);
    const [windowSize, setWindowSize] = useState<number>(16);
    const [minMatchLength, setMinMatchLength] = useState<number>(4);
    const [maxMatchLength, setMaxMatchLength] = useState<number>(30);
    const [useRLE, setUseRLE] = useState<boolean>(false);

    useRenderAlarm({
        name: 'SongStats',
    });

    const clipboard = useClipboard();
    //const [data, setData] = useState<SongStatsData>({ cartSize: 0, breakdown: [] });

    const cartWriter = useWriteBehindEffect<Song, SongSerialized>(async (doc) => {
        const cartDetails = serializeSongToCartDetailed(doc, true, 'release', gAllChannelsAudible);

        const optimizedDoc = OptimizeSong(doc).optimizedSong;
        const bridge = serializeSongForTic80Bridge(optimizedDoc, gAllChannelsAudible);
        return { cartridge: cartDetails, bridge };
    }, {
        debounceMs: 1200,
        maxWaitMs: 5000,
        onSuccess: (input) => {
            setInput(input);
        },
        onError: () => {
            setInput(null);
        },
    });

    useEffect(() => {
        cartWriter.enqueue(song);
    }, [song]);

    // refresh when compression settings change
    // useEffect(() => {
    //     cartWriter.enqueue(song);
    //     cartWriter.flush();
    // }, [minMatchLength, maxMatchLength, windowSize, useRLE]);

    const breakdown = useMemo<Stats>(() => {
        if (!input) return {
            chunks: [],
            patternCompressedSize: 0,
            patternUncompressedSize: 0,
            patternCompressionRatio: 1,
            roundTripStatus: "no data",
        };
        const result: ChunkInfo[] = [];
        result.push({ name: 'Code (playroutine)', size: input.cartridge.codeChunk.length - input.cartridge.generatedCode.length, color: 'var(--tic-1)' });
        result.push({ name: 'Code (songdata)', size: input.cartridge.generatedCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Waveforms', size: input.cartridge.waveformChunk.length, color: 'var(--tic-3)' });
        result.push({ name: 'SFX', size: input.cartridge.sfxChunk.length, color: 'var(--tic-4)' });
        result.push({ name: 'Patterns', size: input.cartridge.patternChunk.length, color: 'var(--tic-5)' });
        result.push({ name: 'Tracks', size: input.cartridge.trackChunk.length, color: 'var(--tic-6)' });

        let patternCompressedSize = 0;
        let patternUncompressedSize = 0;
        let status = "ok";
        try {
            for (const patternData of input.cartridge.realPatternChunks) {
                // to truly compare pattern compression,
                // for each pattern, compress it, base85 encode, and sum the sizes.
                const patternCompressed = lzCompress(patternData, {
                    minMatchLength,
                    maxMatchLength,
                    windowSize,
                    useRLE,
                });

                const decompressed = lzDecompress(patternCompressed); // sanity check
                const compareResult = compareBuffers(patternData, decompressed);

                if (!compareResult.match) {
                    console.error("Decompressed pattern does not match original!", { patternData, decompressed });
                    status = `Roundtrip error: ${compareResult.description}`;
                }

                patternCompressedSize += base85Encode(patternCompressed).length;
                patternUncompressedSize += base85Encode(patternData).length;
            }
        } catch (e) {
            console.error("Error calculating pattern compression stats:", e);
            status = `Exception thrown`;
        }

        const patternCompressionRatio = patternUncompressedSize > 0 ? (patternCompressedSize / patternUncompressedSize) : 1;

        return {
            chunks: result,
            patternCompressedSize,
            patternUncompressedSize,
            patternCompressionRatio,
            roundTripStatus: status,
        };
    }, [input]);

    const totalSize = Math.max(1, input?.cartridge.cartridge.length || 0);

    const handleClickGeneratedCode = async () => {
        console.log(input?.cartridge.generatedCode);
        await clipboard.copyTextToClipboard(input?.cartridge.generatedCode || "");
    };

    const tooltipContent = !input ? (<>No data</>) : (
        <div style={{ minWidth: 320 }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Cart size: {formatBytes(input.cartridge.cartridge.length)}</div>
            <div style={{ height: 12, display: 'flex', width: '100%', background: '#0ff', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                {breakdown.chunks.length > 0 ? breakdown.chunks.map((c, idx) => (
                    <div key={idx} title={`${c.name}: ${c.size} bytes`} style={{ flex: c.size || 1, background: c.color }} />
                )) : <div style={{ flex: 1, background: '#444' }} />}
            </div>
            <div>
                {breakdown.chunks.map((c, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 12, height: 12, background: c.color, borderRadius: 2 }} />
                        <div style={{ flex: 1 }}>{c.name}</div>
                        <div style={{ color: '#aaa', minWidth: 80, textAlign: 'right' }}>{formatBytes(c.size)} · {((c.size / totalSize) * 100).toFixed(1)}%</div>
                    </div>
                ))}

                Click to Copy generated code

                {/* display more fields */}
                <div>Serialization took: {input.cartridge.elapsedMillis} ms</div>
                <div>Patterns: {input.cartridge.optimizeResult.usedPatternCount}</div>
                <div>SFX: {input.cartridge.optimizeResult.usedSfxCount}</div>
                <div>Waveforms: {input.cartridge.optimizeResult.usedWaveformCount}</div>
                <div>Pattern uncompressed size: {formatBytes(breakdown.patternUncompressedSize)}</div>
                <div>Pattern compressed size  : {formatBytes(breakdown.patternCompressedSize)}</div>
                <div>Pattern compression ratio: {(breakdown.patternCompressionRatio * 100).toFixed(1)}%</div>
                <div>status: {breakdown.roundTripStatus}</div>
                <div>---</div>
                <div>Bridge:</div>
                <div>  Waveforms: {input.bridge.optimizeResult.usedWaveformCount} ({input.bridge.waveformData.length} bytes)</div>
                <div>  SFX: {input.bridge.optimizeResult.usedSfxCount} ({input.bridge.sfxData.length} bytes)</div>
                <div>  Patterns: {input.bridge.optimizeResult.usedPatternCount} ({input.bridge.patternData.length} bytes)</div>
                <div>  Tracks: {input.bridge.trackData.length} bytes</div>
                <div>  Song order: {input.bridge.songOrderData.length} bytes</div>

            </div>
        </div>
    );

    const error = (input?.bridge.patternData.length || 0) > SomaticCaps.maxPatternLengthToBridge;

    return (<div className={`songStatsPanel ${error ? 'error' : ''}`}>
        <Tooltip title={tooltipContent} placement="bottom">
            <div>
                {/* <input type="number" value={windowSize} min={1} onChange={e => setWindowSize(parseInt(e.target.value) || 16)} style={{ width: 60, marginLeft: 8 }} /> window size
                <input type="number" value={minMatchLength} min={2} onChange={e => setMinMatchLength(parseInt(e.target.value) || 3)} style={{ width: 60 }} /> min match length
                <input type="number" value={maxMatchLength} onChange={e => setMaxMatchLength(parseInt(e.target.value) || 18)} style={{ width: 60, marginLeft: 8 }} /> max match length
                <label style={{ marginLeft: 8 }}>
                    <input type="checkbox" checked={useRLE} onChange={e => setUseRLE(e.target.checked)} /> use RLE
                </label> */}
                <div className="cartSize__label" style={{ cursor: 'default' }} onClick={() => handleClickGeneratedCode()}>
                    cart: {formatBytes(totalSize)}
                </div>
            </div>
        </Tooltip>
    </div>
    );
};

