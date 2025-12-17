import React from 'react';
import { createPortal } from 'react-dom';

type HelpTooltipProps = {
    content: React.ReactNode;
    children: React.ReactNode;
    /** Optional aria-label override for the trigger wrapper. */
    label?: string;
    className?: string;
};

export const HelpTooltip: React.FC<HelpTooltipProps> = ({ content, children, label, className }) => {
    const triggerRef = React.useRef<HTMLSpanElement | null>(null);
    const [open, setOpen] = React.useState(false);
    const [coords, setCoords] = React.useState<{ top: number; left: number } | null>(null);

    const updatePosition = React.useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        setCoords({ top: rect.bottom + 6, left: rect.left });
    }, []);

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

    const triggerProps = {
        ref: triggerRef,
        tabIndex: 0,
        'aria-label': label,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
    } as const;

    return (
        <span className={`tooltip ${className || ''}`} role="note">
            <span className="tooltip-trigger" {...triggerProps}>
                {children}
            </span>
            {open && coords && createPortal(
                <span className="tooltip-content tooltip-content--portal" style={{ top: coords.top, left: coords.left }}>
                    {content}
                </span>,
                document.body,
            )}
        </span>
    );
};
