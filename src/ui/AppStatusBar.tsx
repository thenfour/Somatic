import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { IsNullOrWhitespace } from "../utils/utils";
import { useAppStatusBar } from "../hooks/useAppStatusBar";



interface AppStatusBarProps {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
};

export const AppStatusBar: React.FC<AppStatusBarProps> = ({ song, editorState, onSongChange, onEditorStateChange }) => {
    const { currentMessage } = useAppStatusBar();

    const editingCell = editorState.getEditingCell(song);
    if (!editingCell) {
        return null;
    }
    //console.log("AppStatusBar editingCell:", editingCell);
    let statusMessage = "No cell selected";

    if (!!editingCell.instrumentIndex) {
        const instrument = song.instruments[editingCell.instrumentIndex];
        statusMessage = `${editingCell.instrumentIndex}: ${instrument.name}`;
    }

    // If there's a temporary message from the hook, show that instead
    const displayMessage = currentMessage || statusMessage;

    return (
        <div className="app-status-bar">
            <div className="app-status-bar-group">
                <div>
                    {IsNullOrWhitespace(displayMessage) ? <>&nbsp;</> : displayMessage}
                </div>
            </div>
        </div>);
};
