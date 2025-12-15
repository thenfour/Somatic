export const NOTE_NAMES = ["C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export const OCTAVE_COUNT = 8;
export const MIN_MIDI_NOTE = 0;
export const MAX_MIDI_NOTE = 255; // full MIDI byte range for registry completeness

// Tracker/UI range (aligned to TIC-80 0..95)
export const MIN_PATTERN_NOTE = 0;
export const MAX_PATTERN_NOTE = 95;
export const MAX_NOTE_NUM = MAX_PATTERN_NOTE; // backwards compatibility alias

export type NoteInfo = {
   midi: number; // 0..11 within octave
   name: string;
   frequency: number;
   semitone: number;
   octave: number;        // MIDI-standard display octave (C4 = 60)
   ticOctave: number;     // 0..7 used by TIC-80 encoding
   ticNoteNibble: number; // 4..15 used by TIC-80 encoding
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
   const ticOctave = Math.max(0, Math.min(7, octave));
   const ticNoteNibble = semitone + 4; // 4..15
   const isAvailableInPattern = midi >= MIN_PATTERN_NOTE && midi <= MAX_PATTERN_NOTE;
   const info: NoteInfo = {
      midi,
      name: noteName,
      frequency,
      semitone,
      octave,
      ticOctave,
      ticNoteNibble,
      isAvailableInPattern,
   };
   NOTE_REGISTRY[midi] = info;
   NOTE_NAME_MAP[noteName] = info;
   NOTE_INFOS.push(info);
}

export const NOTES_BY_NUM: Record<number, NoteInfo> = NOTE_REGISTRY;
export const NOTE_NUMS_BY_NAME: Record<string, number> = Object.fromEntries(
   Object.entries(NOTE_NAME_MAP).map(([k, v]) => [k, v.midi]),
);

export function getNoteInfo(midi: number): NoteInfo|undefined { return NOTE_REGISTRY[midi]; }

export function midiToFrequency(midi: number): number|undefined { return NOTE_REGISTRY[midi]?.frequency; }

export function midiToName(midi: number): string|undefined { return NOTE_REGISTRY[midi]?.name; }

export function nameToMidi(name: string): number|undefined { return NOTE_NAME_MAP[name]?.midi; }

export function midiToTicPitch(midi: number): {octave: number; noteNibble: number}|null {
   const info = NOTE_REGISTRY[midi];
   if (!info)
      return null;
   return {octave: info.ticOctave, noteNibble: info.ticNoteNibble};
}

// export const PATTERN_COUNT = 64;
// export const INSTRUMENT_COUNT = 15;
