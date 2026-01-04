import { AudioController } from "../audio/controller";
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { AppPanelShell } from "./AppPanelShell"
import { SongEditor } from "./song_editor";


interface SongSettingsPanelProps {
    song: Song;
    editorState: EditorState;
    audio: AudioController;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (updater: (state: EditorState) => void) => void;
    onClose: () => void;
};

export const SongSettingsPanel: React.FC<SongSettingsPanelProps> = ({ song, editorState, audio, onSongChange, onEditorStateChange, onClose }) => {
    return <AppPanelShell
        title="Song Settings"
        onClose={onClose}
    >
        <SongEditor
            song={song}
            audio={audio}
            editorState={editorState}
            onSongChange={onSongChange}
            onEditorStateChange={onEditorStateChange}
        />
    </AppPanelShell>
};
