import {typedEntries} from "./utils/utils";

export const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export const OCTAVE_COUNT = 8;
export const MIN_MIDI_NOTE = 0;
export const MAX_MIDI_NOTE = 255; // full MIDI byte range for registry completeness

// Tracker/UI range (aligned to TIC-80 0..95)
// choose mapping: MIDI 12 (C0) -> TIC note index 0 (C-0)
const MIDI_FOR_TIC_NOTE0 = 12; // C0
const MIN_TIC_NOTE = 0;
const MAX_TIC_NOTE = 95;
// const MIN_PATTERN_NOTE = MIDI_FOR_TIC_NOTE0 + MIN_TIC_NOTE; // 12
// const MAX_PATTERN_NOTE = MIDI_FOR_TIC_NOTE0 + MAX_TIC_NOTE; // 107

// export const MIN_PATTERN_NOTE = 0;
// export const MAX_PATTERN_NOTE = 95;
// export const MAX_NOTE_NUM = MAX_PATTERN_NOTE; // backwards compatibility alias

export type NoteInfo = {
   midi: number; // 0..127 absolute MIDI note number
   name: string;
   frequency: number;
   semitone: number;             // 0..11 within octave (C=0)
   octave: number;               // MIDI-standard display octave (C4 = 60)
   ticAbsoluteNoteIndex: number; // 0..95 used by sfx()
   ticOctave: number;            // 0..7 used by TIC-80 pattern encoding (-1 if not representable)
   ticNoteNibble: number;        // 4..15 used by TIC-80 pattern encoding (0 if not representable)
   isAvailableInPattern: boolean;
};

const calcFrequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const NOTE_REGISTRY: Record<number, NoteInfo> = {};
const NOTE_NAME_MAP: Record<string, NoteInfo> = {};
export const NOTE_INFOS: NoteInfo[] = [];

for (let midi = MIN_MIDI_NOTE; midi <= MAX_MIDI_NOTE; midi++) {
   const semitone = ((midi % 12) + 12) % 12; // 0..11
   const octave = Math.floor(midi / 12) - 1; // MIDI standard: 60 -> C4

   const noteName = `${NOTE_NAMES[semitone]}${octave}`;
   const frequency = calcFrequency(midi);

   // Map MIDI -> TIC note index (0..95), then to (O, N)
   const ticNoteIndex = midi - MIDI_FOR_TIC_NOTE0;
   const isAvailableInPattern = ticNoteIndex >= MIN_TIC_NOTE && ticNoteIndex <= MAX_TIC_NOTE;

   let ticOctave = -1;
   let ticNoteNibble = 0;

   if (isAvailableInPattern) {
      ticOctave = Math.floor(ticNoteIndex / 12); // 0..7
      const noteInOctave = ticNoteIndex % 12;    // 0..11
      ticNoteNibble = noteInOctave + 4;          // 4..15 (pattern N nibble)
   }

   const info: NoteInfo = {
      midi,
      name: noteName,
      frequency,
      semitone,
      octave,
      ticOctave,
      ticNoteNibble,
      isAvailableInPattern,
      ticAbsoluteNoteIndex: ticNoteIndex,
   };

   NOTE_REGISTRY[midi] = info;
   NOTE_NAME_MAP[noteName] = info;
   NOTE_INFOS.push(info);
}

export const NOTES_BY_NUM: Record<number, NoteInfo> = NOTE_REGISTRY;
export const NOTE_NUMS_BY_NAME: Record<string, number> = Object.fromEntries(
   typedEntries(NOTE_NAME_MAP).map(([k, v]) => [k, v.midi]),
);

export function getNoteInfo(midi: number): NoteInfo|undefined {
   return NOTE_REGISTRY[midi];
}

export function midiToFrequency(midi: number): number|undefined {
   return NOTE_REGISTRY[midi]?.frequency;
}

export function midiToName(midi: number): string|undefined {
   return NOTE_REGISTRY[midi]?.name;
}

export function nameToMidi(name: string): number|undefined {
   return NOTE_NAME_MAP[name]?.midi;
}

export function midiToTicPitch(
   midi: number,
   ): {octave: number; noteNibble: number}|null {
   const info = NOTE_REGISTRY[midi];
   if (!info || !info.isAvailableInPattern)
      return null;
   return {octave: info.ticOctave, noteNibble: info.ticNoteNibble};
}
