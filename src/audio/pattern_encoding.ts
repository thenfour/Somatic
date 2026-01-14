import {NOTE_INFOS} from "../defs";
import {Pattern, PatternCell, PatternChannel} from "../models/pattern";
import {kTic80EffectCommand, Tic80Caps} from "../models/tic80Capabilities";

function encodePatternNote(midiNoteValue: number|undefined): {noteNibble: number; octave: number} {
   if (midiNoteValue === undefined) {
      return {noteNibble: 0, octave: 0};
   }
   const noteInfo = NOTE_INFOS[midiNoteValue]!;
   return {
      noteNibble: noteInfo.ticNoteNibble, octave: noteInfo.octave,
   }
};

function encodePatternCellTriplet(
   midiNoteValue: number|undefined, instrument: number, command: number, argX: number, argY: number):
   [number, number, number] {
   const ticPitch = encodePatternNote(midiNoteValue);

   const byte0 = ((argX & 0xf) << 4) | (ticPitch.noteNibble & 0x0f);
   const byte1 = ((instrument >> 5) & 0x01) << 7 | ((command & 0x07) << 4) | (argY & 0x0f);
   const byte2 = ((ticPitch.octave & 0x07) << 5) | (instrument & 0x1f);
   return [byte0, byte1, byte2];
}

function decodeTicPitch(noteNibble: number, octave: number): number|undefined {
   // See defs.ts mapping: MIDI 12 (C0) -> TIC note index 0.
   // noteNibble is 4..15 for actual notes.
   if (noteNibble < 4)
      return undefined;
   const noteInOctave = (noteNibble - 4) & 0x0f;
   const ticNoteIndex = (octave * 12) + noteInOctave;
   const midi = 12 + ticNoteIndex;
   // This should always land in 12..107, but be conservative.
   if (midi < 0 || midi >= NOTE_INFOS.length)
      return undefined;
   return midi;
}

function decodePatternCellTriplet(byte0: number, byte1: number, byte2: number): PatternCell {
   // XXXXNNNN SCCCYYYY OOOSSSSS
   const argX = (byte0 >> 4) & 0x0f;
   const noteNibble = byte0 & 0x0f;

   const instrument = (((byte1 >> 7) & 0x01) << 5) | (byte2 & 0x1f);
   const command = (byte1 >> 4) & 0x07; // 0 = no effect
   const argY = byte1 & 0x0f;
   const octave = (byte2 >> 5) & 0x07;

   // noteNibble: 0 = empty; 1..3 = stops; 4..15 = notes
   if (noteNibble === 0) {
      return {};
   }
   if (noteNibble < 4) {
      // Map TIC-80 stops to Somatic's explicit note-off.
      return {
         noteOff: true,
         instrumentIndex: undefined,
      };
   }

   const midiNote = decodeTicPitch(noteNibble, octave);
   const effect =
      kTic80EffectCommand.infos.find(info => info.tic80EncodedValue === command); // clamp(command - 1, 0, 7);

   // Somatic instruments are 0-based and exclude TIC-80 reserved indices 0 and 1.
   // We decode reserved instruments to Somatic semantics:
   // - 0 => no instrument
   // - 1 => note off (Somatic-exported carts use instrument 1 as silent off)
   let somaticInstrumentIndex: number|undefined = undefined;
   let noteOff = false;
   if (instrument === 0) {
      somaticInstrumentIndex = undefined;
   } else {
      somaticInstrumentIndex = instrument - 1; // - 2;
   }

   return {
      midiNote,
      instrumentIndex: somaticInstrumentIndex,
      noteOff,
      tic80Effect: effect ? effect.key : undefined,
      tic80EffectX: argX,
      tic80EffectY: argY,
   };
}

// outputs 4 patterns (one for each channel)
function encodePatternChannelRows(
   getCell: (rowIndex: number) => PatternCell,
   ): Uint8Array {
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-patterns
   // chunk type 15
   // RAM at 0x11164...0x13E63
   // 192 bytes per pattern (16 rows x 4 channels x 3 bytes)
   // note: sfx number of 0 is valid in tic-80.

   //    Each pattern is 192 bytes long (trailing zeros are removed). Each note in a patters is represented by a triplet of bytes, like this:
   // ----NNNN SCCCAAAA OOOSSSSS

   // Explanation :

   //     N is the note number (4-15 for notes and <4 for stops)
   //     S is the sfx number (the part in byte 2 is to be added to the one in byte 3 after shifting it to the left 2 times)
   //     C is the command to be performed on the note (0-7 -> MCJSPVD)
   //     A is the x and y arguments for each command
   //     O is the octave of each note

   const buf = new Uint8Array(Tic80Caps.pattern.maxRows * 3);

   for (let row = 0; row < Tic80Caps.pattern.maxRows; row++) {
      const cellData = getCell(row);

      // Map Somatic instrument index -> TIC-80 SFX index:
      // - noteOff => instrument 1 (silent off)
      // - null/undefined => instrument 0 (no instrument)
      // - N => N+2 (leave room for reserved 0/1)
      const inst = cellData.noteOff ? 1 : (cellData.instrumentIndex == null ? 0 : ((cellData.instrumentIndex | 0) + 2));

      const commandArgX = cellData.tic80EffectX ?? 0;
      const commandArgY = cellData.tic80EffectY ?? 0;
      //const command = cellData.effect === undefined ? 0 : clamp(cellData.effect + 1, 0, 7);
      const command = kTic80EffectCommand.coerceByKey(cellData.tic80Effect);
      // For noteOff cells, ensure we emit a note so it actually retriggers and cuts.
      const noteForEncoding =
         cellData.noteOff ? (cellData.midiNote ?? Tic80Caps.pattern.minMidiNote) : cellData.midiNote;
      const [b0, b1, b2] = encodePatternCellTriplet(
         noteForEncoding, inst, command ? command.tic80EncodedValue : 0, commandArgX, commandArgY);
      const base = 3 * row;
      buf[base + 0] = b0;
      buf[base + 1] = b1;
      buf[base + 2] = b2;
   }
   //}

   return buf;
}

// function encodePatternChannel(pattern: Pattern, channelIndex: number): Uint8Array {
//    return encodePatternChannelRows((rowIndex) => pattern.getCell(channelIndex, rowIndex));
// }

export function encodePatternChannelDirect(channel: PatternChannel): Uint8Array {
   //const rows = channel.rows;
   return encodePatternChannelRows((rowIndex) => channel.getCell(rowIndex));
}

export function decodePatternChannelBytes(bytes: Uint8Array, startOffset = 0): PatternChannel {
   // Decodes 64 rows (192 bytes) starting at startOffset; missing bytes are treated as 0.
   const rows: PatternCell[] = new Array(Tic80Caps.pattern.maxRows);
   for (let row = 0; row < Tic80Caps.pattern.maxRows; row++) {
      const base = startOffset + (row * 3);
      const b0 = bytes[base + 0] ?? 0;
      const b1 = bytes[base + 1] ?? 0;
      const b2 = bytes[base + 2] ?? 0;
      rows[row] = decodePatternCellTriplet(b0, b1, b2);

      // now if there's no effect, remove the param if they are 0.
      if (rows[row].tic80Effect === undefined && rows[row].tic80EffectX === 0 && rows[row].tic80EffectY === 0) {
         rows[row].tic80EffectX = undefined;
         rows[row].tic80EffectY = undefined;
      }
   }
   return new PatternChannel({rows});
}

// function encodePattern(pattern: Pattern): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
//    const encoded0 = encodePatternChannel(pattern, 0);
//    const encoded1 = encodePatternChannel(pattern, 1);
//    const encoded2 = encodePatternChannel(pattern, 2);
//    const encoded3 = encodePatternChannel(pattern, 3);
//    return [encoded0, encoded1, encoded2, encoded3];
// };

// function encodePatternCombined(pattern: Pattern): Uint8Array {
//    const [encoded0, encoded1, encoded2, encoded3] = encodePattern(pattern);
//    const combined = new Uint8Array(encoded0.length + encoded1.length + encoded2.length + encoded3.length);
//    let offset = 0;
//    combined.set(encoded0, offset);
//    offset += encoded0.length;
//    combined.set(encoded1, offset);
//    offset += encoded1.length;
//    combined.set(encoded2, offset);
//    offset += encoded2.length;
//    combined.set(encoded3, offset);
//    return combined;
// };
