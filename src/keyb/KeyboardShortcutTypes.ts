import {typedKeys} from "../utils/utils";
import {GlobalActionCategory, GlobalActionId} from "./ActionIds";

export type Platform = "mac"|"win"|"linux";
export type ShortcutKind = "character"|"physical";

// Semantic modifiers: "primary" is Cmd on mac, Ctrl on win/linux.
// "secondary" is the other one (Ctrl on mac, Meta on win/linux)
export type ShortcutChord = {
   kind: ShortcutKind;

   // kind === "character": layout-aware
   key?: string;

   // kind === "physical": layout-agnostic (QWERTY geometry)
   code?: string;

   primary?: boolean;
   secondary?: boolean;
   alt?: boolean;
   shift?: boolean;

   // If true, extra modifiers do not prevent a match.
   // (e.g. chord with no mods can still match while Ctrl is held).
   // Default is exact matching.
   ignoreExtraModifiers?: boolean;
};

export function isSameChord(a: ShortcutChord, b: ShortcutChord): boolean {
   if (a.kind !== b.kind)
      return false;
   if (Boolean(a.ignoreExtraModifiers) !== Boolean(b.ignoreExtraModifiers))
      return false;
   if (Boolean(a.primary) !== Boolean(b.primary))
      return false;
   if (Boolean(a.secondary) !== Boolean(b.secondary))
      return false;
   if (Boolean(a.alt) !== Boolean(b.alt))
      return false;
   if (Boolean(a.shift) !== Boolean(b.shift))
      return false;
   if (a.kind === "character") {
      return a.key === b.key;
   } else {
      return a.code === b.code;
   }
}

//export type ActionId = string;

export type ActionDef<TActionId extends string = string> = {
   id: TActionId; //
   title?: string;
   description?: string;
   category?: GlobalActionCategory;

   // Which keyboard event type triggers this action.
   // Default: keydown
   eventType?: "keydown" | "keyup" | "both";

   // Defaults can be platform-specific (recommended)
   defaultBindings?: ShortcutChord[]; // | Partial<Record<Platform, ShortcutChord[]>>;

   // runtime policy
   allowInEditable?: boolean; // default false
   allowRepeat?: boolean;     // default false
   preventDefault?: boolean;  // default true when handled
   stopPropagation?: boolean; // default true when handled

   when?: (ctx: ShortcutContext) => boolean;
};

export type ShortcutContext = {
   platform: Platform; //
   target: EventTarget | null;
   isEditableTarget: boolean;
   eventType: "keydown" | "keyup";
   event: KeyboardEvent;
};

export type UserBindings<TActionId extends string = string> = Partial<Record<TActionId, ShortcutChord[]|null>>;

export type UserBindigsDto = {
   [actionId: string]: ShortcutChord[]|null;
};

export function serializeUserBindings<TActionId extends string>(bindings: UserBindings<TActionId>): UserBindigsDto {
   const dto: UserBindigsDto = {};
   for (const actionId of Object.keys(bindings)) {
      const b = bindings[actionId as TActionId];
      if (b === undefined)
         continue;
      dto[actionId] = b;
   }
   return dto;
}

export function deserializeUserBindings<TActionId extends string>(dto: UserBindigsDto): UserBindings<TActionId> {
   const bindings: UserBindings<TActionId> = {};
   for (const actionId of typedKeys(dto)) {
      bindings[actionId as TActionId] = dto[actionId];
   }
   return bindings;
};

export type ActionRegistry<TActionId extends string = string> = Record<TActionId, ActionDef<TActionId>>;

export type ActionHandler = (ctx: ShortcutContext) => void;

export type ShortcutEventPolicy = {
   // if you want to globally ignore events (e.g. while dragging)
   ignoreEvent?: (e: KeyboardEvent) => boolean;
};
