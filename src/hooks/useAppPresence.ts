import {useCallback, useEffect, useMemo, useRef, useState} from "react";

type Options = {
   heartbeatMs?: number; // default 2000
   staleMs?: number;     // default 8000
};

function safeParse<T>(raw: string|null): T|null {
   if (!raw)
      return null;
   try {
      return JSON.parse(raw) as T;
   } catch {
      return null;
   }
}

function makeTabId(): string {
   return globalThis.crypto?.randomUUID?.() ?? `tab_${Math.random().toString(16).slice(2)}`;
}

export function useAppInstancePresence(appId: string, opts: Options = {}) {
   const {heartbeatMs = 2000, staleMs = 8000} = opts;

   const tabIdRef = useRef(makeTabId());
   const tabId = tabIdRef.current;

   const ACTIVE_KEY = `__app_active__:${appId}`;

   const [otherInstanceActive, setOtherInstanceActive] = useState(false);

   const readActive = useCallback((): {tabId: string; ts: number}|null => {
      return safeParse<{tabId: string; ts: number}>(localStorage.getItem(ACTIVE_KEY));
   }, [ACTIVE_KEY]);

   const computeOtherActive = useCallback(() => {
      const a = readActive();
      if (!a)
         return false;
      const alive = (Date.now() - a.ts) < staleMs;
      return alive && a.tabId !== tabId;
   }, [readActive, staleMs, tabId]);

   const heartbeat = useCallback(() => {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({tabId, ts: Date.now()}));
   }, [ACTIVE_KEY, tabId]);

   useEffect(() => {
      if (typeof window === "undefined")
         return;

      const tick = () => {
         if (document.visibilityState === "visible")
            heartbeat();
         setOtherInstanceActive(computeOtherActive());
      };

      tick();
      const id = window.setInterval(tick, heartbeatMs);

      const onFocus = () => {
         heartbeat();
         setOtherInstanceActive(computeOtherActive());
      };
      window.addEventListener("focus", onFocus);

      const onVis = () => {
         if (document.visibilityState === "visible")
            onFocus();
      };
      document.addEventListener("visibilitychange", onVis);

      const onStorage = (e: StorageEvent) => {
         if (e.key === ACTIVE_KEY)
            setOtherInstanceActive(computeOtherActive());
      };
      window.addEventListener("storage", onStorage);

      return () => {
         window.clearInterval(id);
         window.removeEventListener("focus", onFocus);
         document.removeEventListener("visibilitychange", onVis);
         window.removeEventListener("storage", onStorage);
      };
   }, [heartbeatMs, heartbeat, computeOtherActive, ACTIVE_KEY]);

   return useMemo(
      () => ({
         tabId,
         otherInstanceActive,
      }),
      [tabId, otherInstanceActive]);
}
