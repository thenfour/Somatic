import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { AudioController } from '../audio/controller';
import { MAX_NOTE_NUM, midiToName } from '../defs';
import { EditorState } from '../models/editor_state';
import { Pattern } from '../models/pattern';
import { Song } from '../models/song';

const formatMidiNote = (midiNote: number | undefined | null) => {
    return !midiNote ? '---' : midiToName(midiNote);
};

const formatInstrument = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '--';
    return val.toString(16).toUpperCase();
};

const noteKeyMap = '-zsxdcvgbhnjmq2w3er5t6y7ui'.split('');
const instrumentKeyMap = '0123456789abcdef'.split('');

type PatternGridProps = {
    song: Song;
    audio: AudioController;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
};

export type PatternGridHandle = {
    focusPattern: () => void;
};

export const PatternGrid = forwardRef<PatternGridHandle, PatternGridProps>(
    ({ song, audio, editorState, onEditorStateChange, onSongChange }, ref) => {
        const pattern: Pattern = song.patterns[editorState.patternIndex];
        const [activeRow, setActiveRow] = useState<number | null>(null);
        const cellRefs = useMemo(
            () => Array.from({ length: 64 }, () => Array(8).fill(null) as (HTMLTableCellElement | null)[]),
            [],
        );
        const editingEnabled = editorState.editingEnabled !== false;

        useEffect(() => {
            if (!audio) return undefined;
            const onRow = (rowNumber: number, patternPlaying: Pattern) => {
                if (patternPlaying === pattern) {
                    setActiveRow(rowNumber);
                } else {
                    setActiveRow(null);
                }
            };
            const onStop = () => setActiveRow(null);
            const offRow = audio.onRow(onRow);
            const offStop = audio.onStop(onStop);
            return () => {
                offRow();
                offStop();
            };
        }, [audio, pattern]);

        const setRowValue = (channelIndex: number, rowIndex: number, field: 'note' | 'instrument', value: number) => {
            onSongChange((s) => {

                //s.patterns[editorState.patternIndex].channels[channelIndex].setRow(rowIndex, field, value);
            });
        };

        const playRow = (rowIndex: number) => {
            audio.playRow(pattern, rowIndex);
        };

        const stopRow = () => audio.stop();

        const handleNoteKey = (channelIndex: number, rowIndex: number, key: string) => {
            const idx = noteKeyMap.indexOf(key);
            if (idx === -1) return;
            const midiNoteValue = idx + (editorState.octave - 1) * 12;
            if (midiNoteValue > MAX_NOTE_NUM) return;
            setRowValue(channelIndex, rowIndex, 'note', midiNoteValue);
            setRowValue(channelIndex, rowIndex, 'instrument', editorState.currentInstrument);
            if (!audio.isPlaying) playRow(rowIndex);
        };

        const handleInstrumentKey = (channelIndex: number, rowIndex: number, key: string) => {
            const idx = instrumentKeyMap.indexOf(key);
            if (idx === -1) return;
            setRowValue(channelIndex, rowIndex, 'instrument', idx);
            if (!audio.isPlaying) playRow(rowIndex);
        };

        const focusCell = (row: number, col: number) => {
            const target = cellRefs[row]?.[col];
            if (target) target.focus();
        };

        useImperativeHandle(ref, () => ({
            focusPattern() {
                const row = editorState.patternEditRow || 0;
                const col = (editorState.patternEditChannel || 0) * 2;
                focusCell(row, col);
            },
        }), [editorState.patternEditChannel, editorState.patternEditRow, focusCell]);

        const updateEditTarget = (row: number, col: number) => {
            const channelIndex = Math.floor(col / 2);
            onEditorStateChange((s) => s.setPatternEditTarget(row, channelIndex));
        };

        const handleArrowNav = (row: number, col: number, key: string) => {
            const rowCount = 64;
            const colCount = 8;
            if (key === 'ArrowUp') return [(row + rowCount - 1) % rowCount, col] as const;
            if (key === 'ArrowDown') return [(row + 1) % rowCount, col] as const;
            if (key === 'ArrowLeft') return [row, (col + colCount - 1) % colCount] as const;
            if (key === 'ArrowRight') return [row, (col + 1) % colCount] as const;
            if (key === 'PageUp') return [0, col] as const;
            if (key === 'PageDown') return [rowCount - 1, col] as const;
            return null;
        };

        const onCellKeyDown = (row: number, col: number, e: React.KeyboardEvent<HTMLTableCellElement>) => {
            const navTarget = handleArrowNav(row, col, e.key);
            if (navTarget) {
                focusCell(navTarget[0], navTarget[1]);
                e.preventDefault();
                return;
            }

            updateEditTarget(row, col);

            if (!editingEnabled) return;

            const channelIndex = Math.floor(col / 2);
            const channelColumn = col % 2;
            if (channelColumn === 0 && noteKeyMap.includes(e.key) && !e.repeat) {
                handleNoteKey(channelIndex, row, e.key);
            } else if (channelColumn === 1 && instrumentKeyMap.includes(e.key) && !e.repeat) {
                handleInstrumentKey(channelIndex, row, e.key);
            } else if (e.key === '0' && channelColumn === 0 && !e.repeat) {
                setRowValue(channelIndex, row, 'note', 0);
            }
        };

        const onCellKeyUp = () => {
            stopRow();
        };

        return (
            <div className={`pattern-grid-container${editingEnabled ? '' : ' pattern-grid-container--locked'}`}>
                {!editingEnabled && (
                    <div className="edit-locked-banner" role="status" aria-label="Editing disabled">
                        <span className="edit-locked-banner__dot" aria-hidden="true" />
                        <span className="edit-locked-banner__text">Edit mode is off</span>
                    </div>
                )}
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
                        {pattern.channels[0].rows.map((_, rowIndex) => {
                            const chunkSize = Math.max(song.highlightRowCount || 1, 1);
                            const sectionIndex = Math.floor(rowIndex / chunkSize) % 2;
                            const rowClass = `${sectionIndex === 0 ? 'row-section-a' : 'row-section-b'}${activeRow === rowIndex ? ' active-row' : ''}`;
                            return (
                                <tr key={rowIndex} className={rowClass}>
                                    <td className="row-number">{rowIndex}</td>
                                    {pattern.channels.map((channel, channelIndex) => {
                                        const row = channel.rows[rowIndex];
                                        const noteText = formatMidiNote(row.midiNote);
                                        const instText = formatInstrument(row.instrumentIndex);
                                        const noteCol = channelIndex * 2;
                                        const instCol = channelIndex * 2 + 1;
                                        const isNoteEmpty = !row.midiNote;
                                        const noteClass = `note-cell${isNoteEmpty ? ' empty-cell' : ''}`;
                                        const instClass = `instrument-cell${isNoteEmpty ? ' empty-cell' : ''}`;
                                        return (
                                            <React.Fragment key={channelIndex}>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][noteCol] = el)}
                                                    className={noteClass}
                                                    onKeyDown={(e) => onCellKeyDown(rowIndex, noteCol, e)}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => updateEditTarget(rowIndex, noteCol)}
                                                >
                                                    {noteText}
                                                </td>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][instCol] = el)}
                                                    className={instClass}
                                                    onKeyDown={(e) => onCellKeyDown(rowIndex, instCol, e)}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => updateEditTarget(rowIndex, instCol)}
                                                >
                                                    {instText}
                                                </td>
                                            </React.Fragment>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    });
