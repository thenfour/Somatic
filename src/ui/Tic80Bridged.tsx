// // wraps <Tic80Iframe /> to provide TIC-80 in an iframe
// // loads the bridge.tic cart
// // for reference the source for the cart is in /bridge/bridge.lua

// export const TIC_RAM = {
//     // Pick addresses inside “reserved” for our marker + mailbox
//     MARKER_ADDR: 0x14E24,
//     MAILBOX_ADDR: 0x14E40,

//     // Audio data areas you’ll likely write later
//     WAVEFORMS: 0x0FFE4,
//     SFX: 0x100E4,
//     PATTERNS: 0x11164,
//     TRACKS: 0x13E64,
// } as const;

// export const TIC_BRIDGE_CART = "/bridge.tic";

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
    MARKER_TEXT: "CHROMATIC_TIC80_V1",

    // Mailbox cmd IDs
    CMD_NOP: 0,
    CMD_PLAY: 1,
    CMD_STOP: 2,
    CMD_ACK: 3,
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
};

export type Tic80BridgeProps = {
    className?: string;
    style?: React.CSSProperties;
};

/** Find a byte pattern in a Uint8Array. */
function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
    if (needle.length === 0) return -1;
    const last = haystack.length - needle.length;
    outer: for (let i = 0; i <= last; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (haystack[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

function getHeapU8(Module: any): Uint8Array {
    const heap = Module?.HEAPU8;
    console.log(`heap : `, heap);

    if (!heap) {
        throw new Error("Module.HEAPU8 not available yet (or not exposed by this build).");
    }
    return heap;
}

export const Tic80Bridge = forwardRef<Tic80BridgeHandle, Tic80BridgeProps>(
    function Tic80Bridge(
        {
            className,
            style,
        },
        ref
    ) {
        const iframeRef = useRef<Tic80IframeHandle | null>(null);

        const moduleRef = useRef<any | null>(null);
        const heapRef = useRef<Uint8Array | null>(null);
        const ramBaseRef = useRef<number | null>(null);
        const stageRef = useRef<string>("init");
        const pollingCancelledRef = useRef<boolean>(false);

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
                        log("Module detected in iframe; probing HEAPU8...");
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
                    const pos = findSubarray(heap, markerBytes);
                    if (pos < 0) {
                        if (stageRef.current !== "waiting-marker") {
                            stageRef.current = "waiting-marker";
                            log("waiting for marker bytes from bridge cart...");
                        }
                        raf = requestAnimationFrame(tick);
                        return;
                    }

                    log("marker located at", pos, "computing ramBase...");

                    const ramBase = pos - TIC.MARKER_ADDR;
                    if (ramBase < 0) throw new Error(`Computed negative ramBase: ${ramBase}`);

                    moduleRef.current = Module;
                    heapRef.current = heap;
                    ramBaseRef.current = ramBase;

                    if (!pollingCancelledRef.current) {
                        stageRef.current = "ready";

                        // stop polling.
                        pollingCancelledRef.current = true;

                        log("bridge ready", { ramBase, markerPos: pos });
                        setReady(true);
                    }

                    return; // done
                } catch (err) {
                    if (stageRef.current !== "error") {
                        stageRef.current = "error";
                        log("poll error; will retry", err);
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
            poke8(TIC.MAILBOX_ADDR + 0, TIC.CMD_ACK);
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
            const mb = TIC.MAILBOX_ADDR;
            log("write mailbox", { addr: mb, bytes });
            for (let i = 0; i < bytes.length; i++) {
                poke8(mb + i, bytes[i] ?? 0);
            }
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
            }),
            [ready]
        );

        // Important: to run the cart, pass it as first argument (CLI-style), like the HTML export pattern.
        //const args = [cartUrl, ...extraArgs];

        return (<>
            <button onClick={() => pollingCancelledRef.current = true}>cancel</button>
            <Tic80Iframe
                ref={iframeRef}
                //scriptSrc={scriptSrc}
                //args={args}
                className={className}
                style={style}
            />
        </>
        );
    }
);
