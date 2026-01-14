
import {decodeModPeriod, MOD_FINETUNES, ModDecodedPitch, modMidiFromPeriod, modPeriodFromMidi, PROTRACKER_BASE_PERIODS_FT0, PROTRACKER_MIN_MIDI, PROTRACKER_NOTE_COUNT, PROTRACKER_PERIOD_TABLES, ProtrackerFinetune} from "./utils/music/modMusic";
import {kPitchClasses, PitchClassInfo} from "./utils/music/pitchClass";
import {defaultTicNoteConfig, TicPitch, ticPitchFromMidi} from "./utils/music/tic80Music";


type NoteInfo = {
   midi: number; // 0..255
   frequencyHz: number;
   octave: number; // MIDI-standard display octave (C4=60)
   pitchClass: PitchClassInfo;

   label: string;           // e.g. "C#4", "B4"
   labelUnicode: string;    // e.g. "C♯4", "B4"
   labelFixedWidth: string; // e.g. "C#4", "B-4"

   tic: TicPitch;
};

export const NoteRegistry = (() => {
   // Full byte range for full 8-bit registry completeness.
   const MIN_NOTE_NUM = 0;
   const MAX_NOTE_NUM = 255;

   // takes midi note and returns semitone offset in octave.
   function semitoneOf(midiNote: number): number {
      return ((midiNote % 12) + 12) % 12;
   }

   // MIDI-standard display octave: C4 = 60, C0 = 12
   function octaveOf(midiNote: number): number {
      return Math.floor(midiNote / 12) - 1;
   }

   function pitchClassInfoOf(semitoneOrMidiNote: number): PitchClassInfo {
      return kPitchClasses.infoByValue.get((semitoneOrMidiNote % 12) as any)!;
   }

   function frequencyOf(midiNote: number, a4Hz = 440, a4NoteNumber = 69): number {
      return a4Hz * 2 ** ((midiNote - a4NoteNumber) / 12);
   }

   function noteInfoOfMidiNote(midiNote: number): NoteInfo {
      const s = semitoneOf(midiNote);
      const o = octaveOf(midiNote);
      return {
         pitchClass: pitchClassInfoOf(s),
         midi: midiNote,
         frequencyHz: frequencyOf(midiNote),
         octave: o,
         tic: ticPitchFromMidi(midiNote),
         label: `${pitchClassInfoOf(s).label}${o}`,
         labelUnicode: `${pitchClassInfoOf(s).labelUnicode}${o}`,
         labelFixedWidth: `${pitchClassInfoOf(s).labelFixedWidth}${o}`,
      };
   }

   // build the registry
   // midi note = index
   const notesByMidi: Array<NoteInfo> = [];

   for (let midi = MIN_NOTE_NUM; midi <= MAX_NOTE_NUM; midi++) {
      const info: NoteInfo = noteInfoOfMidiNote(midi);
      notesByMidi[midi] = info;
   }

   // Public API
   const api = Object.freeze({

      all: Object.freeze(notesByMidi.slice()),
      get(midi: number): NoteInfo |
         undefined {
            if (!Number.isFinite(midi))
               return undefined;
            midi = midi | 0;
            if (midi < MIN_NOTE_NUM || midi > MAX_NOTE_NUM)
               return undefined;
            return notesByMidi[midi];
         },
      frequencyFromMidi(midi: number): number |
         undefined {
            return api.get(midi)?.frequencyHz;
         },

      // TIC-80 API
      tic: Object.freeze({
         config: defaultTicNoteConfig,
         ticPitchFromMidi(midi: number): TicPitch {
            return ticPitchFromMidi(midi);
         },
         // midiFromTicPitch(octave: number, noteNibble: number): number |
         //    undefined {
         //       return midiFromTicPitch(octave, noteNibble);
         //    },
         pitchForPatternOrNull(midi: number): {octave: number; noteNibble: number} |
            null {
               const info = api.get(midi);
               if (!info || !info.tic.isPatternEncodable)
                  return null;
               return {octave: info.tic.octave, noteNibble: info.tic.noteNibble};
            },
      }),

      // MOD / ProTracker API
      mod: Object.freeze({
         // finetune values as stored in MOD samples are -8..+7 (signed nibble).
         FINETUNES: MOD_FINETUNES,
         PROTRACKER_MIN_MIDI,                                                  // C-1 in your naming
         PROTRACKER_MAX_MIDI: PROTRACKER_MIN_MIDI + PROTRACKER_NOTE_COUNT - 1, // B-3
         BASE_PERIODS_FT0: PROTRACKER_BASE_PERIODS_FT0,
         PERIOD_TABLES: PROTRACKER_PERIOD_TABLES,

         periodFromMidi(midi: number, finetune: ProtrackerFinetune = 0): number |
            undefined {
               return modPeriodFromMidi(midi, finetune);
            },
         midiFromPeriod(period: number, finetune: ProtrackerFinetune = 0): number |
            undefined {
               return modMidiFromPeriod(period, finetune);
            },
         decodePeriod(period: number, finetune: ProtrackerFinetune = 0): ModDecodedPitch {
            return decodeModPeriod(period, finetune);
         },
      }),
   });

   return api;
})();
