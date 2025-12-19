// for formatting keyboard shortcut chords into human-readable strings

import type {Platform, ShortcutChord} from "./KeyboardShortcutTypes";

function platformPrimaryLabel(platform: Platform): string {
   return platform === "mac" ? "⌘" : "Ctrl";
}

function platformSecondaryLabel(platform: Platform): string {
   return platform === "mac" ? "Ctrl" : "⌘";
}

function prettyKey(keyOrCode: string): string {
   // Common prettification; extend as you like
   const map: Record<string, string> = {
      Escape: "Esc",
      Backspace: "Backspace",
      Enter: "Enter",
      Space: "Space",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      ArrowUp: "Up",
      ArrowDown: "Down",
   };
   return map[keyOrCode] ?? keyOrCode;
}

export function formatChord(chord: ShortcutChord, platform: Platform): string {
   const parts: string[] = [];

   if (chord.primary)
      parts.push(platformPrimaryLabel(platform));
   if (chord.secondary)
      parts.push(platformSecondaryLabel(platform));
   if (chord.alt)
      parts.push(platform === "mac" ? "⌥" : "Alt");
   if (chord.shift)
      parts.push(platform === "mac" ? "⇧" : "Shift");

   const main = chord.kind === "physical" ? prettyKey(chord.code ?? "") : prettyKey(chord.key ?? "");

   if (main)
      parts.push(main);

   // On mac: show compact symbols by default; on win/linux join with "+"
   if (platform === "mac")
      return parts.join("");
   return parts.join("+");
}
