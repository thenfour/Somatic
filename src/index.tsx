import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./Somatic";
import { StatusBarProvider } from "./hooks/useAppStatusBar";
import { ClipboardProvider } from "./hooks/useClipboard";
import { DebugModeProvider } from "./hooks/useDebugMode";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { gActionRegistry } from "./keyb/ActionRegistry";
import { ShortcutManagerProvider } from "./keyb/KeyboardShortcutManager";
import { applySweetie16CssVars } from "./theme/ticPalette";
import { ConfirmDialogProvider } from "./ui/basic/confirm_dialog";
import { FocusHistoryProvider } from "./ui/basic/restoreFocus";
import { Theme } from "./ui/theme_editor_panel";
import { ToastProvider } from "./ui/toast_provider";

// Apply TIC-80 palette + contrast CSS vars from code, as early as possible
(() => {
    applySweetie16CssVars(document.documentElement.style);
})();

// just a splash which requires user gesture to continue (so the audio context etc are allowed to start)
const SplashScreen: React.FC<{ onContinue: () => void }> = ({ onContinue }) => {
    const title = "SOMATIC";
    const PALETTE_SIZE = 16;
    const CYCLE_INTERVAL_MS = 150;
    const [cycleIndex, setCycleIndex] = useState(0);

    React.useEffect(() => {
        document.addEventListener("keydown", onContinue, true);
        return () => document.removeEventListener("keydown", onContinue, true);
    }, [onContinue]);

    // split into letters; each letter wrapped in a span for potential future animation
    const letters = title.split("").map((letter, index) => {
        const letterIndex = ((index + cycleIndex) % PALETTE_SIZE) + 1;
        return <span key={index} className="splash-screen__letter" style={{ "color": `var(--tic-${letterIndex})` } as React.CSSProperties}>
            {letter}
        </span>
    });

    // split into letters; each letter wrapped in a span for potential future animation
    const bgletters = title.split("").map((letter, index) => {
        const letterIndex = ((index + cycleIndex) % PALETTE_SIZE) + 1;
        return <span key={index} className="splash-screen__letter" style={{ "color": `var(--text)` } as React.CSSProperties}>
            {letter}
        </span>
    });

    useEffect(() => {
        const interval = setInterval(() => {
            setCycleIndex((cycleIndex + 1) % PALETTE_SIZE);
        }, CYCLE_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [cycleIndex]);

    return <div className="splash-screen" onClick={onContinue} onKeyDown={onContinue}>
        <h1 style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 6, left: 6, zIndex: 0 }}>
                {bgletters}
            </div>
            <div style={{ position: "relative", zIndex: 1 }}>
                {letters}
            </div>
        </h1>
        <div className='subtitle subtitle1'>A tracker for TIC-80</div>
        <button className='clickToContinueButton' style={{ pointerEvents: 'none' }}>Click to Continue</button>
    </div>;
};

// just wrapps <App /> to gate on user gesture via splash screen
const AppWrapper: React.FC = () => {
    const [hasContinued, setHasContinued] = useState(false);
    const [theme, setTheme] = useLocalStorage<Theme>('somatic-theme', 'dark');

    useEffect(() => {
        const el = document.documentElement;
        if (!el) return;
        if (theme === 'dark') {
            el.classList.add('theme-dark');
        } else {
            el.classList.remove('theme-dark');
        }
    }, [theme]);

    const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

    const [keyBindings, setKeyBindings] = useLocalStorage('somatic-keybindings', {});

    return (
        <ShortcutManagerProvider
            name="GlobalShortcuts"
            actions={gActionRegistry}
            initialBindings={keyBindings}
            onBindingsChange={setKeyBindings}
            attachTo={document}
        >
            <FocusHistoryProvider>
                <ToastProvider>
                    <ConfirmDialogProvider>
                        <ClipboardProvider>
                            <StatusBarProvider>
                                <DebugModeProvider>
                                    {hasContinued
                                        ? <App theme={theme} onToggleTheme={toggleTheme} />
                                        : <SplashScreen onContinue={() => setHasContinued(true)} />}
                                </DebugModeProvider>
                            </StatusBarProvider>
                        </ClipboardProvider>
                    </ConfirmDialogProvider>
                </ToastProvider>
            </FocusHistoryProvider>
        </ShortcutManagerProvider>
    );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<AppWrapper />);
