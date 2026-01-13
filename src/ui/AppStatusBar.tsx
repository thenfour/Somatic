import { useAppStatusBar } from "../hooks/useAppStatusBar";
import { EditorState } from "../models/editor_state";
import { formatPatternIndex, Song } from "../models/song";
import { kSomaticPatternCommand, kTic80EffectCommand } from "../models/tic80Capabilities";
import { clamp } from "../utils/utils";


// Column type descriptions
const COLUMN_DESCRIPTIONS: Record<string, string> = {
    note: 'Note',
    instrument: 'Instrument',
    command: 'Effect command',
    param: 'Effect param',
    somaticCommand: 'Somatic command',
    somaticParam: 'Somatic param',
};

interface AppStatusBarProps {
    song: Song;
    editorState: EditorState;
    currentColumnType?: string;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    rightContent?: React.ReactNode;
};

export const AppStatusBar: React.FC<AppStatusBarProps> = ({ song, editorState, currentColumnType, onSongChange, onEditorStateChange, rightContent }) => {
    const { currentMessage } = useAppStatusBar();

    const editingCell = editorState.getEditingCell(song);

    // Build position context string
    const songPosition = clamp(editorState.activeSongPosition ?? 0, 0, song.songOrder.length - 1);
    const songOrderItem = song.songOrder[songPosition];
    const patternIndex = songOrderItem?.patternIndex ?? 0;
    const channel = editorState.patternEditChannel;
    const row = editorState.patternEditRow;

    // Position info
    const positionParts: string[] = [];
    positionParts.push(`Ord:${songPosition}`);
    positionParts.push(`Pat:${formatPatternIndex(patternIndex)}`);
    positionParts.push(`Ch:${channel}`);
    positionParts.push(`Row:${row.toString().padStart(2, '0')}`);

    // Column description
    const columnDesc = currentColumnType ? (COLUMN_DESCRIPTIONS[currentColumnType] || currentColumnType) : '';

    // Command descriptions
    const commandDescParts: string[] = [];

    if (editingCell) {
        // TIC-80 effect command
        const tic80EffectInfo = kTic80EffectCommand.coerceByKey(editingCell.tic80Effect);
        if (!!tic80EffectInfo) {
            const paramX = editingCell.tic80EffectX ?? 0;
            const paramY = editingCell.tic80EffectY ?? 0;
            const paramStr = `${paramX.toString(16).toUpperCase()}${paramY.toString(16).toUpperCase()}`;
            commandDescParts.push(`${tic80EffectInfo.patternChar}${paramStr}: ${tic80EffectInfo.description}`);
        }

        // Somatic effect command
        const somaticEffectInfo = kSomaticPatternCommand.coerceByKey(editingCell.somaticEffect);
        if (!!somaticEffectInfo) {
            const paramStr = (editingCell.somaticParam ?? 0).toString(16).toUpperCase().padStart(2, '0');
            commandDescParts.push(`${somaticEffectInfo.patternChar}${paramStr}: ${somaticEffectInfo.description}`);
        }
    }

    // Build the full status line
    const positionStr = positionParts.join(' | ');
    const commandStr = commandDescParts.length > 0 ? commandDescParts.join(', ') : '';

    // If there's a temporary message from the hook, show that in a separate area
    const displayMessage = currentMessage || '';

    return (
        <div className="app-status-bar">
            <div className="app-status-bar-group app-status-bar-position">
                <span className="app-status-bar-label">{positionStr}</span>
                {columnDesc && <span className="app-status-bar-column">{columnDesc}</span>}
            </div>
            <div className="app-status-bar-group app-status-bar-commands">
                <span>{commandStr}</span>
            </div>
            <div className="app-status-bar-group app-status-bar-message">
                <span>{displayMessage}</span>
            </div>
            {rightContent && (
                <div className="app-status-bar-group app-status-bar-right-content">
                    {rightContent}
                </div>
            )}
        </div>
    );
};
