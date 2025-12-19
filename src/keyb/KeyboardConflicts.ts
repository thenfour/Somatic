import {ActionId, kAllActionIds} from "./ActionIds";
import type {ActionDef, ActionRegistry, Platform, ShortcutChord, UserBindings} from "./KeyboardShortcutTypes";

function getActionDefaultsForPlatform(def: ActionDef, platform: Platform): ShortcutChord[] {
   const d = def.defaultBindings;
   if (!d)
      return [];
   if (Array.isArray(d))
      return d;
   return d[platform] ?? [];
}

export function resolveBindingsForPlatform(
   actions: ActionRegistry,
   user: UserBindings|undefined,
   platform: Platform,
   ): Record<ActionId, ShortcutChord[]> {
   const out: Record<ActionId, ShortcutChord[]> = {} as any;

   for (const id of kAllActionIds) {
      const u = user?.[id];

      if (u === null) {
         out[id] = []; // explicitly unbound
         continue;
      }
      if (u !== undefined) {
         out[id] = u; // user override (can be [] if you want)
         continue;
      }

      out[id] = getActionDefaultsForPlatform(actions[id], platform); // defaults
   }

   return out;
}