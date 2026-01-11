// todo: indicate when used (opacity i think)
// todo: keyboard nav on list + delete / insert below?
// todo: insert new instrument above / below. don't allow if kicking out used instruments
import React, { useMemo } from "react";

import { EditorState } from "../models/editor_state";
import { Tic80Instrument } from "../models/instruments";
import { Song } from "../models/song";
import { SomaticCaps } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";
import { AppPanelShell } from "./AppPanelShell";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { Button } from "./Buttons/PushButton";
import { InstrumentChip } from "./InstrumentChip";
import "./InstrumentsPanel.css";

export type InstrumentsPanelProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onClose: () => void;
};

// todo: dedupe built-in instrument creation.
const makeDefaultInstrumentForIndex = (instrumentIndex: number): Tic80Instrument => {
    const inst = new Tic80Instrument();
    if (instrumentIndex === 0) {
        inst.name = "dontuse";
    } else if (instrumentIndex === SomaticCaps.noteCutInstrumentIndex) {
        inst.name = "off";
        inst.volumeFrames.fill(0);
    } else {
        inst.name = `new inst ${instrumentIndex.toString(16).toUpperCase().padStart(2, "0")}`;
    }
    return inst;
};

// todo: prob move this to song
const swapInstrumentIndicesInPatterns = (song: Song, a: number, b: number) => {
    const maxInstrumentIndex = Math.max(song.instruments.length - 1, 0);
    for (const pattern of song.patterns) {
        for (const channel of pattern.channels) {
            for (const cell of channel.rows) {
                if (cell.instrumentIndex === undefined || cell.instrumentIndex === null) continue;
                const clamped = clamp(cell.instrumentIndex, 0, maxInstrumentIndex);
                // keep index sane even if song was loaded with out-of-range references
                cell.instrumentIndex = clamped;
                if (cell.instrumentIndex === a) cell.instrumentIndex = b;
                else if (cell.instrumentIndex === b) cell.instrumentIndex = a;
            }
        }
    }
};

const isReservedInstrument = (idx: number) => idx === 0 || idx === SomaticCaps.noteCutInstrumentIndex;

export const InstrumentsPanel: React.FC<InstrumentsPanelProps> = ({
    song,
    editorState,
    onSongChange,
    onEditorStateChange,
    onClose,
}) => {
    const instrumentCount = song.instruments.length;
    const selectedInstrument = clamp(editorState.currentInstrument, 0, instrumentCount - 1);


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
                swapInstrumentIndicesInPatterns(s, a, b);
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

    return (
        <AppPanelShell
            className="instruments-panel"
            title="Instruments"
            onClose={onClose}
        >
            <div className="instruments-panel__inner">
                <div className="instruments-panel__content">
                    {Array.from({ length: instrumentCount }, (_, idx) => {
                        const inst = song.instruments[idx]!;
                        const isSelected = idx === selectedInstrument;
                        return (
                            <button
                                key={idx}
                                type="button"
                                className={[
                                    "instruments-panel__row",
                                    isSelected ? "instruments-panel__row--selected" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                onClick={() => onEditorStateChange((st) => st.setCurrentInstrument(idx))}
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
