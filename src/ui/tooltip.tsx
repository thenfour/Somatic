import React from 'react';
import { createPortal } from 'react-dom';

type TooltipProps = {
    title: React.ReactNode;
    children: React.ReactElement;
    /** Placement of the tooltip relative to the trigger. Default: 'bottom' */
    placement?: 'top' | 'bottom' | 'left' | 'right';
    /** Optional className for the tooltip content */
    className?: string;
    /** Disable the tooltip */
    disabled?: boolean;
};

export const Tooltip: React.FC<TooltipProps> = ({
    title,
    children,
    placement = 'bottom',
    className,
    disabled = false,
}) => {
    const triggerRef = React.useRef<HTMLElement | null>(null);
    const tooltipRef = React.useRef<HTMLSpanElement | null>(null);
    const [open, setOpen] = React.useState(false);
    const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);

    const updatePosition = React.useCallback(() => {
        const el = triggerRef.current;
        const tooltip = tooltipRef.current;
        if (!el) return;

        const rect = el.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Estimate tooltip dimensions (will be refined after first render)
        const tooltipWidth = tooltip?.offsetWidth || 320; // max-width from CSS
        const tooltipHeight = tooltip?.offsetHeight || 100; // estimated

        const margin = 8; // margin from viewport edge

        let top = 0;
        let left = 0;

        switch (placement) {
            case 'top':
                top = rect.top - 6;
                left = rect.left + rect.width / 2;
                break;
            case 'bottom':
                top = rect.bottom + 6;
                left = rect.left + rect.width / 2;
                break;
            case 'left':
                top = rect.top + rect.height / 2;
                left = rect.left - 6;
                break;
            case 'right':
                top = rect.top + rect.height / 2;
                left = rect.right + 6;
                break;
        }

        // Adjust horizontal position to stay within viewport
        if (placement === 'bottom' || placement === 'top') {
            // Centered horizontally, check both edges
            const halfWidth = tooltipWidth / 2;
            if (left - halfWidth < margin) {
                left = halfWidth + margin;
            } else if (left + halfWidth > viewportWidth - margin) {
                left = viewportWidth - halfWidth - margin;
            }
        } else if (placement === 'right') {
            // Right-aligned, check right edge
            if (left + tooltipWidth > viewportWidth - margin) {
                left = viewportWidth - tooltipWidth - margin;
            }
        } else if (placement === 'left') {
            // Left-aligned, check left edge
            if (left - tooltipWidth < margin) {
                left = tooltipWidth + margin;
            }
        }

        // Adjust vertical position to stay within viewport
        if (placement === 'left' || placement === 'right') {
            // Centered vertically, check both edges
            const halfHeight = tooltipHeight / 2;
            if (top - halfHeight < margin) {
                top = halfHeight + margin;
            } else if (top + halfHeight > viewportHeight - margin) {
                top = viewportHeight - halfHeight - margin;
            }
        } else if (placement === 'bottom') {
            // Below element, check bottom edge
            if (top + tooltipHeight > viewportHeight - margin) {
                top = viewportHeight - tooltipHeight - margin;
            }
        } else if (placement === 'top') {
            // Above element, check top edge
            if (top - tooltipHeight < margin) {
                top = margin + tooltipHeight;
            }
        }

        setCoords({ top, left });
    }, [placement]);

    React.useEffect(() => {
        if (!open) return;
        updatePosition();
        const handleScroll = () => updatePosition();
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleScroll);
        };
    }, [open, updatePosition]);

    // Update position after tooltip renders to get accurate dimensions
    React.useEffect(() => {
        if (open && tooltipRef.current) {
            // Small delay to ensure tooltip is rendered with content
            requestAnimationFrame(() => {
                updatePosition();
            });
        }
    }, [open, title, updatePosition]);

    // Clone the child element and attach event handlers
    const childElement = React.Children.only(children);

    const clonedChild = React.cloneElement(childElement, {
        ref: (node: HTMLElement | null) => {
            triggerRef.current = node;

            // Preserve any existing ref on the child
            const { ref } = childElement as any;
            if (typeof ref === 'function') {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        },
        onMouseEnter: (e: React.MouseEvent) => {
            if (!disabled) setOpen(true);
            childElement.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
            if (!disabled) setOpen(false);
            childElement.props.onMouseLeave?.(e);
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

    return (
        <>
            {clonedChild}
            {shouldShow && coords && createPortal(
                <span
                    ref={tooltipRef}
                    className={`generic-tooltip generic-tooltip--${placement} ${className || ''}`}
                    style={{ top: coords.top, left: coords.left }}
                >
                    {title}
                </span>,
                document.body,
            )}
        </>
    );
};
