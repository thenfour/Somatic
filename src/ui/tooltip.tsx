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
    const [open, setOpen] = React.useState(false);
    const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);

    const updatePosition = React.useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();

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
