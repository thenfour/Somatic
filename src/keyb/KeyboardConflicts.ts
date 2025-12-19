// shortcuts/conflicts.ts
import type {ActionRegistry, Platform, ShortcutChord, UserBindings} from "./KeyboardShortcutTypes";
import {ActionId, kAllActionIds} from "./ActionIds";
import {formatChord} from "./format";

export type BindingIssue =|{
   kind: "conflict";
   chord: ShortcutChord;
   actions: ActionId[];
   message: string
}
|{
   kind: "reserved";
   chord: ShortcutChord;
   message: string
};

function chordKey(chord: ShortcutChord): string {
   // Stable identifier for conflict detection
   const main = chord.kind === "physical" ? `code:${chord.code ?? ""}` : `key:${(chord.key ?? "").toLowerCase()}`;
   const mods = `p:${!!chord.primary}|s:${!!chord.secondary}|a:${!!chord.alt}|sh:${!!chord.shift}`;
   return `${chord.kind}|${mods}|${main}`;
}

export function resolveBindingsForPlatform(
   actions: ActionRegistry,
   user: UserBindings|undefined,
   platform: Platform,
   ): Record<ActionId, ShortcutChord[]> {
   const out: Record<ActionId, ShortcutChord[]> = {} as Record<ActionId, ShortcutChord[]>;
   for (const id of kAllActionIds) {
      const u = user?.[id];
      if (u && u.length) {
         out[id] = u;
         continue;
      }
      const d = actions[id].defaultBindings?.[platform] ?? [];
      out[id] = d;
   }
   return out;
}

export function findBindingIssues(
   actions: ActionRegistry,
   bindings: Record<ActionId, ShortcutChord[]>,
   platform: Platform,
   ): BindingIssue[] {
   const issues: BindingIssue[] = [];

   // conflicts
   const map = new Map<string, ActionId[]>();
   for (const [actionId, chords] of Object.entries(bindings)) {
      for (const chord of chords) {
         const k = chordKey(chord);
         const arr = map.get(k) ?? [];
         arr.push(actionId as ActionId);
         map.set(k, arr);
      }
   }
   for (const [k, actionIds] of map.entries()) {
      if (actionIds.length > 1) {
         const chord = bindings[actionIds[0]].find(c => chordKey(c) === k)!;
         issues.push({
            kind: "conflict",
            chord,
            actions: actionIds,
            message: `Conflict: ${formatChord(chord, platform)} is assigned to ${actionIds.join(", ")}`,
         });
      }
   }

   // reserved-ish heuristics (not authoritative; treat as warnings)
   for (const chords of Object.values(bindings)) {
      for (const chord of chords) {
         const main = chord.kind === "character" ? chord.key : chord.code;

         // Avoid Alt+F4 / Cmd+Q etc style footguns:
         if (chord.alt && (main?.toUpperCase?.().startsWith("F") || main === "F4")) {
            issues.push({
               kind: "reserved",
               chord,
               message: `Warning: ${formatChord(chord, platform)} may be captured by the OS/browser.`,
            });
         }

         // Common browser/OS combos (heuristic)
         if (chord.primary && !chord.shift && !chord.alt && (main === "r" || main === "R")) {
            issues.push({
               kind: "reserved",
               chord,
               message: `Warning: ${formatChord(chord, platform)} is commonly Refresh.`,
            });
         }
      }
   }

   return issues;
}
