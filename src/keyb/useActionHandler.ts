// shortcuts/useActionHandler.ts
import React from "react";
import type {ActionHandler} from "./KeyboardShortcutTypes";
import {useShortcutManager} from "./KeyboardShortcutManager";
import {GlobalActionId} from "./ActionIds";

export function useActionHandler(actionId: GlobalActionId, handler: ActionHandler) {
   const mgr = useShortcutManager();
   //const scopes = useActiveScopes();

   // Keep latest handler without re-registering every render
   const handlerRef = React.useRef(handler);
   handlerRef.current = handler;

   React.useEffect(() => {
      return mgr.registerHandler(actionId, (ctx) => handlerRef.current(ctx));
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [mgr, actionId]);
}
