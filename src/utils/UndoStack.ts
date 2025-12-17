import type { EditorState } from '../models/editor_state';
import type { SongDto } from '../models/song';

export type EditorStateSnapshot = ReturnType<EditorState['toData']>;

export type UndoSnapshot = {
    song: SongDto;
    editor: EditorStateSnapshot;
};

export class UndoStack {
    private readonly capacity: number;
    private past: UndoSnapshot[] = [];
    private future: UndoSnapshot[] = [];
    private recordingGuard = false;

    constructor(capacity = 200) {
        this.capacity = Math.max(1, capacity);
    }

    record(provider: () => UndoSnapshot) {
        if (this.recordingGuard) return;
        this.past.push(provider());
        if (this.past.length > this.capacity) {
            this.past.shift();
        }
        this.future = [];
        this.recordingGuard = true;
        const releaseGuard = () => {
            this.recordingGuard = false;
        };
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(releaseGuard);
        } else {
            Promise.resolve().then(releaseGuard);
        }
    }

    undo(currentProvider: () => UndoSnapshot): UndoSnapshot | null {
        const snapshot = this.past.pop();
        if (!snapshot) return null;
        this.future.push(currentProvider());
        return snapshot;
    }

    redo(currentProvider: () => UndoSnapshot): UndoSnapshot | null {
        const snapshot = this.future.pop();
        if (!snapshot) return null;
        this.past.push(currentProvider());
        return snapshot;
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
}
