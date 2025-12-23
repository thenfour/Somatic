import React from 'react';
import { useToasts } from './toast_provider';
import './theme_editor_panel.css';
import { typedEntries, typedValues } from '../utils/utils';

const PALETTE_KEYS = Array.from({ length: 16 }, (_, i) => `--tic-${i}`);
const PALETTE_CONTRAST_KEYS = PALETTE_KEYS.map((k) => `${k}-contrast`);

export type Theme = 'light' | 'dark';

const THEME_VARS = {
    "General": [
        '--bg',
        '--panel',
        '--panel-strong',
        '--text',
        '--muted',
        '--border',
        '--border-strong',
        '--accent',
        '--accent-strong',
        '--row-a',
        '--row-b',
        '--row-active',
        '--tooltip-bg',
        '--tooltip-text',
        '--success-accent',
        '--error-accent',
        '--error-surface-bg',
        '--error-surface-text',
        '--error-surface-border',
        '--edit-border',
        '--cell-note',
        '--cell-instrument',
        '--cell-command',
        '--cell-param',
    ],
    "Keyboard": [
        '--keyboard-white-key',
        '--keyboard-black-key',
        '--keyboard-white-text',
        '--keyboard-black-text',
    ],
    "Waveform Editor": [
        '--waveform-edit-background',
        '--waveform-edit-grid-line',
        '--waveform-edit-loop-line',
        '--waveform-edit-point',
        '--waveform-edit-coordinate-text',
        '--waveform-edit-highlight',
        '--waveform-swatch-normal-background',
        '--waveform-swatch-normal-point',
        '--waveform-swatch-muted-background',
        '--waveform-swatch-muted-point',
        '--waveform-swatch-highlighted-background',
        '--waveform-swatch-highlighted-point',
        '--waveform-swatch-highlighted-border',
    ],
    "Channel Header": [
        '--channel-header-button-bg',
        '--channel-header-button-hover-bg',
        '--mute-button-label',
        '--solo-button-label',
        '--mute-button-active-bg',
        '--solo-button-active-bg',
        '--mute-button-active-label',
        '--solo-button-active-label',
    ],

} as const;

function readCssVar(name: string, target: HTMLElement = document.documentElement): string {
    const val = getComputedStyle(target).getPropertyValue(name) || '';
    return val.trim();
}

export const PaletteSwatch: React.FC<{ color: string; }> = ({ color }) => {
    const onDragStart = (event: React.DragEvent<HTMLDivElement>) => {
        event.dataTransfer.setData('application/json', color);
        event.dataTransfer.setData('text/plain', color);
    };

    const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        // Allow dropping by preventing the default behavior
        event.preventDefault();
    };

    return (
        <div
            className="theme-panel__swatch"
            style={{ background: color }}
            draggable
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            title={color}
            aria-label={color}
        />
    );
};

export const ThemeEditorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { pushToast } = useToasts();

    // get all the theme variable names
    const themeKeys = typedValues(THEME_VARS).flat();

    const [values, setValues] = React.useState<Record<string, string>>(() => {
        const obj: Record<string, string> = {};
        for (const key of [...PALETTE_KEYS, ...PALETTE_CONTRAST_KEYS, ...themeKeys]) {
            obj[key] = readCssVar(key);
        }
        return obj;
    });

    const applyVar = React.useCallback((name: string, value: string) => {
        document.documentElement.style.setProperty(name, value);
        setValues((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDrop = (ev: React.DragEvent<HTMLButtonElement>, varName: string) => {
        ev.preventDefault();
        const color = ev.dataTransfer.getData('application/x-somatic-color') || ev.dataTransfer.getData('text/plain');
        if (!color) return;
        applyVar(varName, color);
    };

    const handleDragOver = (ev: React.DragEvent) => {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'copy';
    };

    const paletteContrastMap = React.useMemo(() => {
        const m = new Map<string, string>();
        for (let i = 0; i < PALETTE_KEYS.length; i++) {
            const base = values[PALETTE_KEYS[i]];
            const contrast = values[PALETTE_CONTRAST_KEYS[i]];
            if (base && contrast) m.set(base, contrast);
        }
        return m;
    }, [values]);

    const getForegroundForValue = (val: string) => paletteContrastMap.get(val) || '#000';

    const handleCopy = async () => {
        const lines = [...themeKeys].map((name) => `${name}: ${values[name]};`);
        const css = lines.join('\n  ') + '\n';
        try {
            await navigator.clipboard.writeText(css);
            pushToast({ message: 'Theme variables copied to clipboard', variant: 'success' });
            console.log('Theme variables copied to clipboard');
        } catch (err) {
            pushToast({ message: 'Copy failed', variant: 'error' });
        }
    };

    return (
        <div className="theme-panel app-panel" role="dialog" aria-label="Theme editor">
            <h2>Theme Editor</h2>
            <p>Drag a palette swatch onto a variable to assign it. Export copies current vars.</p>

            <div className="theme-panel__palette" aria-label="TIC-80 palette">
                {PALETTE_KEYS.map((key) => (
                    <PaletteSwatch
                        key={key}
                        color={values[key]}
                    />
                ))}
            </div>

            <div className="theme-panel__vars" aria-label="Theme variables">

                {typedEntries(THEME_VARS).map(([sectionName, varNames]) => (
                    <div key={sectionName} className="theme-panel__var-section">
                        <h3>{sectionName}</h3>
                        {varNames.map((name) => (
                            <button
                                key={name}
                                className="theme-panel__var"
                                onDragOver={handleDragOver}
                                onDrop={(ev) => handleDrop(ev, name)}
                                style={{ background: values[name], color: getForegroundForValue(values[name]) }}
                                title={`${name} ${values[name]} (drop a swatch to change)`}
                            >
                                <span className="theme-panel__var-name">{name}</span>
                                <span className="theme-panel__var-value">{values[name]}</span>
                            </button>
                        ))}
                    </div>
                ))
                }

                {/* {THEME_VARS.map((name) => (
                    <button
                        key={name}
                        className="theme-panel__var"
                        onDragOver={handleDragOver}
                        onDrop={(ev) => handleDrop(ev, name)}
                        style={{ background: values[name], color: getForegroundForValue(values[name]) }}
                        title={`${name} ${values[name]} (drop a swatch to change)`}
                    >
                        <span className="theme-panel__var-name">{name}</span>
                        <span className="theme-panel__var-value">{values[name]}</span>
                    </button>
                ))} */}
            </div>

            <div className="theme-panel__actions">
                <button onClick={() => pushToast({ message: 'Example toast success', variant: 'success' })}>Example Toast success</button>
                <button onClick={() => pushToast({ message: 'Example toast error', variant: 'error' })}>Example Toast error</button>
                <span className='menu-separator'></span>
                <button onClick={handleCopy}>Copy CSS</button>
                <button onClick={onClose}>Close</button>
            </div>
        </div>
    );
};
