import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from "../defs";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export class EditorState {
    octave: number;
    pattern: number;
    selectedPosition: number;
    currentInstrument: number;

    constructor({ octave = Math.floor(OCTAVE_COUNT / 2), pattern = 0, selectedPosition = 0, currentInstrument = 1 }: Partial<EditorState> = {}) {
        this.octave = clamp(octave, 1, OCTAVE_COUNT);
        this.pattern = clamp(pattern, 0, PATTERN_COUNT - 1);
        this.selectedPosition = clamp(selectedPosition, 0, 255);
        this.currentInstrument = clamp(currentInstrument, 1, INSTRUMENT_COUNT);
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

    toData() {
        return {
            octave: this.octave,
            pattern: this.pattern,
            selectedPosition: this.selectedPosition,
            currentInstrument: this.currentInstrument,
        };
    }

    static fromData(data?: Partial<EditorState>) {
        return new EditorState(data || {});
    }

    clone() {
        return EditorState.fromData(this.toData());
    }
}
