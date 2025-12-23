import {ActionCategory, ActionId} from "./ActionIds";

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
};

export function isSameChord(a: ShortcutChord, b: ShortcutChord): boolean {
   if (a.kind !== b.kind)
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

export type ActionDef = {
   id: ActionId; //
   title: string;
   description?: string;
   category?: ActionCategory;

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
};

export type UserBindings = Partial<Record<ActionId, ShortcutChord[]|null>>;

export type UserBindigsDto = {
   [actionId: string]: ShortcutChord[]|null;
};

export function serializeUserBindings(bindings: UserBindings): UserBindigsDto {
   const dto: UserBindigsDto = {};
   for (const actionId of Object.keys(bindings)) {
      const b = bindings[actionId as ActionId];
      if (b === undefined)
         continue;
      dto[actionId] = b;
   }
   return dto;
}

export function deserializeUserBindings(dto: UserBindigsDto): UserBindings {
   const bindings: UserBindings = {};
   for (const actionId of Object.keys(dto)) {
      bindings[actionId as ActionId] = dto[actionId];
   }
   return bindings;
};

export type ActionRegistry = Record<ActionId, ActionDef>;

export type ActionHandler = (ctx: ShortcutContext) => void;

export type ShortcutEventPolicy = {
   // if you want to globally ignore events (e.g. while dragging)
   ignoreEvent?: (e: KeyboardEvent) => boolean;
};
