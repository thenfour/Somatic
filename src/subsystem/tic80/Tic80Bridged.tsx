"use client";

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import { Tic80SerializedSong } from "./tic80_cart_serializer";
import { buildInfo } from "../../buildInfo";
import {decodeSomaticSongPositionU8, TicBridge, TicMemoryMap} from "../../models/tic80Capabilities";
import { AsyncMutex } from "../../utils/async_mutex";
import { gLog } from "../../utils/logger";
import { Tic80Iframe, Tic80IframeHandle } from "./Tic80EmbedIframe";
import {clamp} from "../../utils/utils";
//import { Tic80TopLevel, Tic80TopLevelHandle } from "./Tic80TopLevel";

const AUDIO_RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute timeout

export type Tic80AudioCaptureResult = Readonly<{
   filename: string;
   mimeType: string;
   bytes: Uint8Array;
}>;

export type Tic80AudioRenderProgress = Readonly<{
   completedRows: number;
   totalRows: number;
   fraction01: number;
   songPosition: number;
   row: number;
}>;

export function calculateAudioRenderProgress(
   data: Tic80SerializedSong,
   songPosition: number,
   row: number,
): Tic80AudioRenderProgress {
   const song = data.bakedSong.bakedSong;
   const totalRows = song.getSongLengthRows();
   const safePosition = clamp(songPosition, 0, song.songOrder.length - 1);
   const safeRow = Math.max(0, row);
   const completedRows = songPosition < 0 ? 0 : song.getAbsRowAtSongPosition(safePosition, safeRow);
   console.log(`capture play progress: songPosition=${songPosition} row=${row} => safePosition=${safePosition} safeRow=${safeRow} completedRows=${completedRows} totalRows=${totalRows}`);
   return {
      completedRows,
      totalRows,
      fraction01: Math.min(0.999, completedRows / totalRows),
      songPosition: safePosition,
      row: safeRow,
   };
}

function createAudioRenderAbortError(): Error {
   const error = new Error("Audio render cancelled.");
   error.name = "AbortError";
   return error;
}

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
    invokeExclusive: <T>(description: string, fn: (tx: Tic80BridgeTransaction) => Promise<T>) => Promise<T>;

    // stop: () => Promise<void>;
    ping: () => Promise<void>;
};

export type Tic80BridgeTransaction = {
    playSfx: (opts: { sfxId: number; tic80Note: number; channel: number; speed: number; volumeU8?: number; panU8?: number }) => Promise<void>;
    stopSfx: (opts: { channel: number; }) => Promise<void>;
    transmitAndPlay: (opts: {
        data: Tic80SerializedSong,
        reason: string,
    }) => Promise<void>;
    transmit: (opts: {
        data: Tic80SerializedSong,
        reason: string,
    }) => Promise<void>;
   renderSongToWav: (opts: {
      data: Tic80SerializedSong,
      reason: string,
      onProgress?: (progress: Tic80AudioRenderProgress) => void,
      signal?: AbortSignal,
   }) => Promise<Tic80AudioCaptureResult>;
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

    if (!heap) {
        throw new Error("Module.HEAPU8 not available yet (or not exposed by this build).");
    }
    return heap;
}

// Emscripten replaces Module.HEAPU8 whenever WebAssembly.Memory grows. Keep
// the Module object, not a typed-array view that can become detached during a
// long audio capture.
export function createTic80HeapAccess(Module: any) {
    const currentHeap = () => getHeapU8(Module);
    return {
        peekU8: (absoluteAddress: number) => currentHeap()[absoluteAddress] ?? 0,
        pokeU8: (absoluteAddress: number, value: number) => {
            currentHeap()[absoluteAddress] = value;
        },
        pokeBlock: (absoluteAddress: number, data: Uint8Array) => {
            currentHeap().set(data, absoluteAddress);
        },
        peekBlock: (absoluteAddress: number, length: number) =>
            currentHeap().slice(absoluteAddress, absoluteAddress + length),
    };
}

export const Tic80Bridge = forwardRef<Tic80BridgeHandle, Tic80BridgeProps>(
    function Tic80Bridge(
        {
            onReady,
        },
        ref
    ) {
        const iframeRef = useRef<Tic80IframeHandle | null>(null);

        const bridgeBuildId = buildInfo.commitHash || "dev";
        const bridgeCartPath = `/bridge-${bridgeBuildId}.tic`;

        const moduleRef = useRef<any | null>(null);
        const heapAccessRef = useRef<ReturnType<typeof createTic80HeapAccess> | null>(null);
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
                            gLog.info("waiting for Module in iframe...");
                        }
                        raf = requestAnimationFrame(tick);
                        return;
                    }

                    if (stageRef.current !== "module-ready") {
                        stageRef.current = "module-ready";
                        //log("Module detected in iframe; probing HEAPU8...");
                    }

                    // Emscripten runtime is alive; HEAPU8 may still not be ready for a moment
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
                            gLog.info("waiting for marker bytes from bridge cart...");
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
                    heapAccessRef.current = createTic80HeapAccess(Module);
                    ramBaseRef.current = ramBase;

                    if (!pollingCancelledRef.current) {
                        stageRef.current = "ready";

                        // stop polling.
                        pollingCancelledRef.current = true;

                        gLog.info("bridge ready");
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
                gLog.info("bridge poll cancelled");
                cancelAnimationFrame(raf);
            };
        }, []);

      // Confirm the cart can accept mailbox commands before exposing the bridge to the app.
        useEffect(() => {
            if (!ready) return;
           let cancelled = false;

           const completeStartupHandshake = async () => {
              try {
                 await ping();
                 if (cancelled) return;

                 // Initialize OUTBOX read pointer/seq to current cart state so we only read new logs.
                 try {
                    hostLogReadPtrRef.current = peekU8(TicMemoryMap.LOG_WRITE_PTR_ADDR);
                    outboxSeqRef.current = peekU8(TicMemoryMap.OUTBOX_SEQ_ADDR);
                 } catch (e) {
                    gLog.info("init outbox read ptr failed", e);
                 }

                 // now the parent can push real commands.
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
              } catch (error) {
                 if (!cancelled) {
                    gLog.error("bridge startup handshake failed", error);
                 }
              }
           };

           void completeStartupHandshake();
           return () => {
              cancelled = true;
           };
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
                        gLog.info(`unknown outbox cmd ${cmd} len=${len}`);
                        break;
                    }
                }

                readPtr += entrySize;
                if (readPtr >= TicMemoryMap.LOG_SIZE) readPtr = 0;
            }

            hostLogReadPtrRef.current = readPtr;

            if (logs.length) {
                logs.forEach((msg) => gLog.info(`[cart] ${msg}`));
            }
        }

        useEffect(() => {
            if (!ready) return;
            const id = window.setInterval(readOutboxCommands, 100);
            return () => window.clearInterval(id);
        }, [ready]);

        function assertReady() {
            if (!ready || !moduleRef.current || !heapAccessRef.current || ramBaseRef.current == null) {
                throw new Error("Tic80Bridge not ready yet.");
            }
        }

        function peekU8(addr: number): number {
            assertReady();
            return heapAccessRef.current!.peekU8(ramBaseRef.current! + addr);
        }

        function peekS8(addr: number): number {
            assertReady();
            const val = heapAccessRef.current!.peekU8(ramBaseRef.current! + addr);
            return val > 0x7f ? val - 0x100 : val;
        }

        function pokeU8(addr: number, value: number) {
            assertReady();
            // value is 0..255
            if (value < 0 || value > 255) {
                throw new Error(`pokeU8 value out of range: ${value}`);
            }
            heapAccessRef.current!.pokeU8(ramBaseRef.current! + addr, value);
        }

        function pokeS8(addr: number, value: number) {
            assertReady();
            // value is -128..127
            if (value < -128 || value > 127) {
                throw new Error(`pokeS8 value out of range: ${value}`);
            }
            heapAccessRef.current!.pokeU8(ramBaseRef.current! + addr, value & 0xff);
        }

        function pokeBlock(addr: number, data: Uint8Array) {
            assertReady();
            heapAccessRef.current!.pokeBlock(ramBaseRef.current! + addr, data);
        }

        function peekBlock(addr: number, length: number): Uint8Array {
            assertReady();
            return heapAccessRef.current!.peekBlock(ramBaseRef.current! + addr, length);
        }

        async function playSfxRaw(opts: { sfxId: number; tic80Note: number; channel: number; speed: number; volumeU8?: number; panU8?: number }) {
            const channel = (opts.channel ?? 0) & 0xff;

            // sfxId passed in is the somatic-facing instrument id (0-based).
            // but the TIC-80 SFX ids reserve 0 and 1 for special purposes,
            // handled by serialization. When playing a sfx live, we need to account for that.
            const sfxId = (opts.sfxId + 2) & 0xff;
            const note = opts.tic80Note & 0xff;
            const speed = opts.speed & 0xff;
            const hasVolumeScale = opts.volumeU8 !== undefined;
            const volumeU8 = hasVolumeScale ? (opts.volumeU8! & 0xff) : 0;
            const hasPanOverride = opts.panU8 !== undefined;
            const panU8 = hasPanOverride ? (opts.panU8! & 0xff) : 0;
            const mixFlags = (hasVolumeScale ? 1 : 0) | (hasPanOverride ? 2 : 0);
            const cmd = TicBridge.CMD_PLAY_SFX_ON;
            await sendMailboxCommandRaw(
                [cmd, sfxId, note, channel, speed, volumeU8, mixFlags, panU8],
                "Play SFX",
            );
        }

        async function stopSfxRaw(opts: { channel: number; }) {
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
            //return await gLog.scope(`sendMailboxCommand: ${description}`, () => {
            assertReady();
            const token = (cmdTokenRef.current = (cmdTokenRef.current + 1) & 0xff);
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
                           const result = peekU8(TicMemoryMap.OUTBOX_LAST_CMD_RESULT_ADDR);
                           if (result === 0) {
                              resolve();
                           } else {
                              const completedCommand = peekU8(TicMemoryMap.OUTBOX_LAST_CMD_ADDR);
                              reject(new Error(
                                 `${description} was rejected by the bridge (command ${completedCommand}, result ${result}).`,
                              ));
                           }
                            return;
                        }
                        if (performance.now() - start > timeoutMs) {
                            gLog.error(`sendMailboxCommand TIMEOUT: ${description}`);
                           reject(new Error(`${description} timed out waiting for the bridge.`));
                            return;
                        }
                        requestAnimationFrame(poll);
                    } catch (err) {
                        reject(err as Error);
                    }
                };
                poll();
                //});
            });
        }

        // just does the poking
        async function transmitInternal(opts: { data: Tic80SerializedSong, reason: string }) {

            for (const block of [...opts.data.standardBlocksToTransmit, ...opts.data.bridgeBlocksToTransmit]) {
                pokeBlock(block.region.address, block.payload);
            }
        };

        // Transaction API
        // uses the serialized(baked/prepared) song data to
        // - upload the song data to TIC-80 RAM
        // - start playback at specified song position, row, loop mode
        async function transmitAndPlayRaw(opts: { data: Tic80SerializedSong, reason: string }) {
            assertReady();
            await transmitInternal(opts);
            // Mailbox layout from the Lua:
            // 0 cmd, 1 songPosition, 2 row, 3 loopForever, 4 sustain (unused here), 5 tempo, 6 speed
            await sendMailboxCommandRaw([
                TicBridge.CMD_TRANSMIT_AND_PLAY,
                opts.data.bakedSong.startPosition & 0xff,
                opts.data.bakedSong.startRow & 0xff,
                opts.data.bakedSong.wantSongLoop ? 1 : 0,
                0, // sustain: unused
            ], "Play");
        }

        async function transmitRaw(opts: { data: Tic80SerializedSong, reason: string }) {
            assertReady();
            await transmitInternal(opts);
            await sendMailboxCommandRaw([
                TicBridge.CMD_TRANSMIT
            ], "Transmit");
        };

      async function renderSongToWavRaw(opts: {
         data: Tic80SerializedSong,
         reason: string,
         onProgress?: (progress: Tic80AudioRenderProgress) => void,
         signal?: AbortSignal,
      }): Promise<Tic80AudioCaptureResult> {
         assertReady();
         if (opts.signal?.aborted) {
            throw createAudioRenderAbortError();
         }

         const Module = moduleRef.current!;
         const previousComplete = Module.onAudioCaptureComplete;
         const previousError = Module.onAudioCaptureError;
         let progressAnimationFrame = 0;
         let timeoutId: number | null = null;
         let cancelFallbackId: number | null = null;
         let startAcknowledged = false;
         let terminalError: Error | null = null;
         let cancelCommandPromise: Promise<void> | null = null;
         let captureSettled = false;
         let lastReportedProgress: Tic80AudioRenderProgress | null = null;
         let resolveCapture!: (result: Tic80AudioCaptureResult) => void;
         let rejectCapture!: (error: Error) => void;

         const capturePromise = new Promise<Tic80AudioCaptureResult>((resolve, reject) => {
            resolveCapture = resolve;
            rejectCapture = reject;
         });
         void capturePromise.catch(() => { });

         const settleCaptureError = (error: Error) => {
            if (captureSettled) return;
            captureSettled = true;
            rejectCapture(error);
         };

         const reportProgress = (progress: Tic80AudioRenderProgress) => {
            if (lastReportedProgress && progress.completedRows <= lastReportedProgress.completedRows) return;
            lastReportedProgress = progress;
            try {
               opts.onProgress?.(progress);
            } catch (error) {
               gLog.error("audio render progress handler failed", error);
            }
         };

         // grab current runtime position and report to parent.
         const pollProgress = () => {
            if (captureSettled) return;
            try {
               const songPosition = decodeSomaticSongPositionU8(
                  peekU8(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION),
               );
               const row = peekU8(TicMemoryMap.MUSIC_STATE_ROW);
               reportProgress(calculateAudioRenderProgress(opts.data, songPosition, row));
            } catch (error) {
               settleCaptureError(error as Error);
               return;
            }
            progressAnimationFrame = requestAnimationFrame(pollProgress);
         };

         const requestCancel = (reason: Error) => {
            terminalError ??= reason;
            if (!startAcknowledged || cancelCommandPromise) return;

            cancelCommandPromise = sendMailboxCommandRaw(
               [TicBridge.CMD_CANCEL_RENDER_WAV],
               "Cancel WAV render",
            ).then(() => {
               // Normally the capture completion callback arrives immediately after the
               // cancelling TIC is synthesized. Do not hold the bridge forever if it does not.
               cancelFallbackId = window.setTimeout(() => {
                  settleCaptureError(terminalError ?? reason);
               }, 2000);
            }).catch((error) => {
               settleCaptureError(error as Error);
               throw error;
            });
         };

         const onAbort = () => requestCancel(createAudioRenderAbortError());
         opts.signal?.addEventListener("abort", onAbort, {once: true});

         const onAudioCaptureComplete = (rawResult: any) => {
            // from TIC-80, https://github.com/thenfour/TIC-80-ticbuild#audio-capture-lua-api
            // Module.onAudioCaptureComplete = ({ filename : string, mimeType : string, bytes: Uint8Array }) => {};
            // Module.onAudioCaptureError = ({ message }) => {};
            if (captureSettled) return;
            if (terminalError) {
               settleCaptureError(terminalError);
               return;
            }

            const rawBytes = rawResult?.bytes;
            if (!rawBytes || typeof rawBytes.length !== "number") {
               settleCaptureError(new Error("TIC-80 completed audio capture without WAV bytes."));
               return;
            }

            const bytes = new Uint8Array(rawBytes.length);
            bytes.set(rawBytes);
            const completeProgress = calculateAudioRenderProgress(opts.data, 0, 0);
            reportProgress({
               ...completeProgress,
               completedRows: completeProgress.totalRows,
               fraction01: 1,
            });
            captureSettled = true;
            resolveCapture({
               filename: typeof rawResult.filename === "string" ? rawResult.filename : "audio-capture.wav",
               mimeType: typeof rawResult.mimeType === "string" ? rawResult.mimeType : "audio/wav",
               bytes,
            });
         };

         const onAudioCaptureError = (rawError: any) => {
            const message = typeof rawError?.message === "string"
               ? rawError.message
               : "Unknown TIC-80 audio capture error.";
            terminalError ??= new Error(message);
            settleCaptureError(terminalError);
         };

         Module.onAudioCaptureComplete = onAudioCaptureComplete;
         Module.onAudioCaptureError = onAudioCaptureError;

         // here is the main loop, basically poll progress until capture complete web event, error web event, timeout...
         try {
            // send the song data.
            await transmitInternal(opts);
            if (terminalError || opts.signal?.aborted) {
               throw terminalError ?? createAudioRenderAbortError();
            }

            // and kick off render
            await sendMailboxCommandRaw([TicBridge.CMD_RENDER_WAV], "Render WAV");
            startAcknowledged = true;
            progressAnimationFrame = requestAnimationFrame(pollProgress); // begin polling progress

            // early error?
            if (terminalError || opts.signal?.aborted) {
               requestCancel(terminalError ?? createAudioRenderAbortError());
            }

            // if it takes too long, cancel. yes it means renders are never allowed to take longer than N minutes... sanity.
            timeoutId = window.setTimeout(() => {
               requestCancel(new Error("Audio render timed out."));
            }, AUDIO_RENDER_TIMEOUT_MS);

            const result = await capturePromise;
            if (cancelCommandPromise) {
               await cancelCommandPromise;
            }
            return result;
         } catch (error) {
            const renderError = error instanceof Error ? error : new Error(String(error));
            if (startAcknowledged) {
               requestCancel(renderError);
            }
            if (cancelCommandPromise) {
               try {
                  await cancelCommandPromise;
               } catch {
                  // Preserve the error that ended the render; the cancel path already logged its own failure.
               }
            }
            throw renderError;
         } finally {
            // uninstall
            if (progressAnimationFrame) cancelAnimationFrame(progressAnimationFrame);
            if (timeoutId !== null) window.clearTimeout(timeoutId);
            if (cancelFallbackId !== null) window.clearTimeout(cancelFallbackId);
            opts.signal?.removeEventListener("abort", onAbort);
            if (Module.onAudioCaptureComplete === onAudioCaptureComplete) {
               Module.onAudioCaptureComplete = previousComplete;
            }
            if (Module.onAudioCaptureError === onAudioCaptureError) {
               Module.onAudioCaptureError = previousError;
            }
         }
      } // function renderSongToWavRaw

        async function stopRaw() {
            gLog.info("stop() request");
            await sendMailboxCommandRaw([TicBridge.CMD_STOP], "Stop");
        }

        async function pingRaw() {
            gLog.info("ping()");
            await sendMailboxCommandRaw([TicBridge.CMD_PING], "Ping");
        }

        const transactionApi: Tic80BridgeTransaction = {
            playSfx: playSfxRaw,
            stopSfx: stopSfxRaw,
            transmitAndPlay: transmitAndPlayRaw,
            transmit: transmitRaw,
           renderSongToWav: renderSongToWavRaw,
            stop: stopRaw,
            ping: pingRaw,
        };

        async function invokeExclusive<T>(description: string, fn: (tx: Tic80BridgeTransaction) => Promise<T>): Promise<T> {
            return await gLog.scope(`invokeExclusive ${description}`, async () => {
                const release = await commandMutexRef.current.acquire();
                try {
                    const ret = await fn(transactionApi);
                    return ret;
                } finally {
                    release();
                }
            });
        }

        async function ping() {
            return invokeExclusive("ping", (tx) => tx.ping());
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

        return <Tic80Iframe
            ref={iframeRef}
        />;
    }
);
