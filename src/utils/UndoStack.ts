import type {EditorState} from "../models/editor_state";
import type {SongDto} from "../models/song";

export type EditorStateSnapshot = ReturnType<EditorState["toData"]>;

export type UndoSnapshot = {
   song: SongDto; editor: EditorStateSnapshot;
};

export type UndoEntry = {
   snapshot: UndoSnapshot; description: string;
};

export class UndoStack {
   private readonly capacity: number;
   private past: UndoEntry[] = [];
   private future: UndoEntry[] = [];
   private recordingGuard = false;

   constructor(capacity = 200) {
      this.capacity = Math.max(1, capacity);
   }

   record(description: string, provider: () => UndoSnapshot) {
      if (this.recordingGuard)
         return;
      this.past.push({snapshot: provider(), description});
      if (this.past.length > this.capacity) {
         this.past.shift();
      }
      this.future = [];
      this.recordingGuard = true;
      const releaseGuard = () => {
         this.recordingGuard = false;
      };
      if (typeof queueMicrotask === "function") {
         queueMicrotask(releaseGuard);
      } else {
         Promise.resolve().then(releaseGuard);
      }
   }

   undo(currentProvider: () => UndoSnapshot): UndoEntry|null {
      const entry = this.past.pop();
      if (!entry)
         return null;
      const current = currentProvider();
      this.future.push({snapshot: current, description: entry.description});
      return entry;
   }

   redo(currentProvider: () => UndoSnapshot): UndoEntry|null {
      const entry = this.future.pop();
      if (!entry)
         return null;
      const current = currentProvider();
      this.past.push({snapshot: current, description: entry.description});
      return entry;
   }

   canUndo(): boolean {
      return this.past.length > 0;
   }

   canRedo(): boolean {
      return this.future.length > 0;
   }

   clear() {
      this.past = [];
      this.future = [];
      this.recordingGuard = false;
   }

   /** Peek at the next undo entry without modifying the stack. */
   peekUndo(): UndoEntry|null {
      if (!this.past.length)
         return null;
      return this.past[this.past.length - 1];
   }

   /** Peek at the next redo entry without modifying the stack. */
   peekRedo(): UndoEntry|null {
      if (!this.future.length)
         return null;
      return this.future[this.future.length - 1];
   }
}
