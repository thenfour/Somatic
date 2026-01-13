// todo: keyboard nav on list + delete / insert below?
// todo: insert new instrument above / below. don't allow if kicking out used instruments
import React, { useCallback, useMemo, useRef } from "react";

import { EditorState } from "../models/editor_state";
import { isReservedInstrument, makeDefaultInstrumentForIndex, SomaticInstrument } from "../models/instruments";
import { Song } from "../models/song";
import { SomaticCaps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";
import { AppPanelShell } from "./AppPanelShell";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { Button } from "./Buttons/PushButton";
import { InstrumentChip } from "./InstrumentChip";
import "./InstrumentsPanel.css";
import { GlobalActions } from "../keyb/ActionIds";

export type InstrumentsPanelProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onClose: () => void;
};

export const InstrumentsPanel: React.FC<InstrumentsPanelProps> = ({
    song,
    editorState,
    onSongChange,
    onEditorStateChange,
    onClose,
}) => {
    const instrumentCount = song.instruments.length;
    const selectedInstrument = clamp(editorState.currentInstrument, 0, instrumentCount - 1);

    const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const focusRow = useCallback((idx: number) => {
        const el = rowRefs.current[idx];
        if (!el) return;
        el.focus();
        // Ensure keyboard navigation keeps the active row visible.
        el.scrollIntoView?.({ block: "nearest" });
    }, []);

    const setCurrentInstrument = useCallback((idx: number) => {
        onEditorStateChange((st) => st.setCurrentInstrument(idx));
    }, [onEditorStateChange]);


    const canMoveUp = useMemo(() => {
        if (selectedInstrument <= 0) return false;
        const target = selectedInstrument - 1;
        return !isReservedInstrument(selectedInstrument) && !isReservedInstrument(target);
    }, [selectedInstrument]);

    const canMoveDown = useMemo(() => {
        if (selectedInstrument >= instrumentCount - 1) return false;
        const target = selectedInstrument + 1;
        return !isReservedInstrument(selectedInstrument) && !isReservedInstrument(target);
    }, [selectedInstrument, instrumentCount]);

    const canClear = useMemo(() => {
        return !isReservedInstrument(selectedInstrument);
    }, [selectedInstrument]);

    const moveSelected = (delta: -1 | 1) => {
        const a = selectedInstrument;
        const b = a + delta;
        if (b < 0 || b >= instrumentCount) return;
        if (isReservedInstrument(a) || isReservedInstrument(b)) return;

        onSongChange({
            description: delta < 0 ? "Move instrument up" : "Move instrument down",
            undoable: true,
            mutator: (s) => {
                const tmp = s.instruments[a];
                s.instruments[a] = s.instruments[b];
                s.instruments[b] = tmp;
                // Rewrite pattern instrument indices so playback is unchanged.
                s.swapInstrumentIndicesInPatterns(a, b);
            },
        });

        // Keep selection on the same instrument "identity" as it moves.
        onEditorStateChange((st) => st.setCurrentInstrument(b));
    };

    const clearSelected = () => {
        if (isReservedInstrument(selectedInstrument)) return;

        onSongChange({
            description: "Clear instrument",
            undoable: true,
            mutator: (s) => {
                s.instruments[selectedInstrument] = makeDefaultInstrumentForIndex(selectedInstrument);
            },
        });
    };

    const usageMap = useMemo(() => {
        return song.getInstrumentUsageMap();
    }, [song]);

    const lastInstrumentIndex = instrumentCount - 1;
    const lastInstrumentIsUsed = usageMap.has(lastInstrumentIndex);

    const canInsertAbove = useMemo(() => {
        if (lastInstrumentIsUsed) return false;
        if (isReservedInstrument(selectedInstrument)) return false;
        return selectedInstrument > SomaticCaps.noteCutInstrumentIndex;
    }, [lastInstrumentIsUsed, selectedInstrument]);

    const canInsertBelow = useMemo(() => {
        if (lastInstrumentIsUsed) return false;
        if (isReservedInstrument(selectedInstrument)) return false;
        const insertIndex = selectedInstrument + 1;
        if (insertIndex >= instrumentCount) return false;
        return insertIndex > SomaticCaps.noteCutInstrumentIndex;
    }, [instrumentCount, lastInstrumentIsUsed, selectedInstrument]);

    const insertAt = (insertIndex: number) => {
        if (lastInstrumentIsUsed) return;
        if (insertIndex < 0 || insertIndex >= instrumentCount) return;
        if (insertIndex <= SomaticCaps.noteCutInstrumentIndex) return;

        onSongChange({
            description: insertIndex === selectedInstrument ? "Insert instrument above" : "Insert instrument below",
            undoable: true,
            mutator: (s) => {
                s.insertInstrumentSlotAtIndex(insertIndex);
            },
        });
        onEditorStateChange((st) => st.setCurrentInstrument(insertIndex));
    };

    const handleRowKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
        let next: number | null = null;
        switch (e.key) {
            case "ArrowUp":
                next = clamp(idx - 1, 0, instrumentCount - 1);
                break;
            case "ArrowDown":
                next = clamp(idx + 1, 0, instrumentCount - 1);
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = instrumentCount - 1;
                break;
            default:
                return;
        }
        if (next === idx) return;
        e.preventDefault();
        setCurrentInstrument(next);
        // Focus immediately so repeated key presses work smoothly.
        focusRow(next);
    }, [focusRow, instrumentCount, setCurrentInstrument]);

    return (
        <AppPanelShell
            className="instruments-panel"
            title="Instruments"
            onClose={onClose}
            closeActionId={GlobalActions.ToggleInstrumentsPanel}
        >
            <div className="instruments-panel__inner">
                <div className="instruments-panel__content">
                    {Array.from({ length: instrumentCount }, (_, idx) => {
                        const inst = song.instruments[idx]!;
                        const isSelected = idx === selectedInstrument;
                        const isReserved = isReservedInstrument(idx);
                        const isUsed = usageMap.has(idx);
                        return (
                            <button
                                key={idx}
                                type="button"
                                ref={(el) => {
                                    rowRefs.current[idx] = el;
                                }}
                                className={[
                                    "instruments-panel__row",
                                    isSelected ? "instruments-panel__row--selected" : "",
                                    isReserved ? "instruments-panel__row--reserved" : "",
                                    isUsed ? "instruments-panel__row--used" : "instruments-panel__row--unused",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                tabIndex={isSelected ? 0 : -1}
                                data-focus-bookmark="true"
                                aria-selected={isSelected}
                                onClick={() => setCurrentInstrument(idx)}
                                onFocus={() => {
                                    if (idx !== selectedInstrument) {
                                        setCurrentInstrument(idx);
                                    }
                                }}
                                onKeyDown={(e) => handleRowKeyDown(e, idx)}
                            >
                                <InstrumentChip
                                    instrumentIndex={idx}
                                    instrument={inst}
                                    // showTooltip={false}
                                    className={isSelected ? "instruments-panel__chip--selected" : undefined}
                                />
                            </button>
                        );
                    })}
                </div>

                <div className="instruments-panel__footer">
                    <div className="instruments-panel__footer-row">
                        <ButtonGroup>
                            <Button
                                type="button"
                                onClick={() => moveSelected(-1)}
                                disabled={!canMoveUp}
                                title="Move up"
                            >
                                ↑
                            </Button>
                            <Button
                                type="button"
                                onClick={() => moveSelected(1)}
                                disabled={!canMoveDown}
                                title="Move down"
                            >
                                ↓
                            </Button>
                            <Button
                                type="button"
                                onClick={() => insertAt(selectedInstrument)}
                                disabled={!canInsertAbove}
                                title={lastInstrumentIsUsed ? "Cannot insert: last instrument is used" : "Insert new instrument above"}
                            >
                                +↑
                            </Button>
                            <Button
                                type="button"
                                onClick={() => insertAt(selectedInstrument + 1)}
                                disabled={!canInsertBelow}
                                title={lastInstrumentIsUsed ? "Cannot insert: last instrument is used" : "Insert new instrument below"}
                            >
                                +↓
                            </Button>
                            <Button
                                type="button"
                                onClick={clearSelected}
                                disabled={!canClear}
                                title="Reset this instrument to defaults"
                            >
                                Reset
                            </Button>
                        </ButtonGroup>
                    </div>
                </div>
            </div>
        </AppPanelShell>
    );
};
