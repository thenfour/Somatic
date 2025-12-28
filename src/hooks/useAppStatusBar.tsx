import React, { createContext, useContext, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';

type StatusBarMessage = {
    id: string;
    content: string;
    priority: number; // Higher priority messages take precedence
};

// Lightweight external store so message updates do not force the whole app tree to re-render.
type Listener = () => void;
const listeners = new Set<Listener>();
let messageMap: Map<string, StatusBarMessage> = new Map();

const notify = () => {
    listeners.forEach((fn) => fn());
};

const computeCurrentMessage = (msgs: Map<string, StatusBarMessage>): string | null => {
    if (msgs.size === 0) return null;
    const highest = Array.from(msgs.values()).reduce<StatusBarMessage | null>((acc, msg) => {
        if (!acc || msg.priority > acc.priority) return msg;
        return acc;
    }, null);
    return highest?.content ?? null;
};

const getSnapshot = () => computeCurrentMessage(messageMap);
const subscribe = (listener: Listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const setMessageInternal = (id: string, content: string, priority: number = 0) => {
    const next = new Map(messageMap);
    next.set(id, { id, content, priority });
    messageMap = next;
    notify();
};

const clearMessageInternal = (id: string) => {
    if (!messageMap.has(id)) return;
    const next = new Map(messageMap);
    next.delete(id);
    messageMap = next;
    notify();
};

type StatusBarContextType = {
    setMessage: (id: string, content: string, priority?: number) => void;
    clearMessage: (id: string) => void;
};

const StatusBarContext = createContext<StatusBarContextType | null>(null);

export const StatusBarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const value = useMemo<StatusBarContextType>(() => ({
        setMessage: setMessageInternal,
        clearMessage: clearMessageInternal,
    }), []);

    return (
        <StatusBarContext.Provider value={value}>
            {children}
        </StatusBarContext.Provider>
    );
};

export const useAppStatusBar = () => {
    const context = useContext(StatusBarContext);
    if (!context) {
        throw new Error('useAppStatusBar must be used within a StatusBarProvider');
    }

    const idRef = useRef<string>(`status-${Math.random().toString(36).substr(2, 9)}`);

    // subscribe to external global store so status bar can render statically.
    const currentMessage = useSyncExternalStore(subscribe, getSnapshot);

    const setMessage = useCallback((content: string, priority?: number) => {
        context.setMessage(idRef.current, content, priority);
    }, [context]);

    const clearMessage = useCallback(() => {
        context.clearMessage(idRef.current);
    }, [context]);

    useEffect(() => {
        return () => {
            context.clearMessage(idRef.current);
        };
    }, [context]);

    return { setMessage, clearMessage, currentMessage };
};
