// shortcuts/useActionHandler.ts
import React from "react";
import type {ActionHandler} from "./KeyboardShortcutTypes";
import {useShortcutManager} from "./KeyboardShortcutManager";
import {useActiveScopes} from "./KeyboardShortcutScope";
import {ActionId} from "./ActionIds";

export function useActionHandler(actionId: ActionId, handler: ActionHandler) {
   const mgr = useShortcutManager();
   const scopes = useActiveScopes();

   // Keep latest handler without re-registering every render
   const handlerRef = React.useRef(handler);
   handlerRef.current = handler;

   React.useEffect(() => {
      return mgr.registerHandler(actionId, scopes, (ctx) => handlerRef.current(ctx));
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [mgr, actionId, scopes.join("|")]);
}
