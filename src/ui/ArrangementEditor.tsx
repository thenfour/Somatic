import React, { useState } from "react";
import type { MusicState } from "../audio/backend";
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { SomaticCaps, Tic80Caps } from "../models/tic80Capabilities";
import { Pattern } from "../models/pattern";
import { clamp } from "../utils/utils";
import { useConfirmDialog } from "./confirm_dialog";
import { Tooltip } from "./tooltip";

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

    const [showPatternNames, setShowPatternNames] = useState(false);
    const [editingPatternNameIndex, setEditingPatternNameIndex] = useState<number | null>(null);
    const [editingPatternNameValue, setEditingPatternNameValue] = useState("");

    const formattedIndex = (index: number) => index.toString().padStart(2, "0");

    const ensurePatternExists = (s: Song, patternIndex: number) => {
        const target = clamp(patternIndex, 0, maxPatterns - 1);
        while (s.patterns.length <= target && s.patterns.length < maxPatterns) {
            s.patterns.push(new Pattern());
        }
        return target;
    };

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

    const handleAddPosition = () => {
        onSongChange((s) => {
            if (s.songOrder.length >= maxPositions) return;
            const last = s.songOrder[s.songOrder.length - 1] ?? 0;
            let next = clamp(last, 0, maxPatterns - 1);
            next = ensurePatternExists(s, next);
            s.songOrder.push(next);
        });
    };

    const handleSelectPosition = (positionIndex: number, _patternIndex: number, event?: React.MouseEvent) => {
        onEditorStateChange((state) => {
            if (event?.shiftKey && state.activeSongPosition !== positionIndex) {
                // Shift+click: select range from active position to clicked position
                const start = Math.min(state.activeSongPosition, positionIndex);
                const end = Math.max(state.activeSongPosition, positionIndex);
                const selection: number[] = [];
                for (let i = start; i <= end; i++) {
                    selection.push(i);
                }
                state.setArrangementSelection(selection);
            } else {
                // Normal click: clear selection and set active position
                state.setActiveSongPosition(positionIndex);
                state.setArrangementSelection([]);
            }
        });
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

    const activeSongPosition = musicState.somaticSongPosition ?? -1;

    return (
        <div className="arrangement-editor">
            <div className="arrangement-editor__header">
                <button
                    type="button"
                    className="arrangement-editor__toggle-names"
                    onClick={() => setShowPatternNames((v) => !v)}
                    aria-pressed={showPatternNames}
                    title="Toggle pattern names"
                >
                    Names
                </button>
            </div>
            <div className="arrangement-editor__content">
                {song.songOrder.map((patternIndex, positionIndex) => {
                    const clampedPattern = clamp(patternIndex ?? 0, 0, maxPatterns - 1);
                    const isSelected = editorState.activeSongPosition === positionIndex;
                    const isInSelection = editorState.selectedArrangementPositions.includes(positionIndex);
                    const isPlaying = activeSongPosition === positionIndex;
                    const canDelete = song.songOrder.length > 1;
                    const rowClass = [
                        "arrangement-editor__row",
                        isSelected && "arrangement-editor__row--selected",
                        isInSelection && "arrangement-editor__row--in-selection",
                        isPlaying && "arrangement-editor__row--playing",
                    ].filter(Boolean).join(" ");
                    return (
                        <div
                            key={positionIndex}
                            className={rowClass}
                            onClick={(e) => handleSelectPosition(positionIndex, clampedPattern, e)}
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
                                🗑️
                            </button>
                            <span className="arrangement-editor__position-id">{formattedIndex(positionIndex)}</span>
                            <button
                                type="button"
                                className="arrangement-editor__pattern"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectPosition(positionIndex, clampedPattern, e);
                                }}
                            >
                                {formattedIndex(clampedPattern)}
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
                            {showPatternNames && (
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
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="arrangement-editor__footer">
                <Tooltip title={`Add position at the end of the list`}>
                    <button
                        type="button"
                        className="arrangement-editor__add"
                        onClick={handleAddPosition}
                        disabled={song.songOrder.length >= maxPositions}
                        aria-label="Add position"
                    >
                        +
                    </button>
                </Tooltip>
            </div>
        </div>
    );
};