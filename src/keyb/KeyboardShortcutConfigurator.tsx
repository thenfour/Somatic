import React from "react";
import { useShortcutManager } from "./KeyboardShortcutManager";
import { useChordCapture } from "./useChordCapture";
import { ActionId, Actions } from "./ActionIds";
import { formatChord } from "./format";
import { gActionRegistry, kAllActions } from "./ActionRegistry";
import "./KeyboardShortcutConfigurator.css";

export function BindingEditorRow({ actionId }: { actionId: ActionId }) {
    const mgr = useShortcutManager();
    const capture = useChordCapture({ kind: "character", platform: mgr.platform });

    React.useEffect(() => {
        if (!capture.capturing) return;

        const onAnyKey = (e: KeyboardEvent) => {
            const chord = capture.captureFromEvent(e);
            if (!chord) return;

            mgr.setUserBindings(prev => ({
                ...prev,
                [actionId]: [chord],
            }));

            capture.setCapturing(false);
        };

        document.addEventListener("keydown", onAnyKey, true);
        return () => document.removeEventListener("keydown", onAnyKey, true);
    }, [capture, mgr, actionId]);

    const handleResetToDefault = React.useCallback(() => {
        mgr.setUserBindings(prev => {
            const newBindings = { ...prev };
            delete newBindings[actionId];
            return newBindings;
        });
    }, [mgr, actionId]);

    const defaultBindings = gActionRegistry[actionId].defaultBindings;

    return (<div className="keyboard-binding-row">
        <span>{actionId}</span>
        {mgr.userBindings[actionId]?.map(chord => formatChord(chord, mgr.platform)).join(", ") || "<none>"}
        <button onClick={() => capture.setCapturing(true)}>
            Rebind…
        </button>
        <button onClick={() => handleResetToDefault}>
            Reset to Default {defaultBindings ? `(${formatChord(defaultBindings[mgr.platform]?.[0]!, mgr.platform)})` : ""}
        </button>
    </div>
    );
}

export const KeyboardShortcutConfigurator: React.FC<{}> = () => {

    const allCategories = new Set(kAllActions.map(action => action.category));

    return <div className="keyboard-shortcut-configurator">
        <h3>Keyboard Shortcuts</h3>
        {Array.from(allCategories).map(category => (
            <div key={category} style={{ marginBottom: 16 }}>
                <h4>{category}</h4>
                {kAllActions.filter(action => action.category === category).map(action => (
                    <BindingEditorRow key={action.id} actionId={action.id} />
                ))}
            </div>
        ))}
    </div>;
};

