import {ActionCategory, ActionId} from "./ActionIds";

export type Platform = "mac"|"win"|"linux";
export type ShortcutKind = "character"|"physical";

// Semantic modifiers: "primary" is Cmd on mac, Ctrl on win/linux.
// "secondary" is the other one (Ctrl on mac, Meta on win/linux) if you ever need it.
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
   return a.kind === b.kind &&           //
      a.key === b.key &&                 //
      a.code === b.code &&               //
      !!a.primary === !!b.primary &&     //
      !!a.secondary === !!b.secondary && //
      !!a.alt === !!b.alt &&             //
      !!a.shift === !!b.shift;           //
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
   platform: Platform;     //
   activeScopes: string[]; // top-most first, e.g. ["modal:cmdk", "panel:pianoRoll", "global"]
   target: EventTarget | null;
   isEditableTarget: boolean;
};

export type UserBindings = Partial<Record<ActionId, ShortcutChord[]|null>>;

export type ActionRegistry = Record<ActionId, ActionDef>;

export type ActionHandler = (ctx: ShortcutContext) => void;

export type ShortcutEventPolicy = {
   // if you want to globally ignore events (e.g. while dragging)
   ignoreEvent?: (e: KeyboardEvent) => boolean;
};
