import React from "react";
import type {Platform, ShortcutChord} from "./KeyboardShortcutTypes";
import {getEventPrimaryDown, getEventSecondaryDown} from "./KeyboardShortcutPlatform";
import {normalizeKeyForCharacterShortcut} from "./Keyboard";
import {useShortcutManager} from "./KeyboardShortcutManager";

type CaptureOptions = {
   kind: "character"|"physical"; //
   platform: Platform;
   // optional: block chords that are "just modifiers"
   allowBareModifier?: boolean;
};

export function useChordCapture(opts: CaptureOptions) {
   const [capturing, setCapturing] = React.useState(false);
   const mgr = useShortcutManager();

   React.useEffect(() => {
      if (!capturing)
         return;
      const release = mgr.suspendShortcuts();
      return release;
   }, [capturing, mgr]);

   const onKeyDown = React.useCallback(
      (e: KeyboardEvent):
         ShortcutChord|null => {
            if (!capturing)
               return null;

            // Don’t let the browser do stuff while capturing
            e.preventDefault();
            e.stopPropagation();

            const primary = getEventPrimaryDown(e, opts.platform);
            const secondary = getEventSecondaryDown(e, opts.platform);
            const alt = e.altKey;
            const shift = e.shiftKey;

            // Ignore pure modifier presses unless allowed
            const isModifierOnly = e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta";
            if (isModifierOnly && !opts.allowBareModifier)
               return null;

            if (opts.kind === "physical") {
               return {
                  kind: "physical",
                  code: e.code,
                  primary,
                  secondary,
                  alt,
                  shift,
               };
            }

            return {
               kind: "character",
               key: normalizeKeyForCharacterShortcut(e.key),
               primary,
               secondary,
               alt,
               shift,
            };
         },
      [capturing, opts.kind, opts.platform, opts.allowBareModifier],
   );

   React.useEffect(() => {
      if (!capturing)
         return;
      const handler = (e: KeyboardEvent) => onKeyDown(e);
      document.addEventListener("keydown", handler, true);
      return () => document.removeEventListener("keydown", handler, true);
   }, [capturing, onKeyDown]);

   return {capturing, setCapturing, captureFromEvent: onKeyDown};
}
