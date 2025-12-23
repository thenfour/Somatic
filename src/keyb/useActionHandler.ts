import {useShortcutManager} from "./KeyboardShortcutManager";
import type {ActionHandler} from "./KeyboardShortcutTypes";

export function useActionHandler<TActionId extends string>(actionId: TActionId, handler: ActionHandler) {
   const mgr = useShortcutManager<TActionId>();
   mgr.useActionHandler(actionId, handler);
}
