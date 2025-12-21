import React from "react";
import type {
    ActionDef,
    ActionHandler,
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
import { useActiveScopes } from "./KeyboardShortcutScope";
import { ActionId } from "./ActionIds";
import { formatChord } from "./format";

type HandlerReg = {
    id: string;
    actionId: ActionId;
    scopesAtRegistration: string[]; // top-most first
    handler: ActionHandler;
};

type ShortcutManagerApi = {
    platform: Platform;
    actions: ActionRegistry;
    userBindings: UserBindings;
    setUserBindings: React.Dispatch<React.SetStateAction<UserBindings>>;

    registerHandler: (actionId: ActionId, scopes: string[], handler: ActionHandler) => () => void;
    getResolvedBindings: () => Record<ActionId, ShortcutChord[]>;
    getActionBindingLabel: (actionId: ActionId) => string | undefined;
    suspendShortcuts: () => () => void; // returns a release function
};

const ShortcutManagerContext = React.createContext<ShortcutManagerApi | null>(null);

function defaultShouldHandleAction(def: ActionDef, ctx: ShortcutContext): boolean {
    if (def.when && !def.when(ctx)) return false;
    if (!def.allowInEditable && ctx.isEditableTarget) return false;
    return true;
}

function chooseBestHandler(regs: HandlerReg[], activeScopes: string[]): HandlerReg | null {
    if (regs.length === 0) return null;

    // Score: lower is better.
    // 1) earliest match in activeScopes
    // 2) more specific registration (more scopes) wins ties
    // 3) stable tie-break by insertion order (already preserved)
    let best: { reg: HandlerReg; scoreA: number; scoreB: number } | null = null;

    for (const reg of regs) {
        const idx = activeScopes.findIndex(s => reg.scopesAtRegistration.includes(s));
        const scoreA = idx >= 0 ? idx : Number.POSITIVE_INFINITY;
        const scoreB = -reg.scopesAtRegistration.length;

        if (!best || scoreA < best.scoreA || (scoreA === best.scoreA && scoreB < best.scoreB)) {
            best = { reg, scoreA, scoreB };
        }
    }

    return best?.reg ?? null;
}

export function useShortcutManager(): ShortcutManagerApi {
    const v = React.useContext(ShortcutManagerContext);
    if (!v) throw new Error("useShortcutManager must be used inside <ShortcutManagerProvider>");
    return v;
}

export function ShortcutManagerProvider(props: {
    actions: ActionRegistry;
    initialBindings?: UserBindings;
    onBindingsChange?: (b: UserBindings) => void;
    platform?: Platform; // override for tests
    eventPolicy?: ShortcutEventPolicy;
    children: React.ReactNode;
}) {
    const suspendCountRef = React.useRef(0);
    const platform = props.platform ?? detectPlatform();
    const [userBindings, setUserBindings] = React.useState<UserBindings>(props.initialBindings ?? {});

    React.useEffect(() => {
        props.onBindingsChange?.(userBindings);
    }, [userBindings]);

    // Registrations stored in a ref so keydown handler sees latest without rerender-jank.
    const regsRef = React.useRef<HandlerReg[]>([]);
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

    const registerHandler = React.useCallback((actionId: ActionId, scopes: string[], handler: ActionHandler) => {
        const id = `${actionId}:${Math.random().toString(36).slice(2)}`;
        const reg: HandlerReg = { id, actionId, scopesAtRegistration: scopes, handler };
        regsRef.current = [...regsRef.current, reg];

        return () => {
            regsRef.current = regsRef.current.filter(r => r.id !== id);
        };
    }, []);

    const getResolvedBindings = React.useCallback(() => {
        return resolveBindingsForPlatform(actionsRef.current, userBindingsRef.current, platform);
    }, [platform]);

    const getActionBindingLabel = React.useCallback((actionId: ActionId): string | undefined => {
        const resolved = getResolvedBindings();
        const chords = resolved[actionId] ?? [];
        return chords.map(chord => formatChord(chord, platform)).join(", ") || undefined;
    }, [getResolvedBindings, platform]);

    React.useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (suspendCountRef.current > 0) return;

            if (props.eventPolicy?.ignoreEvent?.(e)) return;
            if (e.isComposing) return;

            const activeScopes = (window as any).__shortcut_activeScopes?.() as string[] | undefined;
            // We'll fill this from a hook below. Fallback to ["global"].
            const scopes = activeScopes?.length ? activeScopes : ["global"];

            const ctx = buildShortcutContext(platform, scopes, e);

            // ignore repeats by default (per-action can allow)
            // we can’t know which action until we match; we’ll check allowRepeat once a candidate is found.

            const actions = actionsRef.current;
            const resolved = resolveBindingsForPlatform(actions, userBindingsRef.current, platform);

            // Find all actionIds whose binding matches this event
            const candidates: ActionId[] = [];
            for (const [actionId, chords] of Object.entries(resolved)) {
                for (const chord of chords) {
                    if (chordMatchesEvent(e, chord, platform)) {
                        candidates.push(actionId as ActionId);
                        break;
                    }
                }
            }
            if (!candidates.length) return;

            // For each candidate, find best handler in current scopes and pick best overall
            const regs = regsRef.current;
            let chosen: { actionId: ActionId; reg: HandlerReg; scoreA: number; scoreB: number } | null = null;

            for (const actionId of candidates) {
                const def = actions[actionId];
                if (!def) continue;

                if (e.repeat && !def.allowRepeat) continue;
                if (!defaultShouldHandleAction(def, ctx)) continue;

                const matchingRegs = regs.filter(r => r.actionId === actionId);
                const bestReg = chooseBestHandler(matchingRegs, scopes);
                if (!bestReg) continue;

                const idx = scopes.findIndex(s => bestReg.scopesAtRegistration.includes(s));
                const scoreA = idx >= 0 ? idx : Number.POSITIVE_INFINITY;
                const scoreB = -bestReg.scopesAtRegistration.length;

                if (!chosen || scoreA < chosen.scoreA || (scoreA === chosen.scoreA && scoreB < chosen.scoreB)) {
                    chosen = { actionId, reg: bestReg, scoreA, scoreB };
                }
            }

            if (!chosen) return;

            const def = actions[chosen.actionId];

            // Apply event policy only when handled
            const prevent = def.preventDefault ?? true;
            const stop = def.stopPropagation ?? true;
            if (prevent) e.preventDefault();
            if (stop) e.stopPropagation();

            chosen.reg.handler(ctx);
        };

        document.addEventListener("keydown", onKeyDown, true);
        return () => document.removeEventListener("keydown", onKeyDown, true);
    }, [platform, props.eventPolicy]);

    const api: ShortcutManagerApi = {
        platform,
        actions: props.actions,
        userBindings,
        setUserBindings,
        registerHandler,
        getResolvedBindings,
        getActionBindingLabel,
        suspendShortcuts,
    };

    return <ShortcutManagerContext.Provider value={api}>{props.children}</ShortcutManagerContext.Provider>;
}

/**
 * Bridge: expose active scopes to the global keydown handler without rerendering it.
 * This keeps the keydown listener fast and avoids dependency churn.
 */
export function useExposeActiveScopesToWindow() {
    const scopes = useActiveScopes();
    const scopesRef = React.useRef(scopes);
    scopesRef.current = scopes;

    React.useEffect(() => {
        (window as any).__shortcut_activeScopes = () => scopesRef.current;
        return () => {
            if ((window as any).__shortcut_activeScopes) delete (window as any).__shortcut_activeScopes;
        };
    }, []);
}
