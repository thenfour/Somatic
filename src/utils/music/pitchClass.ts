import {defineEnum} from "../enum";
import {CharMap} from "../utils";

export const kPitchClasses = defineEnum({
   C: {
      value: 0,
      label: "C",
      labelUnicode: "C",
      labelFixedWidth: "C-",
   },
   Cs: {
      value: 1,
      label: "C#",
      labelUnicode: "C♯",
      labelFixedWidth: "C#",
   },
   D: {
      value: 2,
      label: "D",
      labelUnicode: "D",
      labelFixedWidth: "D-",
   },
   Ds: {
      value: 3,
      label: "D#",
      labelUnicode: "D♯",
      labelFixedWidth: "D#",
   },
   E: {
      value: 4,
      label: "E",
      labelUnicode: "E",
      labelFixedWidth: "E-",
   },
   F: {
      value: 5,
      label: "F",
      labelUnicode: "F",
      labelFixedWidth: "F-",
   },
   Fs: {
      value: 6,
      label: "F#",
      labelUnicode: "F♯",
      labelFixedWidth: "F#",
   },
   G: {
      value: 7,
      label: "G",
      labelUnicode: "G",
      labelFixedWidth: "G-",
   },
   Gs: {
      value: 8,
      label: "G#",
      labelUnicode: "G♯",
      labelFixedWidth: "G#",
   },
   A: {
      value: 9,
      label: "A",
      labelUnicode: "A",
      labelFixedWidth: "A-",
   },
   As: {
      value: 10,
      label: "A#",
      labelUnicode: "A♯",
      labelFixedWidth: "A#",
   },
   B: {
      value: 11,
      label: "B",
      labelUnicode: "B",
      labelFixedWidth: "B-",
   },
} as const);

export type PitchClassInfo = typeof kPitchClasses.$info;

// manual mapping within octave. after that,
// notate as octaves + interval within octave. preserve fractions of notes in cents.
// purposely don't map above octave (for example maj 9th) because it gets weird (for example a diminished 12th just feels off.)
const kMusicalIntervalToNameMap = [
   "unison", // never used.
   "♭2",
   "♮2",
   "♭3",
   "♮3",
   "♮4",
   "♭5",
   "♮5",
   "♭6",
   "♮6",
   "♭7",
   "♮7",
] as const;

export function FormatMusicalInterval(interval: number): string {
   const intInterval = Math.round(interval);
   if (intInterval === 0)
      return "unison";
   const fraction = interval - intInterval; // may be pos/neg
   const cents = Math.round(fraction * 100);
   const fractionText = Math.abs(cents) !== 0 ? ` ${cents > 0 ? "+" : ""}${cents} cents` : "";
   const absInterval = Math.abs(intInterval);
   const octave = Math.floor(absInterval / 12);
   const intervalWithinOctave = absInterval % 12;
   if (intervalWithinOctave == 0)
      return `${octave} octaves${fractionText}`;
   const sign = intInterval < 0 ? "-" : "";
   return `${sign}${kMusicalIntervalToNameMap[intervalWithinOctave]}${octave > 0 ? ` + ${octave} octaves` : ""}${fractionText}`;
}
