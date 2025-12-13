import { OCTAVE_COUNT, PATTERN_COUNT } from '../defs';

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

export class EditorState {
    constructor({ octave = Math.floor(OCTAVE_COUNT / 2), pattern = 0, selectedPosition = 0 } = {}) {
        this.octave = clamp(octave, 1, OCTAVE_COUNT);
        this.pattern = clamp(pattern, 0, PATTERN_COUNT - 1);
        this.selectedPosition = clamp(selectedPosition, 0, 255);
    }

    setOctave(nextOctave) {
        this.octave = clamp(nextOctave, 1, OCTAVE_COUNT);
    }

    setPattern(nextPattern) {
        this.pattern = clamp(nextPattern, 0, PATTERN_COUNT - 1);
    }

    setSelectedPosition(nextPosition) {
        this.selectedPosition = clamp(nextPosition, 0, 255);
    }

    toData() {
        return {
            octave: this.octave,
            pattern: this.pattern,
            selectedPosition: this.selectedPosition,
        };
    }

    static fromData(data) {
        return new EditorState(data || {});
    }

    clone() {
        return EditorState.fromData(this.toData());
    }
}
