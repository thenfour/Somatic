// Keyboard-based note input source treated like a MIDI device.
// Maps QWERTY keys to note numbers using the same layout as the pattern grid.

import {NoteEvent, NoteInputSource} from "./note_input";

const defaultNoteKeyMap = "-zsxdcvgbhnjmq2w3er5t6y7ui".split("");

const isEditableTarget = (target: EventTarget|null) => {
   const el = target as HTMLElement | null;
   if (!el)
      return false;
   const tag = el.tagName?.toLowerCase();
   return tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || el.isContentEditable;
};

export class KeyboardNoteInput implements NoteInputSource {
   private noteOnListeners = new Set<(evt: NoteEvent) => void>();
   private noteOffListeners = new Set<(evt: NoteEvent) => void>();
   private enabled = true;
   private activeKeys = new Set<string>();
   private initialized = false;
   private getOctave: () => number;
   private noteKeyMap: string[];
   private sourceId: string;

   constructor(opts?: {getOctave?: () => number; noteKeyMap?: string[]; sourceId?: string;}) {
      this.getOctave = opts?.getOctave ?? (() => 4);
      this.noteKeyMap = opts?.noteKeyMap ?? defaultNoteKeyMap;
      this.sourceId = opts?.sourceId ?? "keyboard";
   }

   init(): void {
      if (this.initialized)
         return;
      window.addEventListener("keydown", this.handleKeyDown, true);
      window.addEventListener("keyup", this.handleKeyUp, true);
      this.initialized = true;
   }

   dispose(): void {
      if (!this.initialized)
         return;
      window.removeEventListener("keydown", this.handleKeyDown, true);
      window.removeEventListener("keyup", this.handleKeyUp, true);
      this.initialized = false;
   }

   setEnabled(enabled: boolean): void {
      this.enabled = enabled;
   }

   isEnabled(): boolean {
      return this.enabled;
   }

   onNoteOn(cb: (evt: NoteEvent) => void): () => void {
      this.noteOnListeners.add(cb);
      return () => this.noteOnListeners.delete(cb);
   }

   onNoteOff(cb: (evt: NoteEvent) => void): () => void {
      this.noteOffListeners.add(cb);
      return () => this.noteOffListeners.delete(cb);
   }

   private handleKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled)
         return;
      if (isEditableTarget(e.target))
         return;
      if (e.metaKey || e.ctrlKey || e.altKey)
         return;
      if (e.repeat)
         return;

      const idx = this.noteKeyMap.indexOf(e.key);
      if (idx === -1)
         return;
      if (this.activeKeys.has(e.key))
         return;

      this.activeKeys.add(e.key);
      const octave = this.getOctave();
      const note = idx + (octave - 1) * 12;
      const payload: NoteEvent = {note, velocity: 127, channel: 0, deviceId: this.sourceId};
      this.noteOnListeners.forEach((cb) => cb(payload));
      e.preventDefault();
   };

   private handleKeyUp = (e: KeyboardEvent) => {
      if (!this.enabled)
         return;
      const idx = this.noteKeyMap.indexOf(e.key);
      if (idx === -1)
         return;
      if (!this.activeKeys.has(e.key))
         return;

      this.activeKeys.delete(e.key);
      const octave = this.getOctave();
      const note = idx + (octave - 1) * 12;
      const payload: NoteEvent = {note, velocity: 0, channel: 0, deviceId: this.sourceId};
      this.noteOffListeners.forEach((cb) => cb(payload));
      e.preventDefault();
   };
}
