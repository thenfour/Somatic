// a list of all keyboard shortcuts.
export const Actions = {
   Panic: "Panic",
   Undo: "Undo",
   Redo: "Redo",
   TogglePreferencesPanel: "TogglePreferencesPanel",
   FocusPattern: "FocusPattern",
   ToggleWaveformEditor: "ToggleWaveformEditor",
   ToggleInstrumentPanel: "ToggleInstrumentPanel",
   ToggleTic80Panel: "ToggleTic80Panel",
   ToggleOnScreenKeyboard: "ToggleOnScreenKeyboard",
   ToggleArrangementEditor: "ToggleArrangementEditor",
   ToggleAdvancedEditPanel: "ToggleAdvancedEditPanel",
   PlayFromPosition: "PlayFromPosition",
   PlayPattern: "PlayPattern",
   PlaySong: "PlaySong",
   PlayStop: "PlayStop",
   ToggleEditMode: "ToggleEditMode",
   DecreaseOctave: "DecreaseOctave",
   IncreaseOctave: "IncreaseOctave",
   DecreaseInstrument: "DecreaseInstrument",
   IncreaseInstrument: "IncreaseInstrument",

   IncreaseEditStep: "IncreaseEditStep",
   DecreaseEditStep: "DecreaseEditStep",
   IncreaseTempo: "IncreaseTempo",
   DecreaseTempo: "DecreaseTempo",
   IncreaseSpeed: "IncreaseSpeed",
   DecreaseSpeed: "DecreaseSpeed",
   NextSongOrder: "NextSongOrder",
   PreviousSongOrder: "PreviousSongOrder",
   ToggleKeyboardNoteInput: "ToggleKeyboardNoteInput",
   ToggleMidiNoteInput: "ToggleMidiNoteInput",

   Copy: "Copy",
   Paste: "Paste",
   Cut: "Cut",
} as const;

export const kAllActionIds = Object.values(Actions);

export type ActionId = keyof typeof Actions;


export const ActionCategories = {
   Transport: "Transport",
   Edit: "Edit",
   View: "View",
} as const;

export const kAllActionCategories = Object.values(ActionCategories);

export type ActionCategory = keyof typeof ActionCategories;
