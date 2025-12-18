import React, { useEffect, useMemo, useState } from "react";
import { Song } from "../models/song";
import { useWriteBehindEffect } from "../hooks/useWriteBehindEffect";
import { serializeSongToCart, serializeSongToCartDetailed, SongCartDetails } from "../audio/tic80_cart_serializer";
import { Tooltip } from "./tooltip";
import { formatBytes } from "../utils/utils";
import { useClipboard } from "../hooks/useClipboard";



type ChunkInfo = {
    name: string; //
    size: number;//
    color: string;
};

// type SongStatsData = {
//     cartSize: number;
//     breakdown: ChunkInfo[];
// };

// const CHUNK_NAMES: Record<number, string> = {
//     5: 'Code',
//     9: 'SFX',
//     10: 'Waveforms',
//     14: 'Music Tracks',
//     15: 'Music Patterns',
// };

// const CHUNK_COLORS: Record<number, string> = {
//     5: '#6c5ce7',
//     9: '#00b894',
//     10: '#0984e3',
//     14: '#fdcb6e',
//     15: '#d63031',
// };

// function parseCartridge(cart: Uint8Array): ChunkInfo[] {
//     const chunks: ChunkInfo[] = [];
//     let pos = 0;
//     while (pos + 4 <= cart.length) {
//         const header0 = cart[pos++];
//         const type = header0 & 0x1f;
//         const lenLo = cart[pos++];
//         const lenHi = cart[pos++];
//         const len = (lenHi << 8) | lenLo;
//         // reserved
//         pos++;
//         // ensure we don't read past end
//         const payloadLen = Math.min(len, Math.max(0, cart.length - pos));
//         chunks.push({ type, name: CHUNK_NAMES[type] ?? `Chunk ${type}`, size: payloadLen });
//         pos += payloadLen;
//     }
//     return chunks;
// }

export const SongStats: React.FC<{ song: Song }> = ({ song }) => {
    const [cartDetails, setCartDetails] = useState<SongCartDetails | null>(null);

    const clipboard = useClipboard();
    //const [data, setData] = useState<SongStatsData>({ cartSize: 0, breakdown: [] });

    const cartWriter = useWriteBehindEffect<Song, SongCartDetails>(async (doc) => {
        const cartDetails = serializeSongToCartDetailed(doc, true, 'release');
        return cartDetails;
    }, {
        debounceMs: 1200,
        maxWaitMs: 5000,
        onSuccess: (cartDetails) => {
            setCartDetails(cartDetails);
        },
        onError: () => {
            setCartDetails(null);
            //setData({ cartSize: 0, breakdown: [] });
        },
    });

    useEffect(() => {
        cartWriter.enqueue(song);
    }, [song]);

    //const totalSize = Math.max(1, data.breakdown.reduce((s, c) => s + c.size, 0) || data.cartSize || 0);

    const breakdown = useMemo<ChunkInfo[]>(() => {
        if (!cartDetails) return [];
        const result: ChunkInfo[] = [];
        result.push({ name: 'Code (playroutine)', size: cartDetails.codeChunk.length - cartDetails.generatedCode.length, color: 'var(--tic-1)' });
        result.push({ name: 'Code (songdata)', size: cartDetails.generatedCode.length, color: 'var(--tic-2)' });
        result.push({ name: 'Waveforms', size: cartDetails.waveformChunk.length, color: 'var(--tic-3)' });
        result.push({ name: 'SFX', size: cartDetails.sfxChunk.length, color: 'var(--tic-4)' });
        result.push({ name: 'Patterns', size: cartDetails.patternChunk.length, color: 'var(--tic-5)' });
        result.push({ name: 'Tracks', size: cartDetails.trackChunk.length, color: 'var(--tic-6)' });
        return result;
    }, [cartDetails]);

    const totalSize = Math.max(1, cartDetails?.cartridge.length || 0);

    const handleClickGeneratedCode = async () => {
        console.log(cartDetails?.generatedCode);
        await clipboard.copyTextToClipboard(cartDetails?.generatedCode || "");
    };

    const tooltipContent = !cartDetails ? (<>No data</>) : (
        <div style={{ minWidth: 320 }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Cart size: {formatBytes(cartDetails.cartridge.length)}</div>
            <div style={{ height: 12, display: 'flex', width: '100%', background: '#0ff', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                {breakdown.length > 0 ? breakdown.map((c, idx) => (
                    <div key={idx} title={`${c.name}: ${c.size} bytes`} style={{ flex: c.size || 1, background: c.color }} />
                )) : <div style={{ flex: 1, background: '#444' }} />}
            </div>
            <div>
                {breakdown.map((c, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <div style={{ width: 12, height: 12, background: c.color, borderRadius: 2 }} />
                        <div style={{ flex: 1 }}>{c.name}</div>
                        <div style={{ color: '#aaa', minWidth: 80, textAlign: 'right' }}>{formatBytes(c.size)} · {((c.size / totalSize) * 100).toFixed(1)}%</div>
                    </div>
                ))}

                Click to Copy generated code

                {/* display more fields */}
                <div>Patterns: {cartDetails.optimizeResult.usedPatternCount}</div>
                <div>SFX: {cartDetails.optimizeResult.usedSfxCount}</div>
                <div>Waveforms: {cartDetails.optimizeResult.usedWaveformCount}</div>
            </div>
        </div>
    );

    return (<div>
        <Tooltip title={tooltipContent} placement="bottom">
            <div className="cartSize__label" style={{ cursor: 'default' }} onClick={() => handleClickGeneratedCode()}>
                cart: {formatBytes(totalSize)}
            </div>
        </Tooltip>
    </div>
    );
};

