import React, { useEffect, useMemo, useState } from "react";
import type { MusicState } from "../audio/backend";
import { SelectionRect2D, useRectSelection2D } from "../hooks/useRectSelection2D";
import { EditorState } from "../models/editor_state";
import { Pattern } from "../models/pattern";
import { Song } from "../models/song";
import { SomaticCaps } from "../models/tic80Capabilities";
import { CharMap, clamp } from "../utils/utils";
import { useConfirmDialog } from "./confirm_dialog";
import { Tooltip } from "./tooltip";

const PAGE_SIZE = 4;

export const ArrangementEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    musicState: MusicState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, musicState, onEditorStateChange, onSongChange }) => {
    const { confirm } = useConfirmDialog();
    const maxPatterns = SomaticCaps.maxPatternCount;
    const maxPositions = SomaticCaps.maxSongLength;

    const [editingPatternNameIndex, setEditingPatternNameIndex] = useState<number | null>(null);
    const [editingPatternNameValue, setEditingPatternNameValue] = useState("");

    // Create refs for all arrangement rows
    const rowRefs = useMemo(
        () => Array(maxPositions).fill(null) as (HTMLDivElement | null)[],
        [maxPositions]
    );

    const selection2d = useRectSelection2D({
        selection: editorState.selectedArrangementPositions,
        onChange: (rect) => {
            onEditorStateChange((state) => state.setArrangementSelection(rect));
        },
        clampCoord: (coord) => ({
            x: 0,
            y: clamp(coord.y, 0, Math.max(0, song.songOrder.length - 1)),
        }),
    });

    const formattedIndex = (index: number) => index.toString().padStart(2, "0");

    const ensurePatternExists = (s: Song, patternIndex: number) => {
        const target = clamp(patternIndex, 0, maxPatterns - 1);
        while (s.patterns.length <= target && s.patterns.length < maxPatterns) {
            s.patterns.push(new Pattern());
        }
        return target;
    };

    useEffect(() => {
        const sel = editorState.selectedArrangementPositions;
        if (!sel || sel.isNull()) {
            //console.log("ArrangementEditor selection [] (empty)");
            return;
        }
        //console.log(`ArrangementEditor selection [${sel.getAllCells().map(c => c.y).join(", ")}]`);
    }, [editorState.selectedArrangementPositions]);

    const changePatternAtPosition = (positionIndex: number, delta: number) => {
        onSongChange((s) => {
            if (positionIndex < 0 || positionIndex >= s.songOrder.length) return;
            const current = s.songOrder[positionIndex] ?? 0;
            let next = current + delta;
            next = clamp(next, 0, maxPatterns - 1);
            next = ensurePatternExists(s, next);
            s.songOrder[positionIndex] = next;
        });
        onEditorStateChange((state) => {
            state.setActiveSongPosition(positionIndex);
        });
    };

    const handleRowMouseDown = (e: React.MouseEvent, positionIndex: number) => {
        onEditorStateChange((state) => state.setActiveSongPosition(positionIndex));
        selection2d.onCellMouseDown(e, { x: 0, y: positionIndex });
        focusRow(positionIndex);
    };

    const deletePosition = (positionIndex: number) => {
        onSongChange((s) => {
            if (s.songOrder.length <= 1) return; // keep at least one position
            if (positionIndex < 0 || positionIndex >= s.songOrder.length) return;
            s.songOrder.splice(positionIndex, 1);
        });
        onEditorStateChange((state) => {
            if (state.activeSongPosition >= positionIndex && state.activeSongPosition > 0) {
                state.setActiveSongPosition(state.activeSongPosition - 1);
            }
        });
    };

    const handleDeletePosition = async (positionIndex: number) => {
        const confirmed = await confirm({
            content: (
                <div>
                    <p>
                        Are you sure you want to delete position {formattedIndex(positionIndex)} from the arrangement?
                    </p>
                </div>
            ),
            defaultAction: 'no',
            yesLabel: 'Delete',
            noLabel: 'Cancel',
        });

        if (!confirmed) return;
        deletePosition(positionIndex);
    };

    // Find multiple unused pattern indices
    const findUnusedPatternIndices = (s: Song, count: number): number[] => {
        const usedPatterns = new Set(s.songOrder);
        const result: number[] = [];
        for (let i = 0; i < maxPatterns && result.length < count; i++) {
            if (!usedPatterns.has(i)) {
                ensurePatternExists(s, i);
                result.push(i);
            }
        }
        return result;
    };

    const getSelectionRange = (): number[] => {
        const sel = editorState.selectedArrangementPositions;
        if (!sel || sel.isNull()) return [];
        const ycoords = sel.getAllCells().map(c => c.y);
        return ycoords;
    };

    const handleInsertAbove = () => {
        onSongChange((s) => {
            if (s.songOrder.length >= maxPositions) return;
            const selection = getSelectionRange();
            const insertPos = selection[0];
            const newPatterns = findUnusedPatternIndices(s, 1);
            if (newPatterns.length > 0) {
                s.songOrder.splice(insertPos, 0, newPatterns[0]);
            }
        });
    };

    const handleInsertBelow = () => {
        onSongChange((s) => {
            if (s.songOrder.length >= maxPositions) return;
            const selection = getSelectionRange();
            const insertPos = selection[selection.length - 1] + 1;
            const newPatterns = findUnusedPatternIndices(s, 1);
            if (newPatterns.length > 0) {
                s.songOrder.splice(insertPos, 0, newPatterns[0]);
            }
        });
    };

    const handleDeleteSelected = async () => {
        const selection = getSelectionRange();
        if (selection.length >= song.songOrder.length) return; // can't delete everything

        const confirmed = await confirm({
            content: (
                <div>
                    <p>
                        Are you sure you want to delete {selection.length} position{selection.length > 1 ? 's' : ''} from the arrangement?
                    </p>
                </div>
            ),
            defaultAction: 'yes',
            yesLabel: 'Delete',
            noLabel: 'Cancel',
        });

        if (!confirmed) return;

        selection2d.setSelection(new SelectionRect2D(null));

        onSongChange((s) => {
            // Delete in reverse order to maintain indices
            for (let i = selection.length - 1; i >= 0; i--) {
                s.songOrder.splice(selection[i], 1);
            }
        });
    };

    const handleRepeatSelection = () => {
        onSongChange((s) => {
            if (s.songOrder.length >= maxPositions) return;
            const selection = getSelectionRange();
            const patterns = selection.map(idx => s.songOrder[idx]);
            const insertPos = selection[selection.length - 1] + 1;

            // Check if we have room
            if (s.songOrder.length + patterns.length > maxPositions) return;

            s.songOrder.splice(insertPos, 0, ...patterns);
        });
        // move selection to the new items.
        // note that there's an issue if you duplicate the last item; state hasn't made space for that item yet
        // the workaround would be to useEffect() but ... meh.
        const sel = editorState.selectedArrangementPositions;
        if (sel && !sel.isNull()) {
            selection2d.setSelection(sel.withNudge({ width: 0, height: sel.getSignedSize()!.height }));
        }
    };

    const handleDuplicateSelection = () => {
        onSongChange((s) => {
            if (s.songOrder.length >= maxPositions) return;
            const selection = getSelectionRange();
            const patterns = selection.map(idx => s.songOrder[idx]);

            // Check if we have room
            if (s.songOrder.length + patterns.length > maxPositions) return;

            // Reserve all needed pattern indices upfront
            const newPatternIndices = findUnusedPatternIndices(s, patterns.length);
            if (newPatternIndices.length < patterns.length) return; // not enough unused patterns

            // Create new pattern copies
            const duplicatedPatterns = patterns.map((patternIdx, i) => {
                const newPatternIdx = newPatternIndices[i];
                const sourcePattern = s.patterns[patternIdx];
                s.patterns[newPatternIdx] = sourcePattern.clone();
                return newPatternIdx;
            });

            const insertPos = selection[selection.length - 1] + 1;
            s.songOrder.splice(insertPos, 0, ...duplicatedPatterns);
        });
        // move selection to the new items.
        // note that there's an issue if you duplicate the last item; state hasn't made space for that item yet
        // the workaround would be to useEffect() but ... meh.
        const sel = editorState.selectedArrangementPositions;
        if (sel && !sel.isNull()) {
            selection2d.setSelection(sel.withNudge({ width: 0, height: sel.getSignedSize()!.height }));
        }
    };

    const handleMakeSelectionUnique = () => {
        const selection = getSelectionRange();
        if (selection.length === 0) return;

        onSongChange((s) => {
            if (s.songOrder.length === 0) return;

            // Count how many times each pattern index appears in the whole arrangement.
            const patternUsageCount = new Map<number, number>();
            for (const patIndex of s.songOrder) {
                patternUsageCount.set(patIndex, (patternUsageCount.get(patIndex) ?? 0) + 1);
            }

            // Determine which selection positions need a unique clone
            // (i.e. their pattern index is used more than once in the song).
            const positionsNeedingClone: number[] = [];
            for (const pos of selection) {
                const patIndex = s.songOrder[pos];
                const count = patternUsageCount.get(patIndex) ?? 0;
                if (count > 1) {
                    positionsNeedingClone.push(pos);
                }
            }

            if (positionsNeedingClone.length === 0) return;

            // Reserve enough unused pattern indices for all required clones.
            const newPatternIndices = findUnusedPatternIndices(s, positionsNeedingClone.length);
            if (newPatternIndices.length < positionsNeedingClone.length) {
                // Not enough free pattern slots; abort without partial changes.
                return;
            }

            // For each position that needs to be unique, clone its pattern to a new index
            // and point this arrangement position at the clone.
            for (let i = 0; i < positionsNeedingClone.length; i += 1) {
                const pos = positionsNeedingClone[i];
                const sourcePatternIndex = s.songOrder[pos];
                const targetPatternIndex = newPatternIndices[i];

                const sourcePattern = s.patterns[sourcePatternIndex];
                if (!sourcePattern) continue;

                s.patterns[targetPatternIndex] = sourcePattern.clone();
                s.songOrder[pos] = targetPatternIndex;
            }
        });
    };

    const handleMoveUp = () => {
        const selection = getSelectionRange();
        if (selection[0] === 0) return; // already at top

        onSongChange((s) => {
            // Move each selected position up by one
            for (const idx of selection) {
                const temp = s.songOrder[idx];
                s.songOrder[idx] = s.songOrder[idx - 1];
                s.songOrder[idx - 1] = temp;
            }
        });

        // update selection to follow the moved items.
        if (editorState.selectedArrangementPositions) {
            selection2d.setSelection(editorState.selectedArrangementPositions?.withNudge({ width: 0, height: -1 }) || null);
        }
    };

    const handleMoveDown = () => {
        const selection = getSelectionRange();
        if (selection[selection.length - 1] >= song.songOrder.length - 1) return; // already at bottom

        onSongChange((s) => {
            // Move in reverse order to avoid conflicts
            for (let i = selection.length - 1; i >= 0; i--) {
                const idx = selection[i];
                const temp = s.songOrder[idx];
                s.songOrder[idx] = s.songOrder[idx + 1];
                s.songOrder[idx + 1] = temp;
            }
        });
        // update selection to follow the moved items.
        if (editorState.selectedArrangementPositions) {
            selection2d.setSelection(editorState.selectedArrangementPositions?.withNudge({ width: 0, height: 1 }) || null);
        }
    };

    const patternDisplayName = (patternIndex: number) => {
        const pat = song.patterns[patternIndex]!;
        return pat.name;
    };

    const startEditingPatternName = (patternIndex: number) => {
        setEditingPatternNameIndex(patternIndex);
        setEditingPatternNameValue(patternDisplayName(patternIndex));
    };

    const commitEditingPatternName = () => {
        if (editingPatternNameIndex === null) return;
        const index = editingPatternNameIndex;
        const value = editingPatternNameValue.trim();
        onSongChange((s) => {
            const pat = s.patterns[index];
            if (!pat) return;
            pat.name = value;
        });
        setEditingPatternNameIndex(null);
    };

    const cancelEditingPatternName = () => {
        setEditingPatternNameIndex(null);
    };

    const focusRow = (positionIndex: number) => {
        const target = rowRefs[positionIndex];
        if (target) target.focus();
    };

    const handleWheel = (e: React.WheelEvent) => {
        const positionIndex = editorState.activeSongPosition;
        const maxIndex = Math.max(0, song.songOrder.length - 1);

        // deltaY > 0 means scrolling down (move cursor down)
        // deltaY < 0 means scrolling up (move cursor up)
        if (e.deltaY === 0) return;

        e.preventDefault();

        let next: number;
        if (e.deltaY < 0) {
            next = Math.max(0, positionIndex - 1);
        } else {
            next = Math.min(maxIndex, positionIndex + 1);
        }
        selection2d.setSelection(new SelectionRect2D({
            start: { x: 0, y: next },
            size: { width: 1, height: 1 },
        }));
        onEditorStateChange((state) => {
            state.setActiveSongPosition(next);
        });
        focusRow(next);
    };

    const handleKeyDown = (e: React.KeyboardEvent, positionIndex: number) => {
        const maxIndex = Math.max(0, song.songOrder.length - 1);
        switch (e.key) {
            case 'ArrowUp': {
                e.preventDefault();
                const next = Math.max(0, positionIndex - 1);
                if (e.shiftKey) {
                    // shift up = nudge selection.
                    selection2d.nudgeActiveEnd({ delta: { width: 0, height: -1 } });
                } else {
                    // no shift = set active position.
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: 0, y: next },
                        size: { width: 1, height: 1 },
                    }));
                }
                onEditorStateChange((state) => {
                    state.setActiveSongPosition(next);
                });
                focusRow(next);
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                const next = Math.min(maxIndex, positionIndex + 1);
                if (e.shiftKey) {
                    // shift down = nudge selection.
                    selection2d.nudgeActiveEnd({ delta: { width: 0, height: 1 } });
                } else {
                    // no shift = set active position.
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: 0, y: next },
                        size: { width: 1, height: 1 },
                    }));
                }
                onEditorStateChange((state) => {
                    state.setActiveSongPosition(next);
                });
                focusRow(next);
                break;
            }
            case 'ArrowLeft': {
                e.preventDefault();
                changePatternAtPosition(positionIndex, -1);
                break;
            }
            case 'ArrowRight': {
                e.preventDefault();
                changePatternAtPosition(positionIndex, 1);
                break;
            }
            case 'Home': {
                e.preventDefault();
                if (e.shiftKey) {
                    selection2d.setEnd({ x: 0, y: 0 });
                    return;
                }
                const next = 0;
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: 0, y: next },
                    size: { width: 1, height: 1 },
                }));
                break;
            }
            case 'End': {
                e.preventDefault();
                if (e.shiftKey) {
                    selection2d.setEnd({ x: 0, y: maxIndex });
                    return;
                }
                const next = maxIndex;
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: 0, y: next },
                    size: { width: 1, height: 1 },
                }));
                break;
            }
            // page up / down will move by 4
            case 'PageUp': {
                e.preventDefault();
                const next = Math.max(0, positionIndex - PAGE_SIZE);
                if (e.shiftKey) {
                    selection2d.nudgeActiveEnd({ delta: { width: 0, height: -PAGE_SIZE } });
                    focusRow(next);
                    return;
                }
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: 0, y: next },
                    size: { width: 1, height: 1 },
                }));
                focusRow(next);
                break;
            }
            case 'PageDown': {
                e.preventDefault();
                const next = Math.min(maxIndex, positionIndex + PAGE_SIZE);
                if (e.shiftKey) {
                    selection2d.nudgeActiveEnd({ delta: { width: 0, height: PAGE_SIZE } });
                    focusRow(next);
                    return;
                }
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: 0, y: next },
                    size: { width: 1, height: 1 },
                }));
                focusRow(next);
                break;
            }
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                handleDeleteSelected();
                break;
            // case 'Enter':
            // case ' ':
            //     e.preventDefault();
            //     break;
        }
    };

    const activeSongPosition = musicState.somaticSongPosition ?? -1;

    return (
        <div className="arrangement-editor">
            <div className="arrangement-editor__header">
            </div>
            <div className="arrangement-editor__content"
                onWheel={(e) => handleWheel(e)}
            >
                {song.songOrder.map((patternIndex, positionIndex) => {
                    const clampedPattern = clamp(patternIndex ?? 0, 0, maxPatterns - 1);
                    const isSelected = editorState.activeSongPosition === positionIndex;
                    const sel = editorState.selectedArrangementPositions;
                    const isInSelection = sel?.includesCoord({ x: 0, y: positionIndex }) || false;
                    const isPlaying = activeSongPosition === positionIndex;
                    const canDelete = song.songOrder.length > 1;

                    // Determine if this is the first or last in selection
                    const isFirstInSelection = positionIndex === sel?.topInclusive(); //editorState.selectedArrangementPositions sortedSelection.length > 0 && positionIndex === sortedSelection[0];
                    const isLastInSelection = positionIndex === sel?.bottomInclusive();

                    const rowClass = [
                        "arrangement-editor__row",
                        isSelected && "arrangement-editor__row--selected",
                        isInSelection && "arrangement-editor__row--in-selection",
                        isFirstInSelection && "arrangement-editor__row--selection-first",
                        isLastInSelection && "arrangement-editor__row--selection-last",
                        isPlaying && "arrangement-editor__row--playing",
                    ].filter(Boolean).join(" ");
                    return (
                        <div
                            key={positionIndex}
                            className={rowClass}
                        >
                            <div
                                className="arrangement-editor__controls"
                                tabIndex={0}
                                ref={(el) => (rowRefs[positionIndex] = el)}
                                onKeyDown={(e) => handleKeyDown(e, positionIndex)}
                                onMouseDown={(e) => handleRowMouseDown(e, positionIndex)}
                                onMouseEnter={() => selection2d.onCellMouseEnter({ x: 0, y: positionIndex })}
                            >
                                <button
                                    type="button"
                                    className="arrangement-editor__delete"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeletePosition(positionIndex);
                                    }}
                                    disabled={!canDelete}
                                    aria-label="Delete position"
                                >
                                    {CharMap.Mul}
                                </button>
                                <button
                                    type="button"
                                    className="arrangement-editor__step"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        changePatternAtPosition(positionIndex, -1);
                                    }}
                                    disabled={clampedPattern <= 0}
                                    aria-label="Previous pattern"
                                >
                                    {"<"}
                                </button>
                                <button
                                    type="button"
                                    className="arrangement-editor__step"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        changePatternAtPosition(positionIndex, 1);
                                    }}
                                    disabled={clampedPattern >= maxPatterns - 1}
                                    aria-label="Next pattern"
                                >
                                    {">"}
                                </button>
                                <span className="arrangement-editor__position-id">
                                    <span style={{ visibility: isSelected ? "visible" : "hidden" }}>{CharMap.RightTriangle}</span>
                                    {formattedIndex(positionIndex)}
                                </span>
                                <span
                                    className="arrangement-editor__pattern"
                                >
                                    {formattedIndex(clampedPattern)}
                                </span>
                            </div>
                            <div
                                className="arrangement-editor__pattern-name-container"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {editingPatternNameIndex === clampedPattern ? (
                                    <input
                                        type="text"
                                        className="arrangement-editor__pattern-name-input"
                                        value={editingPatternNameValue}
                                        autoFocus
                                        onChange={(e) => setEditingPatternNameValue(e.target.value)}
                                        onBlur={commitEditingPatternName}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                commitEditingPatternName();
                                            } else if (e.key === "Escape") {
                                                e.preventDefault();
                                                cancelEditingPatternName();
                                            }
                                        }}
                                    />
                                ) : (
                                    <span
                                        className="arrangement-editor__pattern-name"
                                        title={patternDisplayName(clampedPattern)}
                                        onDoubleClick={() => startEditingPatternName(clampedPattern)}
                                    >
                                        {patternDisplayName(clampedPattern)}
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="arrangement-editor__footer">
                <div className="arrangement-editor__footer-row">
                    <Tooltip title="Insert new pattern above selection">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleInsertAbove}
                            disabled={song.songOrder.length >= maxPositions}
                            aria-label="Insert above"
                        >
                            +↑
                        </button>
                    </Tooltip>
                    <Tooltip title="Insert new pattern below selection">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleInsertBelow}
                            disabled={song.songOrder.length >= maxPositions}
                            aria-label="Insert below"
                        >
                            +⬇
                        </button>
                    </Tooltip>
                    <Tooltip title="Repeat selection (reuse same patterns)">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleRepeatSelection}
                            disabled={song.songOrder.length >= maxPositions}
                            aria-label="Repeat selection"
                        >
                            ↻
                        </button>
                    </Tooltip>
                    <Tooltip title="Duplicate selection (copy patterns)">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleDuplicateSelection}
                            disabled={song.songOrder.length >= maxPositions}
                            aria-label="Duplicate selection"
                        >
                            ⧉
                        </button>
                    </Tooltip>
                    <Tooltip title="Make selection unique">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleMakeSelectionUnique}
                        >
                            {CharMap.BoldSixPointedAsterisk}
                        </button>
                    </Tooltip>
                </div>
                <div className="arrangement-editor__footer-row">
                    <Tooltip title="Delete selected positions">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleDeleteSelected}
                            disabled={getSelectionRange().length >= song.songOrder.length}
                            aria-label="Delete selected"
                        >
                            ×
                        </button>
                    </Tooltip>
                    <Tooltip title="Move selection up">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleMoveUp}
                            disabled={getSelectionRange()[0] === 0}
                            aria-label="Move up"
                        >
                            ⬆
                        </button>
                    </Tooltip>
                    <Tooltip title="Move selection down">
                        <button
                            type="button"
                            className="arrangement-editor__command"
                            onClick={handleMoveDown}
                            disabled={getSelectionRange()[getSelectionRange().length - 1] >= song.songOrder.length - 1}
                            aria-label="Move down"
                        >
                            ⬇
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
};