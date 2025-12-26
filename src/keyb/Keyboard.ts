
import {getEventPrimaryDown, getEventSecondaryDown} from "./KeyboardShortcutPlatform";
import {Platform, ShortcutChord, ShortcutContext} from "./KeyboardShortcutTypes";

export function isEditableTarget(target: EventTarget|null): boolean {
   const el = target as HTMLElement | null;
   if (!el)
      return false;

   // Contenteditable
   if ((el as any).isContentEditable)
      return true;

   const tag = el.tagName?.toLowerCase();
   if (!tag)
      return false;

   if (tag === "textarea")
      return true;
   if (tag === "input") {
      const input = el as HTMLInputElement;
      const type = (input.type || "text").toLowerCase();
      // allow shortcuts in non-text inputs (checkbox/range/etc)
      const texty = new Set([
         "text",
         "search",
         "email",
         "url",
         "tel",
         "password",
         "number",
         "date",
         "datetime-local",
         "month",
         "time",
         "week",
      ]);
      return texty.has(type);
   }

   // Select behaves like editable (avoid stealing arrows, etc.)
   if (tag === "select")
      return true;

   return false;
}

export function normalizeKeyForCharacterShortcut(key: string): string {
   // Make matching stable:
   // - letters lowercased
   // - keep special keys as-is (Enter/Escape/ArrowLeft)
   // - normalize space
   if (key === " ")
      return "Space";

   // For single character keys (letters, digits, punctuation), normalize case.
   if (key.length === 1)
      return key.toLowerCase();

   return key; // "Enter", "Escape", "Backspace", "ArrowLeft", etc.
}

function chordModsMatch(e: KeyboardEvent, chord: ShortcutChord, platform: Platform): boolean {
   const havePrimary = getEventPrimaryDown(e, platform);
   const haveSecondary = getEventSecondaryDown(e, platform);
   const haveAlt = e.altKey;
   const haveShift = e.shiftKey;

   if (chord.ignoreExtraModifiers) {
      if (chord.primary && !havePrimary)
         return false;
      if (chord.secondary && !haveSecondary)
         return false;
      if (chord.alt && !haveAlt)
         return false;
      if (chord.shift && !haveShift)
         return false;
      return true;
   }

   const wantPrimary = !!chord.primary;
   const wantSecondary = !!chord.secondary;
   const wantAlt = !!chord.alt;
   const wantShift = !!chord.shift;

   return (
      wantPrimary === havePrimary && wantSecondary === haveSecondary && wantAlt === haveAlt && wantShift === haveShift);
}

export function chordMatchesEvent(e: KeyboardEvent, chord: ShortcutChord, platform: Platform): boolean {
   if (!chordModsMatch(e, chord, platform))
      return false;

   if (chord.kind === "physical") {
      if (!chord.code)
         return false;
      return e.code === chord.code;
   }

   // character
   if (!chord.key)
      return false;
   return normalizeKeyForCharacterShortcut(e.key) === normalizeKeyForCharacterShortcut(chord.key);
}

export function buildShortcutContext(platform: Platform, e: KeyboardEvent): ShortcutContext {
   const target = e.target;
   return {
      platform,
      target,
      isEditableTarget: isEditableTarget(target),
      eventType: (e.type === "keyup" ? "keyup" : "keydown"),
      event: e,
   };
}
