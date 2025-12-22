declare module "file-dialog" {
   type FileDialogOptions = { accept?: string; multiple?: boolean; };
   const fileDialog: (options?: FileDialogOptions) => Promise<FileList|File[]>;
   export default fileDialog;
}

declare module "save-file" {
   export function saveSync(data: BlobPart|string, filename?: string): void;
   export function save(data: BlobPart|string, filename?: string): Promise<void>;
}

// Minimal Web MIDI ambient types
interface MIDIInput {
   id: string;
   name?: string;
   manufacturer?: string;
   state: string;
   onmidimessage: ((ev: MIDIMessageEvent) => void)|null;
}

interface WebMidi {
   inputs: Map<string, MIDIInput>;
   onstatechange: ((ev: Event) => void)|null;
}

interface Navigator {
   requestMIDIAccess?: (opts?: {sysex?: boolean}) => Promise<WebMidi>;
}

interface MIDIMessageEvent extends Event {
   data: Uint8Array;
}

declare module "*.lua" {
   const content: string;
   export default content;
}

declare module "*.jsonc" {
   const value: any;
   export default value;
}
