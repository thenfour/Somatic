import {ActionRegistry} from "./KeyboardShortcutTypes";


export const gActionRegistry: ActionRegistry = {
   "Panic": {
      id: "Panic",
      title: "panic",
      description: "help for panick.",
      category: "Transport",
      defaultBindings: {
         mac: [{kind: "character", key: "?", shift: true}],
         win: [{kind: "character", key: "?", shift: true}],
         linux: [{kind: "character", key: "?", shift: true}],
      },
   },

   "PlayPause": {
      id: "PlayPause",
      title: "play/pause",
      description: "toggle playback.",
      category: "Transport",
      defaultBindings: {
         mac: [{kind: "character", key: "p", shift: true}],
         win: [{kind: "character", key: "p", shift: true}],
         linux: [{kind: "character", key: "p", shift: true}],
      },
   },

   "Undo": {
      id: "Undo",
      title: "undo",
      description: "undo last action.",
      category: "Edit",
      defaultBindings: {
         mac: [{kind: "character", key: "z", primary: true}],
         win: [{kind: "character", key: "z", primary: true}],
         linux: [{kind: "character", key: "z", primary: true}],
      },
   },
} as const;

export const kAllActions = Object.values(gActionRegistry);