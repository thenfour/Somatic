import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from "../defs";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export class EditorState {
    octave: number;
    pattern: number;
    selectedPosition: number;
    currentInstrument: number;
    editingEnabled: boolean;
    patternEditRow: number;
    patternEditChannel: number;

    constructor({ octave = Math.floor(OCTAVE_COUNT / 2), pattern = 0, selectedPosition = 0, currentInstrument = 1, editingEnabled = true, patternEditRow = 0, patternEditChannel = 0 }: Partial<EditorState> = {}) {
        this.octave = clamp(octave, 1, OCTAVE_COUNT);
        this.pattern = clamp(pattern, 0, PATTERN_COUNT - 1);
        this.selectedPosition = clamp(selectedPosition, 0, 255);
        this.currentInstrument = clamp(currentInstrument, 1, INSTRUMENT_COUNT);
        this.editingEnabled = Boolean(editingEnabled);
        this.patternEditRow = clamp(patternEditRow, 0, 63);
        this.patternEditChannel = clamp(patternEditChannel, 0, 3);
    }

    setOctave(nextOctave: number) {
        this.octave = clamp(nextOctave, 1, OCTAVE_COUNT);
    }

    setPattern(nextPattern: number) {
        this.pattern = clamp(nextPattern, 0, PATTERN_COUNT - 1);
    }

    setSelectedPosition(nextPosition: number) {
        this.selectedPosition = clamp(nextPosition, 0, 255);
    }

    setCurrentInstrument(nextInstrument: number) {
        this.currentInstrument = clamp(nextInstrument, 1, INSTRUMENT_COUNT);
    }

    setEditingEnabled(enabled: boolean) {
        this.editingEnabled = Boolean(enabled);
    }

    setPatternEditTarget(row: number, channel: number) {
        this.patternEditRow = clamp(row, 0, 63);
        this.patternEditChannel = clamp(channel, 0, 3);
    }

    toData() {
        return {
            octave: this.octave,
            pattern: this.pattern,
            selectedPosition: this.selectedPosition,
            currentInstrument: this.currentInstrument,
            editingEnabled: this.editingEnabled,
            patternEditRow: this.patternEditRow,
            patternEditChannel: this.patternEditChannel,
        };
    }

    static fromData(data?: Partial<EditorState>) {
        return new EditorState(data || {});
    }

    clone() {
        return EditorState.fromData(this.toData());
    }
}
