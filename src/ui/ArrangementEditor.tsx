import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { Tic80Caps } from "../models/tic80Capabilities";
import { Pattern } from "../models/pattern";
import { clamp } from "../utils/utils";
import { useConfirmDialog } from "./confirm_dialog";

export const ArrangementEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onEditorStateChange, onSongChange }) => {
    const { confirm } = useConfirmDialog();
    const maxPatterns = Tic80Caps.pattern.count;
    const maxPositions = Tic80Caps.arrangement.count;

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
            state.setSelectedPosition(positionIndex);
        });
    };

    const deletePosition = (positionIndex: number) => {
        onSongChange((s) => {
            if (s.songOrder.length <= 1) return; // keep at least one position
            if (positionIndex < 0 || positionIndex >= s.songOrder.length) return;
            s.songOrder.splice(positionIndex, 1);
        });
        onEditorStateChange((state) => {
            if (state.selectedPosition >= positionIndex && state.selectedPosition > 0) {
                state.setSelectedPosition(state.selectedPosition - 1);
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

    const handleSelectPosition = (positionIndex: number, _patternIndex: number) => {
        onEditorStateChange((state) => {
            state.setSelectedPosition(positionIndex);
        });
    };

    return (
        <div className="arrangement-editor">
            {song.songOrder.map((patternIndex, positionIndex) => {
                const clampedPattern = clamp(patternIndex ?? 0, 0, maxPatterns - 1);
                const isSelected = editorState.selectedPosition === positionIndex;
                const canDelete = song.songOrder.length > 1;
                return (
                    <div
                        key={positionIndex}
                        className={
                            isSelected
                                ? "arrangement-editor__row arrangement-editor__row--selected"
                                : "arrangement-editor__row"
                        }
                        onClick={() => handleSelectPosition(positionIndex, clampedPattern)}
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
                            className="arrangement-editor__pattern"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSelectPosition(positionIndex, clampedPattern);
                            }}
                        >
                            {formattedIndex(clampedPattern)}
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
                    </div>
                );
            })}
            <div className="arrangement-editor__footer">
                <button
                    type="button"
                    className="arrangement-editor__add"
                    onClick={handleAddPosition}
                    disabled={song.songOrder.length >= maxPositions}
                    aria-label="Add position"
                >
                    +
                </button>
            </div>
        </div>
    );
};