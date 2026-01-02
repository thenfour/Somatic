import React from 'react';
import { useToasts } from './toast_provider';
import './theme_editor_panel.css';
import { typedEntries, typedValues } from '../utils/utils';
import { AppPanelShell } from './AppPanelShell';

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
        '--cell-somatic-command',
        '--cell-somatic-param',
    ],
    "Keyboard": [
        '--keyboard-white-key',
        '--keyboard-black-key',
        '--keyboard-white-text',
        '--keyboard-black-text',
    ],
    "transport": [
        '--transport-time-bg',
        '--transport-time-fg',
        '--transport-time-fg-subtle',
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
    "Song Order Marker": [
        '--marker-default',
        '--marker-star',
        '--marker-question',
        '--marker-exclamation',
        '--marker-trash',
        '--marker-check',
        '--marker-blank',
        '--marker-asterisk',
        '--marker-up',
        '--marker-circle1',
        '--marker-circle2',
        '--marker-circle3',
        '--marker-circle4',
        '--marker-heart',
        '--marker-diamond',
        '--marker-club',
        '--marker-spade',
    ],
    "Arrangement Thumbnails": [
        '--arr-thumb-bg',
        '--arr-thumb-fill',
        '--arr-thumb-highlight',
        '--arr-thumb-border',
    ],

} as const;

type PaletteSwatchProps = {
    color: string;
    contrast?: string;
};

const PaletteSwatch: React.FC<PaletteSwatchProps> = ({ color, contrast }) => {
    const onDragStart = (ev: React.DragEvent<HTMLDivElement>) => {
        ev.dataTransfer.effectAllowed = 'copy';
        ev.dataTransfer.setData('application/x-somatic-color', color);
        ev.dataTransfer.setData('text/plain', color);
    };

    return (
        <div
            //type="button"
            className="theme-panel__swatch"
            draggable
            onDragStart={onDragStart}
            style={{ background: color, color: contrast || '#000' }}
            title={`Drag to apply ${color}`}
        >
            {/* {color} */}
        </div>
    );
};

const readCssVar = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

export const ThemeEditorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { pushToast } = useToasts();

    const themeKeys = React.useMemo(() => typedValues(THEME_VARS).flat(), []);
    const [values, setValues] = React.useState<Record<string, string>>(() => {
        const style = getComputedStyle(document.documentElement);
        const allVars = [...PALETTE_KEYS, ...PALETTE_CONTRAST_KEYS, ...themeKeys];
        const entries = allVars.map((name) => [name, readCssVar(style, name)] as const);
        return Object.fromEntries(entries);
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
        } catch (err) {
            pushToast({ message: 'Copy failed', variant: 'error' });
        }
    };

    return (
        <AppPanelShell
            className="theme-panel"
            role="dialog"
            ariaLabel="Theme editor"
            title="Theme Editor"
            actions={(
                <>
                    <button type="button" onClick={handleCopy}>Export CSS vars</button>
                    <button type="button" onClick={onClose}>Close</button>
                </>
            )}
            headerExtra={<>
                <p>Drag a palette swatch onto a variable to assign it. Export copies current vars.</p>
                <div className="theme-panel__palette" aria-label="TIC-80 palette">
                    {PALETTE_KEYS.map((key, i) => (
                        <PaletteSwatch
                            key={key}
                            color={values[key]}
                            contrast={values[PALETTE_CONTRAST_KEYS[i]]}
                        />
                    ))}
                </div>
            </>
            }
        >

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
                ))}
            </div>
        </AppPanelShell>
    );
};
