import React, { createContext, useContext, useCallback } from 'react';
import { useToasts } from '../ui/toast_provider';

interface ClipboardContextType {
    copyObjectToClipboard: <T = any>(data: T) => Promise<void>;
    readObjectFromClipboard: <T = any>() => Promise<T>;
    copyTextToClipboard: (text: string) => Promise<void>;
    readTextFromClipboard: () => Promise<string>;
}

const ClipboardContext = createContext<ClipboardContextType | undefined>(undefined);

export const ClipboardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const toasts = useToasts();

    const copyObjectToClipboard = useCallback(async <T = any,>(data: T) => {
        const jsonString = JSON.stringify(data);
        await navigator.clipboard.writeText(jsonString);
        toasts.pushToast({ message: `Copied ${jsonString.length} chars to clipboard` });
    }, []);

    const readObjectFromClipboard = useCallback(async <T = any,>(): Promise<T> => {
        const text = await navigator.clipboard.readText();
        toasts.pushToast({ message: `Read ${text.length} chars from clipboard` });
        return JSON.parse(text) as T;
    }, []);

    const copyTextToClipboard = useCallback(async (text: string) => {
        await navigator.clipboard.writeText(text);
        toasts.pushToast({ message: `Copied ${text.length} chars to clipboard` });
    }, []);

    const readTextFromClipboard = useCallback(async (): Promise<string> => {
        const text = await navigator.clipboard.readText();
        toasts.pushToast({ message: `Read ${text.length} chars from clipboard` });
        return text;
    }, []);

    return (
        <ClipboardContext.Provider value={{ copyObjectToClipboard, readObjectFromClipboard, copyTextToClipboard, readTextFromClipboard }}>
            {children}
        </ClipboardContext.Provider>
    );
};

export const useClipboard = (): ClipboardContextType => {
    const context = useContext(ClipboardContext);
    if (!context) {
        throw new Error('useClipboard must be used within a ClipboardProvider');
    }
    return context;
};
