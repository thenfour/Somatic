"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Tic80Iframe, Tic80IframeHandle } from "./Tic80EmbedIframe";
import { Tic80TopLevel, Tic80TopLevelHandle } from "./Tic80TopLevel";
import { AsyncMutex } from "../utils/async_mutex";
import { Tic80ChannelIndex, TicBridge, TicMemoryMap } from "../models/tic80Capabilities";
import { Tic80SerializedSong } from "../audio/tic80_cart_serializer";

declare global {
    interface Window {
        Module?: any;
    }
}

export type Tic80BridgeHandle = {
    /** True once Module + RAM base are established */
    isReady: () => boolean;

    /** Emscripten Module inside iframe (escape hatch) */
    getModule: () => any | null;

    /** Discovered base pointer for TIC-80 fantasy RAM within HEAPU8 */
    getRamBase: () => number | null;

    /** Raw memory access (TIC-80 RAM addressing) */
    peekS8: (addr: number) => number;
    peekU8: (addr: number) => number;
    pokeS8: (addr: number, value: number) => void;
    pokeU8: (addr: number, value: number) => void;
    pokeBlock: (addr: number, data: Uint8Array) => void;
    peekBlock: (addr: number, length: number) => Uint8Array;

    /** Run a set of mailbox operations atomically to avoid interleaving */
    invokeExclusive: <T>(fn: (tx: Tic80BridgeTransaction) => Promise<T>) => Promise<T>;

    // stop: () => Promise<void>;
    ping: () => Promise<void>;
};

export type Tic80BridgeTransaction = {
    uploadSongData: (data: Tic80SerializedSong, reason: string) => Promise<void>;
    playSfx: (opts: { sfxId: number; tic80Note: number; channel: Tic80ChannelIndex; speed: number }) => Promise<void>;
    stopSfx: (opts: { channel: Tic80ChannelIndex; }) => Promise<void>;
    play: (opts?: {
        songPosition?: number;
        row?: number;
    }) => Promise<void>;
    stop: () => Promise<void>;
    ping: () => Promise<void>;
};

export type Tic80BridgeProps = {
    className?: string;
    style?: React.CSSProperties;
    onReady?: (handle: Tic80BridgeHandle) => void;
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
            onReady,
        },
        ref
    ) {
        const iframeRef = useRef<Tic80IframeHandle | Tic80TopLevelHandle | null>(null);

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
        const [embedMode, setEmbedMode] = useState<"iframe" | "toplevel">("iframe");

        const log = (...args: any[]) => console.log("[Tic80Bridge]", ...args);

        useEffect(() => {
            if (typeof window === "undefined") return;
            try {
                const params = new URLSearchParams(window.location.search);
                const mode = params.get("embed");
                if (mode === "toplevel") {
                    setEmbedMode("toplevel");
                } else if (mode === "iframe") {
                    setEmbedMode("iframe");
                }
            } catch {
                // ignore invalid URL/search
            }
        }, []);

        // Boot sequence:
        // 1) wait for iframe window.Module to appear
        // 2) wait for Module.HEAPU8
        // 3) scan for marker bytes to compute ramBase
        useEffect(() => {
            //let cancelled = false;
            let raf = 0;

            const markerBytes = new TextEncoder().encode(TicBridge.MARKER_TEXT);

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
                        .map((pos) => pos - TicMemoryMap.MARKER_ADDR)
                        .filter((base) => base >= 0 && base + TicMemoryMap.OUTBOX_ADDR < heap.length);

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
                    const ramBase = candidates.find((base) => heap[base + TicMemoryMap.OUTBOX_ADDR] === 0x42);

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
            sendMailboxCommandRaw([TicBridge.CMD_PING], "Ping");

            // Initialize OUTBOX read pointer/seq to current cart state so we only read new logs.
            try {
                hostLogReadPtrRef.current = peekU8(TicMemoryMap.LOG_WRITE_PTR_ADDR);
                outboxSeqRef.current = peekU8(TicMemoryMap.OUTBOX_SEQ_ADDR);
            } catch (e) {
                log("init outbox read ptr failed", e);
            }

            // Notify parent that bridge is ready
            if (onReady) {
                const handle: Tic80BridgeHandle = {
                    isReady: () => ready,
                    getModule: () => moduleRef.current,
                    getRamBase: () => ramBaseRef.current,
                    peekU8,
                    peekS8,
                    pokeU8,
                    pokeS8,
                    pokeBlock,
                    peekBlock,
                    invokeExclusive,
                    ping,
                };
                onReady(handle);
            }
        }, [ready]);

        function readOutboxCommands() {
            if (!ready) return;
            assertReady();

            // If cart is mid-write, skip this poll to avoid tearing.
            if (peekU8(TicMemoryMap.OUTBOX_MUTEX_ADDR) !== 0) return;

            const seq = peekU8(TicMemoryMap.OUTBOX_SEQ_ADDR);
            const writePtr = peekU8(TicMemoryMap.LOG_WRITE_PTR_ADDR);
            let readPtr = hostLogReadPtrRef.current ?? 0;

            if (seq === outboxSeqRef.current && writePtr === readPtr) return;

            outboxSeqRef.current = seq;
            const logs: string[] = [];

            while (readPtr !== writePtr) {
                const cmd = peekU8(TicMemoryMap.LOG_BASE + readPtr + 0);
                const len = peekU8(TicMemoryMap.LOG_BASE + readPtr + 1);

                // Wrap marker: reset to start.
                if (cmd === 0 && len === 0) {
                    readPtr = 0;
                    continue;
                }

                const entrySize = 2 + len;

                // Defensive bounds check; skip malformed entries.
                if (len > 31 || entrySize > TicMemoryMap.LOG_SIZE || readPtr + entrySize > TicMemoryMap.LOG_SIZE) {
                    readPtr = 0;
                    continue;
                }

                // Extract payload once for switch handling.
                const payload = new Uint8Array(len);
                for (let i = 0; i < len; i++) {
                    payload[i] = peekU8(TicMemoryMap.LOG_BASE + readPtr + 2 + i);
                }

                switch (cmd) {
                    case TicBridge.OUT_CMD_LOG: {
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
                if (readPtr >= TicMemoryMap.LOG_SIZE) readPtr = 0;
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

        function peekU8(addr: number): number {
            assertReady();
            return heapRef.current![ramBaseRef.current! + addr] ?? 0;
        }

        function peekS8(addr: number): number {
            assertReady();
            const val = heapRef.current![ramBaseRef.current! + addr] ?? 0;
            return val > 0x7f ? val - 0x100 : val;
        }

        function pokeU8(addr: number, value: number) {
            assertReady();
            // value is 0..255
            if (value < 0 || value > 255) {
                throw new Error(`pokeU8 value out of range: ${value}`);
            }
            heapRef.current![ramBaseRef.current! + addr] = value;
        }

        function pokeS8(addr: number, value: number) {
            assertReady();
            // value is -128..127
            if (value < -128 || value > 127) {
                throw new Error(`pokeS8 value out of range: ${value}`);
            }
            heapRef.current![ramBaseRef.current! + addr] = value;
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

        async function uploadSongDataRaw(data: Tic80SerializedSong, reason: string) {
            assertReady();
            await sendMailboxCommandRaw([TicBridge.CMD_BEGIN_UPLOAD], `Begin song Upload: ${reason}`);
            pokeBlock(TicMemoryMap.WAVEFORMS_ADDR, data.waveformData);
            pokeBlock(TicMemoryMap.SFX_ADDR, data.sfxData);
            pokeBlock(TicMemoryMap.TRACKS_ADDR, data.trackData);

            pokeBlock(TicMemoryMap.TF_ORDER_LIST, data.songOrderData);
            pokeBlock(TicMemoryMap.TF_PATTERN_DATA, data.patternData);

            // write pattern data
            await sendMailboxCommandRaw([TicBridge.CMD_END_UPLOAD], "End song Upload");
        }

        async function playSfxRaw(opts: { sfxId: number; tic80Note: number; channel: Tic80ChannelIndex; speed: number }) {
            const channel = (opts.channel ?? 0) & 0xff;
            const sfxId = opts.sfxId & 0xff;
            const note = opts.tic80Note & 0xff;
            const speed = opts.speed & 0xff;
            //console.log("playSfxRaw", { sfxId, note, channel, speed });
            const cmd = TicBridge.CMD_PLAY_SFX_ON;
            await sendMailboxCommandRaw([cmd, sfxId, note, channel, speed], "Play SFX");
        }

        async function stopSfxRaw(opts: { channel: Tic80ChannelIndex; }) {
            const channel = opts.channel ?? 0;
            const cmd = TicBridge.CMD_PLAY_SFX_OFF;
            await sendMailboxCommandRaw([cmd, 0, 0, channel & 0xff], "Stop SFX");
        }

        // note that you may need to sync runtime vs. cart memory!
        function writeMailboxBytes(bytes: number[], token?: number) {
            assertReady();
            const inbox = TicMemoryMap.INBOX_ADDR;
            const mutex = TicMemoryMap.MAILBOX_MUTEX_ADDR;
            const seqAddr = TicMemoryMap.MAILBOX_SEQ_ADDR;
            const tokenAddr = TicMemoryMap.MAILBOX_TOKEN_ADDR;

            // Signal busy to cart while we write the payload.
            pokeU8(mutex, 1);

            // Write payload bytes; zero the rest of the fixed mailbox window (first 8 bytes).
            const windowSize = 8;
            for (let i = 0; i < windowSize; i++) {
                pokeU8(inbox + i, bytes[i] ?? 0);
            }

            if (typeof token === "number") {
                pokeU8(tokenAddr, token & 0xff);
            }

            // Bump sequence after payload so cart can detect a complete write.
            mailboxSeqRef.current = (mailboxSeqRef.current + 1) & 0xff;
            pokeU8(seqAddr, mailboxSeqRef.current);

            // Release busy flag.
            pokeU8(mutex, 0);
        }

        async function sendMailboxCommandRaw(bytes: number[], description: string): Promise<void> {
            assertReady();
            const token = (cmdTokenRef.current = (cmdTokenRef.current + 1) & 0xff);
            //console.log(`---------------- sendMailboxCommand: ${description} (token=${token})`, bytes);
            writeMailboxBytes(bytes, token);

            const start = performance.now();
            const timeoutMs = 2000;

            return new Promise<void>((resolve, reject) => {
                const poll = () => {
                    try {
                        if (peekU8(TicMemoryMap.OUTBOX_MUTEX_ADDR) !== 0) {
                            requestAnimationFrame(poll);
                            return;
                        }
                        const seenToken = peekU8(TicMemoryMap.OUTBOX_TOKEN_ADDR);
                        if (seenToken === token) {
                            //console.log(`---------------- sendMailboxCommand: ${description} DONE`);
                            resolve();
                            return;
                        }
                        if (performance.now() - start > timeoutMs) {
                            //console.log(`---------------- sendMailboxCommand: ${description} TIMEOUT`);
                            //reject(new Error(`TIC-80 command timed out: ${description}`));
                            resolve();
                            return;
                        }
                        requestAnimationFrame(poll);
                    } catch (err) {
                        //console.log(`---------------- sendMailboxCommand: ${description} ERROR`, err);
                        reject(err as Error);
                    }
                };
                poll();
            });
        }

        async function playRaw(opts?: {
            songPosition?: number;
            row?: number;
            loop?: boolean;
            sustain?: boolean;
            tempo?: number;
            speed?: number;
        }) {
            const songPosition = opts?.songPosition ?? 0;
            const row = opts?.row ?? 0;
            const loop = opts?.loop ?? true;
            const sustain = opts?.sustain ?? false;
            const tempo = opts?.tempo ?? 0;
            const speed = opts?.speed ?? 0;

            log("play() request", { songPosition, row, loop, sustain, tempo, speed });

            // Mailbox layout from the Lua:
            // 0 cmd, 1 songPosition, 2 row, 3 loop, 4 sustain, 5 tempo, 6 speed
            await sendMailboxCommandRaw([
                TicBridge.CMD_PLAY,
                songPosition & 0xff,
                row & 0xff,
                loop ? 1 : 0,
                sustain ? 1 : 0,
                tempo & 0xff,
                speed & 0xff,
            ], "Play");
        }

        async function stopRaw() {
            log("stop() request");
            await sendMailboxCommandRaw([TicBridge.CMD_STOP], "Stop");
        }

        async function pingRaw() {
            log("ping()");
            await sendMailboxCommandRaw([TicBridge.CMD_PING], "Ping");
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

        async function ping() {
            return invokeExclusive((tx) => tx.ping());
        }

        useImperativeHandle(
            ref,
            (): Tic80BridgeHandle => ({
                isReady: () => ready,
                getModule: () => moduleRef.current,
                getRamBase: () => ramBaseRef.current,

                peekU8,
                peekS8,
                pokeU8,
                pokeS8,
                pokeBlock,
                peekBlock,
                invokeExclusive,
                ping,
            }),
            [ready]
        );

        return (<>
            {embedMode === "toplevel" ? (
                <Tic80TopLevel
                    ref={iframeRef}
                    args={["/bridge.tic", "--skip", "--vsync"]}
                />
            ) : (
                <Tic80Iframe
                    ref={iframeRef}
                    args={["/bridge.tic", "--skip", "--vsync"]}
                />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <button onClick={() => {
                    ping();
                }}>ping</button>
                <span style={{ fontSize: 12, opacity: 0.7 }}>
                    Embed variant: {embedMode === "toplevel" ? "top-level" : "iframe"}
                </span>
            </div>
        </>
        );
    }
);
