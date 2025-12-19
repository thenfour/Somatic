import {ActionRegistry} from "./KeyboardShortcutTypes";


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

   "PlayPause": {
      id: "PlayPause",
      title: "play/pause",
      description: "toggle playback.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "p", shift: true},
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
      defaultBindings: [
         {kind: "character", key: "1", alt: true},
      ],
   },

   "ToggleWaveformEditor": {
      id: "ToggleWaveformEditor",
      title: "toggle waveform editor",
      description: "show or hide the waveform editor panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "2", alt: true},
      ],
   },

   "ToggleInstrumentPanel": {
      id: "ToggleInstrumentPanel",
      title: "toggle instrument panel",
      description: "show or hide the instrument editor panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "3", alt: true},
      ],
   },

   "ToggleTic80Panel": {
      id: "ToggleTic80Panel",
      title: "toggle TIC-80 bridge",
      description: "show or hide the TIC-80 bridge panel.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "4", alt: true},
      ],
   },

   "ToggleOnScreenKeyboard": {
      id: "ToggleOnScreenKeyboard",
      title: "toggle on-screen keyboard",
      description: "show or hide the on-screen keyboard.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "5", alt: true},
      ],
   },

   "ToggleArrangementEditor": {
      id: "ToggleArrangementEditor",
      title: "toggle arrangement editor",
      description: "show or hide the arrangement editor.",
      category: "View",
      defaultBindings: [
         {kind: "character", key: "6", alt: true},
      ],
   },

   "ToggleAdvancedEditPanel": {
      id: "ToggleAdvancedEditPanel",
      title: "toggle advanced edit panel",
      description: "show or hide the advanced edit panel.",
      category: "View",
      defaultBindings: [
         {kind: "physical", code: "Backslash"},
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
         {kind: "character", key: "9", alt: true},
      ],
   },

   "PlayPattern": {
      id: "PlayPattern",
      title: "play current pattern",
      description: "start playback from the beginning of the active pattern.",
      category: "Transport",
      defaultBindings: [
         {kind: "character", key: "8", alt: true},
      ],
   },

   "ToggleEditMode": {
      id: "ToggleEditMode",
      title: "toggle edit mode",
      description: "enable or disable editing in the pattern editor and panic audio.",
      category: "Edit",
      defaultBindings: [
         {kind: "physical", code: "Escape"},
      ],
   },

   "DecreaseOctave": {
      id: "DecreaseOctave",
      title: "decrease octave",
      description: "lower the current octave for note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "["},
      ],
   },

   "IncreaseOctave": {
      id: "IncreaseOctave",
      title: "increase octave",
      description: "raise the current octave for note input.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "]"},
      ],
   },

   "DecreaseInstrument": {
      id: "DecreaseInstrument",
      title: "decrease instrument",
      description: "select the previous instrument.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "{", shift: true},
      ],
   },

   "IncreaseInstrument": {
      id: "IncreaseInstrument",
      title: "increase instrument",
      description: "select the next instrument.",
      category: "Edit",
      defaultBindings: [
         {kind: "character", key: "}", shift: true},
      ],
   },
} as const;

export const kAllActions = Object.values(gActionRegistry);