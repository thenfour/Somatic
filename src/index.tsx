import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClipboardProvider } from "./hooks/useClipboard";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { ShortcutManagerProvider, useExposeActiveScopesToWindow } from "./keyb/KeyboardShortcutManager";
import { ConfirmDialogProvider } from "./ui/confirm_dialog";
import { Theme } from "./ui/theme_editor_panel";
import { ToastProvider } from "./ui/toast_provider";
import { App } from "./Somatic";
import { gActionRegistry } from "./keyb/ActionRegistry";

// just a splash which requires user gesture to continue (so the audio context etc are allowed to start)
const SplashScreen: React.FC<{ onContinue: () => void }> = ({ onContinue }) => (
    <div className="splash-screen" onClick={onContinue} onKeyDown={onContinue}>
        <h1>Somatic</h1>
        <div className='subtitle subtitle1'>A tracker for TIC-80</div>
        <div className='subtitle subtitle2'>By tenfour</div>
        <button className='clickToContinueButton' style={{ pointerEvents: 'none' }}>Click to Continue</button>
    </div>
);

function ShortcutRuntimeBridge() {
    useExposeActiveScopesToWindow();
    return null;
}

// just wrapps <App /> to gate on user gesture via splash screen
const AppWrapper: React.FC = () => {
    const [hasContinued, setHasContinued] = useState(false);
    const [theme, setTheme] = useLocalStorage<Theme>('somatic-theme', 'light');

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
        <ShortcutManagerProvider actions={gActionRegistry} initialBindings={keyBindings} onBindingsChange={setKeyBindings}>
            <ShortcutRuntimeBridge />
            <ToastProvider>
                <ConfirmDialogProvider>
                    <ClipboardProvider>
                        {hasContinued
                            ? <App theme={theme} onToggleTheme={toggleTheme} />
                            : <SplashScreen onContinue={() => setHasContinued(true)} />}
                    </ClipboardProvider>
                </ConfirmDialogProvider>
            </ToastProvider>
        </ShortcutManagerProvider>
    );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(<AppWrapper />);
