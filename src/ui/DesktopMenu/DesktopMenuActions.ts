import {ActionRegistry} from "../../keyb/KeyboardShortcutTypes";
import {typedValues} from "../../utils/utils";

// a list of all keyboard shortcuts.
export const MenuActions = {
   Close: "Close",

} as const;

export const kMenuActionIds = typedValues(MenuActions);

export type MenuActionId = keyof typeof MenuActions;


export const gMenuActionRegistry: ActionRegistry<MenuActionId> = {
   Close: {
      id: MenuActions.Close,
      defaultBindings: [],
   },
} as const;

export const kMenuActions = typedValues(gMenuActionRegistry);