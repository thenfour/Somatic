import React, { forwardRef, KeyboardEvent, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AudioController } from '../audio/controller';
import type { MusicState } from '../audio/backend';
import { midiToName } from '../defs';
import { EditorState } from '../models/editor_state';
import { isNoteCut, Pattern, PatternCell } from '../models/pattern';
import { Song } from '../models/song';
import { SomaticEffectCommand, SomaticCaps, Tic80Caps, Tic80ChannelIndex, ToTic80ChannelIndex } from '../models/tic80Capabilities';
import { HelpTooltip } from './HelpTooltip';
import { useClipboard } from '../hooks/useClipboard';
import { useToasts } from './toast_provider';
import { PatternAdvancedPanel, ScopeValue, InterpolateTarget } from './PatternAdvancedPanel';
import { Tooltip } from './tooltip';
import { CharMap, clamp } from '../utils/utils';

type CellType = 'note' | 'instrument' | 'command' | 'param';


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
    return `${commandKeyMap[val].toUpperCase()}` || '?';
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

type PatternGridProps = {
    song: Song;
    audio: AudioController;
    musicState: MusicState;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
    advancedEditPanelOpen: boolean;
    onSetAdvancedEditPanelOpen: (open: boolean) => void;
};

export type PatternGridHandle = {
    focusPattern: () => void;
};

const PATTERN_CLIPBOARD_TYPE = 'somatic-pattern-block';

type PatternClipboardPayload = {
    type: typeof PATTERN_CLIPBOARD_TYPE;
    version: 1;
    rows: number;
    channels: number;
    cells: PatternCell[][]; // row-major order
};

type RowRange = { start: number; end: number };
type ScopeTargets = {
    patternIndices: number[];
    channels: number[];
    rowRange: RowRange;
};

// Matches defs.ts MIDI_FOR_TIC_NOTE0 mapping (C0) and TIC-80's 8 octaves of pattern range.
const TIC_NOTE_MIDI_BASE = 12;
const MIN_PATTERN_MIDI = TIC_NOTE_MIDI_BASE;
const MAX_PATTERN_MIDI = TIC_NOTE_MIDI_BASE + Tic80Caps.pattern.octaveCount * 12 - 1;

const normalizeInstrumentValue = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return clamp(Math.floor(value), 0, Tic80Caps.sfx.count - 1);
};

const inclusiveRange = (start: number, end: number): number[] => {
    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    const length = Math.max(upper - lower + 1, 0);
    return Array.from({ length }, (_, idx) => lower + idx);
};

const debugAdvanced = (...args: unknown[]) => {
    //console.debug('[AdvancedEdit]', ...args);
};

const mutatePatternCells = (
    pattern: Pattern,
    channels: number[],
    rowRange: RowRange,
    rowsPerPattern: number,
    mutator: (cell: PatternCell, channelIndex: Tic80ChannelIndex, rowIndex: number) => PatternCell | null,
): boolean => {
    const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
    if (maxRow < 0) return false;
    const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
    const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);
    if (rowStart > rowEnd) return false;

    const channelMax = Tic80Caps.song.audioChannels - 1;
    let mutated = false;

    for (let row = rowStart; row <= rowEnd; row++) {
        for (const channel of channels) {
            if (!Number.isFinite(channel)) continue;
            const safeChannel = clamp(Math.floor(channel), 0, channelMax);
            const channelIndex = ToTic80ChannelIndex(safeChannel);
            const cell = pattern.getCell(channelIndex, row);
            const updatedCell = mutator(cell, channelIndex, row);
            if (updatedCell) {
                pattern.setCell(channelIndex, row, updatedCell);
                mutated = true;
            }
        }
    }

    return mutated;
};

const transposeCellsInPattern = (
    pattern: Pattern,
    channels: number[],
    rowRange: RowRange,
    rowsPerPattern: number,
    amount: number,
): boolean =>
    mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
        if (cell.midiNote === undefined) return null;
        if (isNoteCut(cell)) return null;
        const nextNote = cell.midiNote + amount;
        if (nextNote < MIN_PATTERN_MIDI || nextNote > MAX_PATTERN_MIDI) return null;
        if (nextNote === cell.midiNote) return null;
        return { ...cell, midiNote: nextNote };
    });

const setInstrumentInPattern = (
    pattern: Pattern,
    channels: number[],
    rowRange: RowRange,
    rowsPerPattern: number,
    instrumentValue: number,
): boolean =>
    mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
        if (cell.instrumentIndex === undefined) return null;
        if (cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex) return null;
        if (cell.instrumentIndex === instrumentValue) return null;
        return { ...cell, instrumentIndex: instrumentValue };
    });

const changeInstrumentInPattern = (
    pattern: Pattern,
    channels: number[],
    rowRange: RowRange,
    rowsPerPattern: number,
    fromInstrument: number,
    toInstrument: number,
): boolean =>
    mutatePatternCells(pattern, channels, rowRange, rowsPerPattern, (cell) => {
        if (cell.instrumentIndex === undefined) return null;
        if (cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex) return null;
        if (cell.instrumentIndex !== fromInstrument) return null;
        if (fromInstrument === toInstrument) return null;
        return { ...cell, instrumentIndex: toInstrument };
    });

type CellValueAccessor = {
    min: number;
    max: number;
    read: (cell: PatternCell) => number | undefined;
    write: (cell: PatternCell, value: number) => PatternCell | null;
};

const interpolationAccessors: Record<InterpolateTarget, CellValueAccessor> = {
    notes: {
        min: MIN_PATTERN_MIDI,
        max: MAX_PATTERN_MIDI,
        read: (cell) => {
            if (cell.midiNote === undefined) return undefined;
            if (isNoteCut(cell)) return undefined;
            return cell.midiNote;
        },
        write: (cell, value) => {
            if (isNoteCut(cell)) return null;
            const clamped = clamp(Math.round(value), MIN_PATTERN_MIDI, MAX_PATTERN_MIDI);
            if (cell.midiNote === clamped) return null;
            return { ...cell, midiNote: clamped };
        },
    },
    paramX: {
        min: 0,
        max: 0x0f,
        read: (cell) => {
            if (cell.effectX === undefined) return undefined;
            return cell.effectX;
        },
        write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0x0f);
            if (cell.effectX === clamped) return null;
            return { ...cell, effectX: clamped };
        },
    },
    paramY: {
        min: 0,
        max: 0x0f,
        read: (cell) => {
            if (cell.effectY === undefined) return undefined;
            return cell.effectY;
        },
        write: (cell, value) => {
            const clamped = clamp(Math.round(value), 0, 0x0f);
            if (cell.effectY === clamped) return null;
            return { ...cell, effectY: clamped };
        },
    },
};

type InterpolationResult = {
    mutated: boolean;
    anchorPairs: number;
};

const interpolatePatternValues = (
    pattern: Pattern,
    channels: number[],
    rowRange: RowRange,
    rowsPerPattern: number,
    target: InterpolateTarget,
): InterpolationResult => {
    const accessor = interpolationAccessors[target];
    const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
    if (maxRow < 0) return { mutated: false, anchorPairs: 0 };
    const rowStart = clamp(Math.min(rowRange.start, rowRange.end), 0, maxRow);
    const rowEnd = clamp(Math.max(rowRange.start, rowRange.end), 0, maxRow);

    const channelMax = Tic80Caps.song.audioChannels - 1;
    let mutated = false;
    let anchorPairs = 0;

    for (const channel of channels) {
        if (!Number.isFinite(channel)) continue;
        const safeChannel = clamp(Math.floor(channel), 0, channelMax);
        const channelIndex = ToTic80ChannelIndex(safeChannel);

        let startRow = -1;
        let startValue: number | null = null;
        for (let row = rowStart; row <= rowEnd; row++) {
            const value = accessor.read(pattern.getCell(channelIndex, row));
            if (value === undefined) continue;
            startRow = row;
            startValue = value;
            break;
        }

        if (startRow === -1 || startValue === null) continue;

        let endRow = -1;
        let endValue: number | null = null;
        for (let row = rowEnd; row >= rowStart; row--) {
            const value = accessor.read(pattern.getCell(channelIndex, row));
            if (value === undefined) continue;
            endRow = row;
            endValue = value;
            break;
        }

        if (endRow === -1 || endValue === null) continue;
        if (endRow <= startRow) continue;
        anchorPairs++;
        debugAdvanced('Interpolating channel', {
            target,
            channelIndex,
            startRow,
            startValue,
            endRow,
            endValue,
        });

        const span = endRow - startRow;
        for (let row = startRow + 1; row < endRow; row++) {
            const t = (row - startRow) / span;
            const interpolated = startValue + (endValue - startValue) * t;
            const clampedValue = clamp(Math.round(interpolated), accessor.min, accessor.max);
            const cell = pattern.getCell(channelIndex, row);
            const updated = accessor.write(cell, clampedValue);
            if (!updated) continue;
            pattern.setCell(channelIndex, row, updated);
            mutated = true;
        }
    }

    return { mutated, anchorPairs };
};

export const PatternGrid = forwardRef<PatternGridHandle, PatternGridProps>(
    ({ song, audio, musicState, editorState, onEditorStateChange, onSongChange, advancedEditPanelOpen, onSetAdvancedEditPanelOpen }, ref) => {
        const currentPosition = Math.max(0, Math.min(song.songOrder.length - 1, editorState.activeSongPosition || 0));
        const currentPatternIndex = song.songOrder[currentPosition] ?? 0;
        const safePatternIndex = Math.max(0, Math.min(currentPatternIndex, song.patterns.length - 1));
        const pattern: Pattern = song.patterns[safePatternIndex];
        //const [focusedCell, setFocusedCell] = useState<{ row: number; channel: number } | null>(null);
        const cellRefs = useMemo(
            () => Array.from({ length: 64 }, () => Array(16).fill(null) as (HTMLTableCellElement | null)[]),
            [],
        );
        const editingEnabled = editorState.editingEnabled !== false;
        const selectionAnchorRef = useRef<{ rowIndex: number; channelIndex: Tic80ChannelIndex } | null>(null);
        const [isSelecting, setIsSelecting] = useState(false);
        const selectingRef = useRef(false);
        //const [advancedPanelOpen, setAdvancedPanelOpen] = useState(false);
        const clipboard = useClipboard();
        const { pushToast } = useToasts();

        const selectionBounds = editorState.patternSelection
            ? {
                rowStart: Math.min(editorState.patternSelection.startRow, editorState.patternSelection.endRow),
                rowEnd: Math.max(editorState.patternSelection.startRow, editorState.patternSelection.endRow),
                channelStart: Math.min(editorState.patternSelection.startChannel, editorState.patternSelection.endChannel),
                channelEnd: Math.max(editorState.patternSelection.startChannel, editorState.patternSelection.endChannel),
            }
            : null;

        const setSelecting = useCallback((value: boolean) => {
            selectingRef.current = value;
            setIsSelecting(value);
        }, []);

        const updateSelectionBounds = useCallback((anchor: { rowIndex: number; channelIndex: Tic80ChannelIndex }, target: { rowIndex: number; channelIndex: Tic80ChannelIndex }) => {
            onEditorStateChange((state) => {
                state.setPatternSelection({
                    startRow: anchor.rowIndex,
                    endRow: target.rowIndex,
                    startChannel: anchor.channelIndex,
                    endChannel: target.channelIndex,
                });
            });
        }, [onEditorStateChange]);

        useEffect(() => {
            if (!isSelecting) return;
            const handleMouseUp = () => setSelecting(false);
            window.addEventListener('mouseup', handleMouseUp);
            return () => window.removeEventListener('mouseup', handleMouseUp);
        }, [isSelecting, setSelecting]);

        const resolveSelectionAnchor = (useExistingAnchor: boolean, rowIndex: number, channelIndex: Tic80ChannelIndex) => {
            if (useExistingAnchor) {
                if (selectionAnchorRef.current) {
                    return selectionAnchorRef.current;
                }
                if (editorState.patternSelection) {
                    const anchor = {
                        rowIndex: editorState.patternSelection.startRow,
                        channelIndex: ToTic80ChannelIndex(editorState.patternSelection.startChannel),
                    };
                    selectionAnchorRef.current = anchor;
                    return anchor;
                }
            }
            const anchor = { rowIndex, channelIndex };
            selectionAnchorRef.current = anchor;
            return anchor;
        };

        const handleCellMouseDown = (e: React.MouseEvent<HTMLTableCellElement>, rowIndex: number, channelIndex: Tic80ChannelIndex) => {
            if (e.button !== 0) return;
            const anchor = resolveSelectionAnchor(e.shiftKey, rowIndex, channelIndex);
            setSelecting(true);
            updateSelectionBounds(anchor, { rowIndex, channelIndex });
        };

        const handleCellMouseEnter = (rowIndex: number, channelIndex: Tic80ChannelIndex) => {
            if (!selectingRef.current) return;
            const anchor = selectionAnchorRef.current;
            if (!anchor) return;
            updateSelectionBounds(anchor, { rowIndex, channelIndex });
        };

        const getSelectionBounds = (notify = true) => {
            if (!selectionBounds && notify) {
                pushToast({ message: 'Select a block in the pattern first.', variant: 'error' });
            }
            return selectionBounds;
        };

        const resolveScopeTargets = useCallback((scope: ScopeValue): ScopeTargets | null => {
            const lastRow = Math.max(song.rowsPerPattern - 1, 0);
            const fullRowRange: RowRange = { start: 0, end: lastRow };
            const patternCount = song.patterns.length;
            const allPatternIndices = Array.from({ length: patternCount }, (_, idx) => idx);
            const allChannels = inclusiveRange(0, Tic80Caps.song.audioChannels - 1);

            switch (scope) {
                case 'selection': {
                    if (!selectionBounds) {
                        pushToast({ message: 'Select a block before using Selection scope.', variant: 'error' });
                        return null;
                    }
                    const targets = {
                        patternIndices: [safePatternIndex],
                        channels: inclusiveRange(selectionBounds.channelStart, selectionBounds.channelEnd),
                        rowRange: { start: selectionBounds.rowStart, end: selectionBounds.rowEnd },
                    };
                    debugAdvanced('Scope resolved', scope, targets);
                    return targets;
                }
                case 'channel-pattern':
                    const channelPatternTargets = {
                        patternIndices: [safePatternIndex],
                        channels: [editorState.patternEditChannel],
                        rowRange: fullRowRange,
                    };
                    debugAdvanced('Scope resolved', scope, channelPatternTargets);
                    return channelPatternTargets;
                case 'channel-song':
                    const channelSongTargets = {
                        patternIndices: allPatternIndices,
                        channels: [editorState.patternEditChannel],
                        rowRange: fullRowRange,
                    };
                    debugAdvanced('Scope resolved', scope, channelSongTargets);
                    return channelSongTargets;
                case 'pattern':
                    const patternTargets = {
                        patternIndices: [safePatternIndex],
                        channels: allChannels,
                        rowRange: fullRowRange,
                    };
                    debugAdvanced('Scope resolved', scope, patternTargets);
                    return patternTargets;
                case 'song':
                    const songTargets = {
                        patternIndices: allPatternIndices,
                        channels: allChannels,
                        rowRange: fullRowRange,
                    };
                    debugAdvanced('Scope resolved', scope, songTargets);
                    return songTargets;
                default:
                    return null;
            }
        }, [editorState.patternEditChannel, pushToast, safePatternIndex, selectionBounds, song.patterns.length, song.rowsPerPattern]);

        const handleTranspose = useCallback((amount: number, scope: ScopeValue) => {
            if (!amount) {
                return;
            }
            const targets = resolveScopeTargets(scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to transpose in that scope.', variant: 'error' });
                return;
            }
            onSongChange((nextSong) => {
                let mutated = false;
                for (const patternIndex of patternIndices) {
                    const targetPattern = nextSong.patterns[patternIndex];
                    if (!targetPattern) continue;
                    if (transposeCellsInPattern(targetPattern, channels, rowRange, nextSong.rowsPerPattern, amount)) {
                        mutated = true;
                    }
                }
                if (!mutated) {
                    pushToast({ message: 'No notes found to transpose in that scope.', variant: 'info' });
                }
            });
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const handleSetInstrument = useCallback((rawInstrument: number, scope: ScopeValue) => {
            const instrumentValue = normalizeInstrumentValue(rawInstrument);
            if (instrumentValue === SomaticCaps.noteCutInstrumentIndex) {
                pushToast({ message: 'Instrument 1 is reserved for note cuts.', variant: 'error' });
                return;
            }
            const targets = resolveScopeTargets(scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to edit in that scope.', variant: 'error' });
                return;
            }
            onSongChange((nextSong) => {
                let mutated = false;
                for (const patternIndex of patternIndices) {
                    const targetPattern = nextSong.patterns[patternIndex];
                    if (!targetPattern) continue;
                    if (setInstrumentInPattern(targetPattern, channels, rowRange, nextSong.rowsPerPattern, instrumentValue)) {
                        mutated = true;
                    }
                }
                if (!mutated) {
                    pushToast({ message: 'No instruments were eligible for update.', variant: 'info' });
                }
            });
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const handleChangeInstrument = useCallback((rawFrom: number, rawTo: number, scope: ScopeValue) => {
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
            const targets = resolveScopeTargets(scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to edit in that scope.', variant: 'error' });
                return;
            }
            onSongChange((nextSong) => {
                let mutated = false;
                for (const patternIndex of patternIndices) {
                    const targetPattern = nextSong.patterns[patternIndex];
                    if (!targetPattern) continue;
                    if (changeInstrumentInPattern(targetPattern, channels, rowRange, nextSong.rowsPerPattern, fromInstrument, toInstrument)) {
                        mutated = true;
                    }
                }
                if (!mutated) {
                    pushToast({ message: 'No matching instruments were found to change.', variant: 'info' });
                }
            });
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const handleInterpolate = useCallback((target: InterpolateTarget, scope: ScopeValue) => {
            const targets = resolveScopeTargets(scope);
            if (!targets) return;
            const { patternIndices, channels, rowRange } = targets;
            debugAdvanced('Interpolate request', { target, scope, patternIndices, channels, rowRange });
            if (patternIndices.length === 0 || channels.length === 0) {
                pushToast({ message: 'Nothing to interpolate in that scope.', variant: 'error' });
                return;
            }
            let totalMutated = false;
            let totalAnchorPairs = 0;
            onSongChange((nextSong) => {
                for (const patternIndex of patternIndices) {
                    const targetPattern = nextSong.patterns[patternIndex];
                    if (!targetPattern) continue;
                    const result = interpolatePatternValues(targetPattern, channels, rowRange, nextSong.rowsPerPattern, target);
                    debugAdvanced('Interpolate result', { patternIndex, result });
                    if (result.mutated) totalMutated = true;
                    totalAnchorPairs += result.anchorPairs;
                }
            });
            debugAdvanced('Interpolate summary', { totalMutated, totalAnchorPairs });
            if (!totalMutated) {
                if (totalAnchorPairs === 0) {
                    pushToast({ message: 'Need at least two anchors with values to interpolate.', variant: 'info' });
                } else {
                    pushToast({ message: 'No eligible rows between anchors to update.', variant: 'info' });
                }
            }
        }, [onSongChange, pushToast, resolveScopeTargets]);

        const createClipboardPayload = (): PatternClipboardPayload | null => {
            const bounds = getSelectionBounds();
            if (!bounds) return null;
            const maxRow = Math.max(0, song.rowsPerPattern - 1);
            const maxChannel = Tic80Caps.song.audioChannels - 1;
            const rowStart = Math.max(0, Math.min(bounds.rowStart, maxRow));
            const rowEnd = Math.max(0, Math.min(bounds.rowEnd, maxRow));
            const channelStart = Math.max(0, Math.min(bounds.channelStart, maxChannel));
            const channelEnd = Math.max(0, Math.min(bounds.channelEnd, maxChannel));
            const rows = rowEnd - rowStart + 1;
            const channels = channelEnd - channelStart + 1;
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
            const bounds = getSelectionBounds(false);
            if (!bounds) return;
            onSongChange((s) => {
                const pat = s.patterns[safePatternIndex];
                const maxRow = Math.max(0, s.rowsPerPattern - 1);
                const maxChannel = Tic80Caps.song.audioChannels - 1;
                for (let row = bounds.rowStart; row <= bounds.rowEnd && row <= maxRow; row++) {
                    for (let channel = bounds.channelStart; channel <= bounds.channelEnd && channel <= maxChannel; channel++) {
                        pat.setCell(ToTic80ChannelIndex(channel), row, {});
                    }
                }
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
            onSongChange((s) => {
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
            });
            const selectionEndRow = Math.min(startRow + payload.rows - 1, maxRow);
            const selectionEndChannel = Math.min(startChannel + payload.channels - 1, maxChannel);
            onEditorStateChange((state) => {
                state.setPatternSelection({
                    startRow,
                    endRow: selectionEndRow,
                    startChannel,
                    endChannel: selectionEndChannel,
                });
                state.setPatternEditTarget({ rowIndex: selectionEndRow, channelIndex: ToTic80ChannelIndex(selectionEndChannel) });
            });
            selectionAnchorRef.current = { rowIndex: startRow, channelIndex: ToTic80ChannelIndex(startChannel) };
            focusCell(startRow, startChannel * 4);
        };

        const handlePasteSelection = async () => {
            const payload = await readClipboardPayload();
            if (!payload) return;
            applyClipboardPayload(payload);
        };

        const handleClipboardShortcuts = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
            if (e.repeat) return false;
            const hasPrimaryModifier = e.ctrlKey || e.metaKey;
            const keyLower = e.key.toLowerCase();

            if (hasPrimaryModifier && !e.altKey) {
                if (keyLower === 'c' || e.key === 'Insert') {
                    e.preventDefault();
                    handleCopySelection();
                    return true;
                }
                if (keyLower === 'v') {
                    e.preventDefault();
                    void handlePasteSelection();
                    return true;
                }
                if (keyLower === 'x') {
                    e.preventDefault();
                    void handleCutSelection();
                    return true;
                }
            }

            if (!hasPrimaryModifier && !e.altKey && e.shiftKey) {
                if (e.key === 'Insert') {
                    e.preventDefault();
                    void handlePasteSelection();
                    return true;
                }
                if (e.key === 'Delete') {
                    e.preventDefault();
                    void handleCutSelection();
                    return true;
                }
            }

            return false;
        };

        const playbackSongPosition = musicState.somaticSongPosition ?? -1;
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

        const handleNoteKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, e: KeyboardEvent<HTMLTableCellElement>) => {
            // shift+backspace = note cut (still handled locally)
            if (e.shiftKey && e.key === 'Backspace') {
                onSongChange((s) => {
                    const pat = s.patterns[safePatternIndex];
                    const oldCell = pat.getCell(channelIndex, rowIndex);
                    pat.setCell(channelIndex, rowIndex, {
                        ...oldCell,
                        midiNote: 69,
                        instrumentIndex: SomaticCaps.noteCutInstrumentIndex,
                    });
                });
            }
            // note entry is now handled via global note input sources (MIDI/keyboard), so other keys are ignored here.
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

        const handleCommandKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const idx = commandKeyMap.indexOf(key);
            if (idx === -1) return false;
            onSongChange((s) => {
                const patIndex = Math.max(0, Math.min(safePatternIndex, s.patterns.length - 1));
                const pat = s.patterns[patIndex];
                const oldCell = pat.getCell(channelIndex, rowIndex);
                pat.setCell(channelIndex, rowIndex, {
                    ...oldCell,
                    effect: idx,
                });
            });
            return true;
        };

        const handleParamKey = (channelIndex: Tic80ChannelIndex, rowIndex: number, key: string): boolean => {
            const idx = paramKeyMap.indexOf(key);
            if (idx === -1) return false;
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
            onEditorStateChange((state) => state.advancePatternEditRow(step, rowCount));
            const nextRow = clamp(rowIndex + step, 0, Math.max(0, rowCount - 1));
            if (nextRow !== rowIndex) {
                focusCell(nextRow, columnIndex);
            }
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
                    const targetRow = row - 4;
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
                    const targetRow = row + 4;
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
                const targetRow = targetBlock * jumpSize;
                if (targetRow < 0) {
                    // Navigate to previous song order position
                    if (currentPosition > 0) {
                        onEditorStateChange((s) => s.setActiveSongPosition(currentPosition - 1));
                        const blocksInPattern = Math.ceil(rowCount / jumpSize);
                        const newTargetRow = (blocksInPattern + targetBlock) * jumpSize;
                        return [Math.max(0, newTargetRow), col] as const;
                    }
                    // At the beginning of the song, clamp to top
                    return [0, col] as const;
                }
                return [targetRow, col] as const;
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

        const onCellKeyDown = (e: React.KeyboardEvent<HTMLTableCellElement>) => {
            const target = e.currentTarget;
            const rowIndex = parseInt(target.dataset.rowIndex!, 10);
            const channelIndex = parseInt(target.dataset.channelIndex!, 10) as Tic80ChannelIndex;
            const cellType = target.dataset.cellType as CellType;
            //const colOffset = cellType === 'note' ? 0 : cellType === 'instrument' ? 1 : cellType === 'command' ? 2 : 3;
            const columnIndex = parseInt(target.dataset.columnIndex!, 10);
            //const col = channelIndex * 4 + colOffset;

            if (handleClipboardShortcuts(e)) {
                return;
            }

            const currentRowForNav = editorState.patternEditRow ?? rowIndex;
            const navTarget = handleArrowNav(currentRowForNav, columnIndex, e.key, e.ctrlKey);
            if (navTarget) {
                const [targetRow, targetCol] = navTarget;
                const targetChannel = ToTic80ChannelIndex(Math.floor(targetCol / 4));
                onEditorStateChange((state) => state.setPatternEditTarget({ rowIndex: targetRow, channelIndex: targetChannel }));
                selectionAnchorRef.current = { rowIndex: targetRow, channelIndex: targetChannel };
                focusCell(targetRow, targetCol);
                e.preventDefault();
                return;
            }

            if (e.key === 'Enter' && !e.repeat) {
                e.preventDefault();
                playRow(rowIndex);
                return;
            }

            if (!editingEnabled) return;

            // Delete key: clear entire cell
            if (!e.altKey && !e.shiftKey && !e.ctrlKey && e.key === 'Delete' && !e.repeat) {
                e.preventDefault();
                onSongChange((s) => {
                    const pat = s.patterns[safePatternIndex];
                    pat.setCell(channelIndex, rowIndex, {
                        midiNote: undefined,
                        instrumentIndex: undefined,
                        effect: undefined,
                        effectX: undefined,
                        effectY: undefined
                    });
                });
                return;
            }

            // Backspace: clear only the field under cursor
            if (!e.altKey && !e.shiftKey && !e.ctrlKey && e.key === 'Backspace' && !e.repeat) {
                e.preventDefault();
                onSongChange((s) => {
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
                    }
                });
                return;
            }

            if (cellType === 'note' && !e.repeat) {
                handleNoteKey(channelIndex, rowIndex, e);
            } else if (cellType === 'instrument' && instrumentKeyMap.includes(e.key) && !e.repeat) {
                handleInstrumentKey(channelIndex, rowIndex, e.key);
            } else if (cellType === 'command' && commandKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleCommandKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    advanceAfterCellEdit(rowIndex, columnIndex);
                    e.preventDefault();
                }
            } else if (cellType === 'param' && paramKeyMap.includes(e.key) && !e.repeat) {
                const handled = handleParamKey(channelIndex, rowIndex, e.key);
                if (handled) {
                    advanceAfterCellEdit(rowIndex, columnIndex);
                    e.preventDefault();
                }
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
            //stopRow();
        };


        const onCellFocus = (rowIndex: number, channelIndex: Tic80ChannelIndex, col: number) => {
            updateEditTarget({ rowIndex, channelIndex });
            selectionAnchorRef.current = { rowIndex, channelIndex };
        };

        const isChannelSelected = (channelIndex: number) => selectionBounds
            ? channelIndex >= selectionBounds.channelStart && channelIndex <= selectionBounds.channelEnd
            : false;

        return (
            <div className={`pattern-grid-shell${advancedEditPanelOpen ? ' pattern-grid-shell--advanced-open' : ''}`}>
                {advancedEditPanelOpen && (
                    <PatternAdvancedPanel
                        // enabled={editingEnabled} // allow advanced edits even in non-edit mode
                        onTranspose={handleTranspose}
                        onSetInstrument={handleSetInstrument}
                        onChangeInstrument={handleChangeInstrument}
                        onInterpolate={handleInterpolate}
                    />
                )}
                <div className={`pattern-grid-container${editingEnabled ? ' pattern-grid-container--editMode' : ' pattern-grid-container--locked'}`}>
                    <Tooltip title={advancedEditPanelOpen ? 'Hide advanced edit panel' : 'Show advanced edit panel (\\)'} >
                        <button
                            type="button"
                            className={`pattern-advanced-handle${advancedEditPanelOpen ? ' pattern-advanced-handle--open' : ''}`}
                            onClick={() => onSetAdvancedEditPanelOpen(!advancedEditPanelOpen)}
                            aria-expanded={advancedEditPanelOpen}
                            aria-controls="pattern-advanced-panel"
                        >
                            {advancedEditPanelOpen ? CharMap.LeftArrow : CharMap.RightArrow}
                        </button>
                    </Tooltip>
                    <table className="pattern-grid">
                        <colgroup>
                            <col />
                        </colgroup>
                        <thead>
                            <tr>
                                <th></th>
                                {[0, 1, 2, 3].map((i) => {
                                    const headerClass = `channel-header${isChannelSelected(i) ? ' channel-header--selected' : ''}`;
                                    return (
                                        <th key={i} colSpan={4} className={headerClass}>{i + 1}</th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from({ length: song.rowsPerPattern }, (_, rowIndex) => {
                                const chunkSize = Math.max(song.highlightRowCount || 1, 1);
                                const sectionIndex = Math.floor(rowIndex / chunkSize) % 2;
                                const rowClass = `${sectionIndex === 0 ? 'row-section-a' : 'row-section-b'}${activeRow === rowIndex ? ' active-row' : ''}`;
                                const isRowInSelection = selectionBounds ? rowIndex >= selectionBounds.rowStart && rowIndex <= selectionBounds.rowEnd : false;
                                const rowNumberClass = `row-number${isRowInSelection ? ' row-number--selected' : ''}`;
                                return (
                                    <tr key={rowIndex} className={rowClass}>
                                        <td className={rowNumberClass}>{rowIndex}</td>
                                        {pattern.channels.map((channel, channelIndexRaw) => {
                                            const channelIndex = ToTic80ChannelIndex(channelIndexRaw);
                                            const row = channel.rows[rowIndex];
                                            const noteCut = isNoteCut(row);
                                            const noteText = noteCut ? "^^^" : formatMidiNote(row.midiNote);
                                            const instText = noteCut ? "" : formatInstrument(row.instrumentIndex);
                                            const cmdText = formatCommand(row.effect);
                                            const paramText = formatParams(row.effectX, row.effectY);
                                            const noteCol = channelIndex * 4;
                                            const instCol = channelIndex * 4 + 1;
                                            const cmdCol = channelIndex * 4 + 2;
                                            const paramCol = channelIndex * 4 + 3;
                                            const isEmpty = !row.midiNote && row.effect === undefined && row.instrumentIndex == null && row.effectX === undefined && row.effectY === undefined;
                                            const isMetaFocused = editorState.patternEditChannel === channelIndex && editorState.patternEditRow === rowIndex;//focusedCell?.row === rowIndex && focusedCell?.channel === channelIndex;
                                            const channelSelected = isChannelSelected(channelIndex);
                                            const isCellSelected = isRowInSelection && channelSelected;

                                            const getSelectionClasses = (cellType: CellType) => {
                                                if (!isCellSelected || !selectionBounds) return '';
                                                let classes = ' pattern-cell--selected';
                                                if (rowIndex === selectionBounds.rowStart) classes += ' pattern-cell--selection-top';
                                                if (rowIndex === selectionBounds.rowEnd) classes += ' pattern-cell--selection-bottom';
                                                if (channelIndex === selectionBounds.channelStart && cellType === 'note') classes += ' pattern-cell--selection-left';
                                                if (channelIndex === selectionBounds.channelEnd && cellType === 'param') classes += ' pattern-cell--selection-right';
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

                                            const additionalClasses = `${isEmpty ? ' empty-cell' : ''}${isMetaFocused ? ' metaCellFocus' : ''}${noteCut ? ' note-cut-cell' : ''}${errorInRow ? ' error-cell' : ''}`;
                                            const noteSelectionClass = getSelectionClasses('note');
                                            const instSelectionClass = getSelectionClasses('instrument');
                                            const cmdSelectionClass = getSelectionClasses('command');
                                            const paramSelectionClass = getSelectionClasses('param');

                                            const noteClass = `note-cell${additionalClasses}${noteSelectionClass}`;
                                            const instClass = `instrument-cell${additionalClasses}${instSelectionClass}`;
                                            const cmdClass = `command-cell${additionalClasses}${cmdSelectionClass}`;
                                            const paramClass = `param-cell${additionalClasses}${paramSelectionClass}`;
                                            return (
                                                <React.Fragment key={channelIndex}>
                                                    <td
                                                        tabIndex={0}
                                                        ref={(el) => (cellRefs[rowIndex][noteCol] = el)}
                                                        className={noteClass}
                                                        onKeyDown={onCellKeyDown}
                                                        onKeyUp={onCellKeyUp}
                                                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => handleCellMouseEnter(rowIndex, channelIndex)}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, noteCol)}
                                                        //onBlur={onCellBlur}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="note"
                                                        data-column-index={noteCol}
                                                        data-cell-value={`[${JSON.stringify(row.midiNote)}]`}
                                                    >
                                                        <Tooltip title={errorText} disabled={!errorInRow}>
                                                            <div>{noteText}</div>
                                                        </Tooltip>
                                                        {/* {errorInRow && (<HelpTooltip className="error-tooltip" content={errorText} children={<>!</>} />)} */}
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        ref={(el) => (cellRefs[rowIndex][instCol] = el)}
                                                        className={instClass}
                                                        onKeyDown={onCellKeyDown}
                                                        onKeyUp={onCellKeyUp}
                                                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => handleCellMouseEnter(rowIndex, channelIndex)}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, instCol)}
                                                        //onBlur={onCellBlur}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="instrument"
                                                        data-column-index={instCol}
                                                        data-cell-value={`[${JSON.stringify(row.instrumentIndex)}]`}
                                                    >
                                                        {instText}
                                                    </td>
                                                    <td
                                                        tabIndex={0}
                                                        ref={(el) => (cellRefs[rowIndex][cmdCol] = el)}
                                                        className={cmdClass}
                                                        onKeyDown={onCellKeyDown}
                                                        onKeyUp={onCellKeyUp}
                                                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => handleCellMouseEnter(rowIndex, channelIndex)}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, cmdCol)}
                                                        //onBlur={onCellBlur}
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
                                                        ref={(el) => (cellRefs[rowIndex][paramCol] = el)}
                                                        className={paramClass}
                                                        onKeyDown={onCellKeyDown}
                                                        onKeyUp={onCellKeyUp}
                                                        onMouseDown={(e) => handleCellMouseDown(e, rowIndex, channelIndex)}
                                                        onMouseEnter={() => handleCellMouseEnter(rowIndex, channelIndex)}
                                                        onFocus={() => onCellFocus(rowIndex, channelIndex, paramCol)}
                                                        //onBlur={onCellBlur}
                                                        data-row-index={rowIndex}
                                                        data-channel-index={channelIndex}
                                                        data-cell-type="param"
                                                        data-column-index={paramCol}
                                                        data-cell-value={`[X=${JSON.stringify(row.effectX)},Y=${JSON.stringify(row.effectY)}]`}
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
            </div>
        );
    });
