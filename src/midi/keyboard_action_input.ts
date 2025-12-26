import type {GlobalActionId} from "../keyb/ActionIds";
import type {ShortcutContext} from "../keyb/KeyboardShortcutTypes";
import type {NoteEvent, NoteInputSource} from "./note_input";

export type ActionHandlerRegistration<TActionId extends string> = {
   registerHandler: (actionId: TActionId, handler: (ctx: ShortcutContext) => void) => () => void;
};

export type KeyboardNoteActionMapEntry = {
   actionId: GlobalActionId; //
   semitoneIndex: number;    //
};

export const kDefaultKeyboardNoteActionMap: KeyboardNoteActionMapEntry[] = [
   {actionId: "KeyboardNote01_C", semitoneIndex: 1},       ////
   {actionId: "KeyboardNote02_Csharp", semitoneIndex: 2},  //
   {actionId: "KeyboardNote03_D", semitoneIndex: 3},       ////
   {actionId: "KeyboardNote04_Dsharp", semitoneIndex: 4},  //
   {actionId: "KeyboardNote05_E", semitoneIndex: 5},       ////
   {actionId: "KeyboardNote06_F", semitoneIndex: 6},       //
   {actionId: "KeyboardNote07_Fsharp", semitoneIndex: 7},  ////
   {actionId: "KeyboardNote08_G", semitoneIndex: 8},       //
   {actionId: "KeyboardNote09_Gsharp", semitoneIndex: 9},  ////
   {actionId: "KeyboardNote10_A", semitoneIndex: 10},      //
   {actionId: "KeyboardNote11_Asharp", semitoneIndex: 11}, ////
   {actionId: "KeyboardNote12_B", semitoneIndex: 12},      //
   {actionId: "KeyboardNote13_C", semitoneIndex: 13},      ////
   {actionId: "KeyboardNote14_Csharp", semitoneIndex: 14}, //
   {actionId: "KeyboardNote15_D", semitoneIndex: 15},      ////
   {actionId: "KeyboardNote16_Dsharp", semitoneIndex: 16}, //
   {actionId: "KeyboardNote17_E", semitoneIndex: 17},      ////
   {actionId: "KeyboardNote18_F", semitoneIndex: 18},      //
   {actionId: "KeyboardNote19_Fsharp", semitoneIndex: 19}, ////
   {actionId: "KeyboardNote20_G", semitoneIndex: 20},      //
   {actionId: "KeyboardNote21_Gsharp", semitoneIndex: 21}, ////
   {actionId: "KeyboardNote22_A", semitoneIndex: 22},      //
   {actionId: "KeyboardNote23_Asharp", semitoneIndex: 23}, ////
   {actionId: "KeyboardNote24_B", semitoneIndex: 24},      //
   {actionId: "KeyboardNote25_C", semitoneIndex: 25},      //
];

export class KeyboardActionNoteInput implements NoteInputSource {
   private noteOnListeners = new Set<(evt: NoteEvent) => void>();
   private noteOffListeners = new Set<(evt: NoteEvent) => void>();

   private enabled = true;
   private initialized = false;

   private activeNotesByAction = new Map<GlobalActionId, number>();
   private disposers: Array<() => void> = [];

   private getOctave: () => number;
   private sourceId: string;
   private noteActions: KeyboardNoteActionMapEntry[];

   constructor(opts: {
      shortcutMgr: ActionHandlerRegistration<GlobalActionId>; getOctave: () => number;
      shouldIgnoreKeyDown?: () => boolean;
   }) {
      this.getOctave = opts.getOctave;
      this.sourceId = "keyboard";
      this.noteActions = kDefaultKeyboardNoteActionMap;

      // We store the mgr as closures via registerHandler in init(), so the class stays framework-agnostic.
      this._registerHandler = opts.shortcutMgr.registerHandler;
   }

   private _registerHandler: ActionHandlerRegistration<GlobalActionId>["registerHandler"];

   init(): void {
      if (this.initialized)
         return;

      this.disposers = this.noteActions.map(({actionId, semitoneIndex}) => {
         return this._registerHandler(actionId, (ctx) => this.handleActionEvent(actionId, semitoneIndex, ctx));
      });

      this.initialized = true;
   }

   dispose(): void {
      if (!this.initialized)
         return;

      this.setEnabled(false);
      this.disposers.forEach((fn) => fn());
      this.disposers = [];
      this.initialized = false;
   }

   setEnabled(enabled: boolean): void {
      if (this.enabled === enabled)
         return;

      this.enabled = enabled;
      if (!this.enabled) {
         for (const note of this.activeNotesByAction.values()) {
            this.emitNoteOff(note);
         }
         this.activeNotesByAction.clear();
      }
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

   private emitNoteOn(note: number): void {
      const payload: NoteEvent = {note, velocity: 127, channel: 0, deviceId: this.sourceId};
      this.noteOnListeners.forEach((cb) => cb(payload));
   }

   private emitNoteOff(note: number): void {
      const payload: NoteEvent = {note, velocity: 0, channel: 0, deviceId: this.sourceId};
      this.noteOffListeners.forEach((cb) => cb(payload));
   }

   private handleActionEvent(actionId: GlobalActionId, semitoneIndex: number, ctx: ShortcutContext): void {
      if (!this.enabled)
         return;

      if (ctx.eventType === "keydown") {
         if (this.activeNotesByAction.has(actionId))
            return;

         const octave = this.getOctave();
         const note = semitoneIndex + (octave - 1) * 12;
         this.activeNotesByAction.set(actionId, note);
         this.emitNoteOn(note);
         return;
      }

      // keyup
      const note = this.activeNotesByAction.get(actionId);
      if (note == null)
         return;

      this.activeNotesByAction.delete(actionId);
      this.emitNoteOff(note);
   }
}
