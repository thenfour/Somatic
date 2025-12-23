import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {typedEntries, typedKeys} from "../utils/utils";

type Options = {
   heartbeatMs?: number; // default 2000
   staleMs?: number;     // default 8000
};

type PresenceMap = Record<string, number>;

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
   const [detectionEnabled, setDetectionEnabled] = useState(false);

   const readPresence = useCallback((): PresenceMap => {
      return safeParse<PresenceMap>(localStorage.getItem(ACTIVE_KEY)) ?? {};
   }, [ACTIVE_KEY]);

   const pruneStalePresence = useCallback((presence: PresenceMap) => {
      const now = Date.now();
      const next: PresenceMap = {};
      for (const [id, ts] of typedEntries(presence)) {
         if ((now - ts) < staleMs) {
            next[id] = ts;
         }
      }
      return next;
   }, [staleMs]);

   const computeOtherActive = useCallback(() => {
      if (!detectionEnabled)
         return false;
      const presence = pruneStalePresence(readPresence());
      return typedKeys(presence).some(id => id !== tabId);
   }, [pruneStalePresence, readPresence, tabId, detectionEnabled]);

   const heartbeat = useCallback(() => {
      const now = Date.now();
      const presence = pruneStalePresence(readPresence());
      presence[tabId] = now;
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(presence));
      setOtherInstanceActive(detectionEnabled && typedKeys(presence).some(id => id !== tabId));
   }, [ACTIVE_KEY, pruneStalePresence, readPresence, tabId, detectionEnabled]);

   const removeSelf = useCallback(() => {
      const presence = pruneStalePresence(readPresence());
      delete presence[tabId];
      localStorage.setItem(ACTIVE_KEY, JSON.stringify(presence));
   }, [ACTIVE_KEY, pruneStalePresence, readPresence, tabId]);

   useEffect(() => {
      if (typeof window === "undefined")
         return;

      // grace period so reloads (F5) don't flash a false warning
      const graceMs = staleMs + heartbeatMs + 500; // a bit longer than the stale timeout
      const graceId = window.setTimeout(() => setDetectionEnabled(true), graceMs);

      const tick = () => {
         heartbeat();
      };

      tick();
      const id = window.setInterval(tick, heartbeatMs);

      const onFocus = () => {
         heartbeat();
      };
      window.addEventListener("focus", onFocus);

      const onVis = () => {
         onFocus();
      };
      document.addEventListener("visibilitychange", onVis);

      const onStorage = (e: StorageEvent) => {
         if (e.key === ACTIVE_KEY)
            setOtherInstanceActive(computeOtherActive());
      };
      window.addEventListener("storage", onStorage);

      window.addEventListener("beforeunload", removeSelf);
      window.addEventListener("pagehide", removeSelf);

      return () => {
         window.clearInterval(id);
         window.removeEventListener("focus", onFocus);
         document.removeEventListener("visibilitychange", onVis);
         window.removeEventListener("storage", onStorage);
         window.removeEventListener("beforeunload", removeSelf);
         window.removeEventListener("pagehide", removeSelf);
         window.clearTimeout(graceId);
         removeSelf();
      };
   }, [heartbeatMs, heartbeat, computeOtherActive, ACTIVE_KEY, removeSelf, staleMs]);

   return useMemo(
      () => ({
         tabId,
         otherInstanceActive,
      }),
      [tabId, otherInstanceActive]);
}
