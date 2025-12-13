import React, { useEffect, useMemo, useRef, useState } from "react";
import { NOTES_BY_NUM, MAX_NOTE_NUM } from "../defs";

const formatNote = (note) => (note === 0 ? "---" : NOTES_BY_NUM[note].name);
const formatInstrument = (val) => val.toString(16).toUpperCase();

const noteKeyMap = "-zsxdcvgbhnjmq2w3er5t6y7ui".split("");
const instrumentKeyMap = "0123456789abcdef".split("");

export const PatternGrid = ({ song, audio, editorState, onSongChange }) => {
    const pattern = song.patterns[editorState.pattern];
    const [activeRow, setActiveRow] = useState(null);
    const cellRefs = useMemo(() => Array.from({ length: 64 }, () => Array(8).fill(null)), []);

    useEffect(() => {
        if (!audio) return undefined;
        const onRow = (rowNumber, patternPlaying) => {
            if (patternPlaying === pattern) {
                setActiveRow(rowNumber);
            } else {
                setActiveRow(null);
            }
        };
        const onStop = () => setActiveRow(null);
        audio.on("row", onRow);
        audio.on("stop", onStop);
        return () => {
            audio.removeListener("row", onRow);
            audio.removeListener("stop", onStop);
        };
    }, [audio, pattern]);

    const setRowValue = (channelIndex, rowIndex, field, value) => {
        onSongChange((s) => {
            s.patterns[editorState.pattern].channels[channelIndex].setRow(rowIndex, field, value);
        });
    };

    const playRow = (rowIndex) => {
        audio.playRow(pattern, rowIndex);
    };

    const stopRow = () => audio.stop();

    const handleNoteKey = (channelIndex, rowIndex, key) => {
        const idx = noteKeyMap.indexOf(key);
        if (idx === -1) return;
        const noteVal = idx + (editorState.octave - 1) * 12;
        if (noteVal > MAX_NOTE_NUM) return;
        setRowValue(channelIndex, rowIndex, "note", noteVal);
        if (!audio.isPlaying) playRow(rowIndex);
    };

    const handleInstrumentKey = (channelIndex, rowIndex, key) => {
        const idx = instrumentKeyMap.indexOf(key);
        if (idx === -1) return;
        setRowValue(channelIndex, rowIndex, "instrument", idx);
        if (!audio.isPlaying) playRow(rowIndex);
    };

    const focusCell = (row, col) => {
        const target = cellRefs[row]?.[col];
        if (target) target.focus();
    };

    const handleArrowNav = (row, col, key) => {
        const rowCount = 64;
        const colCount = 8;
        if (key === "ArrowUp") return [((row + rowCount - 1) % rowCount), col];
        if (key === "ArrowDown") return [((row + 1) % rowCount), col];
        if (key === "ArrowLeft") return [row, ((col + colCount - 1) % colCount)];
        if (key === "ArrowRight") return [row, ((col + 1) % colCount)];
        if (key === "PageUp") return [0, col];
        if (key === "PageDown") return [rowCount - 1, col];
        return null;
    };

    const onCellKeyDown = (row, col, e) => {
        const navTarget = handleArrowNav(row, col, e.key);
        if (navTarget) {
            focusCell(navTarget[0], navTarget[1]);
            e.preventDefault();
            return;
        }

        const channelIndex = Math.floor(col / 2);
        const channelColumn = col % 2;
        if (channelColumn === 0 && noteKeyMap.includes(e.key) && !e.repeat) {
            handleNoteKey(channelIndex, row, e.key);
        } else if (channelColumn === 1 && instrumentKeyMap.includes(e.key) && !e.repeat) {
            handleInstrumentKey(channelIndex, row, e.key);
        } else if (e.key === "0" && channelColumn === 0 && !e.repeat) {
            setRowValue(channelIndex, row, "note", 0);
        }
    };

    const onCellKeyUp = () => {
        stopRow();
    };

    return (
        <table className="pattern-grid">
            <colgroup>
                <col />
            </colgroup>
            <thead>
                <tr>
                    <th></th>
                    {[0, 1, 2, 3].map((i) => (
                        <th key={i} colSpan={2}>{i + 1}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {pattern.channels[0].rows.map((_, rowIndex) => (
                    <tr key={rowIndex} className={activeRow === rowIndex ? "active-row" : ""}>
                        <td className="row-number">{rowIndex}</td>
                        {pattern.channels.map((channel, channelIndex) => {
                            const row = channel.rows[rowIndex];
                            const noteText = formatNote(row.note);
                            const instText = formatInstrument(row.instrument);
                            const noteCol = channelIndex * 2;
                            const instCol = channelIndex * 2 + 1;
                            return (
                                <React.Fragment key={channelIndex}>
                                    <td
                                        tabIndex={0}
                                        ref={(el) => (cellRefs[rowIndex][noteCol] = el)}
                                        onKeyDown={(e) => onCellKeyDown(rowIndex, noteCol, e)}
                                        onKeyUp={onCellKeyUp}
                                    >
                                        {noteText}
                                    </td>
                                    <td
                                        tabIndex={0}
                                        ref={(el) => (cellRefs[rowIndex][instCol] = el)}
                                        onKeyDown={(e) => onCellKeyDown(rowIndex, instCol, e)}
                                        onKeyUp={onCellKeyUp}
                                    >
                                        {instText}
                                    </td>
                                </React.Fragment>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
};
