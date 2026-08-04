import React, { useCallback, useMemo, useRef } from "react";
import {
   mdiArrowDownBold,
   mdiArrowUpBold,
   mdiEraser,
   mdiTableRowPlusAfter,
   mdiTableRowPlusBefore,
} from "@mdi/js";

import {useContiguousListSelection} from "../hooks/useContiguousListSelection";
import { GlobalActions } from "../keyb/ActionIds";
import { EditorState } from "../models/editor_state";
import {SelectionRange1D} from "../models/selectionRange1D";
import { Song } from "../models/song";
import { clamp } from "../utils/utils";
import { AppPanelShell } from "./AppPanelShell";
import { Tooltip } from "./basic/tooltip";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { IconButton } from "./Buttons/IconButton";
import { InstrumentChip } from "./InstrumentChip";
import "./InstrumentsPanel.css";

export type InstrumentsPanelProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onOpenInstrumentEditor: () => void;
    onClose: () => void;
};

export const InstrumentsPanel: React.FC<InstrumentsPanelProps> = ({
    song,
    editorState,
    onSongChange,
    onEditorStateChange,
    onOpenInstrumentEditor,
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

    const instrumentSelection = useMemo(() => {
        const stored = editorState.instrumentOperationRange;
        if (stored && stored.focus === selectedInstrument) {
            return stored.withClampedBounds(0, instrumentCount - 1);
        }
        return SelectionRange1D.single(selectedInstrument);
    }, [editorState.instrumentOperationRange, instrumentCount, selectedInstrument]);

    const listSelection = useContiguousListSelection({
        selection: instrumentSelection,
        itemCount: instrumentCount,
        focusIndex: focusRow,
        onChange: (range) => {
            onEditorStateChange((st) => st.setInstrumentSelection(song, range));
        },
    });

    const setCurrentInstrument = useCallback((idx: number) => {
        onEditorStateChange((st) => st.setCurrentInstrument(song, idx));
    }, [onEditorStateChange, song]);


    const canMoveUp = useMemo(() => {
        if (listSelection.first === null || listSelection.first <= 0) return false;
        return true;
    }, [listSelection.first]);

    const canMoveDown = useMemo(() => {
        if (listSelection.last === null || listSelection.last >= instrumentCount - 1) return false;
        return true;
    }, [instrumentCount, listSelection.last]);

    const canClear = listSelection.count > 0;

    const moveSelected = (delta: -1 | 1) => {
        const selection = listSelection.indices;
        if (selection.length === 0) return;
        if (delta < 0 && selection[0] <= 0) return;
        if (delta > 0 && selection[selection.length - 1] >= instrumentCount - 1) return;

        onSongChange({
            description: delta < 0 ? "Move instrument selection up" : "Move instrument selection down",
            undoable: true,
            mutator: (s) => {
                s.moveInstrumentRange(selection[0], selection.length, delta);
            },
        });

        // Keep the operation range and primary instrument on the same identities.
        listSelection.setSelection(instrumentSelection.withNudge(delta));
    };

    const clearSelected = () => {
        const selection = listSelection.indices;
        if (selection.length === 0) return;
        onSongChange({
            description: selection.length === 1 ? "Reset instrument to defaults" : "Reset instruments to defaults",
            undoable: true,
            mutator: (s) => {
                s.resetInstrumentSlotsToDefaults(selection);
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
        return true;
    }, [lastInstrumentIsUsed]);

    const canInsertBelow = useMemo(() => {
        if (lastInstrumentIsUsed) return false;
        const insertIndex = (listSelection.last ?? selectedInstrument) + 1;
        if (insertIndex >= instrumentCount) return false;
        return true;
    }, [instrumentCount, lastInstrumentIsUsed, listSelection.last, selectedInstrument]);

    const insertAt = (insertIndex: number) => {
        if (lastInstrumentIsUsed) return;
        if (insertIndex < 0 || insertIndex >= instrumentCount) return;

        onSongChange({
            description: insertIndex === selectedInstrument ? "Insert instrument above" : "Insert instrument below",
            undoable: true,
            mutator: (s) => {
                s.insertInstrumentSlotAtIndex(insertIndex);
            },
        });
        onEditorStateChange((st) => st.setCurrentInstrument(song, insertIndex));
        focusRow(insertIndex);
    };

    const handleRowKeyDown = useCallback((e: React.KeyboardEvent, idx: number) => {
        listSelection.onItemKeyDown(e, idx);
    }, [listSelection]);

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
                        const isInSelection = listSelection.includes(idx);
                        const isFirstInSelection = idx === listSelection.first;
                        const isLastInSelection = idx === listSelection.last;
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
                                    isInSelection ? "instruments-panel__row--in-selection" : "",
                                    isFirstInSelection ? "instruments-panel__row--selection-first" : "",
                                    isLastInSelection ? "instruments-panel__row--selection-last" : "",
                                    isUsed ? "instruments-panel__row--used" : "instruments-panel__row--unused",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                tabIndex={isSelected ? 0 : -1}
                                data-focus-bookmark="true"
                                aria-selected={isSelected}
                                onMouseDown={(e) => listSelection.onItemMouseDown(e, idx)}
                                onMouseEnter={() => listSelection.onItemMouseEnter(idx)}
                                onClick={(e) => {
                                    // Keyboard and assistive activation do not produce a pointer detail.
                                    if (e.detail === 0)
                                        listSelection.selectIndex(idx);
                                }}
                                onDoubleClick={() => {
                                    if (idx !== selectedInstrument) {
                                        setCurrentInstrument(idx);
                                    }
                                    onOpenInstrumentEditor();
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
                            <Tooltip title="Move selected instruments up">
                                <span className="instruments-panel__footer-tooltip-trigger">
                                    <IconButton
                                        type="button"
                                        onClick={() => moveSelected(-1)}
                                        disabled={!canMoveUp}
                                        aria-label="Move selected instruments up"
                                        iconPath={mdiArrowUpBold}
                                    />
                                </span>
                            </Tooltip>
                            <Tooltip title="Move selected instruments down">
                                <span className="instruments-panel__footer-tooltip-trigger">
                                    <IconButton
                                        type="button"
                                        onClick={() => moveSelected(1)}
                                        disabled={!canMoveDown}
                                        aria-label="Move selected instruments down"
                                        iconPath={mdiArrowDownBold}
                                    />
                                </span>
                            </Tooltip>
                            <Tooltip title={lastInstrumentIsUsed ? "Cannot insert: last instrument is used" : "Insert new instrument above"}>
                                <span className="instruments-panel__footer-tooltip-trigger">
                                    <IconButton
                                        type="button"
                                        onClick={() => insertAt(listSelection.first ?? selectedInstrument)}
                                        disabled={!canInsertAbove}
                                        aria-label="Insert new instrument above"
                                        iconPath={mdiTableRowPlusBefore}
                                    />
                                </span>
                            </Tooltip>
                            <Tooltip title={lastInstrumentIsUsed ? "Cannot insert: last instrument is used" : "Insert new instrument below"}>
                                <span className="instruments-panel__footer-tooltip-trigger">
                                    <IconButton
                                        type="button"
                                        onClick={() => insertAt((listSelection.last ?? selectedInstrument) + 1)}
                                        disabled={!canInsertBelow}
                                        aria-label="Insert new instrument below"
                                        iconPath={mdiTableRowPlusAfter}
                                    />
                                </span>
                            </Tooltip>
                            <Tooltip title={listSelection.count === 1 ? "Reset this instrument to defaults" : "Reset selected instruments to defaults"}>
                                <span className="instruments-panel__footer-tooltip-trigger">
                                    <IconButton
                                        type="button"
                                        onClick={clearSelected}
                                        disabled={!canClear}
                                        aria-label={listSelection.count === 1 ? "Reset this instrument to defaults" : "Reset selected instruments to defaults"}
                               iconPath={mdiEraser} // see also: clear, restore, cancel, ...
                                    />
                                </span>
                            </Tooltip>
                        </ButtonGroup>
                    </div>
                </div>
            </div>
        </AppPanelShell>
    );
};
