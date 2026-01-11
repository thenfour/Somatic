import {ActionRegistry} from "../../keyb/KeyboardShortcutTypes";
import {typedValues} from "../../utils/utils";

// a list of all keyboard shortcuts.
export const MenuActions = {
   Close: "Close",
   NextItem: "NextItem",
   PrevItem: "PrevItem",
   ActivateItem: "ActivateItem",
   OpenOrNextMenu: "OpenOrNextMenu",
   CloseOrParentMenu: "CloseOrParentMenu",

} as const;

export const kMenuActionIds = typedValues(MenuActions);

export type MenuActionId = keyof typeof MenuActions;


export const gMenuActionRegistry: ActionRegistry<MenuActionId> = {
   // close the dropdown menu
   Close: {
      id: MenuActions.Close,
      defaultBindings: [
         {kind: "character", key: "Escape"},
      ],
   },
   ActivateItem: {
      id: MenuActions.ActivateItem,
      defaultBindings: [
         {kind: "character", key: "Enter"},
         {kind: "character", key: " "},
      ],
   },

   // select next item vertically in the dropdown menu; wraps around at ends
   NextItem: {
      id: MenuActions.NextItem,
      defaultBindings: [
         {kind: "character", key: "ArrowDown"},
      ],
   },
   PrevItem: {
      id: MenuActions.PrevItem,
      defaultBindings: [
         {kind: "character", key: "ArrowUp"},
      ],
   },

   // if the current item is a submenu, open it; otherwise, move to the next menu (e.g. from menubar to first menu). Wraps at edges.
   OpenOrNextMenu: {
      id: MenuActions.OpenOrNextMenu,
      defaultBindings: [
         {kind: "character", key: "ArrowRight"},
      ],
   },
   // if in a submenu, close it; otherwise, move to the parent menu (e.g. from first menu to menubar)
   CloseOrParentMenu: {
      id: MenuActions.CloseOrParentMenu,
      defaultBindings: [
         {kind: "character", key: "ArrowLeft"},
      ],
   },
} as const;

export const kMenuActions = typedValues(gMenuActionRegistry);