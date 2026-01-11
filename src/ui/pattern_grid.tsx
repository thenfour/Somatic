import React, { forwardRef, KeyboardEvent, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { SomaticTransportState, Tic80TransportState } from '../audio/backend';
import { AudioController } from '../audio/controller';
import { midiToName } from '../defs';
import { useClipboard } from '../hooks/useClipboard';
import { useActionHandler } from '../keyb/useActionHandler';
import { EditorState } from '../models/editor_state';
import { analyzePatternPlaybackForGrid, isNoteCut, Pattern, PatternCell } from '../models/pattern';
import { formatPatternIndex, Song } from '../models/song';
import { gChannelsArray, SomaticCaps, SomaticEffectCommand, SomaticPatternCommand, SOMATIC_PATTERN_COMMAND_KEYS, SOMATIC_PATTERN_COMMAND_LETTERS, Tic80Caps, Tic80ChannelIndex, ToTic80ChannelIndex } from '../models/tic80Capabilities';
import { CharMap, clamp, Coord2D, numericRange } from '../utils/utils';
import { AdvancedEditScope, InterpolateTarget, PatternAdvancedPanel, ScopeValue } from './PatternAdvancedPanel';
import { useToasts } from './toast_provider';
import { Tooltip } from './basic/tooltip';
import { SelectionRect2D, useRectSelection2D } from '../hooks/useRectSelection2D';
import { changeInstrumentInPattern, interpolatePatternValues, RowRange, setInstrumentInPattern, transposeCellsInPattern, nudgeInstrumentInPattern } from '../utils/advancedPatternEdit';
import { useRenderAlarm } from '../hooks/useRenderAlarm';
import './pattern_grid.css';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { GlobalActionId } from '../keyb/ActionIds';

type CellType = 'note' | 'instrument' | 'command' | 'param';

type ExtendedCellType = CellType | 'somaticCommand' | 'somaticParam';

const CELLS_PER_CHANNEL = 6;
const CELL_STRIDE_PER_CHANNEL = 7; // includes non-interactive cells between chans
const CTRL_ARROW_JUMP_SIZE = 4;

const instrumentKeyMap = '0123456789abcdef'.split('');
const commandKeyMap = 'mcjspvd'.split('');
const paramKeyMap = instrumentKeyMap;

const somaticCommandKeyMap = Object.keys(SOMATIC_PATTERN_COMMAND_KEYS);
const somaticParamKeyMap = instrumentKeyMap;


const formatMidiNote = (midiNote: number | undefined | null) => {
    return !midiNote ? '---' : midiToName(midiNote);
};

const formatInstrumentLabel = (val: number | undefined | null): string => {
    if (val === null || val === undefined) return '--';
    return (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
};

const formatInstrumentTooltip = (instId: number | undefined | null, song: Song): string | null => {
    if (instId === null || instId === undefined) return null;
    const inst = song.getInstrument(instId);
    if (!inst) return null;
    return `${(instId & 0xFF).toString(16).toUpperCase().padStart(2, '0')}: ${inst.name}`;
};

const formatInstrument = (val: number | undefined | null, song: Song): [string, string | null] => {
    return [formatInstrumentLabel(val), formatInstrumentTooltip(val, song)];
};

const formatCommand = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '-';
    //return val.toString(16).toUpperCase();
    return `${commandKeyMap[val].toUpperCase()}` || '?';
};

const formatSomaticCommand = (val: number | undefined | null) => {
    if (val === null || val === undefined) return '-';
    const letter = SOMATIC_PATTERN_COMMAND_LETTERS[val as SomaticPatternCommand];
    return letter || '?';
};

const formatParams = (valX: number | undefined | null, valY: number | undefined | null) => {
    // if (valX === null || valX === undefined || valY === null || valY === undefined) return '--';
    // return `${valX.toString(16).toUpperCase().padStart(1, '0')}${valY.toString(16).toUpperCase().padStart(1, '0')}`;

    // if BOTH are undefined/null, return '--'
    if (valX == null && valY == null) return '--';
    const paramXStr = (valX == null) ? '-' : valX.toString(16).toUpperCase();
    const paramYStr = (valY == null) ? '-' : valY.toString(16).toUpperCase();
    return `${paramXStr}${paramYStr}`;
};

const formatSomaticParam = (val: number | undefined | null) => {
    if (val == null) return '--';
    return (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
};

type PatternGridProps = {
    song: Song;
    audio: AudioController;
    musicState: SomaticTransportState;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    advancedEditPanelOpen: boolean;
    onSetAdvancedEditPanelOpen: (open: boolean) => void;
    highlightSelectedInstrument: boolean;
};

export type PatternGridHandle = {
    focusPattern: () => void;
    focusCellAdvancedToRow: (rowIndex: number) => void; // after editstep changes, set focus to this row. we will keep the same column as current.
    transposeNotes: (amount: number, scope: AdvancedEditScope) => void;
    nudgeInstrumentInSelection: (amount: number, scope: AdvancedEditScope) => void;
};

const PATTERN_CLIPBOARD_TYPE = 'somatic-pattern-block';

type PatternClipboardPayload = {
    type: typeof PATTERN_CLIPBOARD_TYPE;
    version: 1;
    rows: number;
    channels: number;
    cells: PatternCell[][]; // row-major order
};


type ScopeTargets = {
    patternIndices: number[];
    channels: number[];
    rowRange: RowRange;
};

const normalizeInstrumentValue = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return clamp(Math.floor(value), 0, Tic80Caps.sfx.count - 1);
};


export const PatternGrid = forwardRef<PatternGridHandle, PatternGridProps>(
    ({ song, audio, musicState, editorState, onEditorStateChange, onSongChange, advancedEditPanelOpen, onSetAdvancedEditPanelOpen, highlightSelectedInstrument }, ref) => {
        const mgr = useShortcutManager<GlobalActionId>();
        const currentPosition = clamp(editorState.activeSongPosition ?? 0, 0, song.songOrder.length - 1); // Math.max(0, Math.min(song.songOrder.length - 1, editorState.activeSongPosition || 0));
        const currentSongOrderItem = song.songOrder[currentPosition] ?? null;
        const currentPatternIndex = currentSongOrderItem?.patternIndex ?? 0;
        const safePatternIndex = clamp(currentPatternIndex, 0, song.patterns.length - 1);
        const [currentColumnIndex, setCurrentColumnIndex] = useState(0);
        const pattern: Pattern = song.patterns[safePatternIndex];
        const playbackAnalysis = useMemo(
            () => analyzePatternPlaybackForGrid(song, safePatternIndex),
            [song, safePatternIndex],
        );
        const { fxCarryByChannel, kRateRenderSlotConflictByRow } = playbackAnalysis;

        const fxCarryTooltip = `Effect command state at the end of this pattern (doesn't consider previous patterns)`;
        const cellRefs = useMemo(
            () => Array.from({ length: 64 }, () => Array(CELLS_PER_CHANNEL * Tic80Caps.song.audioChannels).fill(null) as (HTMLTableCellElement | null)[]),
            [],
        );
        const editingEnabled = editorState.editingEnabled !== false;
        const clipboard = useClipboard();
        const { pushToast } = useToasts();

        const pendingInstrumentEntryRef = useRef<{
            rowIndex: number;
            channelIndex: Tic80ChannelIndex;
            hiNibble: number;
        } | null>(null);

        const clearPendingInstrumentEntry = useCallback(() => {
            pendingInstrumentEntryRef.current = null;
        }, []);

        useEffect(() => {
            if (!editingEnabled) {
                clearPendingInstrumentEntry();
            }
        }, [editingEnabled, clearPendingInstrumentEntry]);

        const selection2d = useRectSelection2D({
            selection: editorState.patternSelection,
            onChange: (r) => onEditorStateChange((s) => {
                s.setPatternSelection(r);
            }),
            clampCoord: (coord) => {
                return {
                    x: clamp(coord.x, 0, Tic80Caps.song.audioChannels - 1),
                    y: clamp(coord.y, 0, song.rowsPerPattern - 1),
                };
            },
        });

        useRenderAlarm({
            name: 'PatternGrid',
        });

        const resolveScopeTargets = useCallback((scope: ScopeValue): ScopeTargets | null => {
            const lastRow = Math.max(song.rowsPerPattern - 1, 0);
            const fullRowRange: RowRange = { start: 0, end: lastRow };
            const patternCount = song.patterns.length;
            const allPatternIndices = Array.from({ length: patternCount }, (_, idx) => idx);

            switch (scope) {
                case 'selection': {
                    const sel = editorState.patternSelection;
                    if (!sel || sel.isNull()) {
                        pushToast({ message: 'Select a block before using Selection scope.', variant: 'error' });
                        return null;
                    }

                    const targets = {
                        patternIndices: [safePatternIndex],
                        channels: numericRange(sel.leftInclusive()!, sel.columnCount()!),
                        //rowRange: { start: sel.topInclusive()!, end: sel.topInclusive()! + sel.rowCount()! - 1 },
                        rowRange: {
                            start: sel.topInclusive()!,
                            end: sel.topInclusive()! + sel.rowCount()! - 1,
                        }
                    };

                    return targets;
                }
                case 'channel-pattern':
                    const channelPatternTargets = {
                        patternIndices: [safePatternIndex],
                        channels: [editorState.patternEditChannel],
                        rowRange: fullRowRange,
                    };
                    return channelPatternTargets;
                case 'channel-song':
                    const channelSongTargets = {
                        patternIndices: allPatternIndices,
                        channels: [editorState.patternEditChannel],
                        rowRange: fullRowRange,
                    };
                    return channelSongTargets;
                case 'pattern':
                    const patternTargets = {
                        patternIndices: [safePatternIndex],
                        channels: [...gChannelsArray],
                        rowRange: fullRowRange,
                    };
                    return patternTargets;
                case 'song':
                    const songTargets = {
                        patternIndices: allPatternIndices,
                        channels: [...gChannelsArray],
                        rowRange: fullRowRange,
                    };
                    return songTargets;
                default:
                    return null;
            }
        }, [editorState.patternEditChannel, pushToast, safePatternIndex, editorState.patternSelection, song.patterns.length, song.rowsPerPattern]);

        const handleTranspose = useCallback((amount: number, scope: AdvancedEditScope) => {
            if (!amount) {
                return;
            }
            const targets = resolveScopeTargets(scope.scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to transpose in that scope.', variant: 'error' });
                return;
            }
            onSongChange({
                description: amount > 0 ? 'Transpose selection up' : 'Transpose selection down',
                undoable: true,
                mutator: (nextSong) => {
                    let mutated = false;
                    for (const patternIndex of patternIndices) {
                        const targetPattern = nextSong.patterns[patternIndex];
                        if (!targetPattern) continue;
                        if (transposeCellsInPattern(targetPattern, channels, rowRange, nextSong.rowsPerPattern, amount, scope.instrumentIndex)) {
                            mutated = true;
                        }
                    }
                    if (!mutated) {
                        pushToast({ message: 'No notes found to transpose in that scope.', variant: 'info' });
                    }
                },
            });
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const runInstrumentMutationInScope = useCallback(
            (
                scope: AdvancedEditScope,
                mutatePattern: (pattern: Pattern, channels: number[], rowRange: RowRange, rowsPerPattern: number, instrumentIndex: number | null) => boolean,
                noMutatedMessage: string,
            ) => {
                const targets = resolveScopeTargets(scope.scope);
                if (!targets) return;
                const { patternIndices, channels, rowRange } = targets;
                if (patternIndices.length === 0 || channels.length === 0) {
                    pushToast({ message: 'Nothing to edit in that scope.', variant: 'error' });
                    return;
                }
                onSongChange({
                    description: 'Edit instruments in scope',
                    undoable: true,
                    mutator: (nextSong) => {
                        let mutated = false;
                        for (const patternIndex of patternIndices) {
                            const targetPattern = nextSong.patterns[patternIndex];
                            if (!targetPattern) continue;
                            if (mutatePattern(targetPattern, channels, rowRange, nextSong.rowsPerPattern, scope.instrumentIndex)) {
                                mutated = true;
                            }
                        }
                        if (!mutated) {
                            pushToast({ message: noMutatedMessage, variant: 'info' });
                        }
                    },
                });
            },
            [onSongChange, pushToast, resolveScopeTargets],
        );

        const handleSetInstrument = useCallback((rawInstrument: number, scope: AdvancedEditScope) => {
            const instrumentValue = normalizeInstrumentValue(rawInstrument);
            if (instrumentValue === SomaticCaps.noteCutInstrumentIndex) {
                pushToast({ message: 'Instrument 1 is reserved for note cuts.', variant: 'error' });
                return;
            }
            runInstrumentMutationInScope(
                scope,
                (pattern, channels, rowRange, rowsPerPattern, instrumentIndex) =>
                    setInstrumentInPattern(pattern, channels, rowRange, rowsPerPattern, instrumentValue, instrumentIndex),
                'No instruments were eligible for update.',
            );
        }, [pushToast, runInstrumentMutationInScope]);

        const handleChangeInstrument = useCallback((rawFrom: number, rawTo: number, scope: AdvancedEditScope) => {
            const fromInstrument = normalizeInstrumentValue(rawFrom);
            const toInstrument = normalizeInstrumentValue(rawTo);
            if (fromInstrument === SomaticCaps.noteCutInstrumentIndex || toInstrument === SomaticCaps.noteCutInstrumentIndex) {
                pushToast({ message: 'Instrument 1 is reserved for note cuts.', variant: 'error' });
                return;
            }
            if (fromInstrument === toInstrument) {
                pushToast({ message: 'Choose different instruments to change.', variant: 'info' });
                return;
            }
            runInstrumentMutationInScope(
                scope,
                (pattern, channels, rowRange, rowsPerPattern, instrumentIndex) =>
                    changeInstrumentInPattern(pattern, channels, rowRange, rowsPerPattern, fromInstrument, toInstrument, instrumentIndex),
                'No matching instruments were found to change.',
            );
        }, [pushToast, runInstrumentMutationInScope]);


        const nudgeInstrumentInSelection = useCallback((amount: number, scope: AdvancedEditScope) => {
            if (!amount) return;
            runInstrumentMutationInScope(
                scope,
                (pattern, channels, rowRange, rowsPerPattern, instrumentIndex) =>
                    nudgeInstrumentInPattern(pattern, channels, rowRange, rowsPerPattern, amount, instrumentIndex),
                'No instruments were eligible for nudge.',
            );
        }, [runInstrumentMutationInScope]);


        const handleInterpolate = useCallback((target: InterpolateTarget, scope: AdvancedEditScope) => {
            const targets = resolveScopeTargets(scope.scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to interpolate in that scope.', variant: 'error' });
                return;
            }
            let totalMutated = false;
            let totalAnchorPairs = 0;
            onSongChange({
                description: 'Interpolate pattern values',
                undoable: true,
                mutator: (nextSong) => {
                    for (const patternIndex of patternIndices) {
                        const targetPattern = nextSong.patterns[patternIndex];
                        if (!targetPattern) continue;
                        const result = interpolatePatternValues(targetPattern, channels, rowRange, nextSong.rowsPerPattern, target, scope.instrumentIndex);
                        if (result.mutated) totalMutated = true;
                        totalAnchorPairs += result.anchorPairs;
                    }
                },
            });
            if (!totalMutated) {
                if (totalAnchorPairs === 0) {
                    pushToast({ message: 'Need at least two anchors with values to interpolate.', variant: 'info' });
                } else {
                    pushToast({ message: 'No eligible rows between anchors to update.', variant: 'info' });
                }
            }
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const clearPatternFieldInScope = useCallback((
            scope: AdvancedEditScope,
            description: string,
            clearCell: (cell: PatternCell) => PatternCell,
            noOpMessage: string,
        ) => {
            const targets = resolveScopeTargets(scope.scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to edit in that scope.', variant: 'error' });
                return;
            }

            let mutated = false;
            onSongChange({
                description,
                undoable: true,
                mutator: (nextSong) => {
                    const maxRow = Math.max(0, nextSong.rowsPerPattern - 1);
                    const rowStart = clamp(rowRange.start, 0, maxRow);
                    const rowEnd = clamp(rowRange.end, 0, maxRow);

                    for (const patternIndex of patternIndices) {
                        const pat = nextSong.patterns[patternIndex];
                        if (!pat) continue;

                        for (const ch of channels) {
                            if (ch < 0 || ch >= Tic80Caps.song.audioChannels) continue;
                            const channelIndex = ToTic80ChannelIndex(ch);

                            for (let row = rowStart; row <= rowEnd; row++) {
                                const oldCell = pat.getCell(channelIndex, row);

                                if (scope.instrumentIndex != null) {
                                    if (oldCell.instrumentIndex === undefined || oldCell.instrumentIndex !== scope.instrumentIndex) {
                                        continue;
                                    }
                                }

                                const nextCell = clearCell(oldCell);
                                if (nextCell !== oldCell) {
                                    pat.setCell(channelIndex, row, nextCell);
                                    mutated = true;
                                }
                            }
                        }
                    }
                },
            });

            if (!mutated) {
                pushToast({ message: noOpMessage, variant: 'info' });
            }
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const handleClearNotes = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear notes',
                (cell) => {
                    if (cell.midiNote === undefined) return cell;
                    return { ...cell, midiNote: undefined };
                },
                'No notes were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearInstrument = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear instruments',
                (cell) => {
                    if (cell.instrumentIndex === undefined) return cell;
                    return { ...cell, instrumentIndex: undefined };
                },
                'No instruments were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearEffect = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear effects',
                (cell) => {
                    if (cell.effect === undefined) return cell;
                    return { ...cell, effect: undefined };
                },
                'No effects were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearParamX = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear effect param X',
                (cell) => {
                    if (cell.effectX === undefined) return cell;
                    return { ...cell, effectX: undefined };
                },
                'No effect param X values were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearParamY = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear effect param Y',
                (cell) => {
                    if (cell.effectY === undefined) return cell;
                    return { ...cell, effectY: undefined };
                },
                'No effect param Y values were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearParamXY = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear effect params',
                (cell) => {
                    if (cell.effectX === undefined && cell.effectY === undefined) return cell;
                    return { ...cell, effectX: undefined, effectY: undefined };
                },
                'No effect params were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearSomaticEffect = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear Somatic effects',
                (cell) => {
                    if (cell.somaticEffect === undefined) return cell;
                    return { ...cell, somaticEffect: undefined };
                },
                'No Somatic effects were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const handleClearSomaticParam = useCallback((scope: AdvancedEditScope) => {
            clearPatternFieldInScope(
                scope,
                'Clear Somatic params',
                (cell) => {
                    if (cell.somaticParam === undefined) return cell;
                    return { ...cell, somaticParam: undefined };
                },
                'No Somatic params were found to clear in that scope.',
            );
        }, [clearPatternFieldInScope]);

        const createClipboardPayload = (): PatternClipboardPayload | null => {
            const bounds = editorState.patternSelection;
            if (!bounds) return null;
            const rowStart = bounds.topInclusive();
            const channelStart = bounds.leftInclusive();
            const rows = bounds.rowCount();
            const channels = bounds.columnCount();
            if (rowStart === null || channelStart === null || rows === null || channels === null) return null;
            const cells = Array.from({ length: rows }, (_, rowOffset) => {
                const sourceRow = rowStart + rowOffset;
                return Array.from({ length: channels }, (_, channelOffset) => {
                    const sourceChannel = channelStart + channelOffset;
                    const cell = pattern.getCell(ToTic80ChannelIndex(sourceChannel), sourceRow);
                    return { ...cell };
                });
            });
            return {
                type: PATTERN_CLIPBOARD_TYPE,
                version: 1,
                rows,
                channels,
                cells,
            };
        };

        const writePayloadToClipboard = async (payload: PatternClipboardPayload): Promise<boolean> => {
            try {
                await clipboard.copyObjectToClipboard(payload);
                return true;
            } catch (err) {
                console.error('Pattern copy failed', err);
                pushToast({ message: 'Failed to copy pattern selection.', variant: 'error' });
                return false;
            }
        };

        const clearSelectionCells = () => {
            const bounds = editorState.patternSelection;
            if (!bounds) return;
            onSongChange({
                description: 'Clear pattern selection',
                undoable: true,
                mutator: (s) => {
                    const pat = s.patterns[safePatternIndex];
                    const maxRow = Math.max(0, s.rowsPerPattern - 1);
                    const maxChannel = Tic80Caps.song.audioChannels - 1;
                    const allSelectedCells = bounds.getAllCells();
                    for (const cellCoord of allSelectedCells) {
                        if (cellCoord.y > maxRow || cellCoord.x > maxChannel) continue;
                        pat.setCell(ToTic80ChannelIndex(cellCoord.x), cellCoord.y, {});
                    }
                },
            });
        };

        const handleCopySelection = () => {
            const payload = createClipboardPayload();
            if (!payload) return;
            void writePayloadToClipboard(payload);
        };

        const handleCutSelection = async () => {
            const payload = createClipboardPayload();
            if (!payload) return;
            const copied = await writePayloadToClipboard(payload);
            if (!copied) return;
            clearSelectionCells();
        };

        const readClipboardPayload = async (): Promise<PatternClipboardPayload | null> => {
            try {
                const data = await clipboard.readObjectFromClipboard<PatternClipboardPayload>();
                if (!data || data.type !== PATTERN_CLIPBOARD_TYPE || data.version !== 1 || !Array.isArray(data.cells)) {
                    pushToast({ message: 'Clipboard does not contain a pattern block.', variant: 'error' });
                    return null;
                }
                return data;
            } catch (err) {
                console.error('Pattern paste failed', err);
                pushToast({ message: 'Failed to read clipboard for paste.', variant: 'error' });
                return null;
            }
        };

        const applyClipboardPayload = (payload: PatternClipboardPayload) => {
            const startRow = Math.max(0, Math.min(editorState.patternEditRow ?? 0, song.rowsPerPattern - 1));
            const startChannel = editorState.patternEditChannel ?? 0;
            const maxRow = Math.max(0, song.rowsPerPattern - 1);
            const maxChannel = Tic80Caps.song.audioChannels - 1;
            onSongChange({
                description: 'Paste pattern block',
                undoable: true,
                mutator: (s) => {
                    const pat = s.patterns[safePatternIndex];
                    for (let rowOffset = 0; rowOffset < payload.rows; rowOffset++) {
                        const destRow = startRow + rowOffset;
                        if (destRow > maxRow) break;
                        const sourceRow = payload.cells[rowOffset] ?? [];
                        for (let channelOffset = 0; channelOffset < payload.channels; channelOffset++) {
                            const destChannel = startChannel + channelOffset;
                            if (destChannel > maxChannel) break;
                            const cell = sourceRow[channelOffset];
                            if (!cell) continue;
                            pat.setCell(ToTic80ChannelIndex(destChannel), destRow, { ...cell });
                        }
                    }
                },
            });

            // set the selection to the pasted area
            // and set the cursor to the end of the pasted area
            selection2d.setSelection(new SelectionRect2D({
                start: { x: startChannel, y: startRow },
                size: { width: Math.min(payload.channels, maxChannel - startChannel + 1), height: Math.min(payload.rows, maxRow - startRow + 1) },
            }));

            focusCell(startRow, startChannel * CELLS_PER_CHANNEL);
        };

        const handlePasteSelection = async () => {
            const payload = await readClipboardPayload();
            if (!payload) return;
            applyClipboardPayload(payload);
        };

        // Register clipboard action handlers
        useActionHandler("Copy", () => {
            handleCopySelection();
        });

        useActionHandler("Paste", () => {
            void handlePasteSelection();
        });

        useActionHandler("Cut", () => {
            void handleCutSelection();
        });

        useActionHandler("PlayRow", () => {
            const rowIndex = editorState.patternEditRow;
            playRow(rowIndex);
        });

        useActionHandler("InsertNoteCut", () => {
            if (!editingEnabled) return;
            const rowIndex = editorState.patternEditRow;
            const channelIndex = editorState.patternEditChannel;
            onSongChange({
                description: 'Insert note cut',
                undoable: true,
                mutator: (s) => {
                    const pat = s.patterns[safePatternIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        midiNote: 69,
                        instrumentIndex: SomaticCaps.noteCutInstrumentIndex,
                    });
                },
            });
        });

        useActionHandler("ClearCell", () => {
            if (!editingEnabled) return;
            clearPendingInstrumentEntry();
            const rowIndex = editorState.patternEditRow;
            const channelIndex = editorState.patternEditChannel;
            onSongChange({
                description: 'Clear entire cell',
                undoable: true,
                mutator: (s) => {
                    const pat = s.patterns[safePatternIndex];
                    pat.setCell(channelIndex, rowIndex, {
                        midiNote: undefined,
                        instrumentIndex: undefined,
                        effect: undefined,
                        effectX: undefined,
                        effectY: undefined,
                        somaticEffect: undefined,
                        somaticParam: undefined,
                    });
                },
            });
        });

        useActionHandler("ClearField", () => {
            if (!editingEnabled) return;
            clearPendingInstrumentEntry();
            const rowIndex = editorState.patternEditRow;
            const channelIndex = editorState.patternEditChannel;
            const columnIndex = currentColumnIndex;
            const cellTypeOffset = columnIndex % CELLS_PER_CHANNEL;
            const cellType: ExtendedCellType =
                cellTypeOffset === 0 ? 'note' :
                    cellTypeOffset === 1 ? 'instrument' :
                        cellTypeOffset === 2 ? 'command' :
                            cellTypeOffset === 3 ? 'param' :
                                cellTypeOffset === 4 ? 'somaticCommand' :
                                    'somaticParam';
            onSongChange({
                description: 'Clear field under cursor',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);

                    if (cellType === 'note') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, midiNote: undefined });
                    } else if (cellType === 'instrument') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, instrumentIndex: undefined });
                    } else if (cellType === 'command') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, effect: undefined });
                    } else if (cellType === 'param') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, effectX: undefined, effectY: undefined });
                    } else if (cellType === 'somaticCommand') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, somaticEffect: undefined });
                    } else if (cellType === 'somaticParam') {
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, somaticParam: undefined });
                    }
                },
            });
        });

        useActionHandler("SelectAll", () => {
            selection2d.setSelection(new SelectionRect2D({
                start: { x: 0, y: 0 },
                size: { width: Tic80Caps.song.audioChannels, height: song.rowsPerPattern },
            }));
        });

        const playbackSongPosition = musicState.currentSomaticSongPosition ?? -1;
        const playbackRowIndexRaw = musicState.currentSomaticRowIndex ?? -1;
        const playbackSongOrderItem = playbackSongPosition >= 0 && song.songOrder.length > 0
            ? song.songOrder[Math.min(playbackSongPosition, song.songOrder.length - 1)] ?? null
            : null;
        const playbackPatternIndex = playbackSongOrderItem?.patternIndex ?? null;
        const isViewingActivePattern = playbackPatternIndex !== null && playbackPatternIndex === safePatternIndex;
        const activeRow = isViewingActivePattern && playbackRowIndexRaw >= 0
            ? Math.max(0, Math.min(song.rowsPerPattern - 1, playbackRowIndexRaw))
            : null;

        const playRow = (rowIndex: number) => {
            audio.playRow(song, pattern, rowIndex);
        };

        const handleNoteKey = (_channelIndex: Tic80ChannelIndex, _rowIndex: number, _e: KeyboardEvent<HTMLTableCellElement>) => {
            // Note entry is handled via global note input sources (MIDI/keyboard)
            // InsertNoteCut is now handled via useActionHandler
        };

        const handleInstrumentKey = (
            channelIndex: Tic80ChannelIndex,
            rowIndex: number,
            key: string,
        ): false | 'pending' | 'committed' => {
            const nibble = instrumentKeyMap.indexOf(key);
            if (nibble === -1) return false;

            const pending = pendingInstrumentEntryRef.current;
            const isSecondNibble = pending && pending.rowIndex === rowIndex && pending.channelIndex === channelIndex;

            if (!isSecondNibble) {
                pendingInstrumentEntryRef.current = { rowIndex, channelIndex, hiNibble: nibble };

                onSongChange({
                    description: 'Set instrument from key',
                    undoable: true,
                    mutator: (s) => {
                        const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                        const pat = s.patterns[patIndex];
                        const oldCell = pat.getCell(channelIndex, rowIndex);
                        pat.setCell(channelIndex, rowIndex, {
                            ...oldCell,
                            instrumentIndex: normalizeInstrumentValue(nibble),
                        });
                    },
                });
                playRow(rowIndex);
                return 'pending';
            }

            const instValue = ((pending.hiNibble << 4) | nibble) & 0xFF;
            pendingInstrumentEntryRef.current = null;

            onSongChange({
                description: 'Set instrument from key',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        instrumentIndex: normalizeInstrumentValue(instValue),
                    });
                },
            });
            playRow(rowIndex);
            return 'committed';
        };

        const handleCommandKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const idx = commandKeyMap.indexOf(key);
            if (idx === -1) return false;
            onSongChange({
                description: 'Set effect command from key',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        effect: idx,
                    });
                },
            });
            return true;
        };

        const handleSomaticCommandKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const cmd = SOMATIC_PATTERN_COMMAND_KEYS[key.toLowerCase()];
            const idx = cmd !== undefined ? cmd : -1;
            if (idx === -1) return false;
            onSongChange({
                description: 'Set Somatic effect command from key',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        somaticEffect: idx,
                    });
                },
            });
            return true;
        };

        const handleParamKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const idx = paramKeyMap.indexOf(key);
            if (idx === -1) return false;
            onSongChange({
                description: 'Set effect param from key',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    const currentParam = oldCell.effectY ?? 0; // slide over Y to X
                    // Shift the current param left by 4 bits and add the new nibble
                    const newParam = ((currentParam << 4) | idx) & 0xFF;
                    const effectX = (newParam >> 4) & 0x0F;
                    const effectY = newParam & 0x0F;
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        effectX,
                        effectY,
                    });
                },
            });
            return true;
        };

        const handleSomaticParamKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const idx = somaticParamKeyMap.indexOf(key);
            if (idx === -1) return false;
            onSongChange({
                description: 'Set Somatic effect param from key',
                undoable: true,
                mutator: (s) => {
                    const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                    const pat = s.patterns[patIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    const current = oldCell.somaticParam ?? 0;
                    const next = ((current << 4) | idx) & 0xFF;
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        somaticParam: next,
                    });
                },
            });
            return true;
        };

        const focusCell = (row: number, col: number) => {
            const target = cellRefs[row]?.[col];
            if (target) target.focus();
        };

        const advanceAfterCellEdit = (rowIndex: number, columnIndex: number) => {
            const step = song.patternEditStep ?? 0;
            if (step <= 0) return;
            const rowCount = song.rowsPerPattern;
            onEditorStateChange((state) => {
                state.advancePatternEditRow(step, rowCount);
            });
            const nextRow = clamp(rowIndex + step, 0, Math.max(0, rowCount - 1));
            //if (nextRow !== rowIndex) {
            focusCell(nextRow, columnIndex);
            //}
        };

        const focusCellAdvancedToRow = useCallback((rowIndex: number) => {
            //const columnIndex = (editorState.patternEditChannel || 0) * CELLS_PER_CHANNEL;
            focusCell(rowIndex, currentColumnIndex);
        }, [focusCell, currentColumnIndex]);



        useImperativeHandle(ref, () => ({
            focusPattern() {
                const row = editorState.patternEditRow || 0;
                const col = (editorState.patternEditChannel || 0) * CELLS_PER_CHANNEL;
                focusCell(row, col);
            },
            focusCellAdvancedToRow,
            transposeNotes: handleTranspose,
            nudgeInstrumentInSelection,
        }), [editorState.patternEditChannel, editorState.patternEditRow, focusCell, focusCellAdvancedToRow]);

        const updateEditTarget = ({ rowIndex, channelIndex }: { rowIndex: number, channelIndex: Tic80ChannelIndex }) => {
            //const channelIndex = Math.floor(col / 4);
            onEditorStateChange((s) => s.setPatternEditTarget({ rowIndex, channelIndex }));
        };

        const jumpSize = Math.max(song.highlightRowCount || 1, 1);
        const rowCount = song.rowsPerPattern;
        const colCount = CELLS_PER_CHANNEL * Tic80Caps.song.audioChannels;

        const getTargetCoordForPageUp = (row: number, col: number): Coord2D => {
            const currentBlock = Math.floor(row / jumpSize);
            const targetBlock = currentBlock - 1;
            const targetRow = targetBlock * jumpSize;
            if (targetRow < 0) {
                // Navigate to previous song order position
                if (currentPosition > 0) {
                    onEditorStateChange((s) => s.setActiveSongPosition(currentPosition - 1));
                    const blocksInPattern = Math.ceil(rowCount / jumpSize);
                    const newTargetRow = (blocksInPattern + targetBlock) * jumpSize;
                    return { y: Math.max(0, newTargetRow), x: col };
                }
                // At the beginning of the song, clamp to top
                return { y: 0, x: col };
            }
            return { y: targetRow, x: col };
        }

        const handleArrowNav = (row: number, col: number, key: string, ctrlKey: boolean): readonly [number, number] | null => {
            //const jumpSize = Math.max(song.highlightRowCount || 1, 1);
            if (key === 'ArrowUp') {
                if (ctrlKey) {
                    const targetRow = row - CTRL_ARROW_JUMP_SIZE;
                    if (targetRow < 0) {
                        // Navigate to previous song order position
                        if (currentPosition > 0) {
                            onEditorStateChange((s) => s.setActiveSongPosition(currentPosition - 1));
                            return [rowCount + targetRow, col] as const;
                        }
                        // At the beginning of the song, clamp to top
                        return [0, col] as const;
                    }
                    return [targetRow, col] as const;
                }
                const targetRow = row - 1;
                if (targetRow < 0) {
                    // Navigate to previous song order position
                    if (currentPosition > 0) {
                        onEditorStateChange((s) => s.setActiveSongPosition(currentPosition - 1));
                        return [rowCount - 1, col] as const;
                    }
                    // At the beginning of the song, clamp to top
                    return [0, col] as const;
                }
                return [targetRow, col] as const;
            }
            if (key === 'ArrowDown') {
                if (ctrlKey) {
                    const targetRow = row + CTRL_ARROW_JUMP_SIZE;
                    if (targetRow >= rowCount) {
                        // Navigate to next song order position
                        if (currentPosition < song.songOrder.length - 1) {
                            onEditorStateChange((s) => s.setActiveSongPosition(currentPosition + 1));
                            return [targetRow - rowCount, col] as const;
                        }
                        // At the end of the song, clamp to bottom
                        return [rowCount - 1, col] as const;
                    }
                    return [targetRow, col] as const;
                }
                const targetRow = row + 1;
                if (targetRow >= rowCount) {
                    // Navigate to next song order position
                    if (currentPosition < song.songOrder.length - 1) {
                        onEditorStateChange((s) => s.setActiveSongPosition(currentPosition + 1));
                        return [0, col] as const;
                    }
                    // At the end of the song, clamp to bottom
                    return [rowCount - 1, col] as const;
                }
                return [targetRow, col] as const;
            }
            if (key === 'ArrowLeft') {
                if (ctrlKey) {
                    // If not on the note column, snap to note column within the same channel.
                    // If already on the note column, move to previous channel (keeping note column).
                    const channelCount = Tic80Caps.song.audioChannels;
                    const currentChannel = Math.floor(col / CELLS_PER_CHANNEL);
                    const cellTypeOffset = col % CELLS_PER_CHANNEL;
                    if (cellTypeOffset !== 0) {
                        const targetCol = currentChannel * CELLS_PER_CHANNEL;
                        return [row, targetCol] as const;
                    }
                    const targetChannel = (currentChannel + channelCount - 1) % channelCount;
                    const targetCol = targetChannel * CELLS_PER_CHANNEL;
                    return [row, targetCol] as const;
                }
                return [row, (col + colCount - 1) % colCount] as const;
            }
            if (key === 'ArrowRight') {
                if (ctrlKey) {
                    // Move to next channel (keep same cell type within channel)
                    const currentChannel = Math.floor(col / CELLS_PER_CHANNEL);
                    const cellTypeOffset = col % CELLS_PER_CHANNEL;
                    const targetChannel = (currentChannel + 1) % Tic80Caps.song.audioChannels;
                    const targetCol = targetChannel * CELLS_PER_CHANNEL + cellTypeOffset;
                    return [row, targetCol] as const;
                }
                return [row, (col + 1) % colCount] as const;
            }
            if (key === 'PageUp') {
                const target = getTargetCoordForPageUp(row, col);
                return [target.y, target.x] as const;
            }
            if (key === 'PageDown') {
                const currentBlock = Math.floor(row / jumpSize);
                const targetBlock = currentBlock + 1;
                const targetRow = targetBlock * jumpSize;
                if (targetRow >= rowCount) {
                    // Navigate to next song order position
                    if (currentPosition < song.songOrder.length - 1) {
                        onEditorStateChange((s) => s.setActiveSongPosition(currentPosition + 1));
                        const overshoot = targetRow - rowCount;
                        return [overshoot, col] as const;
                    }
                    // At the end of the song, clamp to bottom
                    return [rowCount - 1, col] as const;
                }
                return [targetRow, col] as const;
            }
            if (key === 'Home') {
                if (ctrlKey || row === 0) {
                    return [0, 0] as const;
                }
                return [0, col] as const;
            }
            if (key === 'End') {
                if (ctrlKey || row === rowCount - 1) {
                    return [rowCount - 1, colCount - 1] as const;
                }
                return [rowCount - 1, col] as const;
            }
            return null;
        };

        const handleSelectionNudge = (e: React.KeyboardEvent<HTMLTableCellElement>): boolean => {
            if (!e.shiftKey) return false;

            const isCurrentCellTheAnchor = () => {
                const anchor = editorState.patternSelection?.getAnchorPoint() || null;
                if (!anchor) return false;
                const editRow = editorState.patternEditRow;
                const editChannel = editorState.patternEditChannel;
                return anchor.x === editChannel && anchor.y === editRow;
            };

            if (e.key === 'ArrowUp') {
                // if the currently editing cell is different than the selection anchor,
                // set the anchor to the editing cell first.
                if (!isCurrentCellTheAnchor()) {
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: editorState.patternEditChannel, y: editorState.patternEditRow },
                        size: { width: 1, height: -1 },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: 0, height: -1 } });
                return true;
            }
            if (e.key === 'ArrowDown') {
                if (!isCurrentCellTheAnchor()) {
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: editorState.patternEditChannel, y: editorState.patternEditRow },
                        size: { width: 1, height: 2 },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: 0, height: 1 } });
                return true;
            }
            if (e.key === 'ArrowLeft') {
                if (!isCurrentCellTheAnchor()) {
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: editorState.patternEditChannel, y: editorState.patternEditRow },
                        size: { width: -1, height: 1 },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: -1, height: 0 } });
                return true;
            }
            if (e.key === 'ArrowRight') {
                if (!isCurrentCellTheAnchor()) {
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: editorState.patternEditChannel, y: editorState.patternEditRow },
                        size: { width: 2, height: 1 },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: 1, height: 0 } });
                return true;
            }
            // home / end / page up / page down
            if (e.key === 'PageUp') {
                if (!isCurrentCellTheAnchor()) {
                    const newAnchor = { x: editorState.patternEditChannel, y: editorState.patternEditRow };
                    selection2d.setSelection(new SelectionRect2D({
                        start: newAnchor,
                        size: { width: 1, height: -jumpSize },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: 0, height: -jumpSize } });
                return true;
            }
            if (e.key === 'PageDown') {
                if (!isCurrentCellTheAnchor()) {
                    const newAnchor = { x: editorState.patternEditChannel, y: editorState.patternEditRow };
                    selection2d.setSelection(new SelectionRect2D({
                        start: newAnchor,
                        size: { width: 1, height: jumpSize },
                    }));
                    return true;
                }
                selection2d.nudgeActiveEnd({ delta: { width: 0, height: jumpSize } });
                return true;
            }
            if (e.key === 'Home') {
                if (!isCurrentCellTheAnchor()) {
                    const newAnchor = { x: editorState.patternEditChannel, y: editorState.patternEditRow };
                    selection2d.setSelection(new SelectionRect2D({
                        start: newAnchor,
                        size: { width: -newAnchor.x, height: -newAnchor.y },
                    }));
                    return true;
                }
                // TODO: retain the WIDTH of the selection.
                // TODO: if already at top, go to far left instead.
                selection2d.setEnd({ x: editorState.patternEditChannel!, y: 0 });
                return true;
            }
            if (e.key === 'End') {
                const lastCell = { x: Tic80Caps.song.audioChannels - 1, y: song.rowsPerPattern - 1 };
                if (!isCurrentCellTheAnchor()) {
                    const newAnchor = { x: editorState.patternEditChannel, y: editorState.patternEditRow };
                    selection2d.setSelection(new SelectionRect2D({
                        start: newAnchor,
                        size: { width: lastCell.x - newAnchor.x, height: lastCell.y - newAnchor.y },
                    }));
                    return true;
                }
                // TODO: retain the WIDTH of the selection.
                // TODO: if already at top, go to far left instead.
                selection2d.setEnd({ x: editorState.patternEditChannel!, y: lastCell.y });
                return true;
            }
            return false;
        };

        const onCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
            if (e.altKey) {
                // let alt+key combinations pass through for system/user handling
                return;
            }
            const target = e.currentTarget;
            const rowIndex = parseInt(target.dataset.rowIndex!, 10);
            const channelIndex = parseInt(target.dataset.channelIndex!, 10) as Tic80ChannelIndex;
            const cellType = target.dataset.cellType as ExtendedCellType;
            //const colOffset = cellType === 'note' ? 0 : cellType === 'instrument' ? 1 : cellType === 'command' ? 2 : 3;
            const columnIndex = parseInt(target.dataset.columnIndex!, 10);
            //const col = channelIndex * 4 + colOffset;

            if (handleSelectionNudge(e)) {
                e.preventDefault();
                return;
            }

            const currentRowForNav = editorState.patternEditRow ?? rowIndex;
            const navTarget = handleArrowNav(currentRowForNav, columnIndex, e.key, e.ctrlKey);
            if (navTarget) {
                clearPendingInstrumentEntry();
                const [targetRow, targetCol] = navTarget;
                const targetChannel = ToTic80ChannelIndex(Math.floor(targetCol / CELLS_PER_CHANNEL));
                onEditorStateChange((state) => state.setPatternEditTarget({ rowIndex: targetRow, channelIndex: targetChannel }));
                focusCell(targetRow, targetCol);
                e.preventDefault();
                return;
            }

            if (!editingEnabled) return;

            if (cellType === 'note' && !e.repeat) {
                handleNoteKey(channelIndex, rowIndex, e);
            } else if (cellType === 'instrument' && instrumentKeyMap.includes(e.key) && !e.repeat) {
                const result = handleInstrumentKey(channelIndex, rowIndex, e.key);
                if (result) {
                    if (result === 'committed') {
                        advanceAfterCellEdit(rowIndex, columnIndex);
                    }
                    e.preventDefault();
                }
            } else if (cellType === 'command' && commandKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleCommandKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    advanceAfterCellEdit(rowIndex, columnIndex);
                    e.preventDefault();
                }
            } else if (cellType === 'param' && paramKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleParamKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    // don't advance after param edit; facilitates typing
                    //advanceAfterCellEdit(rowIndex, columnIndex);
                    e.preventDefault();
                }
            } else if (cellType === 'somaticCommand' && somaticCommandKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleSomaticCommandKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    advanceAfterCellEdit(rowIndex, columnIndex);
                    e.preventDefault();
                }
            } else if (cellType === 'somaticParam' && somaticParamKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleSomaticParamKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    // don't advance after param edit; facilitates typing
                    e.preventDefault();
                }
            } else if (e.key === '0' && cellType === 'note' && !e.repeat) {
                onSongChange({
                    description: 'Clear note from key',
                    undoable: true,
                    mutator: (s) => {
                        const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                        const pat = s.patterns[patIndex];
                        const oldCell = pat.getCell(channelIndex, rowIndex);
                        pat.setCell(channelIndex, rowIndex, { ...oldCell, midiNote: undefined });
                    },
                });
            }
        };

        const toggleChannelMute = (channelIndex: Tic80ChannelIndex) => {
            onEditorStateChange((s) => {
                s.setChannelMute(channelIndex, !s.isChannelExplicitlyMuted(channelIndex));
            });
        };

        const toggleChannelSolo = (channelIndex: Tic80ChannelIndex) => {
            onEditorStateChange((s) => {
                s.setChannelSolo(channelIndex, !s.isChannelExplicitlySoloed(channelIndex));
            });
        };

        const onCellFocus = (rowIndex: number, channelIndex: Tic80ChannelIndex, col: number) => {
            const pending = pendingInstrumentEntryRef.current;
            if (pending && (pending.rowIndex !== rowIndex || pending.channelIndex !== channelIndex)) {
                pendingInstrumentEntryRef.current = null;
            }
            updateEditTarget({ rowIndex, channelIndex });
            setCurrentColumnIndex(col);

            // Determine column type from column index
            const cellTypeOffset = col % CELLS_PER_CHANNEL;
            const columnType =
                cellTypeOffset === 0 ? 'note' :
                    cellTypeOffset === 1 ? 'instrument' :
                        cellTypeOffset === 2 ? 'command' :
                            cellTypeOffset === 3 ? 'param' :
                                cellTypeOffset === 4 ? 'somaticCommand' :
                                    'somaticParam';
            onEditorStateChange((s) => s.setPatternEditColumnType(columnType));
        };

        const onCellMouseDownSelectingInstrument = (e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number, channelIndex: Tic80ChannelIndex) => {
            // ctrl+click = select that instrument.
            if (e.ctrlKey || e.metaKey) {
                const cell = pattern.getCell(channelIndex, rowIndex);
                if (cell.instrumentIndex != null) {
                    onEditorStateChange((s) => {
                        //s.setSelectedInstrumentIndex(cell.instrumentIndex!);
                        s.setCurrentInstrument(cell.instrumentIndex!);
                        const inst = song.getInstrument(cell.instrumentIndex!)!;
                        pushToast({ message: `Selected instrument ${inst.getCaption(cell.instrumentIndex!)}.`, variant: 'info' });
                    });
                }
                e.preventDefault();
                return;
            }
            selection2d.onCellMouseDown(e, { y: rowIndex, x: channelIndex });
        };

        const handleChannelHeaderClick = (e: React.MouseEvent<HTMLDivElement>, channelIndex: Tic80ChannelIndex) => {
            // hm this is slightly awkward but it will do for now..
            // issues:
            // - anchor moves to a place that's not natural
            // - unable to click-drag to select multiple channels
            if (e.shiftKey) {
                // extend selection to this channel
                const anchor = editorState.patternSelection?.getAnchorPoint();
                if (!anchor) {
                    // no selection yet, set to this channel
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: channelIndex, y: 0 },
                        size: { width: 1, height: song.rowsPerPattern },
                    }));
                } else {
                    const newLeft = Math.min(anchor.x, channelIndex);
                    const newRight = Math.max(anchor.x, channelIndex);
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: newLeft, y: 0 },
                        size: { width: newRight - newLeft + 1, height: song.rowsPerPattern },
                    }));
                }
            } else {
                // select only this channel
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: channelIndex, y: 0 },
                    size: { width: 1, height: song.rowsPerPattern },
                }));
            }
        };

        const handleRowHeaderMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number) => {
            // adapted from above.
            // select the row / extend the selection to this row
            if (e.shiftKey) {
                const anchor = editorState.patternSelection?.getAnchorPoint();
                if (!anchor) {
                    // no selection yet, set to this row
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: 0, y: rowIndex },
                        size: { width: Tic80Caps.song.audioChannels, height: 1 },
                    }));
                } else {
                    const newTop = Math.min(anchor.y, rowIndex);
                    const newBottom = Math.max(anchor.y, rowIndex);
                    selection2d.setSelection(new SelectionRect2D({
                        start: { x: 0, y: newTop },
                        size: { width: Tic80Caps.song.audioChannels, height: newBottom - newTop + 1 },
                    }));
                }
            } else {
                // select only this row
                selection2d.setSelection(new SelectionRect2D({
                    start: { x: 0, y: rowIndex },
                    size: { width: Tic80Caps.song.audioChannels, height: 1 },
                }));
            }
        };

        const advancedEditPanelKeyshortcut = mgr.getActionBindingLabel("ToggleAdvancedEditPanel") || "Unbound";

        const containerRef = useRef<HTMLDivElement | null>(null);
        const topControlsRef = useRef<HTMLDivElement | null>(null);

        useEffect(() => {
            const container = containerRef.current;
            const topControls = topControlsRef.current;
            if (!container || !topControls) return;

            const updateStickyOffsets = () => {
                const h = Math.ceil(topControls.getBoundingClientRect().height);
                container.style.setProperty('--pattern-grid-sticky-top', `${h}px`);
            };

            updateStickyOffsets();

            const maybeResizeObserver = (globalThis as any).ResizeObserver as (typeof ResizeObserver) | undefined;
            const ro = maybeResizeObserver ? new maybeResizeObserver(() => updateStickyOffsets()) : null;
            ro?.observe(topControls);
            window.addEventListener('resize', updateStickyOffsets);

            return () => {
                window.removeEventListener('resize', updateStickyOffsets);
                ro?.disconnect();
            };
        }, []);

        return (
            <div className={`pattern-grid-shell${advancedEditPanelOpen ? ' pattern-grid-shell--advanced-open' : ''}`}>
                {advancedEditPanelOpen && (
                    <PatternAdvancedPanel
                        // enabled={editingEnabled} // allow advanced edits even in non-edit mode
                        song={song}
                        currentInstrument={editorState.currentInstrument}
                        onTranspose={handleTranspose}
                        onSetInstrument={handleSetInstrument}
                        onChangeInstrument={handleChangeInstrument}
                        onNudgeInstrument={nudgeInstrumentInSelection}
                        onInterpolate={handleInterpolate}
                        onClearNotes={handleClearNotes}
                        onClearInstrument={handleClearInstrument}
                        onClearEffect={handleClearEffect}
                        onClearParamX={handleClearParamX}
                        onClearParamY={handleClearParamY}
                        onClearParamXY={handleClearParamXY}
                        onClearSomaticEffect={handleClearSomaticEffect}
                        onClearSomaticParam={handleClearSomaticParam}
                        onClose={() => onSetAdvancedEditPanelOpen(false)}
                    />
                )}
                <div
                    ref={containerRef}
                    className={`pattern-grid-container${editingEnabled ? ' pattern-grid-container--editMode' : ' pattern-grid-container--locked'}`}
                >
                    <div ref={topControlsRef} className="pattern-grid-top-controls">
                        {!advancedEditPanelOpen && (
                            <Tooltip title={advancedEditPanelOpen ? `Hide advanced edit panel (${advancedEditPanelKeyshortcut})` : `Show advanced edit panel (${advancedEditPanelKeyshortcut})`} >
                                <button
                                    type="button"
                                    className={`aside-toggle-button pattern-advanced-handle`}
                                    onClick={() => onSetAdvancedEditPanelOpen(!advancedEditPanelOpen)}
                                    aria-expanded={advancedEditPanelOpen}
                                    aria-controls="pattern-advanced-panel"
                                >
                                    {advancedEditPanelOpen ? CharMap.LeftTriangle : CharMap.RightTriangle}
                                </button>
                            </Tooltip>
                        )}
                        <div>
                            <label>
                                <span className="label-pattern-name">Pattern{' '}
                                    <span className="label-pattern-index">{formatPatternIndex(safePatternIndex)}</span></span>
                                <input
                                    type="text"
                                    className="input-pattern-name"
                                    value={pattern.name}
                                    onChange={(e) => {
                                        const newName = e.target.value;
                                        onSongChange({
                                            description: 'Rename pattern',
                                            undoable: true,
                                            mutator: (s) => {
                                                const pat = s.patterns[safePatternIndex];
                                                pat.name = newName;
                                            },
                                        })
                                    }}
                                //disabled={!editingEnabled} always allow this.
                                />
                                {(() => {
                                    const usageCount = song.songOrder.filter(item => item.patternIndex === safePatternIndex).length;
                                    const isMultiple = usageCount > 1;
                                    return (
                                        <span className={`pattern-usage-indicator ${isMultiple ? 'pattern-usage-indicator--multiple' : 'pattern-usage-indicator--unique'}`}>
                                            {!isMultiple ? 'Unique in song' : `${usageCount} instances in song`}
                                        </span>
                                    );
                                })()}
                            </label>
                        </div>
                    </div>
                    <table className="pattern-grid">
                        <colgroup>
                            <col />
                        </colgroup>
                        <thead>
                            <tr>
                                <th></th>
                                {gChannelsArray.map((i) => {
                                    const headerClass = `channel-header${editorState.isPatternChannelSelected(i) ? ' channel-header--selected' : ''}`;
                                    return (
                                        <th key={i} colSpan={CELL_STRIDE_PER_CHANNEL} className={headerClass}>
                                            <div className='channel-header-cell-contents'>
                                                <div
                                                    className='channel-header-label'
                                                    onClick={(e) => handleChannelHeaderClick(e, i)}
                                                >
                                                    {i + 1}
                                                </div>
                                                <div className='channel-header-controls-group'>
                                                    <Tooltip title={`Mute/unmute ${mgr.getActionBindingLabelAsTooltipSuffix(`ToggleMuteChannel${i + 1}` as GlobalActionId)}`}>
                                                        <button
                                                            type="button"
                                                            className={`channel-header-control-btn channel-header-control-btn-mute ${editorState.isChannelExplicitlyMuted(i) ? 'channel-header-control-btn--muted' : ''}`}
                                                            onClick={() => toggleChannelMute(i)}
                                                        >M</button>
                                                    </Tooltip>
                                                    <Tooltip title={`Solo/unsolo ${mgr.getActionBindingLabelAsTooltipSuffix(`ToggleSoloChannel${i + 1}` as GlobalActionId)}`}>
                                                        <button
                                                            type="button"
                                                            className={`channel-header-control-btn channel-header-control-btn-solo ${editorState.isChannelExplicitlySoloed(i) ? 'channel-header-control-btn--soloed' : ''}`}
                                                            onClick={() => toggleChannelSolo(i)}
                                                        >S</button>
                                                    </Tooltip>
                                                </div>
                                            </div>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: song.rowsPerPattern }, (_, rowIndex) => {
                                const chunkSize = Math.max(song.highlightRowCount || 1, 1);
                                const sectionIndex = Math.floor(rowIndex / chunkSize) % 2;
                                const rowClass = `${sectionIndex === 0 ? 'row-section-a' : 'row-section-b'}${activeRow === rowIndex ? ' active-row' : ''}`;
                                const isRowInSelection = editorState.isPatternRowSelected(rowIndex);
                                const rowNumberClass = `row-number${isRowInSelection ? ' row-number--selected' : ''}`;
                                const hasWaveformRenderConflict = kRateRenderSlotConflictByRow[rowIndex];
                                return (
                                    <tr key={rowIndex} className={rowClass}>
                                        <td
                                            className={rowNumberClass}
                                            data-row-index={rowIndex}
                                            onMouseDown={(e) => handleRowHeaderMouseDown(e, rowIndex)}
                                        >
                                            <div className="row-number-inner">
                                                <span className="row-number-index">{rowIndex}</span>
                                                {hasWaveformRenderConflict ? (
                                                    <Tooltip title="Two or more channels render to the same waveform slot on this row">
                                                        <div className="row-number-warning-dot"></div>
                                                    </Tooltip>
                                                ) : <div className="row-number-warning-dot row-number-warning-dot--hidden"></div>}
                                            </div>
                                        </td>
                                        {pattern.channels.map((channel, channelIndexRaw) => {
                                            const channelIndex = ToTic80ChannelIndex(channelIndexRaw);
                                            const row = channel.rows[rowIndex];
                                            const noteCut = isNoteCut(row);
                                            const noteText = noteCut ? "^^^" : formatMidiNote(row.midiNote);
                                            const [instText, instTooltip] = noteCut ? ["", null] : formatInstrument(row.instrumentIndex, song);
                                            const instrument = row.instrumentIndex != null ? song.getInstrument(row.instrumentIndex) : null;
                                            const instrumentIsSelected = editorState.currentInstrument != null && row.instrumentIndex === editorState.currentInstrument;
                                            const instrumentIsKRate = instrument?.isKRateProcessing() || false;
                                            const krateRenderSlot = instrumentIsKRate ? instrument!.renderWaveformSlot : null;
                                            const cmdText = formatCommand(row.effect);
                                            const paramText = formatParams(row.effectX, row.effectY);
                                            const somCmdText = formatSomaticCommand(row.somaticEffect);
                                            const somParamText = formatSomaticParam(row.somaticParam);
                                            const noteCol = channelIndex * CELLS_PER_CHANNEL;
                                            const instCol = channelIndex * CELLS_PER_CHANNEL + 1;
                                            const cmdCol = channelIndex * CELLS_PER_CHANNEL + 2;
                                            const paramCol = channelIndex * CELLS_PER_CHANNEL + 3;
                                            const somCmdCol = channelIndex * CELLS_PER_CHANNEL + 4;
                                            const somParamCol = channelIndex * CELLS_PER_CHANNEL + 5;
                                            const isEmpty = !row.midiNote && row.effect === undefined && row.instrumentIndex == null && row.effectX === undefined && row.effectY === undefined && row.somaticEffect === undefined && row.somaticParam === undefined;
                                            const isMetaFocused = editorState.patternEditChannel === channelIndex && editorState.patternEditRow === rowIndex;//focusedCell?.row === rowIndex && focusedCell?.channel === channelIndex;
                                            const channelSelected = editorState.isPatternChannelSelected(channelIndex);
                                            const isCellSelected = isRowInSelection && channelSelected;
                                            const isAudible = editorState.isChannelAudible(channelIndex);

                                            const cellStyle: React.CSSProperties = {};
                                            if (instrument?.highlightColor) {
                                                (cellStyle as any)['--instrument-highlight-color'] = instrument.highlightColor;
                                                (cellStyle as any)['--instrument-highlight-fg'] = instrument.highlightFg;
                                            }

                                            const getSelectionClasses = (cellType: ExtendedCellType) => {
                                                let classes = '';
                                                if (highlightSelectedInstrument && instrumentIsSelected) classes += ' pattern-cell--selected-instrument';
                                                if (instrument?.highlightColor) classes += ' pattern-cell--highlighted-instrument';

                                                if (!isCellSelected || !editorState.patternSelection) return classes;
                                                classes += ' pattern-cell--selected';
                                                if (rowIndex === editorState.patternSelection.topInclusive()) classes += ' pattern-cell--selection-top';
                                                if (rowIndex === editorState.patternSelection.bottomInclusive()) classes += ' pattern-cell--selection-bottom';
                                                if (channelIndex === editorState.patternSelection.leftInclusive() && cellType === 'note') classes += ' pattern-cell--selection-left';
                                                if ((channelIndex === editorState.patternSelection.rightInclusive()) && cellType === 'somaticParam') classes += ' pattern-cell--selection-right';
                                                return classes;
                                            };

                                            let errorInRow = false;
                                            let errorText = "";
                                            // J command is an error (not compatible with playroutine)                                        
                                            if (row.effect === SomaticEffectCommand.J) {
                                                errorInRow = true;
                                                errorText = "The 'J' command is not supported in Somatic patterns.";
                                            }
                                            // usage of instrument 0 is an error (reserved)
                                            if (row.midiNote !== undefined && row.instrumentIndex === 0) {
                                                errorInRow = true;
                                                errorText = "Instrument 0 is reserved and should not be used.";
                                            }
                                            if (row.effect === undefined && (row.effectX !== undefined || row.effectY !== undefined)) {
                                                errorInRow = true;
                                                errorText = "Effect parameter set without an effect command.";
                                            }
                                            if (row.instrumentIndex !== undefined && row.midiNote === undefined) {
                                                errorInRow = true;
                                                errorText = "Instrument set without a note.";
                                            }
                                            if (row.somaticEffect === undefined && row.somaticParam !== undefined) {
                                                errorInRow = true;
                                                errorText = "Somatic effect parameter set without a Somatic effect command.";
                                            }

                                            const additionalClasses = `${isEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}${noteCut ? ' note-cut-cell' : ''}${errorInRow ? ' error-cell' : ''}${isAudible ? '' : ' muted-cell'}`;
                                            const noteSelectionClass = getSelectionClasses('note');
                                            const instSelectionClass = getSelectionClasses('instrument');
                                            const cmdSelectionClass = getSelectionClasses('command');
                                            const paramSelectionClass = getSelectionClasses('param');
                                            const somCmdSelectionClass = getSelectionClasses('somaticCommand');
                                            const somParamSelectionClass = getSelectionClasses('somaticParam');

                                            const noteClass = `note-cell${additionalClasses}${noteSelectionClass}`;
                                            const instClass = `instrument-cell${additionalClasses}${instSelectionClass}`;
                                            const cmdClass = `command-cell${additionalClasses}${cmdSelectionClass}`;
                                            const paramClass = `param-cell${additionalClasses}${paramSelectionClass}`;
                                            const somCmdClass = `somatic-command-cell${additionalClasses}${somCmdSelectionClass}`;
                                            const somParamClass = `somatic-param-cell${additionalClasses}${somParamSelectionClass}`;
                                            return (
                                                <React.Fragment key={channelIndex}>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][noteCol] = el)}
                                                        className={noteClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, noteCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="note"
                                                        data-column-index={noteCol}
                                                        data-cell-value={`[${JSON.stringify(row.midiNote)}]`}
                                                    >
                                                        <Tooltip title={errorText} disabled={!errorInRow}>
                                                            <div>{noteText}</div>
                                                        </Tooltip>
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][instCol] = el)}
                                                        className={instClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, instCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="instrument"
                                                        data-column-index={instCol}
                                                        data-cell-value={`[${JSON.stringify(row.instrumentIndex)}]`}
                                                    >
                                                        <Tooltip title={instTooltip} disabled={!instTooltip}>
                                                            <span>
                                                                {instText}
                                                            </span>
                                                        </Tooltip>
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][cmdCol] = el)}
                                                        className={cmdClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, cmdCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="command"
                                                        data-column-index={cmdCol}
                                                        data-cell-value={`[${JSON.stringify(row.effect)}]`}
                                                    >
                                                        {cmdText}
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][paramCol] = el)}
                                                        className={paramClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, paramCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="param"
                                                        data-column-index={paramCol}
                                                        data-cell-value={`[X=${JSON.stringify(row.effectX)},Y=${JSON.stringify(row.effectY)}]`}
                                                    >
                                                        {paramText}
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][somCmdCol] = el)}
                                                        className={somCmdClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, somCmdCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="somaticCommand"
                                                        data-column-index={somCmdCol}
                                                        data-cell-value={`[${JSON.stringify(row.somaticEffect)}]`}
                                                    >
                                                        {somCmdText}
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        data-focus-bookmark="true"
                                                        ref={(el) => (cellRefs[rowIndex][somParamCol] = el)}
                                                        className={somParamClass}
                                                        style={cellStyle}
                                                        onKeyDown={onCellKeyDown}
                                                        onMouseDown={(e) => onCellMouseDownSelectingInstrument(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => selection2d.onCellMouseEnter({ y: rowIndex, x: channelIndex })}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, somParamCol)}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="somaticParam"
                                                        data-column-index={somParamCol}
                                                        data-cell-value={`[${JSON.stringify(row.somaticParam)}]`}
                                                    >
                                                        {somParamText}
                                                    </td>
                                                    <td className='pattern-grid-krate-render-slot-cell'>
                                                        {/* show which k-rate render slot if applicable */}
                                                        {krateRenderSlot === null ? "" : (
                                                            <Tooltip title={`K-Rate waveform render slot #${krateRenderSlot}`}>
                                                                <span>{krateRenderSlot}</span>
                                                            </Tooltip>
                                                        )}
                                                    </td>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="pattern-grid-carry-row">
                                <th className="pattern-grid-carry-label">
                                    <Tooltip title={fxCarryTooltip}>
                                        <span>FX{CharMap.DownArrow}</span>
                                    </Tooltip>
                                </th>
                                {gChannelsArray.map((channelIndex) => {
                                    const s = fxCarryByChannel[channelIndex];
                                    const entries: string[] = [];
                                    for (let cmd = 0; cmd < commandKeyMap.length; cmd++) {
                                        const cmdState = s?.commandStates.get(cmd);
                                        if (!cmdState) continue;
                                        entries.push(`${formatCommand(cmd)}${formatParams(cmdState.effectX, cmdState.effectY)}`);
                                    }

                                    for (let somCmd = 0; somCmd < somaticCommandKeyMap.length; somCmd++) {
                                        const somState = s?.somaticCommandStates.get(somCmd);
                                        if (!somState) continue;
                                        entries.push(`${formatSomaticCommand(somCmd)}${formatSomaticParam(somState.paramU8)}`);
                                    }

                                    const label = entries.length === 0 ? '' : entries.join(' ');
                                    return (
                                        <th key={channelIndex} colSpan={CELLS_PER_CHANNEL} className={`pattern-grid-carry-cell${entries.length ? ' pattern-grid-carry-cell--warn' : ''}`}>
                                            {label}
                                        </th>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        );
    });
