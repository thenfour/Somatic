import {useShortcutManager} from "./KeyboardShortcutManager";
import type {ActionHandler, ActionHandlerOptions} from "./KeyboardShortcutTypes";

export function useActionHandler<TActionId extends string>(
   actionId: TActionId,
   handler: ActionHandler,
   options?: ActionHandlerOptions,
) {
   const mgr = useShortcutManager<TActionId>();
   mgr.useActionHandler(actionId, handler, options);
}
