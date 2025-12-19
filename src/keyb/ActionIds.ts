// a list of all keyboard shortcuts.
export const Actions = {
   PlayPause: "PlayPause",
   Panic: "Panic",
   Undo: "Undo",
   Redo: "Redo",
   TogglePreferencesPanel: "TogglePreferencesPanel",
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
