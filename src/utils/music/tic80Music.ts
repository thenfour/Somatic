
// ------------------------------------------------------------------------------------------------
// TIC-80 pitch codec (octave 0..7, note nibble 4..15)

export type TicPitch = Readonly<{
   absoluteNoteIndex: number; octave: number; // 0..7 if encodable, else -1
   noteNibble: number;                        // 4..15 if encodable, else 0
   isPatternEncodable: boolean;
}>;

type TicCodecConfig = Readonly<{
   midiForTicNote0: number;         // e.g. 12 => C0
   minTicAbsoluteNoteIndex: number; // e.g. 0
   maxTicAbsoluteNoteIndex: number; // e.g. 95
}>;

export const defaultTicNoteConfig: TicCodecConfig = Object.freeze({
   midiForTicNote0: 12, // C0
   minTicAbsoluteNoteIndex: 0,
   maxTicAbsoluteNoteIndex: 95,
});

export function ticPitchFromMidi(midi: number, cfg = defaultTicNoteConfig): TicPitch {
   const absoluteNoteIndex = midi - cfg.midiForTicNote0;
   const isPatternEncodable =
      absoluteNoteIndex >= cfg.minTicAbsoluteNoteIndex && absoluteNoteIndex <= cfg.maxTicAbsoluteNoteIndex;

   if (!isPatternEncodable) {
      return {absoluteNoteIndex, octave: -1, noteNibble: 0, isPatternEncodable: false};
   }

   const octave = Math.floor(absoluteNoteIndex / 12); // 0..7
   const noteInOct = absoluteNoteIndex % 12;          // 0..11
   const noteNibble = noteInOct + 4;                  // 4..15
   return {absoluteNoteIndex, octave, noteNibble, isPatternEncodable: true};
}

export function midiFromTicPitch(octave: number, noteNibble: number, cfg = defaultTicNoteConfig): number|undefined {
   if (!Number.isInteger(octave) || !Number.isInteger(noteNibble))
      return undefined;
   if (octave < 0 || octave > 7)
      return undefined;
   if (noteNibble < 4 || noteNibble > 15)
      return undefined;

   const noteInOct = noteNibble - 4; // 0..11
   const absoluteNoteIndex = octave * 12 + noteInOct;

   if (absoluteNoteIndex < cfg.minTicAbsoluteNoteIndex || absoluteNoteIndex > cfg.maxTicAbsoluteNoteIndex) {
      return undefined;
   }

   return absoluteNoteIndex + cfg.midiForTicNote0;
}
