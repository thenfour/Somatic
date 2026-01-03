import React from "react";
import fileDialog from "file-dialog";

export const MorphSampleFileImportButton: React.FC<{
    disabled?: boolean;
    onFileSelected: (file: File) => Promise<void>;
}> = ({ disabled, onFileSelected }) => {
    const handleClick = async () => {
        const files = (await fileDialog({
            accept: "audio/*",
            multiple: false //
        })) as FileList | File[] | undefined;
        const fileArray = files ? Array.from(files as any) : [];
        const file = fileArray[0] as File | undefined;
        if (!file) return;
        await onFileSelected(file);
    };

    return (
        <button type="button" onClick={() => void handleClick()} disabled={disabled}>
            Import sample...
        </button>
    );
};
