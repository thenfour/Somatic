declare module 'file-dialog' {
    type FileDialogOptions = {
        accept?: string;
        multiple?: boolean;
    };
    const fileDialog: (options?: FileDialogOptions) => Promise<FileList | File[]>;
    export default fileDialog;
}

declare module 'save-file' {
    export function saveSync(data: BlobPart | string, filename?: string): void;
    export function save(data: BlobPart | string, filename?: string): Promise<void>;
}
