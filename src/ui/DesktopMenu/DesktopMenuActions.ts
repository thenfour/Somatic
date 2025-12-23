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
   Close: {
      id: MenuActions.Close,
      defaultBindings: [
         {kind: "character", key: "Escape"},
      ],
   },
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
   ActivateItem: {
      id: MenuActions.ActivateItem,
      defaultBindings: [
         {kind: "character", key: "Enter"},
         {kind: "character", key: " "},
      ],
   },
   OpenOrNextMenu: {
      id: MenuActions.OpenOrNextMenu,
      defaultBindings: [
         {kind: "character", key: "ArrowRight"},
      ],
   },
   CloseOrParentMenu: {
      id: MenuActions.CloseOrParentMenu,
      defaultBindings: [
         {kind: "character", key: "ArrowLeft"},
      ],
   },
} as const;

export const kMenuActions = typedValues(gMenuActionRegistry);