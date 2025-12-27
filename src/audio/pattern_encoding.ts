import {NOTE_INFOS} from "../defs";
import {Pattern, PatternCell, PatternChannel} from "../models/pattern";
import {Tic80Caps, Tic80ChannelIndex} from "../models/tic80Capabilities";
import {clamp} from "../utils/utils";

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
      const inst = cellData.instrumentIndex ?? 0;
      const commandArgX = cellData.effectX ?? 0;
      const commandArgY = cellData.effectY ?? 0;
      const command = cellData.effect === undefined ? 0 : clamp(cellData.effect + 1, 0, 7);
      const [b0, b1, b2] = encodePatternCellTriplet(cellData.midiNote, inst, command, commandArgX, commandArgY);
      const base = 3 * row;
      buf[base + 0] = b0;
      buf[base + 1] = b1;
      buf[base + 2] = b2;
   }
   //}

   return buf;
}

export function encodePatternChannel(pattern: Pattern, channelIndex: Tic80ChannelIndex): Uint8Array {
   return encodePatternChannelRows((rowIndex) => pattern.getCell(channelIndex, rowIndex));
}

export function encodePatternChannelDirect(channel: PatternChannel): Uint8Array {
   const rows = channel.rows;
   return encodePatternChannelRows((rowIndex) => rows[rowIndex]);
}

export function encodePattern(pattern: Pattern): [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
   const encoded0 = encodePatternChannel(pattern, 0);
   const encoded1 = encodePatternChannel(pattern, 1);
   const encoded2 = encodePatternChannel(pattern, 2);
   const encoded3 = encodePatternChannel(pattern, 3);
   return [encoded0, encoded1, encoded2, encoded3];
};

export function encodePatternCombined(pattern: Pattern): Uint8Array {
   const [encoded0, encoded1, encoded2, encoded3] = encodePattern(pattern);
   const combined = new Uint8Array(encoded0.length + encoded1.length + encoded2.length + encoded3.length);
   let offset = 0;
   combined.set(encoded0, offset);
   offset += encoded0.length;
   combined.set(encoded1, offset);
   offset += encoded1.length;
   combined.set(encoded2, offset);
   offset += encoded2.length;
   combined.set(encoded3, offset);
   return combined;
};
