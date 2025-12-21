import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { IsNullOrWhitespace } from "../utils/utils";



interface AppStatusBarProps {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
};

export const AppStatusBar: React.FC<AppStatusBarProps> = ({ song, editorState, onSongChange, onEditorStateChange }) => {

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

    return (
        <div className="app-status-bar">
            <div className="app-status-bar-group">
                <div>
                    {IsNullOrWhitespace(statusMessage) ? <>&nbsp;</> : statusMessage}
                </div>
            </div>
        </div>);
};
