import React from "react";

import { useLocalStorage } from "./useLocalStorage";

export type DebugModeContextValue = {
    debugMode: boolean;
    setDebugMode: React.Dispatch<React.SetStateAction<boolean>>;
    toggleDebugMode: () => void;
};

const DebugModeContext = React.createContext<DebugModeContextValue | null>(null);

export const DebugModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    // Persisted preference, but provided via context so it can be consumed "almost anywhere".
    const [debugMode, setDebugMode] = useLocalStorage("somatic-debugMode", false);

    const toggleDebugMode = React.useCallback(() => {
        setDebugMode((d) => !d);
    }, [setDebugMode]);

    const value = React.useMemo<DebugModeContextValue>(() => ({
        debugMode,
        setDebugMode,
        toggleDebugMode,
    }), [debugMode, setDebugMode, toggleDebugMode]);

    return (
        <DebugModeContext.Provider value={value}>
            {children}
        </DebugModeContext.Provider>
    );
};

export function useDebugMode(): DebugModeContextValue {
    const ctx = React.useContext(DebugModeContext);
    if (!ctx) {
        throw new Error("useDebugMode must be used within <DebugModeProvider>");
    }
    return ctx;
}
