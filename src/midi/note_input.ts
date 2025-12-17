export type NoteEvent = {
   note: number; velocity: number; channel: number; deviceId: string;
};

export interface NoteInputSource {
   init(): Promise<void>|void;
   onNoteOn(cb: (evt: NoteEvent) => void): () => void;
   onNoteOff(cb: (evt: NoteEvent) => void): () => void;
   setEnabled(enabled: boolean): void;
   isEnabled(): boolean;
}
