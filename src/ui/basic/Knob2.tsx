// a knob component to replace many input type=range or number.
// features:
//
// - mouse capture on click + drag up & down to affect value
// - ctrl+click to set default
// - shift for fine control
// - min / max / step props; the most basic usage can be a drop-in replacement for <input type="range" />
// - value formatter / parser support
// - show current value and label
// - themed colors
// - caller can specify delta sensitivity
// - caller can specify dead angle (the part of the circle where there is no value)
// - highlight around ring from center value to current value.
//
// future features:
// - double-click to type value
// - accept keyboard focus;
//   - left/right or up/down to change value by step
//
// internally we use 0-1; externally the user defines mapping & formatting.
// renders as svg
// track background is an arc
// from the center value to the current value is a highlighted arc
// a thumb circle at the current value position
//
// label is drawn centered above the knob
// value is drawn centered below the knob
//
// a reference implementation that has the correct knob look, but is a bit messy:
// https://github.com/thenfour/digifujam/blob/master/source/DFclient/ui/knob.js
//

import "./Knob2.css";
import React, {
    useCallback,
    useMemo,
    useRef,
    useState,
    PointerEvent,
} from "react";
import { clamp, clamp01, polarToCartesian } from "../../utils/utils";

export interface KnobProps {
    /** Controlled value (external domain). */
    value: number;
    /** Called whenever the value changes due to user interaction. */
    onChange: (value: number) => void;

    /** Minimum and maximum external values (for linear mapping). */
    min?: number;
    max?: number;
    /** Step size in external units. If omitted, no snapping is applied. */
    step?: number;

    /** Default value for Ctrl+click reset. Defaults to midpoint between min and max. */
    defaultValue?: number;

    /** Optional “center” value in external units for the highlight arc. Defaults to midpoint. */
    centerValue?: number;

    /** Optional label shown above the knob. */
    label?: string;

    /** Optional mapping from external value -> normalized [0, 1]. */
    toUnit?: (external: number) => number;
    /** Optional mapping from normalized [0, 1] -> external value. */
    fromUnit?: (unit: number) => number;


    /** Format the value for display. */
    formatValue?: (value: number) => string;
    /** Parse a typed value (future: double-click to edit). */
    parseValue?: (text: string) => number | null;

    /**
     * Approximate vertical pixels of drag for a full sweep from min to max.
     * Larger = slower / finer, smaller = faster / coarser.
     */
    dragSensitivity?: number;

    /**
     * Scale applied to drag delta when Shift is held.
     * E.g. 0.2 means “5x finer” when Shift is pressed.
     */
    fineTuneScale?: number;
    normalDeltaScale?: number;

    /**
     * Dead angle in degrees centered at the bottom of the knob (180°).
     * This part of the circle has no values. Default: 60°.
     */
    deadAngle?: number;

    /** Theme colors. */
    //theme?: KnobTheme;

    /** Disable interaction. */
    disabled?: boolean;

    /** Additional class name for outer container. */
    className?: string;
}

/**
 * Describe an SVG arc from startAngle to endAngle (degrees, 0° at top, CW).
 */
function describeArc(
    x: number,
    y: number,
    radius: number,
    startAngle: number,
    endAngle: number
): string {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const sweep = endAngle - startAngle;
    const largeArcFlag = Math.abs(sweep) <= 180 ? "0" : "1";
    const sweepFlag = sweep >= 0 ? "0" : "1"; // we’re using the “shorter” direction by default

    return [
        "M",
        start.x,
        start.y,
        "A",
        radius,
        radius,
        0,
        largeArcFlag,
        sweepFlag,
        end.x,
        end.y,
    ].join(" ");
}

export const Knob: React.FC<KnobProps> = ({
    value,
    onChange,
    min = 0,
    max = 1,
    step,
    defaultValue,
    centerValue,
    label,

    toUnit,
    fromUnit,

    formatValue,
    //parseValue, // currently unused, future double-click to type
    //size = 80,
    dragSensitivity = 150,
    fineTuneScale = 0.005,
    normalDeltaScale = 0.4,
    deadAngle = 70,
    //theme,
    disabled = false,
    className,
}) => {
    const [isDragging, setIsDragging] = useState(false);

    const dragStateRef = useRef<{
        startY: number;
        startUnit: number;
        lastShiftKey: boolean;
    } | null>(null);

    const minMaxFixed = useMemo(() => {
        // Avoid zero span; fall back to [0,1] if invalid.
        if (max === min) {
            return { min: 0, max: 1 };
        }
        return { min, max };
    }, [min, max]);

    //const decimals = useMemo(() => decimalsFromStep(step), [step]);

    const defaultVal = useMemo(() => {
        if (defaultValue != null) return defaultValue;
        return (minMaxFixed.min + minMaxFixed.max) / 2;
    }, [defaultValue, minMaxFixed]);

    const centerValExternal = useMemo(() => {
        if (centerValue != null) return centerValue;
        return (minMaxFixed.min + minMaxFixed.max) / 2;
    }, [centerValue, minMaxFixed]);

    const unitFromExternal = useCallback(
        (external: number): number => {
            let unit = toUnit
                ? toUnit(external)
                : (external - minMaxFixed.min) / (minMaxFixed.max - minMaxFixed.min);
            return clamp01(unit);
        },
        [toUnit, minMaxFixed]
    );

    const externalFromUnit = useCallback(
        (unit: number): number => {
            const clamped = clamp01(unit);
            const raw = fromUnit
                ? fromUnit(clamped)
                : minMaxFixed.min + clamped * (minMaxFixed.max - minMaxFixed.min);

            if (!step || step <= 0) {
                return clamp(raw, minMaxFixed.min, minMaxFixed.max);
            }

            const snapped =
                Math.round((raw - minMaxFixed.min) / step) * step + minMaxFixed.min;
            return clamp(snapped, minMaxFixed.min, minMaxFixed.max);
        },
        [fromUnit, minMaxFixed, step]
    );

    const unitValue = useMemo(() => unitFromExternal(value), [value, unitFromExternal]);
    const unitCenter = useMemo(
        () => unitFromExternal(centerValExternal),
        [centerValExternal, unitFromExternal]
    );

    // External-domain value corresponding to the current knob position.
    // This ensures the displayed label reflects min/max/step (and fromUnit) rather than 0–1.
    const valueExternalForDisplay = useMemo(
        () => externalFromUnit(unitValue),
        [externalFromUnit, unitValue]
    );

    // Angles for track & highlight.
    const sweepAngle = 360 - deadAngle;
    const startAngle = 180 + deadAngle / 2; // left-bottom edge of dead zone
    const endAngle = startAngle + sweepAngle; // clockwise sweep around top to right-bottom edge

    const valueAngle = startAngle + unitValue * sweepAngle;
    const centerAngle = startAngle + unitCenter * sweepAngle;


    const trackOuterRadius = 25;
    const trackWidth = 10; // i.e. track's inner radius is trackOuterRadius - trackWidth
    const thumbRadius = 6; // thumb will NOT have a stroke; it's just a filled circle

    // Derived geometry.
    // SVG strokes are centered on the arc radius. To make the *outer* edge land exactly at
    // trackOuterRadius, we draw the arc at the midpoint radius.
    const trackRadius = trackOuterRadius - trackWidth / 2;
    const boundsRadius = Math.max(trackOuterRadius, trackRadius + thumbRadius);
    const centerX = boundsRadius;
    const centerY = boundsRadius;

    const formattedValue = useMemo(() => {
        if (formatValue) return formatValue(valueExternalForDisplay);
        return valueExternalForDisplay.toFixed(2);
    }, [formatValue, valueExternalForDisplay]);

    const handlePointerDown = useCallback(
        (e: PointerEvent<SVGSVGElement>) => {
            if (disabled) return;

            // Ctrl+click (or Cmd+click on macOS) resets to default and does NOT start drag.
            if ((e.ctrlKey || e.metaKey) && defaultVal != null) {
                e.preventDefault();
                onChange(defaultVal);
                return;
            }

            const svg = e.currentTarget;
            svg.setPointerCapture(e.pointerId);
            e.preventDefault();

            dragStateRef.current = {
                startY: e.clientY,
                startUnit: unitValue,
                lastShiftKey: e.shiftKey,
            };
            setIsDragging(true);
        },
        [disabled, defaultVal, onChange, unitValue]
    );

    const handlePointerMove = useCallback(
        (e: PointerEvent<SVGSVGElement>) => {
            if (!isDragging || !dragStateRef.current || disabled) return;

            const state = dragStateRef.current;
            const dy = e.clientY - state.startY;

            // If the user toggles Shift mid-drag, re-baseline from the *current* value so
            // the knob doesn't jump back toward the drag-start value.
            if (state.lastShiftKey !== e.shiftKey) {
                const prevScale = state.lastShiftKey ? fineTuneScale : normalDeltaScale;
                const prevDeltaUnit = (-dy / dragSensitivity) * prevScale;
                const unitAtTransition = clamp01(state.startUnit + prevDeltaUnit);

                state.startY = e.clientY;
                state.startUnit = unitAtTransition;
                state.lastShiftKey = e.shiftKey;

                onChange(externalFromUnit(unitAtTransition));
                return;
            }

            const fineScale = e.shiftKey ? fineTuneScale : normalDeltaScale;
            const deltaUnit = (-dy / dragSensitivity) * fineScale; // drag up = increase value

            const nextUnit = clamp01(state.startUnit + deltaUnit);
            const nextExternal = externalFromUnit(nextUnit);

            onChange(nextExternal);
        },
        [
            isDragging,
            disabled,
            dragSensitivity,
            fineTuneScale,
            normalDeltaScale,
            unitValue,
            externalFromUnit,
            onChange,
        ]
    );

    const endDrag = useCallback(
        (e: PointerEvent<SVGSVGElement>) => {
            if (!isDragging) return;

            const svg = e.currentTarget;
            try {
                svg.releasePointerCapture(e.pointerId);
            } catch {
                // ignore if already released
            }

            dragStateRef.current = null;
            setIsDragging(false);
        },
        [isDragging]
    );

    const handlePointerUp = useCallback(
        (e: PointerEvent<SVGSVGElement>) => {
            if (!isDragging) return;
            e.preventDefault();
            endDrag(e);
        },
        [endDrag, isDragging]
    );

    const handlePointerLeave = useCallback(
        (e: PointerEvent<SVGSVGElement>) => {
            // Do not end drag on leave; pointer capture keeps events coming.
            // Only end if button is up.
            if (isDragging && e.buttons === 0) {
                endDrag(e);
            }
        },
        [endDrag, isDragging]
    );

    const thumbPos = useMemo(
        () => polarToCartesian(centerX, centerY, trackRadius, valueAngle),
        [centerX, centerY, trackRadius, valueAngle]
    );

    const activeHasLength = Math.abs(valueAngle - centerAngle) > 0.5;

    const trackPath = useMemo(
        () => describeArc(centerX, centerY, trackRadius, startAngle, endAngle),
        [centerX, centerY, trackRadius, startAngle, endAngle]
    );

    const highlightPath = useMemo(() => {
        if (!activeHasLength) return "";
        const a0 = centerAngle;
        const a1 = valueAngle;
        // Always draw from center towards value along the same direction as the main arc.
        return describeArc(centerX, centerY, trackRadius, a0, a1);
    }, [activeHasLength, centerAngle, valueAngle, centerX, centerY, trackRadius]);

    const ariaLabel = label ?? "Knob";

    return (
        <div className={`somatic-knob ${className || ""}`}>
            {/* Label */}
            {label && (
                <div className="somatic-knob-label">
                    {label}
                </div>
            )}

            {/* SVG knob */}
            <svg
                className="somatic-knob-svg"
                width={boundsRadius * 2}
                height={boundsRadius * 2}
                viewBox={`0 0 ${boundsRadius * 2} ${boundsRadius * 2}`}
                style={{ cursor: disabled ? "default" : "ns-resize", touchAction: "none" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                role="slider"
                aria-label={ariaLabel}
                aria-valuemin={minMaxFixed.min}
                aria-valuemax={minMaxFixed.max}
                aria-valuenow={valueExternalForDisplay}
                aria-disabled={disabled || undefined}
            >
                {/* Track arc */}
                <path
                    d={trackPath}
                    fill="none"
                    strokeWidth={trackWidth}
                    //strokeLinecap="round"
                    className="somatic-knob-track"
                />

                {/* Highlight arc from center value to current value */}
                {activeHasLength && (
                    <path
                        d={highlightPath}
                        fill="none"
                        className="somatic-knob-highlight"
                        strokeWidth={trackWidth}
                    //strokeLinecap="round"
                    />
                )}

                {/* Thumb */}
                <circle
                    cx={thumbPos.x}
                    cy={thumbPos.y}
                    r={thumbRadius}
                    className="somatic-knob-thumb"
                    stroke="none"
                />
            </svg>

            {/* Value text */}
            <div className="somatic-knob-value">
                {formattedValue}
            </div>
        </div>
    );
};
