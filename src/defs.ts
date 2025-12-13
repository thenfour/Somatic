export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export const NOTES_BY_NUM: Record<number, { name: string; frequency: number }> = {};
export const NOTE_NUMS_BY_NAME: Record<string, number> = {};
export const OCTAVE_COUNT = 8;
for (let oct = 1; oct <= OCTAVE_COUNT; oct++) {
    for (let n = 0; n < 12; n++) {
        const noteVal = oct * 12 + n - 11;
        const noteName = (NOTE_NAMES[n] + "-").substring(0, 2) + oct;
        NOTES_BY_NUM[noteVal] = {
            name: noteName,
            frequency: 440 * 2 ** ((noteVal - 58) / 12),
        };
        NOTE_NUMS_BY_NAME[noteName] = noteVal;
    }
}
export const MAX_NOTE_NUM = OCTAVE_COUNT * 12;

export const PATTERN_COUNT = 64;
export const INSTRUMENT_COUNT = 15;
