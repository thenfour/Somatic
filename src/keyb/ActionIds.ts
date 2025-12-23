import {typedValues} from "../utils/utils";

// a list of all keyboard shortcuts.
export const GlobalActions = {
   OpenFile: "OpenFile",
   SaveFile: "SaveFile",
   NewFile: "NewFile",

   Panic: "Panic",
   Undo: "Undo",
   Redo: "Redo",
   TogglePreferencesPanel: "TogglePreferencesPanel",
   FocusPattern: "FocusPattern",
   ToggleWaveformEditor: "ToggleWaveformEditor",
   ToggleInstrumentPanel: "ToggleInstrumentPanel",
   CycleTic80PanelSize: "CycleTic80PanelSize",
   ToggleOnScreenKeyboard: "ToggleOnScreenKeyboard",
   ToggleAdvancedEditPanel: "ToggleAdvancedEditPanel",
   PlayFromPosition: "PlayFromPosition",
   PlayPattern: "PlayPattern",
   PlaySong: "PlaySong",
   PlayRow: "PlayRow",
   //PlayStop: "PlayStop",
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
   ToggleMuteChannel1: "ToggleMuteChannel1",
   ToggleMuteChannel2: "ToggleMuteChannel2",
   ToggleMuteChannel3: "ToggleMuteChannel3",
   ToggleMuteChannel4: "ToggleMuteChannel4",
   ToggleSoloChannel1: "ToggleSoloChannel1",
   ToggleSoloChannel2: "ToggleSoloChannel2",
   ToggleSoloChannel3: "ToggleSoloChannel3",
   ToggleSoloChannel4: "ToggleSoloChannel4",
   UnmuteUnsoloAllChannels: "UnmuteUnsoloAllChannels",

   SetLoopOff: "SetLoopOff",
   SetLoopSong: "SetLoopSong",
   SetLoopSelectionInSongOrder: "SetLoopSelectionInSongOrder",
   SetLoopPattern: "SetLoopPattern",
   SetLoopHalfPattern: "SetLoopHalfPattern",
   SetLoopQuarterPattern: "SetLoopQuarterPattern",
   SetLoopSelectionInPattern: "SetLoopSelectionInPattern",
   ToggleLoopModeOff: "ToggleLoopModeOff",
   NextLoopMode: "NextLoopMode",
   PreviousLoopMode: "PreviousLoopMode",

   TransposeSelectionUpSemitone: "TransposeSelectionUpSemitone",
   TransposeSelectionDownSemitone: "TransposeSelectionDownSemitone",
   TransposeSelectionUpOctave: "TransposeSelectionUpOctave",
   TransposeSelectionDownOctave: "TransposeSelectionDownOctave",
   IncrementInstrumentInSelection: "IncrementInstrumentInSelection",
   DecrementInstrumentInSelection: "DecrementInstrumentInSelection",

   ExportCartRelease: "ExportCartRelease",

   Copy: "Copy",
   Paste: "Paste",
   Cut: "Cut",

   InsertNoteCut: "InsertNoteCut",
   ClearCell: "ClearCell",
   ClearField: "ClearField",
   SelectAll: "SelectAll",
} as const;

export const kAllActionIds = typedValues(GlobalActions);

export type GlobalActionId = keyof typeof GlobalActions;

export const GlobalActionCategories = {
   Transport: "Transport",
   File: "File",
   Edit: "Edit",
   View: "View",
   Navigation: "Navigation",
} as const;

export const kAllActionCategories = typedValues(GlobalActionCategories);

export type GlobalActionCategory = keyof typeof GlobalActionCategories;
