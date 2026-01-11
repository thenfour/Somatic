import * as React from "react";

type FocusBookmark = { restore: () => void };

const STACK_SIZE = 10;

type FocusHistoryApi = {
    // getCurrent: () => HTMLElement | null;
    // getPrevious: () => HTMLElement | null;

    // Capture a focus target to restore later.
    // you should supply a predicate to identify the element to capture.
    // i = index in stack (0 = most recent)
    capture: (predicate: (el: HTMLElement, i: number) => boolean) => FocusBookmark;
    capturePrevious: () => FocusBookmark;

    focus: (el: HTMLElement | null, opts?: FocusOptions) => void;
};

const FocusHistoryContext = React.createContext<FocusHistoryApi | null>(null);

function isFocusable(el: EventTarget | null): el is HTMLElement {
    return el instanceof HTMLElement && typeof el.focus === "function";
}

function stillInDocument(el: HTMLElement) {
    return document.contains(el);
}

function isHTMLElement(t: unknown): t is HTMLElement {
    return t instanceof HTMLElement;
}


function isNativeTextInput(el: HTMLElement) {
    const tag = el.tagName;
    if (tag === "INPUT") {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        // treat these as "explicit focus targets"
        return [
            "text",
            "search",
            "email",
            "url",
            "tel",
            "password",
            "number",
        ].includes(type);
    }
    if (tag === "TEXTAREA") return true;

    // contenteditable="true" should also count as a text focus target
    if (el.isContentEditable) return true;

    return false;
}


// Walk up from the focused node to find the nearest bookmark anchor.
function findBookmarkAnchor(target: EventTarget | null): HTMLElement | null {
    if (!isHTMLElement(target)) return null;
    let el: HTMLElement | null = target;
    while (el) {
        // add explicit data-focus-bookmark="true" to any element you want to act as a focus bookmark anchor
        if (el.dataset.focusBookmark === "true") return el;
        if (isNativeTextInput(el)) return el;
        el = el.parentElement;
    }
    return null;
}

export function FocusHistoryProvider({ children }: { children: React.ReactNode }) {
    // stack; most recent at end
    const focusHistoryStackRef = React.useRef<HTMLElement[]>([]);

    React.useEffect(() => {
        // Track focus changes anywhere in the document.
        const onFocusIn = (e: FocusEvent) => {
            const anchor = findBookmarkAnchor(e.target);
            if (!anchor) {
                //console.log('focusin event with no bookmark anchor, skipping');
                return;
            }

            const stack = focusHistoryStackRef.current;
            const top = stack[stack.length - 1];

            // If it's already at the top, don't duplicate.
            if (top === anchor) {
                //console.log('focusin event for element already at top of stack, skipping', anchor);
                return;
            }

            // Optional: remove if it already exists lower in the stack.
            const idx = stack.indexOf(anchor);
            if (idx !== -1) stack.splice(idx, 1);

            stack.push(anchor);

            //console.log('focusin event for', anchor);
            // const stack = focusHistoryStackRef.current;

            if (stack.length > STACK_SIZE) {
                stack.shift();
            }
        };

        document.addEventListener("focusin", onFocusIn, true);
        return () => document.removeEventListener("focusin", onFocusIn, true);
    }, []);

    const api = React.useMemo<FocusHistoryApi>(() => {
        const focus = (el: HTMLElement | null, opts?: FocusOptions) => {
            if (!el) {
                //console.log('focus: null element, skipping');
                return;
            }
            if (!stillInDocument(el)) {
                //console.log('focus: element not in document, skipping', el);
                return;
            }
            //console.log('focusing element', el);
            queueMicrotask(() => {
                // element might disappear between scheduling and execution
                if (stillInDocument(el)) el.focus(opts);
            });
        };

        const capture = (predicate: (el: HTMLElement, i: number) => boolean) => {

            const stack = focusHistoryStackRef.current;
            let snapshot: HTMLElement | null = null;
            for (let i = stack.length - 1; i >= 0; i--) {
                const el = stack[i];
                const stackIndex = stack.length - 1 - i;
                if (predicate(el, stackIndex)) {
                    //console.log('focus capture matched element', el, 'at stack index', stackIndex, "with stack", stack);
                    snapshot = el;
                    break;
                }
            }

            //const snapshot = strategy === "previous" ? previousRef.current : currentRef.current;
            //console.log('captured focus bookmark', snapshot);

            return {
                restore: () => focus(snapshot ?? null),
            };
        };

        return {
            capture,
            focus,
            capturePrevious: () => {
                // assumes the component that is bookmarking doesn't set a new focus bookmark itself,
                // and assumes the previous one (therefore: top of stack) is the one it wants.
                return capture((el, i) => true);
            }
        };
    }, []);

    return <FocusHistoryContext.Provider value={api}>{children}</FocusHistoryContext.Provider>;
}

export function useFocusHistory() {
    const ctx = React.useContext(FocusHistoryContext);
    if (!ctx) throw new Error("useFocusHistory must be used within <FocusHistoryProvider>");
    return ctx;
}
