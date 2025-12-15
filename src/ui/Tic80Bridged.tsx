"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Tic80Iframe, Tic80IframeHandle } from "./Tic80EmbedIframe";
import { AsyncMutex } from "../utils/async_mutex";
import { Tic80ChannelIndex } from "../models/tic80Capabilities";

declare global {
    interface Window {
        Module?: any;
    }
}

const TIC = {
    // Bridge protocol locations (from our earlier Lua)
    MARKER_ADDR: 0x14e24,
    MAILBOX_ADDR: 0x14e40,
    OUTBOX_ADDR: 0x14e80,
    MAILBOX_MUTEX_ADDR: 0x14e40 + 12,
    MAILBOX_SEQ_ADDR: 0x14e40 + 13,
    MAILBOX_TOKEN_ADDR: 0x14e40 + 14,
    OUTBOX_MUTEX_ADDR: 0x14e80 + 12,
    OUTBOX_SEQ_ADDR: 0x14e80 + 13,
    OUTBOX_TOKEN_ADDR: 0x14e80 + 14,
    LOG_WRITE_PTR_ADDR: 0x14e80 + 7,
    LOG_BASE: 0x14e80 + 16,
    LOG_SIZE: 240,
    MARKER_TEXT: "CHROMATIC_TIC80_V1",
    OUT_CMD_LOG: 1,

    // TIC cartridge chunk IDs (subset)
    CHUNK_WAVEFORMS: 10,
    CHUNK_SFX: 9,
    CHUNK_MUSIC_TRACKS: 14,
    CHUNK_MUSIC_PATTERNS: 15,

    // RAM destinations for the chunk payloads (bank 0)
    WAVEFORMS_ADDR: 0x0ffe4,
    WAVEFORMS_SIZE: 0x100, // 256 bytes
    SFX_ADDR: 0x100e4,
    SFX_SIZE: 66 * 64, // 64 sfx slots * 66 bytes
    PATTERNS_ADDR: 0x11164,
    PATTERNS_SIZE: 0x2d00, // 11520 bytes
    TRACKS_ADDR: 0x13e64,
    TRACKS_SIZE: 51 * 8, // 8 tracks * 51 bytes

    // Mailbox cmd IDs
    CMD_NOP: 0,
    CMD_PLAY: 1,
    CMD_STOP: 2,
    CMD_PING: 3,
    CMD_BEGIN_UPLOAD: 4,
    CMD_END_UPLOAD: 5,
    CMD_PLAY_SFX_ON: 6,
    CMD_PLAY_SFX_OFF: 7,
} as const;

export type Tic80BridgeHandle = {
    /** True once Module + RAM base are established */
    isReady: () => boolean;

    /** Emscripten Module inside iframe (escape hatch) */
    getModule: () => any | null;

    /** Discovered base pointer for TIC-80 fantasy RAM within HEAPU8 */
    getRamBase: () => number | null;

    /** Raw memory access (TIC-80 RAM addressing) */
    peek8: (addr: number) => number;
    poke8: (addr: number, value: number) => void;
    pokeBlock: (addr: number, data: Uint8Array) => void;
    peekBlock: (addr: number, length: number) => Uint8Array;

    /** Upload song chunk stream (.tic music-related chunks) directly into TIC RAM */
    //uploadSongData: (data: Uint8Array) => Promise<void>;

    /** Run a set of mailbox operations atomically to avoid interleaving */
    invokeExclusive: <T>(fn: (tx: Tic80BridgeTransaction) => Promise<T>) => Promise<T>;

    /** Trigger a single SFX by ID/note (instrument audition) */
    //playSfx: (opts: { sfxId: number; note: number }) => Promise<void>;

    // /** Mailbox commands */
    // play: (opts?: {
    //     track?: number;
    //     frame?: number;
    //     row?: number;
    //     loop?: boolean;
    //     sustain?: boolean;
    //     tempo?: number; // 0 = default
    //     speed?: number; // 0 = default
    // }) => Promise<void>;

    // stop: () => Promise<void>;
    ping: () => Promise<void>;
};

export type Tic80BridgeTransaction = {
    uploadSongData: (data: Uint8Array) => Promise<void>;
    playSfx: (opts: { sfxId: number; tic80Note: number; channel: Tic80ChannelIndex; }) => Promise<void>;
    stopSfx: (opts: { channel: Tic80ChannelIndex; }) => Promise<void>;
    play: (opts?: {
        track?: number;
        frame?: number;
        row?: number;
        loop?: boolean;
        sustain?: boolean;
        tempo?: number; // 0 = default
        speed?: number; // 0 = default
    }) => Promise<void>;
    stop: () => Promise<void>;
    ping: () => Promise<void>;
};

export type Tic80BridgeProps = {
    className?: string;
    style?: React.CSSProperties;
};

function findAllSubarrayIndices(haystack: Uint8Array, needle: Uint8Array): number[] {
    if (needle.length === 0) return [];
    const out: number[] = [];
    const last = haystack.length - needle.length;
    outer: for (let i = 0; i <= last; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        out.push(i);
    }
    return out;
}

function getHeapU8(Module: any): Uint8Array {
    const heap = Module?.HEAPU8;
    //console.log(`heap : `, heap);

    if (!heap) {
        throw new Error("Module.HEAPU8 not available yet (or not exposed by this build).");
    }
    return heap;
}

export const Tic80Bridge = forwardRef<Tic80BridgeHandle, Tic80BridgeProps>(
    function Tic80Bridge(
        {
        },
        ref
    ) {
        const iframeRef = useRef<Tic80IframeHandle | null>(null);

        const moduleRef = useRef<any | null>(null);
        const heapRef = useRef<Uint8Array | null>(null);
        const ramBaseRef = useRef<number | null>(null);
        const stageRef = useRef<string>("init");
        const pollingCancelledRef = useRef<boolean>(false);
        const mailboxSeqRef = useRef<number>(0);
        const outboxSeqRef = useRef<number>(0);
        const hostLogReadPtrRef = useRef<number>(0);
        const cmdTokenRef = useRef<number>(0);
        const commandMutexRef = useRef(new AsyncMutex());

        const [ready, setReady] = useState(false);

        const log = (...args: any[]) => console.log("[Tic80Bridge]", ...args);

        // Boot sequence:
        // 1) wait for iframe window.Module to appear
        // 2) wait for Module.HEAPU8
        // 3) scan for marker bytes to compute ramBase
        useEffect(() => {
            //let cancelled = false;
            let raf = 0;

            const markerBytes = new TextEncoder().encode(TIC.MARKER_TEXT);

            const tick = () => {
                if (pollingCancelledRef.current) return;

                try {
                    const win = iframeRef.current?.getWindow();
                    const Module = (win as any)?.Module;

                    if (!Module) {
                        if (stageRef.current !== "waiting-module") {
                            stageRef.current = "waiting-module";
                            log("waiting for Module in iframe...");
                        }
                        raf = requestAnimationFrame(tick);
                        return;
                    }

                    if (stageRef.current !== "module-ready") {
                        stageRef.current = "module-ready";
                        //log("Module detected in iframe; probing HEAPU8...");
                    }

                    // Emscripten runtime is alive; HEAPU8 may still not be ready for a moment
                    //console.log(Module);
                    //console.log(Object.keys(Module));
                    const heap = getHeapU8(Module);

                    if (stageRef.current !== "heap-ready") {
                        stageRef.current = "heap-ready";
                        //log("HEAPU8 ready (bytes)", heap.byteLength);
                    }

                    // Find the marker in heap (written by the bridge cart on first TIC())
                    const positions = findAllSubarrayIndices(heap, markerBytes);
                    const candidates = positions
                        .map((pos) => pos - TIC.MARKER_ADDR)
                        .filter((base) => base >= 0 && base + TIC.OUTBOX_ADDR < heap.length);

                    if (candidates.length === 0) {
                        if (stageRef.current !== "waiting-marker") {
                            stageRef.current = "waiting-marker";
                            log("waiting for marker bytes from bridge cart...");
                        }
                        raf = requestAnimationFrame(tick);
                        return;
                    }

                    // Prefer the candidate whose OUTBOX magic is initialized to 0x42;
                    // this avoids latching onto the Lua constant before the cart boots.
                    const ramBase = candidates.find((base) => heap[base + TIC.OUTBOX_ADDR] === 0x42);

                    if (ramBase == null) {
                        if (stageRef.current !== "waiting-outbox") {
                            stageRef.current = "waiting-outbox";
                            //log("marker found but outbox not initialized yet; waiting for cart boot...");
                        }
                        raf = requestAnimationFrame(tick);
                        return;
                    }

                    moduleRef.current = Module;
                    heapRef.current = heap;
                    ramBaseRef.current = ramBase;

                    if (!pollingCancelledRef.current) {
                        stageRef.current = "ready";

                        // stop polling.
                        pollingCancelledRef.current = true;

                        log("bridge ready");
                        setReady(true);
                    }

                    return; // done
                } catch (err) {
                    if (stageRef.current !== "error") {
                        stageRef.current = "error";
                        //log("poll error; will retry", err);
                    }
                    // Keep polling; most errors here are "not ready yet"
                    raf = requestAnimationFrame(tick);
                }
            };

            raf = requestAnimationFrame(tick);

            return () => {
                pollingCancelledRef.current = true;
                log("bridge poll cancelled");
                cancelAnimationFrame(raf);
            };
        }, []);

        // upon ready, send ack
        useEffect(() => {
            if (!ready) return;
            //log("sending ACK to bridge cart");
            // send ACK command to let the cart know we're ready

            // send acknowledgement command to confirm.
            // fire-and-forget ACK; ignore promise
            sendMailboxCommandRaw([TIC.CMD_PING], "Ping");

            // Initialize OUTBOX read pointer/seq to current cart state so we only read new logs.
            try {
                hostLogReadPtrRef.current = peek8(TIC.LOG_WRITE_PTR_ADDR);
                outboxSeqRef.current = peek8(TIC.OUTBOX_SEQ_ADDR);
            } catch (e) {
                log("init outbox read ptr failed", e);
            }
        }, [ready]);

        function readOutboxCommands() {
            if (!ready) return;
            assertReady();

            // If cart is mid-write, skip this poll to avoid tearing.
            if (peek8(TIC.OUTBOX_MUTEX_ADDR) !== 0) return;

            const seq = peek8(TIC.OUTBOX_SEQ_ADDR);
            const writePtr = peek8(TIC.LOG_WRITE_PTR_ADDR);
            let readPtr = hostLogReadPtrRef.current ?? 0;

            if (seq === outboxSeqRef.current && writePtr === readPtr) return;

            outboxSeqRef.current = seq;
            const logs: string[] = [];

            while (readPtr !== writePtr) {
                const cmd = peek8(TIC.LOG_BASE + readPtr + 0);
                const len = peek8(TIC.LOG_BASE + readPtr + 1);

                // Wrap marker: reset to start.
                if (cmd === 0 && len === 0) {
                    readPtr = 0;
                    continue;
                }

                const entrySize = 2 + len;

                // Defensive bounds check; skip malformed entries.
                if (len > 31 || entrySize > TIC.LOG_SIZE || readPtr + entrySize > TIC.LOG_SIZE) {
                    readPtr = 0;
                    continue;
                }

                // Extract payload once for switch handling.
                const payload = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    payload[i] = peek8(TIC.LOG_BASE + readPtr + 2 + i);
                }

                switch (cmd) {
                    case TIC.OUT_CMD_LOG: {
                        const msg = String.fromCharCode(...payload);
                        logs.push(msg);
                        break;
                    }
                    default: {
                        log(`unknown outbox cmd ${cmd} len=${len}`);
                        break;
                    }
                }

                readPtr += entrySize;
                if (readPtr >= TIC.LOG_SIZE) readPtr = 0;
            }

            hostLogReadPtrRef.current = readPtr;

            if (logs.length) {
                logs.forEach((msg) => log(`[cart] ${msg}`));
            }
        }

        useEffect(() => {
            if (!ready) return;
            const id = window.setInterval(readOutboxCommands, 100);
            return () => window.clearInterval(id);
        }, [ready]);

        function assertReady() {
            if (!ready || !moduleRef.current || !heapRef.current || ramBaseRef.current == null) {
                throw new Error("Tic80Bridge not ready yet.");
            }
        }

        function peek8(addr: number): number {
            assertReady();
            return heapRef.current![ramBaseRef.current! + addr] ?? 0;
        }

        function poke8(addr: number, value: number) {
            assertReady();
            heapRef.current![ramBaseRef.current! + addr] = value & 0xff;
        }

        function pokeBlock(addr: number, data: Uint8Array) {
            assertReady();
            heapRef.current!.set(data, ramBaseRef.current! + addr);
        }

        function peekBlock(addr: number, length: number): Uint8Array {
            assertReady();
            const start = ramBaseRef.current! + addr;
            return heapRef.current!.slice(start, start + length);
        }

        function zeroRange(addr: number, len: number) {
            assertReady();
            heapRef.current!.fill(0, ramBaseRef.current! + addr, ramBaseRef.current! + addr + len);
        }

        function applySongChunk(type: number, payload: Uint8Array, bank: number) {
            // Only bank 0 is supported for now.
            if (bank !== 0) return;

            switch (type) {
                case TIC.CHUNK_WAVEFORMS: {
                    zeroRange(TIC.WAVEFORMS_ADDR, TIC.WAVEFORMS_SIZE);
                    pokeBlock(TIC.WAVEFORMS_ADDR, payload.slice(0, TIC.WAVEFORMS_SIZE));
                    break;
                }
                case TIC.CHUNK_SFX: {
                    zeroRange(TIC.SFX_ADDR, TIC.SFX_SIZE);
                    pokeBlock(TIC.SFX_ADDR, payload.slice(0, TIC.SFX_SIZE));
                    break;
                }
                case TIC.CHUNK_MUSIC_PATTERNS: {
                    zeroRange(TIC.PATTERNS_ADDR, TIC.PATTERNS_SIZE);
                    pokeBlock(TIC.PATTERNS_ADDR, payload.slice(0, TIC.PATTERNS_SIZE));
                    break;
                }
                case TIC.CHUNK_MUSIC_TRACKS: {
                    zeroRange(TIC.TRACKS_ADDR, TIC.TRACKS_SIZE);
                    pokeBlock(TIC.TRACKS_ADDR, payload.slice(0, TIC.TRACKS_SIZE));
                    break;
                }
                default:
                    // ignore other chunk types for now
                    break;
            }
        }

        async function uploadSongDataRaw(data: Uint8Array) {
            assertReady();
            await sendMailboxCommandRaw([TIC.CMD_BEGIN_UPLOAD], "Begin song Upload");
            let offset = 0;
            while (offset + 4 <= data.length) {
                const header = data[offset];
                const bank = (header >> 5) & 0x07;
                const type = header & 0x1f;
                const size = data[offset + 1] | (data[offset + 2] << 8);
                const payloadStart = offset + 4;
                const payloadEnd = payloadStart + size;
                if (payloadEnd > data.length) break; // malformed; stop early

                const payload = data.slice(payloadStart, payloadEnd);
                applySongChunk(type, payload, bank);

                offset = payloadEnd;
            }

            await sendMailboxCommandRaw([TIC.CMD_END_UPLOAD], "End song Upload");
        }

        async function playSfxRaw(opts: { sfxId: number; tic80Note: number; channel: Tic80ChannelIndex; }) {
            const channel = opts.channel ?? 0;
            const sfxId = opts.sfxId & 0xff;
            const note = opts.tic80Note & 0xff;
            const cmd = TIC.CMD_PLAY_SFX_ON;
            await sendMailboxCommandRaw([cmd, sfxId, note, channel & 0xff], "Play SFX");
        }

        async function stopSfxRaw(opts: { channel: Tic80ChannelIndex; }) {
            const channel = opts.channel ?? 0;
            const sfxId = 0;
            const note = 0;
            const cmd = TIC.CMD_PLAY_SFX_OFF;
            await sendMailboxCommandRaw([cmd, sfxId, note, channel & 0xff], "Stop SFX");
        }

        function writeMailboxBytes(bytes: number[], token?: number) {
            assertReady();
            const mb = TIC.MAILBOX_ADDR;
            const mutex = TIC.MAILBOX_MUTEX_ADDR;
            const seqAddr = TIC.MAILBOX_SEQ_ADDR;
            const tokenAddr = TIC.MAILBOX_TOKEN_ADDR;

            // Signal busy to cart while we write the payload.
            poke8(mutex, 1);

            // Write payload bytes; zero the rest of the fixed mailbox window (first 8 bytes).
            const windowSize = 8;
            for (let i = 0; i < windowSize; i++) {
                poke8(mb + i, bytes[i] ?? 0);
            }

            if (typeof token === "number") {
                poke8(tokenAddr, token & 0xff);
            }

            // Bump sequence after payload so cart can detect a complete write.
            mailboxSeqRef.current = (mailboxSeqRef.current + 1) & 0xff;
            poke8(seqAddr, mailboxSeqRef.current);

            // Release busy flag.
            poke8(mutex, 0);
        }

        async function sendMailboxCommandRaw(bytes: number[], description: string): Promise<void> {
            assertReady();
            const token = (cmdTokenRef.current = (cmdTokenRef.current + 1) & 0xff);
            console.log(`---------------- sendMailboxCommand: ${description} (token=${token})`, bytes);
            writeMailboxBytes(bytes, token);

            const start = performance.now();
            const timeoutMs = 2000;

            return new Promise<void>((resolve, reject) => {
                const poll = () => {
                    try {
                        if (peek8(TIC.OUTBOX_MUTEX_ADDR) !== 0) {
                            requestAnimationFrame(poll);
                            return;
                        }
                        const seenToken = peek8(TIC.OUTBOX_TOKEN_ADDR);
                        if (seenToken === token) {
                            console.log(`---------------- sendMailboxCommand: ${description} DONE`);
                            resolve();
                            return;
                        }
                        if (performance.now() - start > timeoutMs) {
                            console.log(`---------------- sendMailboxCommand: ${description} TIMEOUT`);
                            reject(new Error(`TIC-80 command timed out: ${description}`));
                            return;
                        }
                        requestAnimationFrame(poll);
                    } catch (err) {
                        console.log(`---------------- sendMailboxCommand: ${description} ERROR`, err);
                        reject(err as Error);
                    }
                };
                poll();
            });
        }

        async function playRaw(opts?: {
            track?: number;
            frame?: number;
            row?: number;
            loop?: boolean;
            sustain?: boolean;
            tempo?: number;
            speed?: number;
        }) {
            const track = opts?.track ?? 0;
            const frame = opts?.frame ?? 0;
            const row = opts?.row ?? 0;
            const loop = opts?.loop ?? true;
            const sustain = opts?.sustain ?? false;
            const tempo = opts?.tempo ?? 0;
            const speed = opts?.speed ?? 0;

            log("play() request", { track, frame, row, loop, sustain, tempo, speed });

            // Mailbox layout from the Lua:
            // 0 cmd, 1 track, 2 frame, 3 row, 4 loop, 5 sustain, 6 tempo, 7 speed
            await sendMailboxCommandRaw([
                TIC.CMD_PLAY,
                track & 0xff,
                frame & 0xff,
                row & 0xff,
                loop ? 1 : 0,
                sustain ? 1 : 0,
                tempo & 0xff,
                speed & 0xff,
            ], "Play");
        }

        async function stopRaw() {
            log("stop() request");
            await sendMailboxCommandRaw([TIC.CMD_STOP], "Stop");
        }

        async function pingRaw() {
            log("ping()");
            await sendMailboxCommandRaw([TIC.CMD_PING], "Ping");
        }

        const transactionApi: Tic80BridgeTransaction = {
            uploadSongData: uploadSongDataRaw,
            playSfx: playSfxRaw,
            stopSfx: stopSfxRaw,
            play: playRaw,
            stop: stopRaw,
            ping: pingRaw,
        };

        async function invokeExclusive<T>(fn: (tx: Tic80BridgeTransaction) => Promise<T>): Promise<T> {
            const startTime = performance.now();
            const release = await commandMutexRef.current.acquire();
            try {
                const ret = await fn(transactionApi);
                const endTime = performance.now();
                console.log(`invokeExclusive took ${endTime - startTime} ms`);
                return ret;
            } finally {
                release();
            }
        }

        // async function uploadSongData(data: Uint8Array) {
        //     return invokeExclusive((tx) => tx.uploadSongData(data));
        // }

        // async function playSfx(opts: { sfxId: number; note: number }) {
        //     return invokeExclusive((tx) => tx.playSfx(opts));
        // }

        // async function play(opts?: {
        //     track?: number;
        //     frame?: number;
        //     row?: number;
        //     loop?: boolean;
        //     sustain?: boolean;
        //     tempo?: number;
        //     speed?: number;
        // }) {
        //     return invokeExclusive((tx) => tx.play(opts));
        // }

        // async function stop() {
        //     return invokeExclusive((tx) => tx.stop());
        // }

        async function ping() {
            return invokeExclusive((tx) => tx.ping());
        }

        useImperativeHandle(
            ref,
            (): Tic80BridgeHandle => ({
                isReady: () => ready,
                getModule: () => moduleRef.current,
                getRamBase: () => ramBaseRef.current,

                peek8,
                poke8,
                pokeBlock,
                peekBlock,
                //uploadSongData,
                invokeExclusive,
                //playSfx,

                //play,
                //stop,
                ping,
            }),
            [ready]
        );

        return (<>
            <Tic80Iframe
                ref={iframeRef}
                args={["/bridge.tic"]}
            />
            <button onClick={() => {
                ping();
            }}>ping</button>
        </>
        );
    }
);
