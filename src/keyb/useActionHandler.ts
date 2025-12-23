// shortcuts/useActionHandler.ts
import React from "react";
import type {ActionHandler} from "./KeyboardShortcutTypes";
import {useShortcutManager} from "./KeyboardShortcutManager";

export function useActionHandler<TActionId extends string>(actionId: TActionId, handler: ActionHandler) {
   const mgr = useShortcutManager<TActionId>();

   // Keep latest handler without re-registering every render
   const handlerRef = React.useRef(handler);
   handlerRef.current = handler;

   React.useEffect(() => {
      return mgr.registerHandler(actionId, (ctx) => handlerRef.current(ctx));
   }, [mgr, actionId]);
}
