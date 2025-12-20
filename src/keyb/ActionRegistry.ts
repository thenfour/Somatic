import {ActionRegistry} from "./KeyboardShortcutTypes";
// when capturing chords, they always land as character kind.
// so in order to detect duplicates, it's best to default to using character kind in these defaults.

export const gActionRegistry: ActionRegistry = {
   "Panic": {
      id: "Panic",
      title: "panic",
      description: "help for panick.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "?", shift: true},
      ],
   },

   "Undo": {
      id: "Undo",
      title: "undo",
      description: "undo last action.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "z", primary: true},
      ],
   },

   "Redo": {
      id: "Redo",
      title: "redo",
      description: "redo last undone action.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "z", primary: true, shift: true},
         {kind: "character", key: "y", primary: true},
      ],
   },

   "TogglePreferencesPanel": {
      id: "TogglePreferencesPanel",
      title: "toggle preferences panel",
      description: "open or close the preferences panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: ",", primary: true},
      ],
   },

   "FocusPattern": {
      id: "FocusPattern",
      title: "focus pattern editor",
      description: "set keyboard focus to the pattern editor.",
      category: "View",
      defaultBindings: [],
   },

   "ToggleWaveformEditor": {
      id: "ToggleWaveformEditor",
      title: "toggle waveform editor",
      description: "show or hide the waveform editor panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: ","},
      ],
   },

   "ToggleInstrumentPanel": {
      id: "ToggleInstrumentPanel",
      title: "toggle instrument panel",
      description: "show or hide the instrument editor panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "."},
      ],
   },

   "ToggleTic80Panel": {
      id: "ToggleTic80Panel",
      title: "toggle TIC-80 bridge",
      description: "show or hide the TIC-80 bridge panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "8", alt: true},
      ],
   },

   "ToggleOnScreenKeyboard": {
      id: "ToggleOnScreenKeyboard",
      title: "toggle on-screen keyboard",
      description: "show or hide the on-screen keyboard.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "9", alt: true},
      ],
   },

   "ToggleArrangementEditor": {
      id: "ToggleArrangementEditor",
      title: "toggle arrangement editor",
      description: "show or hide the arrangement editor.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "/"},
      ],
   },

   "ToggleAdvancedEditPanel": {
      id: "ToggleAdvancedEditPanel",
      title: "toggle advanced edit panel",
      description: "show or hide the advanced edit panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "\\"},
      ],
   },

   "PlaySong": {
      id: "PlaySong",
      title: "play song from start",
      description: "start playback from the beginning of the song.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "0", alt: true},
      ],
   },

   "PlayFromPosition": {
      id: "PlayFromPosition",
      title: "play from current position",
      description: "start playback from the current row in the active position.",
      category: "Transport",
      defaultBindings: [
         //{kind: "character", key: "9", alt: true},
         {kind: "character", key: "Space", shift: true},
      ],
   },

   "PlayPattern": {
      id: "PlayPattern",
      title: "play current pattern",
      description: "start playback from the beginning of the active pattern.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "Space"},
         //{kind: "character", key: "8", alt: true},
      ],
   },

   // "PlayStop": {
   //    id: "PlayStop",
   //    title: "play or stop playback",
   //    description: "stops playback if playing, otherwise starts playback from the current position.",
   //    category: "Transport",
   //    defaultBindings: [
   //       {kind: "physical", code: "Space"},
   //    ],
   // },

   "ToggleEditMode": {
      id: "ToggleEditMode",
      title: "toggle edit mode",
      description: "enable or disable editing in the pattern editor and panic audio.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "Escape"},
      ],
   },

   "DecreaseOctave": {
      id: "DecreaseOctave",
      title: "decrease octave",
      description: "lower the current octave for note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "{", shift: true},
      ],
   },

   "IncreaseOctave": {
      id: "IncreaseOctave",
      title: "increase octave",
      description: "raise the current octave for note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "}", shift: true},
      ],
   },

   "DecreaseInstrument": {
      id: "DecreaseInstrument",
      title: "decrease instrument",
      description: "select the previous instrument.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "["},
      ],
   },

   "IncreaseInstrument": {
      id: "IncreaseInstrument",
      title: "increase instrument",
      description: "select the next instrument.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "]"},
      ],
   },

   "Copy": {
      id: "Copy",
      title: "copy selection",
      description: "copy to the clipboard.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "c", primary: true},
         {kind: "character", key: "Insert", primary: true},
      ],
   },

   "Paste": {
      id: "Paste",
      title: "paste selection",
      description: "paste clipboard contents.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "v", primary: true},
         {kind: "character", key: "Insert", shift: true},
      ],
   },

   "Cut": {
      id: "Cut",
      title: "cut selection",
      description: "cut to the clipboard.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "x", primary: true},
         {kind: "character", key: "Delete", shift: true},
      ],
   },

   "IncreaseEditStep": {
      id: "IncreaseEditStep",
      title: "increase edit step",
      description: "increase the pattern edit step.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "]", primary: true},
      ],
   },

   "DecreaseEditStep": {
      id: "DecreaseEditStep",
      title: "decrease edit step",
      description: "decrease the pattern edit step.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "[", primary: true},
      ],
   },

   "IncreaseTempo": {
      id: "IncreaseTempo",
      title: "increase tempo",
      description: "increase the song tempo (BPM).",
      category: "Edit",
      defaultBindings: [],
   },

   "DecreaseTempo": {
      id: "DecreaseTempo",
      title: "decrease tempo",
      description: "decrease the song tempo (BPM).",
      category: "Edit",
      defaultBindings: [],
   },

   "IncreaseSpeed": {
      id: "IncreaseSpeed",
      title: "increase speed",
      description: "increase the song speed.",
      category: "Edit",
      defaultBindings: [],
   },

   "DecreaseSpeed": {
      id: "DecreaseSpeed",
      title: "decrease speed",
      description: "decrease the song speed.",
      category: "Edit",
      defaultBindings: [],
   },

   "NextSongOrder": {
      id: "NextSongOrder",
      title: "next song order position",
      description: "move to the next position in the song order.",
      category: "Navigation",
      defaultBindings: [],
   },

   "PreviousSongOrder": {
      id: "PreviousSongOrder",
      title: "previous song order position",
      description: "move to the previous position in the song order.",
      category: "Navigation",
      defaultBindings: [],
   },

   "ToggleKeyboardNoteInput": {
      id: "ToggleKeyboardNoteInput",
      title: "toggle keyboard note input",
      description: "enable or disable keyboard note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "k", alt: true},
      ],
   },

   "ToggleMidiNoteInput": {
      id: "ToggleMidiNoteInput",
      title: "toggle MIDI note input",
      description: "enable or disable MIDI note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "m", alt: true},
      ],
   },

   "ToggleMuteChannel1": {
      id: "ToggleMuteChannel1",
      title: "toggle mute channel 1",
      description: "mute or unmute channel 1.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "1", alt: true},
      ],
   },

   "ToggleMuteChannel2": {
      id: "ToggleMuteChannel2",
      title: "toggle mute channel 2",
      description: "mute or unmute channel 2.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "2", alt: true},
      ],
   },
   "ToggleMuteChannel3": {
      id: "ToggleMuteChannel3",
      title: "toggle mute channel 3",
      description: "mute or unmute channel 3.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "3", alt: true},
      ],
   },
   "ToggleMuteChannel4": {
      id: "ToggleMuteChannel4",
      title: "toggle mute channel 4",
      description: "mute or unmute channel 4.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "4", alt: true},
      ],
   },
   "ToggleSoloChannel1": {
      id: "ToggleSoloChannel1",
      title: "toggle solo channel 1",
      description: "solo or unsolo channel 1.",
      category: "Edit",
      defaultBindings: [],
   },
   "ToggleSoloChannel2": {
      id: "ToggleSoloChannel2",
      title: "toggle solo channel 2",
      description: "solo or unsolo channel 2.",
      category: "Edit",
      defaultBindings: [],
   },
   "ToggleSoloChannel3": {
      id: "ToggleSoloChannel3",
      title: "toggle solo channel 3",
      description: "solo or unsolo channel 3.",
      category: "Edit",
      defaultBindings: [],
   },
   "ToggleSoloChannel4": {
      id: "ToggleSoloChannel4",
      title: "toggle solo channel 4",
      description: "solo or unsolo channel 4.",
      category: "Edit",
      defaultBindings: [],
   },

   "UnmuteUnsoloAllChannels": {
      id: "UnmuteUnsoloAllChannels",
      title: "unmute and unsolo all channels",
      description: "unmute and unsolo all channels.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "5", alt: true},
      ],
   },
} as const;

export const kAllActions = Object.values(gActionRegistry);