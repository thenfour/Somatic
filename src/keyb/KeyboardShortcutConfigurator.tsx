import React from "react";
import { Tooltip } from "../ui/tooltip";
import { assert, CharMap } from "../utils/utils";
import { ActionId, kAllActionIds } from "./ActionIds";
import { gActionRegistry, kAllActions } from "./ActionRegistry";
import { formatChord } from "./format";
import "./KeyboardShortcutConfigurator.css";
import { useShortcutManager } from "./KeyboardShortcutManager";
import { isSameChord, ShortcutChord } from "./KeyboardShortcutTypes";
import { useChordCapture } from "./useChordCapture";
import { useConfirmDialog } from "../ui/confirm_dialog";
import { useToasts } from "../ui/toast_provider";

interface KeyboardChordRowProps {
    chord: ShortcutChord | null;
    actionId: ActionId;
    onRemove?: () => void;
}

function KeyboardChordRow({ chord, actionId, onRemove }: KeyboardChordRowProps) {
    const mgr = useShortcutManager();

    // find if this chord is used by another action.
    const allBindings = mgr.getResolvedBindings();
    const conflicts: ActionId[] = [];
    if (chord !== null) {
        for (const otherActionId of kAllActionIds) {
            if (otherActionId === actionId) continue;
            const bindingsForOtherAction = allBindings[otherActionId] || [];
            if (bindingsForOtherAction.some(b => isSameChord(b, chord))) {
                conflicts.push(otherActionId);
            }
        }
    }

    return <span className="keyboard-binding-chord">
        <Tooltip title={JSON.stringify(chord)}>
            <span className="keyboard-binding-chord__label">
                {chord === null ? "Unbound" : formatChord(chord, mgr.platform)}
            </span>
        </Tooltip>
        {conflicts.length > 0 && <Tooltip title={<>
            This binding is also used by:<br />
            {conflicts.map(aid => <div key={aid}>{aid}</div>)}
        </>}>
            <span className="keyboard-binding-chord__conflict" title="This binding conflicts with another action!">⚠️</span>
        </Tooltip>}
        <button
            className={`keyboard-binding-row__button ${!onRemove ? 'keyboard-binding-row__button--disabled' : ''}`}
            onClick={onRemove}
            title="remove this binding"
            disabled={!onRemove}
        >
            {CharMap.Mul}
        </button>
    </span>;
}


function BindingEditorRow({ actionId }: { actionId: ActionId }) {
    const mgr = useShortcutManager();
    const toast = useToasts();
    const capture = useChordCapture({ kind: "character", platform: mgr.platform });

    React.useEffect(() => {
        if (!capture.capturing) return;

        const onAnyKey = (e: KeyboardEvent) => {
            const chord = capture.captureFromEvent(e);
            if (!chord) return;

            const existingBindings = mgr.userBindings[actionId] ?? [];

            // avoid dupes.
            if (existingBindings.some(b => isSameChord(b, chord))) {
                toast.pushToast({
                    variant: "error",
                    message: "This shortcut is already assigned to this action.",
                }
                );
                return;
            }

            mgr.setUserBindings(prev => ({
                ...prev,
                [actionId]: [...existingBindings, chord],
            }));

            capture.setCapturing(false);
        };

        document.addEventListener("keydown", onAnyKey, true);
        return () => document.removeEventListener("keydown", onAnyKey, true);
    }, [capture, mgr, actionId]);

    const handleResetToDefault = React.useCallback(() => {
        mgr.setUserBindings(prev => {
            const next = { ...prev };
            delete next[actionId];
            return next;
        });
    }, [mgr, actionId]);

    const handleUnbind = React.useCallback(() => {
        mgr.setUserBindings(prev => ({
            ...prev,
            [actionId]: null,
        }));
    }, [mgr, actionId]);

    const handleRemoveBinding = React.useCallback((chord: ShortcutChord | null) => {
        assert(chord !== null);
        const existingBindings = mgr.userBindings[actionId] ?? [];
        const newBindings = existingBindings.filter(b => !isSameChord(b, chord));
        mgr.setUserBindings(prev => ({ ...prev, [actionId]: newBindings }));
    }, [mgr, actionId]);


    const currentBindings = mgr.userBindings[actionId] || [];//?.map(chord => formatChord(chord, mgr.platform)).join(", ");
    const isCustomized = mgr.userBindings[actionId] !== undefined; // null = unbound, undefined = default
    const isUnbound = mgr.userBindings[actionId] === null;
    const isDefault = !isCustomized;
    const defaultBindings = mgr.actions[actionId].defaultBindings || [];

    return (<div className="keyboard-binding-row">
        <Tooltip title={<>
            <strong>{gActionRegistry[actionId].title}</strong><br />
            <p>{gActionRegistry[actionId].description || ""}</p>
        </>}>
            <span className="keyboard-binding-row__label">
                {actionId}
            </span>
        </Tooltip>
        <span className={`keyboard-binding-row__binding ${!currentBindings.length ? 'keyboard-binding-row__binding--empty' : ''}`}>
            {isUnbound && <span className="keyboard-binding-row__binding--placeholder">
                <KeyboardChordRow chord={null} actionId={actionId} />
            </span>}

            {isDefault && (defaultBindings.length > 0) && <span className="keyboard-binding-row__binding--placeholder">
                {defaultBindings.map((chord, i) => <KeyboardChordRow key={i} chord={chord} actionId={actionId} onRemove={handleUnbind} />)}
            </span>}

            {currentBindings.length > 0 && (
                currentBindings.map((chord, i) => <KeyboardChordRow key={i} chord={chord} actionId={actionId} onRemove={() => handleRemoveBinding(chord)} />)
            )}
        </span>
        <span className={`keyboard-binding-row-controls`}>
            <button
                className={`keyboard-binding-row__button ${capture.capturing ? 'keyboard-binding-row__button--capturing' : ''}`}
                onClick={() => capture.setCapturing(!capture.capturing)}
            >
                {capture.capturing ? "Press key..." : `${CharMap.Plus} binding`}
            </button>
            {/* unbind button */}
            {/* <button
                className={`keyboard-binding-row__button ${isUnbound ? 'keyboard-binding-row__button--disabled' : ''}`}
                onClick={handleUnbind}
                title={"Unbind all shortcuts for this action"}
            >   Unbind</button> */}

            <Tooltip title={isDefault ? "This action is using the default bindings." : `Reset this action's bindings to the default (${defaultBindings.map(b => formatChord(b, mgr.platform)).join(", ") || "unbound"} ).`}>
                <button
                    className={`keyboard-binding-row__button ${isCustomized ? '' : 'keyboard-binding-row__button--disabled'}`}
                    onClick={handleResetToDefault}
                    title={"Reset to default"}
                >
                    Reset to default
                </button>
            </Tooltip>
        </span>
    </div>
    );
}

export const KeyboardShortcutConfigurator: React.FC<{}> = () => {
    const confirm = useConfirmDialog();
    const mgr = useShortcutManager();
    const allCategories = new Set(kAllActions.map(action => action.category));

    const onResetAllToDefaults = React.useCallback(async () => {
        if (!await confirm.confirm({ content: "Reset all keyboard shortcuts to their default bindings?" })) {
            return;
        }
        mgr.setUserBindings({});
    }, []);

    return <div className="keyboard-shortcut-configurator">
        <section>
            <h3>Keyboard Shortcuts</h3>
            <button onClick={onResetAllToDefaults}>Reset all to defaults</button>
            {Array.from(allCategories).map(category => (
                <div key={category} className="keyboard-shortcut-category">
                    <h4>{category}</h4>
                    {kAllActions.filter(action => action.category === category).map(action => (
                        <BindingEditorRow key={action.id} actionId={action.id} />
                    ))}
                </div>
            ))}
        </section>
    </div>;
};

