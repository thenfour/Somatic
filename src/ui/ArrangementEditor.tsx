import React, { useEffect, useMemo, useRef } from "react";
import type { SomaticTransportState } from "../audio/backend";
import { SelectionRect2D, useRectSelection2D } from "../hooks/useRectSelection2D";
import { useWheelNavigator } from "../hooks/useWheelNavigator";
import { EditorState } from "../models/editor_state";
import { Pattern } from "../models/pattern";
import { formatPatternIndex, Song } from "../models/song";
import { SongOrderItem } from "../models/songOrder";
import { SomaticCaps } from "../models/tic80Capabilities";
import { CharMap, clamp } from "../utils/utils";
import './ArrangementEditor.css';
import { useConfirmDialog } from "./basic/confirm_dialog";
import { Tooltip } from "./basic/tooltip";
import { renderThumbnail } from "./PatternThumbnail";
import { SongOrderMarkerControl } from "./SongOrderMarker";

const PAGE_SIZE = 4;

// const DEFAULT_THUMB_MODE: { mode: ThumbnailMode } = {
//     mode: "currentInstrument",
// };

export const ArrangementEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    musicState: SomaticTransportState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
}> = ({ song, editorState, musicState, onEditorStateChange, onSongChange }) => {
    const { confirm } = useConfirmDialog();
    const maxPatterns = SomaticCaps.maxPatternCount;
    const maxPositions = SomaticCaps.maxSongLength;
    const cursorPatternIndex = song.songOrder[editorState.activeSongPosition]?.patternIndex;

    // const [thumbMode, setThumbMode] = useLocalStorage<{ mode: ThumbnailMode }>(
    //     "somatic-arrangement-thumbnails",
    //     DEFAULT_THUMB_MODE,
    // );

    // const thumbnailPrefs: ThumbnailPrefs = {
    //     size: song.arrangementThumbnailSize ?? "normal",
    //     mode: thumbMode.mode ?? "currentInstrument",
    // };

    //const [editingPatternNameIndex, setEditingPatternNameIndex] = useState<number | null>(null);
    //const [editingPatternNameValue, setEditingPatternNameValue] = useState("");

    const containerRef = useRef<HTMLDivElement>(null);

    // Create refs for all arrangement rows
    const rowRefs = useMemo(
        () => Array(maxPositions).fill(null) as (HTMLDivElement | null)[],
        [maxPositions]
    );

    // Pending selection/focus to apply after song mutations propagate
    const pendingSelectionRef = useRef<{
        selection: SelectionRect2D | null;
        focusRow: number | null;
    } | null>(null);

    // Apply pending selection after song order changes
    useEffect(() => {
        if (pendingSelectionRef.current) {
            const pending = pendingSelectionRef.current;
            pendingSelectionRef.current = null;

            if (pending.selection) {
                selection2d.setSelection(pending.selection);
            }
            if (pending.focusRow !== null) {
                focusRow(pending.focusRow);
            }
        }
    }, [song.songOrder.length]);

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
            return;
        }
    }, [editorState.selectedArrangementPositions]);

    const nudgeSelectionAndFocusAnchor = (amt: number) => {
        const sel = editorState.selectedArrangementPositions;
        if (!sel || sel.isNull()) return;
        const newRect = sel.withNudge({ width: 0, height: amt });
        selection2d.setSelection(newRect);
        const newFocus = newRect.getAnchorPoint()?.y;
        if (newFocus != null) {
            focusRow(newFocus);
        }
    };

    // Schedule selection/focus to be applied after song mutation propagates through state
    const schedulePendingSelection = (selection: SelectionRect2D | null, focusRowIndex: number | null) => {
        pendingSelectionRef.current = { selection, focusRow: focusRowIndex };
    };

    // Find multiple unused pattern indices
    const findUnusedPatternIndices = (s: Song, count: number): number[] => {
        const usedPatterns = new Set(s.songOrder.map(item => item.patternIndex));
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

    const changePatternAtPosition = (positionIndex: number, delta: number) => {
        onSongChange({
            description: delta > 0 ? 'Next pattern in arrangement' : 'Previous pattern in arrangement',
            undoable: true,
            mutator: (s) => {
                if (positionIndex < 0 || positionIndex >= s.songOrder.length) return;
                const currentItem = s.songOrder[positionIndex] ?? new SongOrderItem({ patternIndex: 0 });
                let nextPatternIndex = currentItem.patternIndex + delta;
                nextPatternIndex = clamp(nextPatternIndex, 0, maxPatterns - 1);
                nextPatternIndex = ensurePatternExists(s, nextPatternIndex);
                const newItem = currentItem.clone();
                newItem.patternIndex = nextPatternIndex;
                s.songOrder[positionIndex] = newItem;
            },
        });
        onEditorStateChange((state) => {
            state.setActiveSongPosition(song, positionIndex);
        });
    };

    const handleRowMouseDown = (e: React.MouseEvent, positionIndex: number) => {
        onEditorStateChange((state) => state.setActiveSongPosition(song, positionIndex));
        selection2d.onCellMouseDown(e, { x: 0, y: positionIndex });
        focusRow(positionIndex);
    };

    const deletePosition = (positionIndex: number) => {
        onSongChange({
            description: 'Delete arrangement position',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length <= 1) return; // keep at least one position
                if (positionIndex < 0 || positionIndex >= s.songOrder.length) return;
                s.songOrder.splice(positionIndex, 1);
            },
        });
        onEditorStateChange((state) => {
            if (state.activeSongPosition >= positionIndex && state.activeSongPosition > 0) {
                state.setActiveSongPosition(song, state.activeSongPosition - 1);
            }
        });
    };

    const handleDeletePosition = async (positionIndex: number) => {
        const confirmed = await confirm({
            content: (
                <div>
                    <p>
                        Are you sure you want to delete position {formatPatternIndex(positionIndex)} from the arrangement?
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

    const handleInsertAbove = () => {
        onSongChange({
            description: 'Insert pattern above',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length >= maxPositions) return;
                const selection = getSelectionRange();
                const insertPos = selection[0];
                const newPatterns = findUnusedPatternIndices(s, 1);
                if (newPatterns.length > 0) {
                    s.songOrder.splice(insertPos, 0, new SongOrderItem({ patternIndex: newPatterns[0] }));
                }
            },
        });
        // no selection tweaking necessary; inserting above put your cursor at the correct place.
        // however, we do this to set focus.
        focusRow(editorState.activeSongPosition);
    };

    const handleInsertBelow = () => {
        const selection = getSelectionRange();
        const insertPos = selection[selection.length - 1] + 1;

        onSongChange({
            description: 'Insert pattern below',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length >= maxPositions) return;
                const newPatterns = findUnusedPatternIndices(s, 1);
                if (newPatterns.length > 0) {
                    s.songOrder.splice(insertPos, 0, new SongOrderItem({ patternIndex: newPatterns[0] }));
                }
            },
        });

        // Schedule selection to new item after song state propagates
        schedulePendingSelection(
            new SelectionRect2D({ start: { x: 0, y: insertPos }, size: { width: 1, height: 1 } }),
            insertPos
        );
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

        // Clear selection
        selection2d.setSelection(new SelectionRect2D(null));
        // but set keyboard focus back to where you were.
        focusRow(selection[0]);

        onSongChange({
            description: 'Delete arrangement selection',
            undoable: true,
            mutator: (s) => {
                // Delete in reverse order to maintain indices
                for (let i = selection.length - 1; i >= 0; i--) {
                    s.songOrder.splice(selection[i], 1);
                }
            },
        });

        // Adjust activeSongPosition to ensure it's within bounds after deletion
        onEditorStateChange((state) => {
            const newLength = song.songOrder.length - selection.length;
            if (state.activeSongPosition >= newLength) {
                state.setActiveSongPosition(song, Math.max(0, newLength - 1));
            }
        });
    };

    const handleRepeatSelection = () => {
        const selection = getSelectionRange();
        const selectionCount = selection.length;
        const insertPos = selection[selection.length - 1] + 1;

        onSongChange({
            description: 'Repeat arrangement selection',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length >= maxPositions) return;
                const newItems = selection.map(idx => s.songOrder[idx].clone());

                // Check if we have room
                if (s.songOrder.length + newItems.length > maxPositions) return;

                s.songOrder.splice(insertPos, 0, ...newItems);
            },
        });

        // Schedule selection to the new repeated items after song state propagates
        schedulePendingSelection(
            new SelectionRect2D({ start: { x: 0, y: insertPos }, size: { width: 1, height: selectionCount } }),
            insertPos
        );
    };

    const handleDuplicateSelection = () => {
        const selection = getSelectionRange();
        const selectionCount = selection.length;
        const insertPos = selection[selection.length - 1] + 1;

        onSongChange({
            description: 'Duplicate arrangement selection',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length >= maxPositions) return;
                const orderItems = selection.map(idx => s.songOrder[idx]);

                // Check if we have room
                if (s.songOrder.length + orderItems.length > maxPositions) return;

                // Reserve all needed pattern indices upfront
                const newPatternIndices = findUnusedPatternIndices(s, orderItems.length);
                if (newPatternIndices.length < orderItems.length) return; // not enough unused patterns

                // Create new pattern copies
                const duplicatedItems: SongOrderItem[] = orderItems.map((orderItem, i) => {
                    const newPatternIdx = newPatternIndices[i];
                    const sourcePattern = s.patterns[orderItem.patternIndex];
                    s.patterns[newPatternIdx] = sourcePattern.clone();
                    const newItem = orderItem.clone();
                    newItem.patternIndex = newPatternIdx;
                    return newItem;
                });

                s.songOrder.splice(insertPos, 0, ...duplicatedItems);
            },
        });

        // Schedule selection to the new duplicated items after song state propagates
        schedulePendingSelection(
            new SelectionRect2D({ start: { x: 0, y: insertPos }, size: { width: 1, height: selectionCount } }),
            insertPos
        );
    };

    const handleMakeSelectionUnique = () => {
        const selection = getSelectionRange();
        if (selection.length === 0) return;

        onSongChange({
            description: 'Make arrangement selection unique',
            undoable: true,
            mutator: (s) => {
                if (s.songOrder.length === 0) return;

                // Count how many times each pattern index appears in the whole arrangement.
                const patternUsageCount = new Map<number, number>();
                for (const orderItem of s.songOrder) {
                    patternUsageCount.set(orderItem.patternIndex, (patternUsageCount.get(orderItem.patternIndex) ?? 0) + 1);
                }

                // Determine which selection positions need a unique clone
                // (i.e. their pattern index is used more than once in the song).
                const positionsNeedingClone: number[] = [];
                for (const pos of selection) {
                    const patIndex = s.songOrder[pos].patternIndex;
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
                    const sourceItem = s.songOrder[pos];
                    const targetPatternIndex = newPatternIndices[i];
                    const sourcePattern = s.patterns[sourceItem.patternIndex];

                    s.patterns[targetPatternIndex] = sourcePattern.clone();
                    const newItem = sourceItem.clone();
                    newItem.patternIndex = targetPatternIndex;
                    s.songOrder[pos] = newItem;
                }
            },
        });
        // set focus back to where it was.
        focusRow(selection[0]);
    };

    const handleMoveUp = () => {
        const selection = getSelectionRange();
        if (selection[0] === 0) return; // already at top

        onSongChange({
            description: 'Move arrangement selection up',
            undoable: true,
            mutator: (s) => {
                // Move each selected position up by one
                for (const idx of selection) {
                    const temp = s.songOrder[idx];
                    s.songOrder[idx] = s.songOrder[idx - 1];
                    s.songOrder[idx - 1] = temp;
                }
            },
        });

        // update selection to follow the moved items.
        if (editorState.selectedArrangementPositions) {
            selection2d.setSelection(editorState.selectedArrangementPositions?.withNudge({ width: 0, height: -1 }) || null);
        }
    };

    const handleMoveDown = () => {
        const selection = getSelectionRange();
        if (selection[selection.length - 1] >= song.songOrder.length - 1) return; // already at bottom

        onSongChange({
            description: 'Move arrangement selection down',
            undoable: true,
            mutator: (s) => {
                // Move in reverse order to avoid conflicts
                for (let i = selection.length - 1; i >= 0; i--) {
                    const idx = selection[i];
                    const temp = s.songOrder[idx];
                    s.songOrder[idx] = s.songOrder[idx + 1];
                    s.songOrder[idx + 1] = temp;
                }
            },
        });
        // update selection to follow the moved items.
        nudgeSelectionAndFocusAnchor(1);
    };

    // const toggleThumbnails = () => {
    //     onSongChange({
    //         description: thumbnailPrefs.size === "off" ? "Enable arrangement thumbnails" : "Disable arrangement thumbnails",
    //         undoable: true,
    //         mutator: (s) => {
    //             s.arrangementThumbnailSize = s.arrangementThumbnailSize === "off" ? "normal" : "off";
    //         },
    //     });
    // };

    const patternDisplayName = (patternIndex: number) => {
        const pat = song.patterns[patternIndex]!;
        if (!pat) return "";
        return pat.name;
    };

    const focusRow = (positionIndex: number) => {
        const target = rowRefs[positionIndex];
        if (target) target.focus();
    };

    useWheelNavigator(containerRef, (e) => {
        const positionIndex = editorState.activeSongPosition;
        const maxIndex = Math.max(0, song.songOrder.length - 1);

        // deltaY > 0 means scrolling down (move cursor down)
        // deltaY < 0 means scrolling up (move cursor up)
        if (e.deltaY === 0) return;

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
            state.setActiveSongPosition(song, next);
        });

        focusRow(next);
    });

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
                    state.setActiveSongPosition(song, next);
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
                    state.setActiveSongPosition(song, next);
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

    const activeSongPosition = musicState.currentSomaticSongPosition ?? -1;

    const thumbnailCache = useMemo(() => new Map<string, React.ReactNode>(), []);
    const thumbnailsEnabled = song.arrangementThumbnailSize !== "off";
    const thumbnailToggleClass = [
        "arrangement-editor__command",
        thumbnailsEnabled && "arrangement-editor__command--active",
    ].filter(Boolean).join(" ");

    return (
        <div className="arrangement-editor">
            <div className="arrangement-editor__header">
            </div>
            <div className="arrangement-editor__content"
                ref={containerRef}
            // style overflow auto.
            //onWheel={(e) => handleWheel(e)}
            >
                {/*
                TODO: drag handle. but it's jank currently:
                - ESC needs to be handled (useListDragDrop should register a shortcut mgr)
                - scroll while dragging changes your selection; it should be locked in during drag
                - dragging beyond bounds should auto-scroll
                 {drag.hasSelection && drag.handleStyle && (
                    <div
                        className="arrangement-editor__drag-handle"
                        style={drag.handleStyle}
                        onMouseDown={drag.onHandleMouseDown}
                        title={drag.isCopy ? "Copy selection (Ctrl/Cmd toggles)" : "Drag to move; hold Ctrl/Cmd to copy"}
                    >
                        {CharMap.UpDown}
                    </div>
                )} */}
                {song.songOrder.map((orderItem, positionIndex) => {
                    const patternIndex = orderItem.patternIndex;
                    const clampedPattern = clamp(patternIndex ?? 0, 0, maxPatterns - 1);
                    const pattern = song.patterns[clampedPattern];
                    const isSelected = editorState.activeSongPosition === positionIndex;
                    const sel = editorState.selectedArrangementPositions;
                    const isInSelection = sel?.includesCoord({ x: 0, y: positionIndex }) || false;
                    const isPlaying = activeSongPosition === positionIndex;
                    const canDelete = song.songOrder.length > 1;
                    const isMatchingCursorPattern = cursorPatternIndex !== undefined && clampedPattern === cursorPatternIndex;
                    const thumbKey = pattern ? pattern.contentSignature() : `nopat-${clampedPattern}`;
                    const cacheKey = `${thumbKey}|${song.arrangementThumbnailSize}|${editorState.currentInstrument}|${song.rowsPerPattern}`;
                    let thumbnail = thumbnailCache.get(cacheKey);
                    if (thumbnail === undefined) {
                        thumbnail = renderThumbnail(song.subsystem.channelCount, pattern, song.rowsPerPattern, song.arrangementThumbnailSize, editorState.currentInstrument);
                        thumbnailCache.set(cacheKey, thumbnail);
                    }

                    // Determine if this is the first or last in selection
                    const isFirstInSelection = positionIndex === sel?.topInclusive(); //editorState.selectedArrangementPositions sortedSelection.length > 0 && positionIndex === sortedSelection[0];
                    const isLastInSelection = positionIndex === sel?.bottomInclusive();

                    const rowClass = [
                        "arrangement-editor__row",
                        "arrangement-editor__row--selection-container",
                        isSelected && "arrangement-editor__row--cursor",
                        isInSelection && "arrangement-editor__row--in-selection",
                        isFirstInSelection && "arrangement-editor__row--selection-first",
                        isLastInSelection && "arrangement-editor__row--selection-last",
                        isPlaying && "arrangement-editor__row--playing",
                        isMatchingCursorPattern && "arrangement-editor__row--pattern-match",
                    ].filter(Boolean).join(" ");

                    const controlsClass = [
                        "arrangement-editor__controls",
                    ].filter(Boolean).join(" ");

                    return (
                        // {drag.isDragging && drag.dropIndex === positionIndex && (
                        //     <div className="arrangement-editor__drop-line" />
                        // )}

                        <div
                            key={positionIndex}
                            className={rowClass}
                        >
                            <div
                                className={controlsClass}
                                tabIndex={0}
                                data-focus-bookmark="true"
                                ref={(el) => (rowRefs[positionIndex] = el)}
                                onKeyDown={(e) => handleKeyDown(e, positionIndex)}
                                onMouseDown={(e) => handleRowMouseDown(e, positionIndex)}
                                onMouseEnter={() => selection2d.onCellMouseEnter({ x: 0, y: positionIndex })}
                            >
                                <Tooltip title="Delete position">
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
                                </Tooltip>
                                <Tooltip title="Dec pattern">
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
                                </Tooltip>
                                <Tooltip title="Inc pattern">
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
                                </Tooltip>
                                <span className="arrangement-editor__position-id">
                                    {formatPatternIndex(positionIndex)}
                                </span>
                                <span
                                    className="arrangement-editor__pattern"
                                >
                                    {formatPatternIndex(clampedPattern)}
                                </span>
                                {thumbnail && (
                                    <div className="arrangement-editor__thumbnail-container" aria-hidden="true">
                                        {thumbnail}
                                    </div>
                                )}
                                <Tooltip title="Set visual marker for this position">
                                    <span className="arrangement-editor__marker">
                                        <SongOrderMarkerControl
                                            value={orderItem.markerVariant}
                                            onChange={(newVariant) => {
                                                onSongChange({
                                                    description: 'Change song order marker',
                                                    undoable: true,
                                                    mutator: (s) => {
                                                        s.songOrder[positionIndex]!.markerVariant = newVariant;
                                                    }
                                                });
                                            }}
                                        />
                                    </span>
                                </Tooltip>
                                <div
                                    className="arrangement-editor__pattern-name-container"
                                    style={{ flexGrow: 1 }}
                                >
                                    <span
                                        className="arrangement-editor__pattern-name"
                                    >
                                        {patternDisplayName(clampedPattern)}
                                    </span>
                                </div>
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
                            {CharMap.Refresh}
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
                            {CharMap.OverlappingSquares}
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
                    <Tooltip title="Set marker for selected items">
                        <div className="arrangement-editor__command">
                            <SongOrderMarkerControl
                                value={(() => {
                                    const selection = getSelectionRange();
                                    if (selection.length > 0) {
                                        return song.songOrder[selection[0]]?.markerVariant ?? "default";
                                    }
                                    return "default";
                                })()}
                                onChange={(newMarker) => {
                                    const selection = getSelectionRange();
                                    if (selection.length > 0) {
                                        onSongChange({
                                            description: 'Set marker for selected items',
                                            undoable: true,
                                            mutator: (s) => {
                                                selection.forEach(pos => {
                                                    if (pos >= 0 && pos < s.songOrder.length) {
                                                        s.songOrder[pos]!.markerVariant = newMarker;
                                                    }
                                                });
                                            }
                                        });
                                    }
                                }}
                            />
                        </div>
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
                            {CharMap.Mul}
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
                            {CharMap.UpArrow}
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
                            {CharMap.DownArrow}
                        </button>
                    </Tooltip>
                    {/* <Tooltip title={thumbnailsEnabled ? "Hide thumbnails" : "Show thumbnails"}>
                        <button
                            type="button"
                            className={thumbnailToggleClass}
                            onClick={toggleThumbnails}
                            aria-pressed={thumbnailsEnabled}
                            aria-label="Toggle thumbnails"
                        >
                            <Icon path={mdiImageMultipleOutline} size={1} />
                        </button>
                    </Tooltip> */}
                </div>
            </div>
        </div>
    );
};