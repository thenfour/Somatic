import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";


export const ArrangementEditor: React.FC<{
    song: Song;
    editorState: EditorState;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    onSongChange: (mutator: (song: Song) => void) => void;
}> = ({ song, editorState, onEditorStateChange, onSongChange }) => {
    return (<div className="arrangement-editor">
        {/*
        
        Arrangement editor implementation goes here.
        it's a narrow vertical list that defines the song order.

        each row has:
        [delete] [position id] [dec pattern index] [pattern index] [inc pattern index]

        at the bottom, a button to add a new position (which appends a new position with the last used pattern index)

        rough example:
        🗑️ 00 ‹ 02 ›
        🗑️ 01 ‹ 02 ›
        🗑️ 02 ‹ 03 ›
        +


        * dec/inc buttons change the pattern index for that position in the song order. ask the song to make sure the pattern exists.
        * delete button removes that position from the song order (closing the gap). it does not delete the pattern itself.

        */}
    </div>);
};