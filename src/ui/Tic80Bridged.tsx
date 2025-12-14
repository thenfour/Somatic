"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Tic80Iframe, Tic80IframeHandle } from "./Tic80EmbedIframe";

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
    OUTBOX_MUTEX_ADDR: 0x14e80 + 12,
    OUTBOX_SEQ_ADDR: 0x14e80 + 13,
    LOG_WRITE_PTR_ADDR: 0x14e80 + 7,
    LOG_BASE: 0x14e80 + 16,
    LOG_SIZE: 240,
    MARKER_TEXT: "CHROMATIC_TIC80_V1",
    OUT_CMD_LOG: 1,

    // Mailbox cmd IDs
    CMD_NOP: 0,
    CMD_PLAY: 1,
    CMD_STOP: 2,
    CMD_PING: 3,
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

    /** Mailbox commands */
    play: (opts?: {
        track?: number;
        frame?: number;
        row?: number;
        loop?: boolean;
        sustain?: boolean;
        tempo?: number; // 0 = default
        speed?: number; // 0 = default
    }) => void;

    stop: () => void;
    ping: () => void;
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
                        log("HEAPU8 ready (bytes)", heap.byteLength);
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
                            log("marker found but outbox not initialized yet; waiting for cart boot...");
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
            log("sending ACK to bridge cart");
            // send ACK command to let the cart know we're ready

            // send acknowledgement command to confirm.
            poke8(TIC.MAILBOX_ADDR + 0, TIC.CMD_PING);

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

        function writeMailboxBytes(bytes: number[]) {
            assertReady();
            const mb = TIC.MAILBOX_ADDR;
            const mutex = TIC.MAILBOX_MUTEX_ADDR;
            const seqAddr = TIC.MAILBOX_SEQ_ADDR;

            // Signal busy to cart while we write the payload.
            poke8(mutex, 1);

            // Write payload bytes; zero the rest of the fixed mailbox window (first 8 bytes).
            const windowSize = 8;
            for (let i = 0; i < windowSize; i++) {
                poke8(mb + i, bytes[i] ?? 0);
            }

            // Bump sequence after payload so cart can detect a complete write.
            mailboxSeqRef.current = (mailboxSeqRef.current + 1) & 0xff;
            poke8(seqAddr, mailboxSeqRef.current);

            // Release busy flag.
            poke8(mutex, 0);
        }

        function play(opts?: {
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
            writeMailboxBytes([
                TIC.CMD_PLAY,
                track & 0xff,
                frame & 0xff,
                row & 0xff,
                loop ? 1 : 0,
                sustain ? 1 : 0,
                tempo & 0xff,
                speed & 0xff,
            ]);
        }

        function stop() {
            log("stop() request");
            writeMailboxBytes([TIC.CMD_STOP]);
        }

        function ping() {
            log("ping()");
            writeMailboxBytes([TIC.CMD_PING]);
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

                play,
                stop,
                ping,
            }),
            [ready]
        );

        return (<>
            <button onClick={() => pollingCancelledRef.current = true}>cancel</button>
            <button onClick={() => {
                ping();
            }}>ping</button>
            <Tic80Iframe
                ref={iframeRef}
                args={["/bridge.tic"]}
            />
        </>
        );
    }
);
