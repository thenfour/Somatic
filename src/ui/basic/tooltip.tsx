// flicker is possible when placement is unsolvable.
// some ideas to consider in the future:
// - don't arrange on every mous event; solve at initial present only.
// - calc scores only once and choose best, instead of looping around (not sure if this is what's going on yet)

import React from "react";
import { createPortal } from "react-dom";
import { useAppStatusBar } from "../../hooks/useAppStatusBar";
import { computeFloatingPlacement } from "./floatingPlacement";
import { clamp } from "../../utils/utils";

type Side = "top" | "bottom" | "left" | "right";
type Rect = { left: number; top: number; width: number; height: number };

function toRect(dom: DOMRect): Rect {
    return { left: dom.left, top: dom.top, width: dom.width, height: dom.height };
}

function clampRectIntoBoundary(rect: Rect, boundary: Rect, padding: number): Rect {
    const minX = boundary.left + padding;
    const minY = boundary.top + padding;
    const maxX = boundary.left + boundary.width - padding - rect.width;
    const maxY = boundary.top + boundary.height - padding - rect.height;
    return {
        ...rect,
        left: clamp(rect.left, minX, maxX),
        top: clamp(rect.top, minY, maxY),
    };
}

function rectContainsPoint(rect: Rect, x: number, y: number, pad: number): boolean {
    return (
        x >= rect.left - pad &&
        x <= rect.left + rect.width + pad &&
        y >= rect.top - pad &&
        y <= rect.top + rect.height + pad
    );
}

// Convert engine "top-left rect" back into "anchor coords"
function rectToLegacyCoords(rect: Rect, side: Side): { top: number; left: number } {
    switch (side) {
        case "bottom":
            return { left: rect.left + rect.width / 2, top: rect.top };
        case "top":
            return { left: rect.left + rect.width / 2, top: rect.top + rect.height };
        case "right":
            return { left: rect.left, top: rect.top + rect.height / 2 };
        case "left":
            return { left: rect.left + rect.width, top: rect.top + rect.height / 2 };
    }
}


type TooltipProps = {
    title: React.ReactNode;
    children: React.ReactElement;
    placement?: Side;
    className?: string;
    disabled?: boolean;
};

export const Tooltip: React.FC<TooltipProps> = ({
    title,
    children,
    placement = "bottom",
    className,
    disabled = false,
}) => {
    const triggerRef = React.useRef<HTMLElement | null>(null);
    const tooltipRef = React.useRef<HTMLSpanElement | null>(null);

    const [ready, setReady] = React.useState(false); // used to know when to set opacity to 1
    const [open, setOpen] = React.useState(false);

    // unchanged outward shape
    const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);
    const [cursorPos, setCursorPos] = React.useState<{ x: number; y: number } | null>(null);

    // actual side chosen by engine (may flip)
    const [effectivePlacement, setEffectivePlacement] = React.useState<typeof placement>(placement);

    const { setMessage, clearMessage } = useAppStatusBar();

    React.useEffect(() => {
        if (open && typeof title === "string" && title.trim()) {
            setMessage(title, 10);
        } else {
            clearMessage();
        }
        return () => clearMessage();
    }, [open, title, setMessage, clearMessage]);

    React.useEffect(() => {
        // any time open state changes, we begin not-ready (opacity 0)
        setReady(false);
    }, [open]);

    // Keep effectivePlacement in sync when prop changes (but allow engine to override while open)
    React.useEffect(() => {
        if (!open) setEffectivePlacement(placement);
    }, [placement, open]);

    const updatePosition = React.useCallback(() => {
        const el = triggerRef.current;
        const tooltip = tooltipRef.current;
        if (!el) return;

        const anchorRect = toRect(el.getBoundingClientRect());
        const boundary = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

        const tooltipWidth = tooltip?.offsetWidth || 320;
        const tooltipHeight = tooltip?.offsetHeight || 100;

        const margin = 8;
        const offset = 6;
        const cursorAvoidPadding = 8;

        // compute a top-left rect + chosen placement (side may flip)
        const result = computeFloatingPlacement({
            anchor: anchorRect,
            floatingSize: { width: tooltipWidth, height: tooltipHeight },
            boundary,
            preferred: { side: placement, align: "center" },
            offset,
            padding: margin,
            allowShift: true,
            allowOverlapAnchor: false,
            candidateStrategy: "smart",
        });

        let rect: { left: number; top: number; width: number; height: number } = result.rect;
        const side = result.placement.side as typeof placement;

        // Cursor avoidance
        if (cursorPos && tooltipWidth > 0 && tooltipHeight > 0) {
            const overlaps = rectContainsPoint(rect, cursorPos.x, cursorPos.y, cursorAvoidPadding);

            if (overlaps) {
                // Nudge along the chosen side's main axis away from cursor
                if (side === "bottom") rect = { ...rect, top: cursorPos.y + cursorAvoidPadding };
                else if (side === "top") rect = { ...rect, top: cursorPos.y - cursorAvoidPadding - rect.height };
                else if (side === "right") rect = { ...rect, left: cursorPos.x + cursorAvoidPadding };
                else if (side === "left") rect = { ...rect, left: cursorPos.x - cursorAvoidPadding - rect.width };

                // Clamp fully back into viewport after nudging
                rect = clampRectIntoBoundary(rect, boundary, margin);
            }
        }

        // Convert rect back to `{top,left}` anchor convention
        setEffectivePlacement(side);
        setCoords(rectToLegacyCoords(rect, side));
    }, [placement, cursorPos]);

    React.useEffect(() => {
        if (!open) return;
        updatePosition();
        const handleScroll = () => updatePosition();
        window.addEventListener("scroll", handleScroll, true);
        window.addEventListener("resize", handleScroll);
        return () => {
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [open, updatePosition]);

    React.useEffect(() => {
        if (!open) return;
        if (!tooltipRef.current) return;

        // Two rAFs is a common trick:
        // - first ensures mount/layout
        // - second ensures we measure after styles/layout settle
        requestAnimationFrame(() => {
            updatePosition();
            requestAnimationFrame(() => {
                updatePosition();
                setReady(true);
            });
        });
    }, [open, title, updatePosition]);


    const childElement = React.Children.only(children);

    const clonedChild = React.cloneElement(childElement, {
        ref: (node: HTMLElement | null) => {
            triggerRef.current = node;
            const { ref } = childElement as any;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
        },
        onMouseEnter: (e: React.MouseEvent) => {
            if (!disabled) {
                setCursorPos({ x: e.clientX, y: e.clientY });
                setOpen(true);
            }
            childElement.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
            if (!disabled) {
                setOpen(false);
                setCursorPos(null);
            }
            childElement.props.onMouseLeave?.(e);
        },
        onMouseMove: (e: React.MouseEvent) => {
            if (!disabled) setCursorPos({ x: e.clientX, y: e.clientY });
            childElement.props.onMouseMove?.(e);
        },
        onFocus: (e: React.FocusEvent) => {
            if (!disabled) setOpen(true);
            childElement.props.onFocus?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
            if (!disabled) setOpen(false);
            childElement.props.onBlur?.(e);
        },
    } as any);

    const shouldShow = open && !disabled && title;

    const style: React.CSSProperties = {
        top: coords?.top,
        left: coords?.left,
        opacity: ready ? 1 : 0,
        pointerEvents: ready ? "auto" : "none",
        //transition: "opacity 80ms linear",
    }

    return (
        <>
            {clonedChild}
            {shouldShow &&
                coords &&
                createPortal(
                    <span
                        ref={tooltipRef}
                        className={`generic-tooltip generic-tooltip--${effectivePlacement} ${className || ""}`}
                        style={style}
                    >
                        {title}
                    </span>,
                    document.body
                )}
        </>
    );
};
