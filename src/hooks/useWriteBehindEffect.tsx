import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gLog } from "../utils/logger";

// so the idea is to basically make autosave behave better.
// example:

// const { enqueue, flush, state } = useWriteBehindEffect(
//   async (doc, { signal }) => {
//     // Example: fetch that can be aborted
//     await fetch("/api/save", {
//       method: "POST",
//       body: JSON.stringify(doc),
//       signal,
//       headers: { "content-type": "application/json" },
//     });
//   },
//   { debounceMs: 1200, maxWaitMs: 15000 }
// );

// // call enqueue whenever you consider the "latest snapshot"changed
// useEffect(() => {
//   enqueue(documentModel);
// }, [documentModel, enqueue]);

// // optional: flush on blur / before unload
// useEffect(() => {
//   const onBlur = () => void flush();
//   window.addEventListener("blur", onBlur);
//   return () => window.removeEventListener("blur", onBlur);
// }, [flush]

type WriteBehindStatus = "idle" | "scheduled" | "running" | "error";

export type WriteBehindEffect<T, R = unknown> = (
    latestValue: T,
    ctx: { signal: AbortSignal }
) => Promise<R> | R;

export type UseWriteBehindEffectOptions<T, R> = {
    enabled?: boolean;

    /** Wait for quiet (trailing) before running. */
    debounceMs?: number;

    /**
     * Guarantee a run at least this often during continuous updates.
     * (Debounce-with-maxWait semantics.)
     */
    maxWaitMs?: number;

    /**
     * If true, abort any in-flight run when a newer value arrives.
     * Default: false (serialize runs; conflate to latest after completion).
     */
    cancelInFlightOnNewer?: boolean;

    onSuccess?: (result: R, value: T) => void;
    onError?: (error: unknown, value: T) => void;
};

export type WriteBehindState = {
    status: WriteBehindStatus;
    isDirty: boolean;
    isScheduled: boolean;
    isRunning: boolean;

    lastRunAt: number | null;
    lastSuccessAt: number | null;

    error: unknown;
};

export function useWriteBehindEffect<T, R = unknown>(
    effect: WriteBehindEffect<T, R>,
    options?: UseWriteBehindEffectOptions<T, R>
) {
    const opts = {
        enabled: true,
        debounceMs: 1000,
        maxWaitMs: undefined as number | undefined,
        cancelInFlightOnNewer: false,
        onSuccess: undefined as ((result: R, value: T) => void) | undefined,
        onError: undefined as ((error: unknown, value: T) => void) | undefined,
        ...options,
    };

    const effectRef = useRef(effect);
    useEffect(() => {
        effectRef.current = effect;
    }, [effect]);

    const mountedRef = useRef(true);
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    const [state, setState] = useState<WriteBehindState>({
        status: "idle",
        isDirty: false,
        isScheduled: false,
        isRunning: false,
        lastRunAt: null,
        lastSuccessAt: null,
        error: null,
    });

    // Internal mutable state (avoids rerender churn).
    const latestValueRef = useRef<T | undefined>(undefined);
    const dirtyRef = useRef(false);

    const debounceTimerRef = useRef<number | null>(null);
    const maxWaitTimerRef = useRef<number | null>(null);

    const inFlightRef = useRef<Promise<void> | null>(null);
    const abortCtrlRef = useRef<AbortController | null>(null);

    // Flush waiters (resolve when fully idle: no dirty, no schedule, no in-flight).
    const flushWaitersRef = useRef<Array<() => void>>([]);

    const clearTimers = useCallback(() => {
        if (debounceTimerRef.current != null) {
            window.clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (maxWaitTimerRef.current != null) {
            window.clearTimeout(maxWaitTimerRef.current);
            maxWaitTimerRef.current = null;
        }
    }, []);

    const updateState = useCallback((patch: Partial<WriteBehindState>) => {
        if (!mountedRef.current) return;
        setState((s) => ({ ...s, ...patch }));
    }, []);

    const maybeResolveFlushWaiters = useCallback(() => {
        const isIdle =
            !dirtyRef.current &&
            debounceTimerRef.current == null &&
            maxWaitTimerRef.current == null &&
            inFlightRef.current == null;

        if (isIdle && flushWaitersRef.current.length > 0) {
            const waiters = flushWaitersRef.current.splice(0);
            waiters.forEach((w) => w());
        }
    }, []);

    const runNow = useCallback(() => {
        if (!opts.enabled) return;
        if (inFlightRef.current) return; // serialize

        if (!dirtyRef.current) {
            // Nothing to do
            updateState({
                status: state.status === "error" ? "error" : "idle",
                isScheduled: false,
                isDirty: false,
                isRunning: false,
            });
            maybeResolveFlushWaiters();
            return;
        }

        clearTimers();
        updateState({ status: "running", isRunning: true, isScheduled: false });

        const value = latestValueRef.current as T; // dirty implies we have a value
        dirtyRef.current = false;
        updateState({ isDirty: false, lastRunAt: Date.now(), error: null });

        const abortCtrl = new AbortController();
        abortCtrlRef.current = abortCtrl;

        const p = (async () => {
            try {
                const result = await effectRef.current(value, { signal: abortCtrl.signal });
                if (!mountedRef.current) return;

                updateState({ status: "idle", isRunning: false, lastSuccessAt: Date.now(), error: null });
                opts.onSuccess?.(result as R, value);
            } catch (err) {
                if (!mountedRef.current) return;

                // If aborted, treat as not an error (unless you want otherwise).
                if (abortCtrl.signal.aborted) {
                    updateState({ status: "idle", isRunning: false });
                } else {
                    updateState({ status: "error", isRunning: false, error: err });
                    opts.onError?.(err, value);
                }
            } finally {
                if (!mountedRef.current) return;

                inFlightRef.current = null;
                abortCtrlRef.current = null;

                // If edits arrived while running, ensure we run again (conflation).
                if (dirtyRef.current) {
                    // Run ASAP after completion.
                    schedule(0);
                } else {
                    maybeResolveFlushWaiters();
                }
            }
        })();

        inFlightRef.current = p;
    }, [opts.enabled, opts.onError, opts.onSuccess, clearTimers, maybeResolveFlushWaiters, updateState, state.status]);

    const schedule = useCallback(
        (overrideDebounceMs?: number) => {
            if (!opts.enabled) return;

            const debounceMs = overrideDebounceMs ?? opts.debounceMs;

            // trailing debounce: reset debounce timer every time
            if (debounceTimerRef.current != null) {
                window.clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = window.setTimeout(() => {
                debounceTimerRef.current = null;
                // If in-flight, we’ll run again on completion (conflation).
                if (!inFlightRef.current) runNow();
                else updateState({ isScheduled: false, status: "running" });
            }, Math.max(0, debounceMs));

            // maxWait: set only on the first edit of a burst
            if (opts.maxWaitMs != null && maxWaitTimerRef.current == null) {
                maxWaitTimerRef.current = window.setTimeout(() => {
                    maxWaitTimerRef.current = null;
                    if (!inFlightRef.current) runNow();
                    else updateState({ isScheduled: false, status: "running" });
                }, Math.max(0, opts.maxWaitMs));
            }

            updateState({
                status: inFlightRef.current ? "running" : "scheduled",
                isScheduled: true,
            });
        },
        [opts.enabled, opts.debounceMs, opts.maxWaitMs, runNow, updateState]
    );

    const enqueue = useCallback(
        (value: T) => {
            if (!opts.enabled) {
                //gLog.info("useWriteBehindEffect: enqueue ignored, not enabled");
                return;
            }

            latestValueRef.current = value;
            dirtyRef.current = true;
            updateState({ isDirty: true, error: null });

            if (opts.cancelInFlightOnNewer && abortCtrlRef.current) {
                //gLog.info("useWriteBehindEffect: enqueue aborting in-flight run due to newer value");
                abortCtrlRef.current.abort();
            }

            //gLog.info("useWriteBehindEffect: enqueue scheduling run");
            schedule();
        },
        [opts.enabled, opts.cancelInFlightOnNewer, schedule, updateState]
    );

    const flush = useCallback(async () => {
        if (!opts.enabled) {
            //gLog.info("useWriteBehindEffect: flush ignored, not enabled");
            return;
        }

        // If there’s pending work, schedule an immediate attempt.
        if (dirtyRef.current) {
            //gLog.info("useWriteBehindEffect: flush scheduling immediate run");
            schedule(0);
        }
        if (!inFlightRef.current && dirtyRef.current) {
            //gLog.info("useWriteBehindEffect: flush running now");
            runNow();
        }

        await new Promise<void>((resolve) => {
            // If already idle, resolve immediately
            const isIdle =
                !dirtyRef.current &&
                debounceTimerRef.current == null &&
                maxWaitTimerRef.current == null &&
                inFlightRef.current == null;

            if (isIdle) {
                //gLog.info("useWriteBehindEffect: flush already idle, resolving");
                resolve();
            }
            else {
                //gLog.info("useWriteBehindEffect: flush waiting for idle");
                flushWaitersRef.current.push(resolve);
            }
        });
    }, [opts.enabled, runNow, schedule]);

    const cancel = useCallback((args?: { abortInFlight?: boolean }) => {
        clearTimers();
        updateState({ isScheduled: false });

        if (args?.abortInFlight && abortCtrlRef.current) {
            abortCtrlRef.current.abort();
        }

        // NOTE: we intentionally do NOT clear dirty/latest by default,
        // because cancel often means “stop timing”, not “forget changes”.
        maybeResolveFlushWaiters();
    }, [clearTimers, maybeResolveFlushWaiters, updateState]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            clearTimers();
            abortCtrlRef.current?.abort();
        };
    }, [clearTimers]);

    const api = useMemo(() => {
        return {
            enqueue,
            flush,
            cancel,
            state,
        };
    }, [enqueue, flush, cancel, state]);

    return api;
}

export type WriteBehind<T> = ReturnType<typeof useWriteBehindEffect<T>>;

export function useNopWriteBehindEffect<T, R = unknown>(
    effect: WriteBehindEffect<T, R>,
    options?: UseWriteBehindEffectOptions<T, R>
) {
    const noopApi = useMemo(() => {
        return {
            enqueue: (_: T) => { },
            flush: async () => { },
            cancel: (_?: { abortInFlight?: boolean }) => { },
            state: {
                status: "idle" as WriteBehindStatus,
                isDirty: false,
                isScheduled: false,
                isRunning: false,

                lastRunAt: null,
                lastSuccessAt: null,
                error: null,
            } as WriteBehindState,
        };
    }, []);
    return noopApi;
}
