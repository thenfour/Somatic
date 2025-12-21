// mouse wheel behavior is weird and preventDefault() doesn't like to cancel it.
// have to use a non-passive event which requires some plumbing. encapsulate here.

import {useEffect, useRef, RefObject} from "react";

function useLatest<T>(value: T) {
   const r = useRef(value);
   r.current = value;
   return r;
}

type WheelNavOptions = {
   enabled?: boolean;
   allowZoomGestures?: boolean;
   capture?: boolean;
   // If true, only triggers once per "notch" on trackpads by reducing delta to -1/ +1
   normalizeDelta?: boolean;
};

export function useWheelNavigator(
   ref: RefObject<HTMLElement|null>, onWheel: (ev: WheelEvent) => void, options: WheelNavOptions = {}) {
   const {
      enabled = true,
      allowZoomGestures = true,
      capture = true,
      normalizeDelta = true,
   } = options;

   const onWheelLatest = useLatest(onWheel);

   useEffect(() => {
      const el = ref.current;
      if (!el || !enabled)
         return;

      const listener = (ev: WheelEvent) => {
         if (allowZoomGestures && (ev.ctrlKey || ev.metaKey))
            return;

         // Block container scrolling
         if (ev.cancelable)
            ev.preventDefault();

         // Optionally normalize trackpad deltas to a single step.
         if (normalizeDelta && ev.deltaY !== 0) {
            // Create a lightweight "view" of the event by mutating a local variable
            const sign = ev.deltaY < 0 ? -1 : 1;
            const proxy = new Proxy(ev, {
                             get(target, prop) {
                                if (prop === "deltaY")
                                   return sign;
                                return (target as any)[prop];
                             },
                          }) as unknown as WheelEvent;

            onWheelLatest.current(proxy);
         } else {
            onWheelLatest.current(ev);
         }
      };

      el.addEventListener("wheel", listener, {passive: false, capture});
      return () => el.removeEventListener("wheel", listener, {capture} as any);
   }, [ref, enabled, allowZoomGestures, capture, normalizeDelta]);
}
