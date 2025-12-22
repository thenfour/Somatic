import {ActionRegistry} from "./KeyboardShortcutTypes";
// when capturing chords, they always land as character kind.
// so in order to detect duplicates, it's best to default to using character kind in these defaults.

export const gActionRegistry: ActionRegistry = {
   "OpenFile": {
      id: "OpenFile",
      title: "open file",
      description: "open a somatic project file.",
      category: "File",
      defaultBindings: [
         {kind: "character", key: "o", primary: true},
      ],
   },
   "SaveFile": {
      id: "SaveFile",
      title: "save file",
      description: "save the current somatic project file.",
      category: "File",
      defaultBindings: [
         {kind: "character", key: "s", primary: true},
      ],
   },
   "NewFile": {
      id: "NewFile",
      title: "new file",
      description: "create a new somatic project file.",
      category: "File",
      defaultBindings: [
         {kind: "character", key: "n", primary: true},
      ],
   },
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

   "CycleTic80PanelSize": {
      id: "CycleTic80PanelSize",
      title: "cycle TIC-80 size",
      description: "cycle through the available TIC-80 sizes.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: ".", primary: true},
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

   "PlayRow": {
      id: "PlayRow",
      title: "play current row",
      description: "play the notes in the row under the cursor.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "Enter"},
      ],
   },

   "InsertNoteCut": {
      id: "InsertNoteCut",
      title: "insert note cut",
      description: "insert a note cut (^^^) at the current cell.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "Backspace", shift: true},
      ],
   },

   "ClearCell": {
      id: "ClearCell",
      title: "clear cell",
      description: "clear the entire cell (note, instrument, and effect).",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "Delete"},
      ],
   },

   "ClearField": {
      id: "ClearField",
      title: "clear field",
      description: "clear the field under the cursor.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "Backspace"},
      ],
   },

   "SelectAll": {
      id: "SelectAll",
      title: "select all",
      description: "select all cells in the current pattern.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "a", primary: true},
      ],
   },

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
   "ExportCartRelease": {
      id: "ExportCartRelease",
      title: "export cart release",
      description: "export an optimized TIC-80 cartridge.",
      category: "Edit",
      defaultBindings: [],
   },

   "TransposeSelectionUpSemitone": {
      id: "TransposeSelectionUpSemitone",
      title: "transpose selection up semitone",
      description: "transpose the selected notes up by one semitone.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowRight", alt: true},
      ],
   },
   "TransposeSelectionDownSemitone": {
      id: "TransposeSelectionDownSemitone",
      title: "transpose selection down semitone",
      description: "transpose the selected notes down by one semitone.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowLeft", alt: true},
      ],
   },
   "TransposeSelectionUpOctave": {
      id: "TransposeSelectionUpOctave",
      title: "transpose selection up octave",
      description: "transpose the selected notes up by one octave.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowUp", alt: true},
      ],
   },
   "TransposeSelectionDownOctave": {
      id: "TransposeSelectionDownOctave",
      title: "transpose selection down octave",
      description: "transpose the selected notes down by one octave.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowDown", alt: true},
      ],
   },
   "IncrementInstrumentInSelection": {
      id: "IncrementInstrumentInSelection",
      title: "increment instrument in selection",
      description: "increase the instrument index for the selection in the pattern.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowUp", alt: true, shift: true},
      ],
   },
   "DecrementInstrumentInSelection": {
      id: "DecrementInstrumentInSelection",
      title: "decrement instrument in selection",
      description: "decrement the instrument index for the selection in the pattern.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "ArrowDown", alt: true, shift: true},
      ],
   },

   "NextLoopMode": {
      id: "NextLoopMode",
      title: "next loop mode",
      description: "switch to the next loop mode.",
      category: "Transport",
      defaultBindings: [],
   },
   "PreviousLoopMode": {
      id: "PreviousLoopMode",
      title: "previous loop mode",
      description: "switch to the previous loop mode.",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopOff": {
      id: "SetLoopOff",
      title: "set loop off",
      description: "disable looping.",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopSelection": {
      id: "SetLoopSelection",
      title: "set loop to selection",
      description: "set the loop to the current selection.",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopWholePattern": {
      id: "SetLoopWholePattern",
      title: "set loop to whole pattern",
      description: "set the loop to the entire pattern.",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopHalfPattern": {
      id: "SetLoopHalfPattern",
      title: "set loop to half pattern",
      description: "set the loop to half of the pattern (at the cursor).",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopQuarterPattern": {
      id: "SetLoopQuarterPattern",
      title: "set loop to quarter pattern",
      description: "set the loop to a quarter of the pattern (at the cursor).",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopSong": {
      id: "SetLoopSong",
      title: "set loop to song",
      description: "set the loop to the entire song.",
      category: "Transport",
      defaultBindings: [],
   },
   "SetLoopPattern": {
      id: "SetLoopPattern",
      title: "set loop to pattern",
      description: "set the loop to the current pattern.",
      category: "Transport",
      defaultBindings: [],
   },
} as const;

export const kAllActions = Object.values(gActionRegistry);