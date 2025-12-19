// a list of all keyboard shortcuts.
export const Actions = {
   PlayPause: "PlayPause",
   Undo: "Undo",
   Panic: "Panic",
} as const;

export const kAllActionIds = Object.values(Actions);

export type ActionId = keyof typeof Actions;
