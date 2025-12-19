// shortcuts/platform.ts

import {Platform} from "./KeyboardShortcutTypes";

export function detectPlatform(): Platform {
   // Reasonable heuristic for web apps
   const p = navigator.platform?.toLowerCase() ?? "";
   const ua = navigator.userAgent?.toLowerCase() ?? "";
   const isMac = p.includes("mac") || ua.includes("mac os");
   const isWin = p.includes("win") || ua.includes("windows");
   return isMac ? "mac" : isWin ? "win" : "linux";
}

export function getEventPrimaryDown(e: KeyboardEvent, platform: Platform): boolean {
   return platform === "mac" ? e.metaKey : e.ctrlKey;
}

export function getEventSecondaryDown(e: KeyboardEvent, platform: Platform): boolean {
   // Rare, but available.
   return platform === "mac" ? e.ctrlKey : e.metaKey;
}
