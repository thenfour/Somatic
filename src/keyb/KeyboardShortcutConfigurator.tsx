import React from "react";
import { Tooltip } from "../ui/basic/tooltip";
import { assert, CharMap, matchesFilter } from "../utils/utils";
import { GlobalActionId, kAllActionIds } from "./ActionIds";
import { gActionRegistry, kAllActions } from "./ActionRegistry";
import { formatChord } from "./format";
import "./KeyboardShortcutConfigurator.css";
import { useShortcutManager } from "./KeyboardShortcutManager";
import { deserializeUserBindings, isSameChord, serializeUserBindings, ShortcutChord } from "./KeyboardShortcutTypes";
import { useChordCapture } from "./useChordCapture";
import { useConfirmDialog } from "../ui/basic/confirm_dialog";
import { useToasts } from "../ui/toast_provider";
import { useClipboard } from "../hooks/useClipboard";

interface KeyboardChordRowProps {
    chord: ShortcutChord | null;
    actionId: GlobalActionId;
    onRemove?: () => void;
}

function KeyboardChordRow({ chord, actionId, onRemove }: KeyboardChordRowProps) {
    const mgr = useShortcutManager();

    // find if this chord is used by another action.
    const allBindings = mgr.getResolvedBindings();
    const conflicts: GlobalActionId[] = [];
    if (chord !== null) {
        for (const otherActionId of kAllActionIds) {
            if (otherActionId === actionId) continue;
            const bindingsForOtherAction = allBindings[otherActionId] || [];
            if (bindingsForOtherAction.some(b => isSameChord(b, chord))) {
                conflicts.push(otherActionId);
            }
        }
    }

    const isPhysical = chord?.kind === "physical";

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
        {isPhysical && (
            <Tooltip title="Physical key binding (layout-agnostic)">
                <span className="keyboard-binding-chord__kindBadge">Phys</span>
            </Tooltip>
        )}
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


function BindingEditorRow({ actionId }: { actionId: GlobalActionId }) {
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
            <strong>{gActionRegistry[actionId].title || actionId}</strong><br />
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
    const clipboard = useClipboard();
    const toast = useToasts();
    const mgr = useShortcutManager();
    const [filter, setFilter] = React.useState("");
    const allCategories = new Set(kAllActions.map(action => action.category));

    const onResetAllToDefaults = React.useCallback(async () => {
        if (!await confirm.confirm({ content: "Reset all keyboard shortcuts to their default bindings?" })) {
            return;
        }
        mgr.setUserBindings({});
    }, []);

    const onCopyCurrentShortcutsToClipboard = React.useCallback(async () => {
        const shortcuts = serializeUserBindings(mgr.userBindings);
        await clipboard.copyObjectToClipboard(shortcuts);
    }, [mgr, clipboard]);

    const onPasteShortcutsFromClipboard = React.useCallback(async () => {
        if (!await confirm.confirm({ content: "Paste keyboard shortcuts from clipboard? This will overwrite your current bindings." })) {
            return;
        }
        const dto = await clipboard.readObjectFromClipboard();
        mgr.setUserBindings(deserializeUserBindings(dto));
        toast.pushToast({ variant: "success", message: "Keyboard shortcuts pasted from clipboard." });
    }, [clipboard, mgr]);

    // Filter actions by matching against id, title, and description
    const filteredActions = React.useMemo(() => {
        return kAllActions.filter(action => {
            const searchText = `${action.id} ${action.title} ${action.description || ""}`;
            return matchesFilter(searchText, filter);
        });
    }, [filter]);

    const filteredCategories = React.useMemo(() => {
        const cats = new Set(filteredActions.map(action => action.category));
        return Array.from(allCategories).filter(cat => cats.has(cat));
    }, [filteredActions, allCategories]);

    return <div className="keyboard-shortcut-configurator">
        <section>
            <h3>Keyboard Shortcuts</h3>
            <div style={{ display: "flex", gap: 8 }}>
                <button onClick={onResetAllToDefaults}>Reset to defaults</button>
                <button onClick={onCopyCurrentShortcutsToClipboard}>Copy config</button>
                <button onClick={onPasteShortcutsFromClipboard}>Paste</button>
            </div>
            <div className="keyboard-shortcut-filter">
                <input
                    type="text"
                    placeholder="Filter shortcuts..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="keyboard-shortcut-filter__input"
                />
                {filter && (
                    <button
                        className="keyboard-shortcut-filter__clear"
                        onClick={() => setFilter("")}
                        title="Clear filter"
                    >
                        {CharMap.Mul}
                    </button>
                )}
            </div>
        </section>
        <section>
            {filteredCategories.map(category => (
                <div key={category} className="keyboard-shortcut-category">
                    <h4>{category}</h4>
                    {filteredActions.filter(action => action.category === category).map(action => (
                        <BindingEditorRow key={action.id} actionId={action.id} />
                    ))}
                </div>
            ))}
            {filteredActions.length === 0 && filter && (
                <div className="keyboard-shortcut-no-results">
                    No shortcuts match "{filter}"
                </div>
            )}
        </section>
    </div>;
};

