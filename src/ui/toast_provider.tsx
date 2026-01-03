import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { typedValues } from '../utils/utils';
import './toasts.css';

export type ToastVariant = 'info' | 'success' | 'error';

export type ToastOptions = {
    message: string;
    variant?: ToastVariant;
    durationMs?: number;
};

type Toast = Required<ToastOptions> & { id: string };

type ToastContextValue = {
    pushToast: (opts: ToastOptions | string) => string;
    removeToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3500;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timeoutsRef = useRef<Record<string, number>>({});

    const removeToast = useCallback((id: string) => {
        const timeoutId = timeoutsRef.current[id];
        if (timeoutId) {
            window.clearTimeout(timeoutId);
            delete timeoutsRef.current[id];
        }
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const pushToast = useCallback((opts: ToastOptions | string) => {
        const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const toast: Toast = {
            id,
            message: typeof opts === "string" ? opts : opts.message,
            variant: typeof opts === "string" ? "info" : opts.variant ?? 'info',
            durationMs: typeof opts === "string" ? DEFAULT_DURATION : opts.durationMs ?? DEFAULT_DURATION,
        };
        setToasts((prev) => [...prev, toast]);
        if (toast.durationMs > 0 && Number.isFinite(toast.durationMs)) {
            timeoutsRef.current[id] = window.setTimeout(() => removeToast(id), toast.durationMs);
        }
        return id;
    }, [removeToast]);

    useEffect(() => {
        return () => {
            typedValues(timeoutsRef.current).forEach((id) => window.clearTimeout(id));
        };
    }, []);

    const value = useMemo(() => ({ pushToast, removeToast }), [pushToast, removeToast]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="toast-viewport" aria-live="polite" aria-atomic="false">
                {toasts.map((toast) => (
                    <div
                        key={toast.id}
                        className={`toast toast--${toast.variant}`}
                        role="status"
                    >
                        <div className="toast__stripe" aria-hidden="true" />
                        <div className="toast__body">
                            <div className="toast__message">{toast.message}</div>
                            <button
                                className="toast__close"
                                onClick={() => removeToast(toast.id)}
                                aria-label="Dismiss notification"
                                type="button"
                            >
                                x
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

export const useToasts = (): ToastContextValue => {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToasts must be used within a ToastProvider');
    return ctx;
};
