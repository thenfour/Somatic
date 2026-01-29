import {typedValues} from "../utils/utils";
import {GlobalActionId} from "./ActionIds";
import {ActionRegistry} from "./KeyboardShortcutTypes";
// when capturing chords, they always land as character kind.
// so in order to detect duplicates, it's best to default to using character kind in these defaults.

export const gActionRegistry: ActionRegistry<GlobalActionId> = {
    OpenFile: {
        id: "OpenFile",
        title: "open file",
        description: "open a somatic project file.",
        category: "File",
        defaultBindings: [{ kind: "character", key: "o", primary: true }],
    },

    ImportTicCart: {
        id: "ImportTicCart",
        title: "import TIC-80 cart",
        description: "import a TIC-80 .tic cartridge as a song.",
        category: "File",
        defaultBindings: [],
    },

    SaveFile: {
        id: "SaveFile",
        title: "save file",
        description: "save the current somatic project file.",
        category: "File",
        defaultBindings: [{ kind: "character", key: "s", primary: true }],
    },
    NewFile: {
        id: "NewFile",
        title: "new file",
        description: "create a new somatic project file.",
        category: "File",
        defaultBindings: [{ kind: "character", key: "n", primary: true }],
    },
    Panic: {
        id: "Panic",
        title: "panic",
        description: "help for panick.",
        category: "Transport",
        defaultBindings: [{ kind: "character", key: "?", shift: true }],
    },

    ToggleDebugMode: {
        id: "ToggleDebugMode",
        title: "toggle debug mode",
        description: "enable or disable debug mode.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "0", alt: true }],
    },

    Undo: {
        id: "Undo",
        title: "undo",
        description: "undo last action.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "z", primary: true }],
    },

    Redo: {
        id: "Redo",
        title: "redo",
        description: "redo last undone action.",
        category: "Edit",
        defaultBindings: [
            { kind: "character", key: "z", primary: true, shift: true },
            { kind: "character", key: "y", primary: true },
        ],
    },

    ExportReleaseBuild: {
        id: "ExportReleaseBuild",
        title: "export release build",
        description: "export the project as a release build.",
        category: "File",
        defaultBindings: [{ kind: "character", key: "r", primary: true, shift: true }],
    },

    ExportDebugBuild: {
        id: "ExportDebugBuild",
        title: "export debug build",
        description: "export the project as a debug build.",
        category: "File",
        defaultBindings: [{ kind: "character", key: "d", primary: true, shift: true }],
    },

    TogglePreferencesPanel: {
        id: "TogglePreferencesPanel",
        title: "toggle preferences panel",
        description: "open or close the preferences panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: ",", primary: true }],
    },

    ToggleCartStatsPanel: {
        id: "ToggleCartStatsPanel",
        title: "toggle cart stats panel",
        description: "open or close the cart stats panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "?", primary: true, shift: true }],
    },

    ToggleSongSettingsPanel: {
        id: "ToggleSongSettingsPanel",
        title: "toggle song settings panel",
        description: "open or close the song settings panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "+", primary: true, shift: true }],
    },

    ToggleDebugPanel: {
        id: "ToggleDebugPanel",
        title: "toggle debug panel",
        description: "open or close the debug panel for testing Lua processing.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "/", primary: true }],
    },

    ToggleEncodingUtilsPanel: {
        id: "ToggleEncodingUtilsPanel",
        title: "toggle encoding utilities panel",
        description: "open or close the encoding utilities panel.",
        category: "View",
        defaultBindings: [
            // ctrl + shift + |
            { kind: "character", key: "|", primary: true, shift: true },
        ],
    },

    FocusPattern: {
        id: "FocusPattern",
        title: "focus pattern editor",
        description: "set keyboard focus to the pattern editor.",
        category: "View",
        defaultBindings: [],
    },

    ToggleWaveformEditor: {
        id: "ToggleWaveformEditor",
        title: "toggle waveform editor",
        description: "show or hide the waveform editor panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "/" }],
    },

    ToggleInstrumentPanel: {
        id: "ToggleInstrumentPanel",
        title: "toggle instrument panel",
        description: "show or hide the instrument editor panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "=" }],
    },

    ToggleInstrumentsPanel: {
        id: "ToggleInstrumentsPanel",
        title: "toggle instruments panel",
        description: "show or hide the instruments management panel.",
        category: "View",
        defaultBindings: [
            // ctrl + i
            { kind: "character", key: "i", primary: true },
        ],
    },

    CycleTic80PanelSize: {
        id: "CycleTic80PanelSize",
        title: "cycle TIC-80 size",
        description: "cycle through the available TIC-80 sizes.",
        category: "View",
        defaultBindings: [{ kind: "character", key: ".", primary: true }],
    },

    ToggleOnScreenKeyboard: {
        id: "ToggleOnScreenKeyboard",
        title: "toggle on-screen keyboard",
        description: "show or hide the on-screen keyboard.",
        category: "View",
        defaultBindings: [],
    },

    ToggleAdvancedEditPanel: {
        id: "ToggleAdvancedEditPanel",
        title: "toggle advanced edit panel",
        description: "show or hide the advanced edit panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "\\" }],
    },

    ToggleSomaticColumns: {
        id: "ToggleSomaticColumns",
        title: "toggle Somatic columns",
        description: "show or hide Somatic effect/param columns in the pattern grid.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "\\", primary: true }],
    },

    TogglePatternEditor: {
        id: "TogglePatternEditor",
        title: "toggle pattern editor",
        description: "show or hide the pattern editor panel.",
        category: "View",
        defaultBindings: [{ kind: "character", key: "|", shift: true }],
    },

    PlaySong: {
        id: "PlaySong",
        title: "play song from start",
        description: "start playback from the beginning of the song.",
        category: "Transport",
        defaultBindings: [],
    },

    PlayFromPosition: {
        id: "PlayFromPosition",
        title: "play from current position",
        description: "start playback from the current row in the active position.",
        category: "Transport",
        defaultBindings: [{ kind: "character", key: "Space", shift: true }],
    },

    PlayPattern: {
        id: "PlayPattern",
        title: "play current pattern",
        description: "start playback from the beginning of the active pattern.",
        category: "Transport",
        defaultBindings: [{ kind: "character", key: "Space" }],
    },

    PlayRow: {
        id: "PlayRow",
        title: "play current row",
        description: "play the notes in the row under the cursor.",
        category: "Transport",
        defaultBindings: [{ kind: "character", key: "Enter" }],
    },

    InsertNoteCut: {
        id: "InsertNoteCut",
        title: "insert note cut",
        description: "insert a note cut (^^^) at the current cell.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "Backspace", shift: true }],
    },

    ClearCell: {
        id: "ClearCell",
        title: "clear cell",
        description: "clear the entire cell (note, instrument, and effect).",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "Delete" }],
    },

    ClearField: {
        id: "ClearField",
        title: "clear field",
        description: "clear the field under the cursor.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "Backspace" }],
    },

    SelectAll: {
        id: "SelectAll",
        title: "select all",
        description: "select all cells in the current pattern.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "a", primary: true }],
    },

    ToggleEditMode: {
        id: "ToggleEditMode",
        title: "toggle edit mode",
        description: "enable or disable editing in the pattern editor and panic audio.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "Escape" }],
    },

    DecreaseOctave: {
        id: "DecreaseOctave",
        title: "decrease octave",
        description: "lower the current octave for note input.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "{", shift: true }],
    },

    IncreaseOctave: {
        id: "IncreaseOctave",
        title: "increase octave",
        description: "raise the current octave for note input.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "}", shift: true }],
    },

    DecreaseInstrument: {
        id: "DecreaseInstrument",
        title: "decrease instrument",
        description: "select the previous instrument.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "[" }],
    },

    IncreaseInstrument: {
        id: "IncreaseInstrument",
        title: "increase instrument",
        description: "select the next instrument.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "]" }],
    },

    Copy: {
        id: "Copy",
        title: "copy selection",
        description: "copy to the clipboard.",
        category: "Edit",
        defaultBindings: [
            { kind: "character", key: "c", primary: true },
            { kind: "character", key: "Insert", primary: true },
        ],
    },

    Paste: {
        id: "Paste",
        title: "paste selection",
        description: "paste clipboard contents.",
        category: "Edit",
        defaultBindings: [
            { kind: "character", key: "v", primary: true },
            { kind: "character", key: "Insert", shift: true },
        ],
    },

    Cut: {
        id: "Cut",
        title: "cut selection",
        description: "cut to the clipboard.",
        category: "Edit",
        defaultBindings: [
            { kind: "character", key: "x", primary: true },
            { kind: "character", key: "Delete", shift: true },
        ],
    },

    IncreaseEditStep: {
        id: "IncreaseEditStep",
        title: "increase edit step",
        description: "increase the pattern edit step.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "]", primary: true }],
    },

    DecreaseEditStep: {
        id: "DecreaseEditStep",
        title: "decrease edit step",
        description: "decrease the pattern edit step.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "[", primary: true }],
    },

    IncreaseTempo: {
        id: "IncreaseTempo",
        title: "increase tempo",
        description: "increase the song tempo (BPM).",
        category: "Edit",
        defaultBindings: [],
    },

    DecreaseTempo: {
        id: "DecreaseTempo",
        title: "decrease tempo",
        description: "decrease the song tempo (BPM).",
        category: "Edit",
        defaultBindings: [],
    },

    IncreaseSpeed: {
        id: "IncreaseSpeed",
        title: "increase speed",
        description: "increase the song speed.",
        category: "Edit",
        defaultBindings: [],
    },

    DecreaseSpeed: {
        id: "DecreaseSpeed",
        title: "decrease speed",
        description: "decrease the song speed.",
        category: "Edit",
        defaultBindings: [],
    },

    NextSongOrder: {
        id: "NextSongOrder",
        title: "next song order position",
        description: "move to the next position in the song order.",
        category: "Navigation",
        defaultBindings: [],
    },

    PreviousSongOrder: {
        id: "PreviousSongOrder",
        title: "previous song order position",
        description: "move to the previous position in the song order.",
        category: "Navigation",
        defaultBindings: [],
    },

    ToggleKeyboardNoteInput: {
        id: "ToggleKeyboardNoteInput",
        title: "toggle keyboard note input",
        description: "enable or disable keyboard note input.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "k", alt: true }],
    },

    ToggleMidiNoteInput: {
        id: "ToggleMidiNoteInput",
        title: "toggle MIDI note input",
        description: "enable or disable MIDI note input.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "m", alt: true }],
    },

    ToggleMuteChannel1: {
        id: "ToggleMuteChannel1",
        title: "toggle mute channel 1",
        description: "mute or unmute channel 1.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "1", alt: true }],
    },

    ToggleMuteChannel2: {
        id: "ToggleMuteChannel2",
        title: "toggle mute channel 2",
        description: "mute or unmute channel 2.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "2", alt: true }],
    },
    ToggleMuteChannel3: {
        id: "ToggleMuteChannel3",
        title: "toggle mute channel 3",
        description: "mute or unmute channel 3.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "3", alt: true }],
    },
    ToggleMuteChannel4: {
        id: "ToggleMuteChannel4",
        title: "toggle mute channel 4",
        description: "mute or unmute channel 4.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "4", alt: true }],
    },
    ToggleSoloChannel1: {
        id: "ToggleSoloChannel1",
        title: "toggle solo channel 1",
        description: "solo or unsolo channel 1.",
        category: "Edit",
        defaultBindings: [],
    },
    ToggleSoloChannel2: {
        id: "ToggleSoloChannel2",
        title: "toggle solo channel 2",
        description: "solo or unsolo channel 2.",
        category: "Edit",
        defaultBindings: [],
    },
    ToggleSoloChannel3: {
        id: "ToggleSoloChannel3",
        title: "toggle solo channel 3",
        description: "solo or unsolo channel 3.",
        category: "Edit",
        defaultBindings: [],
    },
    ToggleSoloChannel4: {
        id: "ToggleSoloChannel4",
        title: "toggle solo channel 4",
        description: "solo or unsolo channel 4.",
        category: "Edit",
        defaultBindings: [],
    },

    UnmuteUnsoloAllChannels: {
        id: "UnmuteUnsoloAllChannels",
        title: "unmute and unsolo all channels",
        description: "unmute and unsolo all channels.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "5", alt: true }],
    },

    TransposeSelectionUpSemitone: {
        id: "TransposeSelectionUpSemitone",
        title: "transpose selection up semitone",
        description: "transpose the selected notes up by one semitone.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowRight", alt: true }],
    },
    TransposeSelectionDownSemitone: {
        id: "TransposeSelectionDownSemitone",
        title: "transpose selection down semitone",
        description: "transpose the selected notes down by one semitone.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowLeft", alt: true }],
    },
    TransposeSelectionUpOctave: {
        id: "TransposeSelectionUpOctave",
        title: "transpose selection up octave",
        description: "transpose the selected notes up by one octave.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowUp", alt: true }],
    },
    TransposeSelectionDownOctave: {
        id: "TransposeSelectionDownOctave",
        title: "transpose selection down octave",
        description: "transpose the selected notes down by one octave.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowDown", alt: true }],
    },
    IncrementInstrumentInSelection: {
        id: "IncrementInstrumentInSelection",
        title: "increment instrument in selection",
        description: "increase the instrument index for the selection in the pattern.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowUp", alt: true, shift: true }],
    },
    DecrementInstrumentInSelection: {
        id: "DecrementInstrumentInSelection",
        title: "decrement instrument in selection",
        description: "decrement the instrument index for the selection in the pattern.",
        category: "Edit",
        defaultBindings: [{ kind: "character", key: "ArrowDown", alt: true, shift: true }],
    },

    NextLoopMode: {
        id: "NextLoopMode",
        title: "next loop mode",
        description: "switch to the next loop mode.",
        category: "Transport",
        defaultBindings: [],
    },
    PreviousLoopMode: {
        id: "PreviousLoopMode",
        title: "previous loop mode",
        description: "switch to the previous loop mode.",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopOff: {
        id: "SetLoopOff",
        title: "set loop off",
        description: "disable looping.",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopSelectionInPattern: {
        id: "SetLoopSelectionInPattern",
        title: "set loop to selection in pattern",
        description: "set the loop to the current selection.",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopSelectionInSongOrder: {
        id: "SetLoopSelectionInSongOrder",
        title: "set loop to selection in song order",
        description: "set the loop to the selection in the song order.",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopHalfPattern: {
        id: "SetLoopHalfPattern",
        title: "set loop to half pattern",
        description: "set the loop to half of the pattern (at the cursor).",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopQuarterPattern: {
        id: "SetLoopQuarterPattern",
        title: "set loop to quarter pattern",
        description: "set the loop to a quarter of the pattern (at the cursor).",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopSong: {
        id: "SetLoopSong",
        title: "set loop to song",
        description: "set the loop to the entire song.",
        category: "Transport",
        defaultBindings: [],
    },
    SetLoopPattern: {
        id: "SetLoopPattern",
        title: "set loop to pattern",
        description: "set the loop to the current pattern.",
        category: "Transport",
        defaultBindings: [],
    },
    ToggleLoopModeOff: {
        id: "ToggleLoopModeOff",
        title: "toggle loop mode off",
        description: "toggle looping off/on.",
        category: "Transport",
        defaultBindings: [
            // shift+L
            { kind: "character", key: "L", shift: true },
        ],
    },

    // Keyboard note input (typing piano). Uses physical key codes so it is layout-agnostic.
    // Matches the legacy layout in src/midi/keyboard_input.ts: "-zsxdcvgbhnjmq2w3er5t6y7ui".
    KeyboardNote01_C: {
        id: "KeyboardNote01_C",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyZ" }],
    },
    KeyboardNote02_Csharp: {
        id: "KeyboardNote02_Csharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyS" }],
    },
    KeyboardNote03_D: {
        id: "KeyboardNote03_D",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyX" }],
    },
    KeyboardNote04_Dsharp: {
        id: "KeyboardNote04_Dsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyD" }],
    },
    KeyboardNote05_E: {
        id: "KeyboardNote05_E",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyC" }],
    },
    KeyboardNote06_F: {
        id: "KeyboardNote06_F",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyV" }],
    },
    KeyboardNote07_Fsharp: {
        id: "KeyboardNote07_Fsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyG" }],
    },
    KeyboardNote08_G: {
        id: "KeyboardNote08_G",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyB" }],
    },
    KeyboardNote09_Gsharp: {
        id: "KeyboardNote09_Gsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyH" }],
    },
    KeyboardNote10_A: {
        id: "KeyboardNote10_A",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyN" }],
    },
    KeyboardNote11_Asharp: {
        id: "KeyboardNote11_Asharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyJ" }],
    },
    KeyboardNote12_B: {
        id: "KeyboardNote12_B",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyM" }],
    },
    KeyboardNote13_C: {
        id: "KeyboardNote13_C",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [
            { kind: "physical", code: "KeyQ" },
            { kind: "physical", code: "Comma" },
        ],
    },
    KeyboardNote14_Csharp: {
        id: "KeyboardNote14_Csharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit2" }],
    },
    KeyboardNote15_D: {
        id: "KeyboardNote15_D",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyW" }],
    },
    KeyboardNote16_Dsharp: {
        id: "KeyboardNote16_Dsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit3" }],
    },
    KeyboardNote17_E: {
        id: "KeyboardNote17_E",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyE" }],
    },
    KeyboardNote18_F: {
        id: "KeyboardNote18_F",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyR" }],
    },
    KeyboardNote19_Fsharp: {
        id: "KeyboardNote19_Fsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit5" }],
    },
    KeyboardNote20_G: {
        id: "KeyboardNote20_G",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyT" }],
    },
    KeyboardNote21_Gsharp: {
        id: "KeyboardNote21_Gsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit6" }],
    },
    KeyboardNote22_A: {
        id: "KeyboardNote22_A",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyY" }],
    },
    KeyboardNote23_Asharp: {
        id: "KeyboardNote23_Asharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit7" }],
    },
    KeyboardNote24_B: {
        id: "KeyboardNote24_B",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyU" }],
    },
    KeyboardNote25_C: {
        id: "KeyboardNote25_C",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyI" }],
    },
    KeyboardNote26_Csharp: {
        id: "KeyboardNote26_Csharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit9" }],
    },
      KeyboardNote27_D: {
         id: "KeyboardNote27_D",
         title: "keyboard note",
         description: "play note using the computer keyboard.",
         category: "NoteInput",
         eventType: "both",
         defaultBindings: [{ kind: "physical", code: "KeyO" }],
    },
    KeyboardNote28_Dsharp: {
        id: "KeyboardNote28_Dsharp",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "Digit0" }],
    },
      KeyboardNote29_E: {
        id: "KeyboardNote29_E",
        title: "keyboard note",
        description: "play note using the computer keyboard.",
        category: "NoteInput",
        eventType: "both",
        defaultBindings: [{ kind: "physical", code: "KeyP" }],
    },
} as const;

export const kAllActions = typedValues(gActionRegistry);