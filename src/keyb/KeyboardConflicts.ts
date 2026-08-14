import {typedKeys} from "../utils/utils";
import {isSameChord} from "./KeyboardShortcutTypes";
import type {ActionDef, ActionRegistry, Platform, ShortcutChord, UserBindings} from "./KeyboardShortcutTypes";

export function findActionsSharingChord<TActionId extends string>(
   actionIds: readonly TActionId[],
   actionId: TActionId,
   chord: ShortcutChord,
   allBindings: Record<TActionId, readonly ShortcutChord[]>,
): TActionId[] {
   return actionIds.filter((otherActionId) => (
      otherActionId !== actionId
      && (allBindings[otherActionId] ?? []).some((binding) => isSameChord(binding, chord))
   ));
}

function getActionDefaultsForPlatform<TActionId extends string>(
   def: ActionDef<TActionId>, platform: Platform): ShortcutChord[] {
   const d = def.defaultBindings;
   if (!d)
      return [];
   if (Array.isArray(d))
      return d;
   return d[platform] ?? [];
}

export function resolveBindingsForPlatform<TActionId extends string>(
   actions: ActionRegistry<TActionId>,
   user: UserBindings<TActionId>|undefined,
   platform: Platform,
   ): Record<TActionId, ShortcutChord[]> {
   const out: Record<TActionId, ShortcutChord[]> = {} as any;

   for (const id of typedKeys(actions) as TActionId[]) {
      const u = user?.[id];

      if (u === null) {
         out[id] = []; // explicitly unbound
         continue;
      }
      if (u !== undefined) {
         out[id] = u; // user override
         continue;
      }

      out[id] = getActionDefaultsForPlatform(actions[id], platform); // defaults
   }

   return out;
}
