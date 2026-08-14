import {mdiLaunch} from "@mdi/js";
import {useAppStatusBar} from "../hooks/useAppStatusBar";
import {EditorState} from "../models/editor_state";
import {formatPatternIndex, Song} from "../models/song";
import {kSomaticPatternCommand, kTic80EffectCommand} from "../models/tic80Capabilities";
import {kSubsystem} from "../subsystem/base/SubsystemBackendBase";
import {
   describeTic80Effect,
   formatTic80EffectInsight,
   type Tic80EffectInsight,
} from "../subsystem/tic80/tic80_effect_insight";
import {
   formatTic80Timing,
   TIC80_EFFECT_DURATION_MAX_TICKS,
   TIC80_EFFECT_TICK_RATE_HZ,
   tic80MeasureRowDuration,
} from "../utils/music/tic80Music";
import {clamp, formatToDecimalPlaces} from "../utils/utils";
import {Tooltip} from "./basic/tooltip";
import {IconButton} from "./Buttons/IconButton";
import {Tic80EffectInsightTooltip} from "./Tic80EffectInsightTooltip";


const LinkButton: React.FC<{href: string; children: React.ReactNode;}> = ({href, children}) => {
   const handleClick = () => {
      window.open(href, "_blank");
   };
   return (
      <IconButton onClick={handleClick} iconPath={mdiLaunch} >
         {children}
      </IconButton>
   );
};


// Column type descriptions
const COLUMN_DESCRIPTIONS: Record<string, React.ReactNode> = {
    note: 'Note',
    instrument: 'Instrument',
   volume: 'Channel volume gain (00=silent, FF=full; multiplied by instrument volume)',
   pan: 'Channel pan (00=left, 80=center, FF=right; overrides instrument pan)',
   command: <>Effect command <LinkButton href="https://github.com/nesbox/TIC-80/issues/261#issuecomment-566043505">TIC-80 effect reference</LinkButton></>,
   param: <>Effect param <LinkButton href="https://github.com/nesbox/TIC-80/issues/261#issuecomment-566043505">TIC-80 effect reference</LinkButton></>,
   somaticCommand: <>Somatic command <LinkButton href="https://github.com/thenfour/Somatic/wiki">Somatic effect reference</LinkButton></>,
   somaticParam: <>Somatic param <LinkButton href="https://github.com/thenfour/Somatic/wiki">Somatic effect reference</LinkButton></>,
   sideChannel: "side-channel data",
};

interface AppStatusBarProps {
    song: Song;
    editorState: EditorState;
    currentColumnType?: string;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    rightContent?: React.ReactNode;
};

type CommandDescription = {
    text: string;
   tic80EffectInsight?: Tic80EffectInsight;
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
   positionParts.push(editorState.patternEditColumnType === "sideChannel" ? "Ch:Sc" : `Ch:${channel}`);
    positionParts.push(`Row:${row.toString().padStart(2, '0')}`);

    // Column description
    const columnDesc = currentColumnType ? (COLUMN_DESCRIPTIONS[currentColumnType] || currentColumnType) : '';

   const selectionRowCount = editorState.patternSelection?.rowCount() ?? null;
   const selectionTiming = song.subsystemType === kSubsystem.key.TIC80 && selectionRowCount !== null && selectionRowCount > 0
      ? tic80MeasureRowDuration(selectionRowCount, {tempo: song.tempo, speed: song.speed})
      : null;
   const selectionEffectParamHex = selectionTiming?.effectParam === null || selectionTiming?.effectParam === undefined
      ? null
      : selectionTiming.effectParam.toString(16).toUpperCase().padStart(2, '0');

    // Command descriptions
    const commandDescParts: CommandDescription[] = [];

    if (editingCell) {
        // TIC-80 effect command
        if (kTic80EffectCommand.isValidKey(editingCell.tic80Effect)) {
            const noteContext = song.getChannelNoteContext(songPosition, channel, row);
            const tic80EffectInsight = describeTic80Effect(
               editingCell,
               noteContext,
               {tempo: song.tempo, speed: song.speed},
            );
            if (tic80EffectInsight) {
                commandDescParts.push({
                    text: formatTic80EffectInsight(tic80EffectInsight),
                   tic80EffectInsight,
                });
            }
        }

        // Somatic effect command
        const somaticEffectInfo = kSomaticPatternCommand.coerceByKey(editingCell.somaticEffect);
        if (!!somaticEffectInfo) {
            const paramStr = (editingCell.somaticParam ?? 0).toString(16).toUpperCase().padStart(2, '0');
            commandDescParts.push({
                text: `${somaticEffectInfo.patternChar}${paramStr}: ${somaticEffectInfo.description}`,
            });
        }
    }

    // Build the full status line
    const positionStr = positionParts.join(' | ');
    // If there's a temporary message from the hook, show that in a separate area
    const displayMessage = currentMessage || '';

    return (
        <div className="app-status-bar">
            <div className="app-status-bar-group app-status-bar-position">
                <span className="app-status-bar-label">{positionStr}</span>
                {columnDesc && <span className="app-status-bar-column">{columnDesc}</span>}
            </div>
          {selectionTiming && (
             <div className="app-status-bar-group app-status-bar-selection">
                <Tooltip
                   title={(
                      <div>
                         <div>
                            {formatToDecimalPlaces(selectionTiming.nominalEffectTicks, 2)} TIC-80 ticks at {TIC80_EFFECT_TICK_RATE_HZ} Hz.
                         </div>
                         {selectionEffectParamHex !== null ? (
                            <div>
                               {selectionTiming.approximate ? 'Nearest' : 'Matching'} effect durations: S{selectionEffectParamHex}.
                            </div>
                         ) : (
                            <div>
                               Longer than FF ({TIC80_EFFECT_DURATION_MAX_TICKS} ticks).
                            </div>
                         )}
                      </div>
                   )}
                >
                   <span className="app-status-bar-selection-measure" tabIndex={0}>
                      <span className="app-status-bar-selection-label">Selection:</span>{' '}
                      {/* {selectionTiming.rowCount} {selectionTiming.rowCount === 1 ? 'row' : 'rows'}
                      (
                        <span className="app-status-bar-selection-ticks">
                         {selectionTiming.nominalEffectTicks} ticks
                      </span>
                      <TransportTime positionSeconds={selectionTiming.seconds} />
                      ) */}
                      {formatTic80Timing(selectionTiming.nominalEffectTicks, {tempo: song.tempo, speed: song.speed})}
                   </span>
                </Tooltip>
             </div>
          )}
            <div className="app-status-bar-group app-status-bar-commands">
             {commandDescParts.map((part, index) => part.tic80EffectInsight ? (
                <Tic80EffectInsightTooltip
                   key={index}
                   source={{kind: "precomputed", insight: part.tic80EffectInsight}}
                >
                   <span tabIndex={0}>
                      {index > 0 ? ", " : ""}{part.text}
                   </span>
                </Tic80EffectInsightTooltip>
             ) : (
                <span key={index}>
                        {index > 0 ? ", " : ""}{part.text}
                    </span>
                ))}
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
