import {useRef} from "react";
import {gLog} from "../utils/logger";

type UseRenderAlarmOpts = {
   name?: string;
   warnAfterRenders?: number; // e.g. 30 renders…
   withinMs?: number;         // …within this time window
   logEachRender?: boolean;   // noisy, but useful briefly
};

export function useRenderAlarm(opts: UseRenderAlarmOpts = {}) {
   const {
      name = "Component",
      warnAfterRenders = 30,
      withinMs = 1000,
      logEachRender = false,
   } = opts;

   const countRef = useRef(0);
   const timesRef = useRef<number[]>([]);

   countRef.current++;

   if (logEachRender) {
      // NOTE: logging in render is intentionally loud use briefly.
      gLog.error(`[render] ${name} #${countRef.current}`);
   }

   // Keep a rolling window of render timestamps; warn if too many.
   const now = performance.now();
   timesRef.current.push(now);
   const cutoff = now - withinMs;
   while (timesRef.current.length && timesRef.current[0] < cutoff) {
      timesRef.current.shift();
   }

   if (timesRef.current.length === warnAfterRenders) {
      console.warn(
         `[render-alarm] ${name} rendered ${warnAfterRenders} times within ${withinMs}ms. Possible loop.`,
      );
      // debugger;
   }
}
