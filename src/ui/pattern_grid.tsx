import React, { forwardRef, useImperativeHandle, useMemo } from 'react';
import { AudioController } from '../audio/controller';
import type { MusicState } from '../audio/backend';
import { midiToName } from '../defs';
import { EditorState } from '../models/editor_state';
import { Pattern } from '../models/pattern';
import { Song } from '../models/song';
import { Tic80ChannelIndex, ToTic80ChannelIndex } from '../models/tic80Capabilities';

type CellType = 'note' | 'instrument' | 'command' | 'param';


const noteKeyMap = '-zsxdcvgbhnjmq2w3er5t6y7ui'.split('');
const instrumentKeyMap = '0123456789abcdef'.split('');
const commandKeyMap = 'mcjspvd'.split('');
const paramKeyMap = instrumentKeyMap;


const formatMidiNote = (midiNote: number | undefined | null) => {
    return !midiNote ? '---' : midiToName(midiNote);
};

const formatInstrument = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '--';
    return val.toString(16).toUpperCase();
};

const formatCommand = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '-';
    //return val.toString(16).toUpperCase();
    return commandKeyMap[val].toUpperCase() || '?';
};

const formatParam = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '--';
    return val.toString(16).toUpperCase().padStart(2, '0');
};

type PatternGridProps = {
    song: Song;
    audio: AudioController;
    musicState: MusicState;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
};

export type PatternGridHandle = {
    focusPattern: () => void;
};

export const PatternGrid = forwardRef<PatternGridHandle, PatternGridProps>(
    ({ song, audio, musicState, editorState, onEditorStateChange, onSongChange }, ref) => {
        const currentPosition = Math.max(0, Math.min(song.songOrder.length - 1, editorState.selectedPosition || 0));
        const currentPatternIndex = song.songOrder[currentPosition] ?? 0;
        const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, song.patterns.length - 1));
        const pattern: Pattern = song.patterns[safePatternIndex];
        //const [focusedCell, setFocusedCell] = useState<{ row: number; channel: number } | null>(null);
        const cellRefs = useMemo(
            () => Array.from({ length: 64 }, () => Array(16).fill(null) as (HTMLTableCellElement | null)[]),
            [],
        );
        const editingEnabled = editorState.editingEnabled !== false;

        const playbackSongPosition = musicState.chromaticSongPosition ?? -1;
        const playbackRowIndexRaw = musicState.tic80RowIndex ?? -1;
        const playbackPatternIndex = playbackSongPosition >= 0 && song.songOrder.length > 0
            ? song.songOrder[Math.min(playbackSongPosition, song.songOrder.length - 1)] ?? null
            : null;
        const isViewingActivePattern = playbackPatternIndex !== null && playbackPatternIndex === safePatternIndex;
        const activeRow = isViewingActivePattern && playbackRowIndexRaw >= 0
            ? Math.max(0, Math.min(song.rowsPerPattern - 1, playbackRowIndexRaw))
            : null;

        // const setRowValue = (channelIndex: number, rowIndex: number, field: 'note' | 'instrument', value: number) => {
        //     onSongChange((s) => {

        //         //s.patterns[editorState.patternIndex].channels[channelIndex].setRow(rowIndex, field, value);
        //     });
        // };

        const playRow = (rowIndex: number) => {
            audio.playRow(pattern, rowIndex);
        };

        const stopRow = () => audio.stop();

        const handleNoteKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string) => {
            const idx = noteKeyMap.indexOf(key);
            if (idx === -1) return;
            const midiNoteValue = idx + (editorState.octave - 1) * 12;
            //if (midiNoteValue > MAX_NOTE_NUM) return;

            onSongChange((s) => {
                const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                const pat = s.patterns[patIndex];
                const oldCell = pat.getCell(channelIndex, rowIndex);
                //const channel = pat.channels[channelIndex];
                //const row = channel.rows[rowIndex];
                //row.midiNote = midiNoteValue;
                //                channel.setRow(rowIndex, row);
                pat.setCell(channelIndex, rowIndex, {
                    ...oldCell,
                    midiNote: midiNoteValue,
                    instrumentIndex: editorState.currentInstrument,
                });
            });

            //setRowValue(channelIndex, rowIndex, 'note', midiNoteValue);
            //setRowValue(channelIndex, rowIndex, 'instrument', editorState.currentInstrument);
            if (!audio.isPlaying) playRow(rowIndex);
        };

        const handleInstrumentKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string) => {
            const idx = instrumentKeyMap.indexOf(key);
            if (idx === -1) return;
            onSongChange((s) => {
                const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                const pat = s.patterns[patIndex];
                const oldCell = pat.getCell(channelIndex, rowIndex);
                pat.setCell(channelIndex, rowIndex, {
                    ...oldCell,
                    instrumentIndex: idx,
                });
            });
            //setRowValue(channelIndex, rowIndex, 'instrument', idx);
            if (!audio.isPlaying) playRow(rowIndex);
        };

        const handleCommandKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string) => {
            const idx = commandKeyMap.indexOf(key);
            if (idx === -1) return;
            onSongChange((s) => {
                const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                const pat = s.patterns[patIndex];
                const oldCell = pat.getCell(channelIndex, rowIndex);
                pat.setCell(channelIndex, rowIndex, {
                    ...oldCell,
                    effect: idx,
                });
            });
        };

        const handleParamKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string) => {
            const idx = paramKeyMap.indexOf(key);
            if (idx === -1) return;
            onSongChange((s) => {
                const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                const pat = s.patterns[patIndex];
                const oldCell = pat.getCell(channelIndex, rowIndex);
                //console.log(`oldxy=[${oldCell.effectX},${oldCell.effectY}]; idx=${idx}; typeof(oldCell.effectX)=${typeof (oldCell.effectX)}`);
                const currentParam = oldCell.effectY ?? 0; // slide over Y to X
                //console.log(`currentParam=${currentParam}`);
                // Shift the current param left by 4 bits and add the new nibble
                const newParam = ((currentParam << 4) | idx) & 0xFF;
                const effectX = (newParam >> 4) & 0x0F;
                const effectY = newParam & 0x0F;
                //console.log(`newparam=${newParam}; XY=[${effectX}, ${effectY}]; currentParam=${currentParam}`);
                pat.setCell(channelIndex, rowIndex, {
                    ...oldCell,
                    effectX,
                    effectY,
                });
            });
        };

        const focusCell = (row: number, col: number) => {
            const target = cellRefs[row]?.[col];
            if (target) target.focus();
        };

        useImperativeHandle(ref, () => ({
            focusPattern() {
                const row = editorState.patternEditRow || 0;
                const col = (editorState.patternEditChannel || 0) * 4;
                focusCell(row, col);
            },
        }), [editorState.patternEditChannel, editorState.patternEditRow, focusCell]);

        const updateEditTarget = ({ rowIndex, channelIndex }: { rowIndex: number, channelIndex: Tic80ChannelIndex }) => {
            //const channelIndex = Math.floor(col / 4);
            onEditorStateChange((s) => s.setPatternEditTarget({ rowIndex, channelIndex }));
        };

        const handleArrowNav = (row: number, col: number, key: string, ctrlKey: boolean): readonly [number, number] | null => {
            const rowCount = song.rowsPerPattern;
            const colCount = 16;
            const jumpSize = Math.max(song.highlightRowCount || 1, 1);
            if (key === 'ArrowUp') {
                if (ctrlKey) {
                    return [(row + rowCount - 4) % rowCount, col] as const;
                }
                return [(row + rowCount - 1) % rowCount, col] as const;
            }
            if (key === 'ArrowDown') {
                if (ctrlKey) {
                    return [(row + 4) % rowCount, col] as const;
                }
                return [(row + 1) % rowCount, col] as const;
            }
            if (key === 'ArrowLeft') {
                if (ctrlKey) {
                    // Move to previous channel (keep same cell type within channel)
                    const currentChannel = Math.floor(col / 4);
                    const cellTypeOffset = col % 4;
                    const targetChannel = (currentChannel + 4 - 1) % 4;
                    const targetCol = targetChannel * 4 + cellTypeOffset;
                    return [row, targetCol] as const;
                }
                return [row, (col + colCount - 1) % colCount] as const;
            }
            if (key === 'ArrowRight') {
                if (ctrlKey) {
                    // Move to next channel (keep same cell type within channel)
                    const currentChannel = Math.floor(col / 4);
                    const cellTypeOffset = col % 4;
                    const targetChannel = (currentChannel + 1) % 4;
                    const targetCol = targetChannel * 4 + cellTypeOffset;
                    return [row, targetCol] as const;
                }
                return [row, (col + 1) % colCount] as const;
            }
            if (key === 'PageUp') {
                const currentBlock = Math.floor(row / jumpSize);
                const targetBlock = currentBlock - 1;
                const targetRow = (targetBlock * jumpSize + rowCount) % rowCount;
                return [targetRow, col] as const;
            }
            if (key === 'PageDown') {
                const currentBlock = Math.floor(row / jumpSize);
                const targetBlock = currentBlock + 1;
                const targetRow = (targetBlock * jumpSize) % rowCount;
                return [targetRow, col] as const;
            }
            if (key === 'Home') {
                return [0, col] as const;
            }
            if (key === 'End') {
                return [rowCount - 1, col] as const;
            }
            return null;
        };

        const onCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
            const target = e.currentTarget;
            const rowIndex = parseInt(target.dataset.rowIndex!, 10);
            const channelIndex = parseInt(target.dataset.channelIndex!, 10) as Tic80ChannelIndex;
            const cellType = target.dataset.cellType as CellType;
            //const colOffset = cellType === 'note' ? 0 : cellType === 'instrument' ? 1 : cellType === 'command' ? 2 : 3;
            const columnIndex = parseInt(target.dataset.columnIndex!, 10);
            //const col = channelIndex * 4 + colOffset;

            //setFocusedCell({ row: rowIndex, channel: channelIndex });

            const navTarget = handleArrowNav(rowIndex, columnIndex, e.key, e.ctrlKey);
            if (navTarget) {
                focusCell(navTarget[0], navTarget[1]);
                e.preventDefault();
                return;
            }

            updateEditTarget({ rowIndex, channelIndex });

            if (!editingEnabled) return;

            if (cellType === 'note' && noteKeyMap.includes(e.key) && !e.repeat) {
                handleNoteKey(channelIndex, rowIndex, e.key);
            } else if (cellType === 'instrument' && instrumentKeyMap.includes(e.key) && !e.repeat) {
                handleInstrumentKey(channelIndex, rowIndex, e.key);
            } else if (cellType === 'command' && commandKeyMap.includes(e.key) && !e.repeat) {
                handleCommandKey(channelIndex, rowIndex, e.key);
            } else if (cellType === 'param' && paramKeyMap.includes(e.key) && !e.repeat) {
                handleParamKey(channelIndex, rowIndex, e.key);
            } else if (e.key === '0' && cellType === 'note' && !e.repeat) {
                onSongChange((s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, { ...oldCell, midiNote: undefined });
                });
            }
        };

        const onCellKeyUp = () => {
            stopRow();
        };

        const onCellFocus = (rowIndex: number, channelIndex: Tic80ChannelIndex, col: number) => {
            updateEditTarget({ rowIndex, channelIndex });
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
                                <th key={i} colSpan={4}>{i + 1}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: song.rowsPerPattern }, (_, rowIndex) => {
                            const chunkSize = Math.max(song.highlightRowCount || 1, 1);
                            const sectionIndex = Math.floor(rowIndex / chunkSize) % 2;
                            const rowClass = `${sectionIndex === 0 ? 'row-section-a' : 'row-section-b'}${activeRow === rowIndex ? ' active-row' : ''}`;
                            return (
                                <tr key={rowIndex} className={rowClass}>
                                    <td className="row-number">{rowIndex}</td>
                                    {pattern.channels.map((channel, channelIndexRaw) => {
                                        const channelIndex = ToTic80ChannelIndex(channelIndexRaw);
                                        const row = channel.rows[rowIndex];
                                        const noteText = formatMidiNote(row.midiNote);
                                        const instText = formatInstrument(row.instrumentIndex);
                                        const cmdText = formatCommand(row.effect);
                                        const paramText = formatParam(row.effectX !== undefined && row.effectY !== undefined ? (row.effectX << 4) | row.effectY : undefined);
                                        const noteCol = channelIndex * 4;
                                        const instCol = channelIndex * 4 + 1;
                                        const cmdCol = channelIndex * 4 + 2;
                                        const paramCol = channelIndex * 4 + 3;
                                        const isNoteEmpty = !row.midiNote;
                                        const isMetaFocused = editorState.patternEditChannel === channelIndex && editorState.patternEditRow === rowIndex;//focusedCell?.row === rowIndex && focusedCell?.channel === channelIndex;
                                        const noteClass = `note-cell${isNoteEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}`;
                                        const instClass = `instrument-cell${isNoteEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}`;
                                        const cmdClass = `command-cell${isNoteEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}`;
                                        const paramClass = `param-cell${isNoteEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}`;
                                        return (
                                            <React.Fragment key={channelIndex}>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][noteCol] = el)}
                                                    className={noteClass}
                                                    onKeyDown={onCellKeyDown}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => onCellFocus(rowIndex, channelIndex, noteCol)}
                                                    //onBlur={onCellBlur}
                                                    data-row-index={rowIndex}
                                                    data-channel-index={channelIndex}
                                                    data-cell-type="note"
                                                    data-column-index={noteCol}
                                                >
                                                    {noteText}
                                                </td>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][instCol] = el)}
                                                    className={instClass}
                                                    onKeyDown={onCellKeyDown}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => onCellFocus(rowIndex, channelIndex, instCol)}
                                                    //onBlur={onCellBlur}
                                                    data-row-index={rowIndex}
                                                    data-channel-index={channelIndex}
                                                    data-cell-type="instrument"
                                                    data-column-index={instCol}
                                                >
                                                    {instText}
                                                </td>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][cmdCol] = el)}
                                                    className={cmdClass}
                                                    onKeyDown={onCellKeyDown}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => onCellFocus(rowIndex, channelIndex, cmdCol)}
                                                    //onBlur={onCellBlur}
                                                    data-row-index={rowIndex}
                                                    data-channel-index={channelIndex}
                                                    data-cell-type="command"
                                                    data-column-index={cmdCol}
                                                >
                                                    {cmdText}
                                                </td>
                                                <td
                                                    tabIndex={0}
                                                    ref={(el) => (cellRefs[rowIndex][paramCol] = el)}
                                                    className={paramClass}
                                                    onKeyDown={onCellKeyDown}
                                                    onKeyUp={onCellKeyUp}
                                                    onFocus={() => onCellFocus(rowIndex, channelIndex, paramCol)}
                                                    //onBlur={onCellBlur}
                                                    data-row-index={rowIndex}
                                                    data-channel-index={channelIndex}
                                                    data-cell-type="param"
                                                    data-column-index={paramCol}
                                                >
                                                    {paramText}
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
