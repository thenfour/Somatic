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
} as const;

export const kAllActions = Object.values(gActionRegistry);