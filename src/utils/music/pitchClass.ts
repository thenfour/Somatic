import {defineEnum} from "../enum";

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
