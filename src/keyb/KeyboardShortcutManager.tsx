import React from "react";
import type {
    ActionDef,
    ActionHandler,
   ActionHandlerOptions,
    ActionRegistry,
    Platform,
    ShortcutChord,
    ShortcutContext,
    ShortcutEventPolicy,
    UserBindings,
} from "./KeyboardShortcutTypes";
import { detectPlatform } from "./KeyboardShortcutPlatform";
import { buildShortcutContext, chordMatchesEvent } from "./Keyboard";
import { resolveBindingsForPlatform } from "./KeyboardConflicts";
import { formatChord } from "./format";
import { typedEntries } from "../utils/utils";

export type ShortcutInvocationCandidate<TValue, TContext> = {
   value: TValue;
   when?: (ctx: TContext) => boolean;
   specificity?: number;
};

// Selects the most-specific eligible invocation. Candidate order is retained
export function chooseShortcutInvocation<TValue, TContext>(
   candidates: readonly ShortcutInvocationCandidate<TValue, TContext>[],
   ctx: TContext,
): TValue | null {
   let best: ShortcutInvocationCandidate<TValue, TContext> | null = null;
   let bestSpecificity = Number.NEGATIVE_INFINITY;

   for (const candidate of candidates) {
      if (candidate.when && !candidate.when(ctx)) continue;

      const specificity = Number.isFinite(candidate.specificity)
         ? candidate.specificity!
         : 0;
      if (best === null || specificity > bestSpecificity) {
         best = candidate;
         bestSpecificity = specificity;
      }
   }

   return best?.value ?? null;
}


type HandlerReg<TActionId extends string> = {
    id: string;
    actionId: TActionId;
    handler: ActionHandler;
   options: ActionHandlerOptions;
};

type ShortcutManagerApi<TActionId extends string> = {
    platform: Platform;
    actions: ActionRegistry<TActionId>;
    userBindings: UserBindings<TActionId>;
    setUserBindings: React.Dispatch<React.SetStateAction<UserBindings<TActionId>>>;

   registerHandler: (actionId: TActionId, handler: ActionHandler, options?: ActionHandlerOptions) => () => void;
   useActionHandler: (actionId: TActionId, handler: ActionHandler, options?: ActionHandlerOptions) => void;
    getResolvedBindings: () => Record<TActionId, ShortcutChord[]>;
    getActionBindingLabel: (actionId: TActionId) => string | undefined;
    getActionBindingLabelAlways: (actionId: TActionId) => string;
    getActionBindingLabelAsTooltipSuffix: (actionId: TActionId) => string;
    suspendShortcuts: () => () => void; // returns a release function
};

const ShortcutManagerContext = React.createContext<ShortcutManagerApi<any> | null>(null);

function defaultShouldHandleAction<TActionId extends string>(def: ActionDef<TActionId>, ctx: ShortcutContext): boolean {
    if (def.when && !def.when(ctx)) return false;
    if (!def.allowInEditable && ctx.isEditableTarget) return false;

    const et = def.eventType ?? "keydown";
    if (et !== "both" && et !== ctx.eventType) return false;
    return true;
}

export function useShortcutManager<TActionId extends string = string>(): ShortcutManagerApi<TActionId> {
    const v = React.useContext(ShortcutManagerContext);
    if (!v) throw new Error("useShortcutManager must be used inside <ShortcutManagerProvider>");
    return v as ShortcutManagerApi<TActionId>;
}

export function ShortcutManagerProvider<TActionId extends string = string>(props: {
    name: string; // for debugging
    actions: ActionRegistry<TActionId>;
    initialBindings?: UserBindings<TActionId>;
    onBindingsChange?: (b: UserBindings<TActionId>) => void;
    platform?: Platform; // override for tests
    attachTo: Document | HTMLElement | React.RefObject<HTMLElement>;
    eventPhase?: "bubble" | "capture"; // bubble is for global; capture is for local
    eventPolicy?: ShortcutEventPolicy;
    children: React.ReactNode;
}) {
    const suspendCountRef = React.useRef(0);
    const platform = props.platform ?? detectPlatform();
    const [userBindings, setUserBindings] = React.useState<UserBindings<TActionId>>(props.initialBindings ?? {});

    React.useEffect(() => {
        props.onBindingsChange?.(userBindings);
    }, [userBindings]);

    // Registrations stored in a ref so keydown handler sees latest without rerender-jank.
    const regsRef = React.useRef<HandlerReg<TActionId>[]>([]);
    const actionsRef = React.useRef(props.actions);
    actionsRef.current = props.actions;

    const userBindingsRef = React.useRef(userBindings);
    userBindingsRef.current = userBindings;

    const suspendShortcuts = React.useCallback(() => {
        suspendCountRef.current += 1;
        let released = false;

        return () => {
            if (released) return;
            released = true;
            suspendCountRef.current = Math.max(0, suspendCountRef.current - 1);
        };
    }, []);

   const registerHandler = React.useCallback((actionId: TActionId, handler: ActionHandler, options: ActionHandlerOptions = {}) => {
        const id = `${actionId}:${Math.random().toString(36).slice(2)}`;
      const reg: HandlerReg<TActionId> = {id, actionId, handler, options};
        regsRef.current = [...regsRef.current, reg];

        return () => {
            regsRef.current = regsRef.current.filter(r => r.id !== id);
        };
    }, []);

    // Hook helper exposed on the manager so consumers can write mgr.useActionHandler("Close", ...) without re-specifying generics.
   const useActionHandlerScoped = (actionId: TActionId, handler: ActionHandler, options?: ActionHandlerOptions) => {
        const handlerRef = React.useRef(handler);
        handlerRef.current = handler;
      const whenRef = React.useRef(options?.when);
      whenRef.current = options?.when;
      const specificity = options?.specificity ?? 0;

        React.useEffect(() => {
           return registerHandler(
              actionId,
              ctx => handlerRef.current(ctx),
              {
                 when: ctx => whenRef.current?.(ctx) ?? true,
                 specificity,
              },
           );
        }, [registerHandler, actionId, specificity]);
    };

    const getResolvedBindings = React.useCallback(() => {
        return resolveBindingsForPlatform(actionsRef.current, userBindingsRef.current, platform);
    }, [platform]);

    const getActionBindingLabel = React.useCallback((actionId: TActionId): string | undefined => {
        const resolved = getResolvedBindings();
        const chords = resolved[actionId] ?? [];
        return chords.map(chord => formatChord(chord, platform)).join(", ") || undefined;
    }, [getResolvedBindings, platform]);

    React.useEffect(() => {
        const onKeyEvent = (e: Event) => {
            if (!(e instanceof KeyboardEvent)) return;
            if (suspendCountRef.current > 0) return;

            if (props.eventPolicy?.ignoreEvent?.(e)) return;
            if (e.isComposing) return;

            const ctx = buildShortcutContext(platform, e);

            // ignore repeats by default (per-action can allow)
            // we can’t know which action until we match; we’ll check allowRepeat once a candidate is found.

            const actions = actionsRef.current;
            const resolved = resolveBindingsForPlatform(actions, userBindingsRef.current, platform);

            // Find all actionIds whose binding matches this event
            const candidates: { action: TActionId, chord: ShortcutChord }[] = [];
            const entries = typedEntries(resolved);//Object.entries(resolved);
            for (const [actionId, chords] of entries) {
                for (const chord of chords) {
                    if (chordMatchesEvent(e, chord, platform)) {
                        candidates.push({ action: actionId as TActionId, chord });
                        break;
                    }
                }
            }
            if (!candidates.length) return;

            // for (const candidate of candidates) {
            //     console.log(`[${props.name}] Candidate action '${candidate.action}' for chord ${formatChord(candidate.chord, platform)}`);
            // };

           // Build all eligible action/handler pairs, then let the most
           // context-specific registration override global fallbacks.
            const regs = regsRef.current;
           type Invocation = {
              reg: HandlerReg<TActionId>;
              def: ActionDef<TActionId>;
              chord: ShortcutChord | null;
           };
           const invocations: ShortcutInvocationCandidate<Invocation, ShortcutContext>[] = [];

           for (const {action: actionId, chord} of candidates) {
                const def = actions[actionId];
                if (!def) continue;

                if (e.repeat && !def.allowRepeat) continue;
                if (!defaultShouldHandleAction(def, ctx)) {
                    //console.log(`[${props.name}] Action '${actionId}' not allowed in current context.`);
                    continue;
                }

                const matchingRegs = regs.filter(r => r.actionId === actionId);
              if (!matchingRegs.length) {
                    //console.log(`[${props.name}] No handler registered for action '${actionId}'.`);
                    continue;
                }
              for (const reg of matchingRegs) {
                 invocations.push({
                    value: {
                       reg,
                       def,
                       chord,
                    },
                    when: reg.options.when,
                    specificity: reg.options.specificity,
                 });
              }
            }

           const chosen = chooseShortcutInvocation(invocations, ctx);
            if (!chosen) {
                //console.log(`[${props.name}] No suitable handler found for candidates.`);
                return;
            }

           //console.log(`[${props.name}] Handling shortcut for action '${chosen.reg.actionId}' via chord ${formatChord(chosen.chord!, platform)}`);

            // Apply event policy only when handled
           const prevent = chosen.def.preventDefault ?? true;
           const stop = chosen.def.stopPropagation ?? true;
            if (prevent) e.preventDefault();
            if (stop) e.stopPropagation();

           chosen.reg.handler(ctx);
        };

        // Resolve the attachment target
        const attachTo = props.attachTo ?? document;

        const target: Document | HTMLElement | null = attachTo && 'current' in attachTo
            ? attachTo.current  // It's a ref
            : attachTo;         // It's a Document or HTMLElement

        if (!target) {
            //console.error(`[${props.name}] attachTo is null; keyboard shortcuts will not be active.`);
            return; // Can't attach if ref is null
        }

        const eventPhase = props.eventPhase ?? (document === props.attachTo ? "bubble" : "capture");

        const useCapture = eventPhase === "capture";

        //console.log(`[${props.name}] Attaching keydown listener to`, target, `in ${useCapture ? "capture" : "bubble"} phase`);
        target.addEventListener("keydown", onKeyEvent, useCapture);
        target.addEventListener("keyup", onKeyEvent, useCapture);
        return () => {
            target.removeEventListener("keydown", onKeyEvent, useCapture);
            target.removeEventListener("keyup", onKeyEvent, useCapture);
        };
    }, [platform, props.eventPolicy, props.attachTo, props.eventPhase]);

    const api: ShortcutManagerApi<TActionId> = {
        platform,
        actions: props.actions,
        userBindings,
        setUserBindings,
        registerHandler,
        useActionHandler: useActionHandlerScoped,
        getActionBindingLabelAlways: (actionId: TActionId): string => {
            const label = getActionBindingLabel(actionId);
           return label ?? "(Unbound)";
        },
        getActionBindingLabelAsTooltipSuffix: (actionId: TActionId): string => {
            const label = getActionBindingLabel(actionId);
            if (!label) return "";
            return ` (${label})`;
        },
        getResolvedBindings,
        getActionBindingLabel,
        suspendShortcuts,
    };

    return <ShortcutManagerContext.Provider value={api}>{props.children}</ShortcutManagerContext.Provider>;
}
