import {SetStateAction} from "react";
import {LoopMode, SomaticTransportState} from "../audio/backend";
import {GlobalActionId} from "../keyb/ActionIds";
import {useShortcutManager} from "../keyb/KeyboardShortcutManager";
import {EditorState} from "../models/editor_state";
import {Song} from "../models/song";
import {CharMap} from "../utils/utils";
import {Tooltip} from "./basic/tooltip";
import {ButtonGroup} from "./Buttons/ButtonGroup";
import {Button} from "./Buttons/PushButton";
import {RadioButton} from "./Buttons/RadioButton";
import {TransportTime} from "./transportTime";
import {Divider} from "./basic/Divider";

interface TransportControlsProps {
   song: Song;
   bridgeReady: boolean;
   onPanic: () => void;
   onPlayAll: () => void;
   onPlayPattern: () => void;
   onPlayFromPosition: () => void;
   editorState: EditorState;
   updateEditorState: (updater: (state: EditorState) => void) => void;
   setLoopState: (value: SetStateAction<{
      loopMode: LoopMode;
      lastNonOffLoopMode: LoopMode;
   }>) => void;
   somaticTransportState: SomaticTransportState;
};

// in order of cycle
const LOOP_MODE_OPTIONS: {value: LoopMode; label: string; buttonLabel: React.ReactNode; actionId: GlobalActionId;}[] = [
   {value: "off", label: "Loop off", buttonLabel: "Off", actionId: "SetLoopOff"},
   {value: "song", label: "Loop entire song", buttonLabel: "Song", actionId: "SetLoopSong"},
   {
      value: "selectionInSongOrder",
      label: "Loop selection in song order / arrangement",
      buttonLabel: "Orders",
      actionId: "SetLoopSelectionInSongOrder",
   },
   {value: "pattern", label: "Loop current pattern", buttonLabel: "1pat", actionId: "SetLoopPattern"},
   {
      value: "halfPattern",
      label: "Loop half pattern at cursor",
      buttonLabel: `${CharMap.Half}pat`,
      actionId: "SetLoopHalfPattern",
   },
   {
      value: "quarterPattern",
      label: "Loop quarter pattern at cursor",
      buttonLabel: `${CharMap.Quarter}pat`,
      actionId: "SetLoopQuarterPattern",
   },
   {
      value: "selectionInPattern",
      label: "Loop pattern row selection",
      buttonLabel: "RowSel",
      actionId: "SetLoopSelectionInPattern",
   },
];

export const TransportControls: React.FC<TransportControlsProps> = ({bridgeReady, //
   onPanic, onPlayAll, onPlayPattern, //
   onPlayFromPosition, editorState, updateEditorState, setLoopState, song, somaticTransportState}
) => {
   const mgr = useShortcutManager<GlobalActionId>();



   const setLoopMode = (mode: LoopMode) => {
      updateEditorState((s) => s.setLoopMode(mode));
      setLoopState((prev) => ({
         loopMode: mode,
         lastNonOffLoopMode: mode !== "off" ? mode : prev.lastNonOffLoopMode,
      }));
   };

   const handleNextLoopMode = () => {
      const current = editorState.loopMode;
      const idx = LOOP_MODE_OPTIONS.findIndex(option => option.value === current);
      const nextIdx = (idx + 1) % LOOP_MODE_OPTIONS.length;
      setLoopMode(LOOP_MODE_OPTIONS[nextIdx].value);
   };

   const handlePreviousLoopMode = () => {
      const current = editorState.loopMode;
      const idx = LOOP_MODE_OPTIONS.findIndex(option => option.value === current);
      const prevIdx = (idx - 1 + LOOP_MODE_OPTIONS.length) % LOOP_MODE_OPTIONS.length;
      setLoopMode(LOOP_MODE_OPTIONS[prevIdx].value);
   };

   const handleToggleLoop = () => {
      const current = editorState.loopMode;
      if (current === "off") {
         setLoopMode(editorState.lastNonOffLoopMode);
      } else {
         setLoopMode("off");
      }
   };

   mgr.useActionHandler("SetLoopOff", () => setLoopMode("off"));
   mgr.useActionHandler("SetLoopSong", () => setLoopMode("song"));
   mgr.useActionHandler("SetLoopSelectionInSongOrder", () => setLoopMode("selectionInSongOrder"));
   mgr.useActionHandler("SetLoopSelectionInPattern", () => setLoopMode("selectionInPattern"));
   mgr.useActionHandler("SetLoopPattern", () => setLoopMode("pattern"));
   mgr.useActionHandler("SetLoopHalfPattern", () => setLoopMode("halfPattern"));
   mgr.useActionHandler("SetLoopQuarterPattern", () => setLoopMode("quarterPattern"));
   mgr.useActionHandler("NextLoopMode", handleNextLoopMode);
   mgr.useActionHandler("PreviousLoopMode", handlePreviousLoopMode);
   mgr.useActionHandler("ToggleLoopModeOff", handleToggleLoop);

   const currentAbsRow = song.getAbsRowAtSongPosition(editorState.activeSongPosition, editorState.patternEditRow);
   const cursorPositionSeconds = song.subsystem.calculateSongPositionInSeconds({
      songTempo: song.tempo,
      songSpeed: song.speed,
      rowIndex: currentAbsRow,
   });

   const currentAbsPlayheadRow = song.getAbsRowAtSongPosition(
      somaticTransportState.currentSomaticSongPosition || 0,
      somaticTransportState.currentSomaticRowIndex || 0,
   );
   const playheadPositionSeconds = song.subsystem.calculateSongPositionInSeconds({
      songTempo: song.tempo,
      songSpeed: song.speed,
      rowIndex: currentAbsPlayheadRow,
   });

   const totalSongSeconds = song.subsystem.calculateSongPositionInSeconds({
      songTempo: song.tempo,
      songSpeed: song.speed,
      rowIndex: song.getSongLengthRows(),
   });
   const loopModeEnabled = editorState.loopMode !== "off";
   const displayedLoopMode = !loopModeEnabled
      ? editorState.lastNonOffLoopMode
      : editorState.loopMode;


   return <div className={`menu-transport ${bridgeReady ? 'menu-transport--ready' : 'menu-transport--not-ready'}`}>
      <ButtonGroup>
         <Tooltip title={`Stop all sound ${mgr.getActionBindingLabelAsTooltipSuffix("Panic")}`}>
            <Button className={undefined/*'active'*/} onClick={onPanic}>
               <span className="icon">⏹</span>
               <span className="caption">Stop</span>
            </Button>
         </Tooltip>
         <Tooltip title={`Play song ${mgr.getActionBindingLabelAsTooltipSuffix("PlaySong")}`}>
            <Button className={undefined/*transportState === 'play-all' ? 'active' : undefined*/} onClick={onPlayAll}>
               <span className="icon" aria-hidden="true">
                  {CharMap.RightTriangle}
               </span>
               Song
            </Button>
         </Tooltip>
         <Tooltip title={`Play pattern ${mgr.getActionBindingLabelAsTooltipSuffix("PlayPattern")}`}>
            <Button className={undefined/*transportState === 'play-pattern' ? 'active' : undefined*/} onClick={onPlayPattern}>
               <span className="icon" aria-hidden="true">
                  {CharMap.RightTriangleOutlined}
               </span>
               Pat
            </Button>
         </Tooltip>
         <Tooltip title={`Play from position ${mgr.getActionBindingLabelAsTooltipSuffix("PlayFromPosition")}`}>
            <Button className={undefined/*transportState === 'play-from-position' ? 'active' : undefined*/} onClick={onPlayFromPosition}>
               <span className="icon" aria-hidden="true">
                  {CharMap.RightTriangleOutlined}
               </span>
               Pos
            </Button>
         </Tooltip>
         <Tooltip title={(<div>
            <div>Current position of {somaticTransportState.isPlaying ? "playhead" : "cursor"}.</div>
            <div>Total song length: <TransportTime positionSeconds={totalSongSeconds} /></div>
         </div>)}
         >
            <div>
               <TransportTime className="main-transport-time" positionSeconds={somaticTransportState.isPlaying ? playheadPositionSeconds : cursorPositionSeconds} />
            </div>
         </Tooltip>
      </ButtonGroup>
      <div className="loop-controls">
         <ButtonGroup>
            <Tooltip title={`Toggle loop mode (${mgr.getActionBindingLabel("ToggleLoopModeOff")})`}>
               <RadioButton
                  type="button"
                  selected={loopModeEnabled}
                  onClick={handleToggleLoop}
               >
                  {CharMap.Refresh}
               </RadioButton>
            </Tooltip>
            <Divider />
            {LOOP_MODE_OPTIONS.filter((option) => option.value !== "off").map((option) => (
               <Tooltip
                  key={option.value}
                  title={`${option.label}${mgr.getActionBindingLabelAsTooltipSuffix(option.actionId)}`}
               >
                  <RadioButton
                     type="button"
                     role="radio"
                     disabled={!loopModeEnabled}
                     selected={displayedLoopMode === option.value}
                     aria-checked={displayedLoopMode === option.value}
                     aria-label={option.label}
                     onClick={() => setLoopMode(option.value)}
                  >
                     {option.buttonLabel}
                  </RadioButton>
               </Tooltip>
            ))}
         </ButtonGroup>
      </div>

   </div>;
};
