import { SetStateAction } from "react";
import { LoopMode, SomaticTransportState } from "../audio/backend";
import { GlobalActionId } from "../keyb/ActionIds";
import { useShortcutManager } from "../keyb/KeyboardShortcutManager";
import { EditorState } from "../models/editor_state";
import { Song } from "../models/song";
import { calculateSongPositionInSeconds, Tic80Caps } from "../models/tic80Capabilities";
import { CharMap } from "../utils/utils";
import { Tooltip } from "./basic/tooltip";
import { Dropdown } from "./basic/Dropdown";
import { TransportTime } from "./transportTime";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { Button } from "./Buttons/PushButton";

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
    }>) => void
    somaticTransportState: SomaticTransportState;
};

// in order of cycle
const LOOP_MODE_OPTIONS: { value: LoopMode; label: string }[] = [
    { value: "off", label: "Off" },
    { value: "song", label: "Song" },
    { value: "selectionInSongOrder", label: "Selection in Song Order" },
    { value: "pattern", label: "Pattern" },
    { value: "halfPattern", label: "1/2 pattern" },
    { value: "quarterPattern", label: "1/4 pattern" },
    { value: "selectionInPattern", label: "Selection in Pattern" },
];

export const TransportControls: React.FC<TransportControlsProps> = ({ bridgeReady, //
    onPanic, onPlayAll, onPlayPattern, //
    onPlayFromPosition, editorState, updateEditorState, setLoopState, song, somaticTransportState }
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

    const currentAbsRow = song.rowsPerPattern * editorState.activeSongPosition + editorState.patternEditRow;
    const cursorPositionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentAbsRow,
    });

    const currentAbsPlayheadRow = song.rowsPerPattern * (somaticTransportState.currentSomaticSongPosition || 0) + (somaticTransportState.currentSomaticRowIndex || 0);
    const playheadPositionSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: currentAbsPlayheadRow,
    });

    const totalSongSeconds = calculateSongPositionInSeconds({
        songTempo: song.tempo,
        songSpeed: song.speed,
        rowIndex: song.songOrder.length * song.rowsPerPattern,
    });


    return <div className={`menu-transport ${bridgeReady ? 'menu-transport--ready' : 'menu-transport--not-ready'}`}>
        <ButtonGroup>
            <Tooltip title={mgr.getActionBindingLabel("Panic")}>
                <Button className={undefined/*'active'*/} onClick={onPanic}>
                    <span className="icon">⏹</span>
                    <span className="caption">Stop</span>
                </Button>
            </Tooltip>
            <Tooltip title={mgr.getActionBindingLabel("PlaySong")}>
                <Button className={undefined/*transportState === 'play-all' ? 'active' : undefined*/} onClick={onPlayAll} title={mgr.getActionBindingLabel("PlaySong")}>
                    <span className="icon" aria-hidden="true">
                        {CharMap.RightTriangle}
                    </span>
                    Song
                </Button>
            </Tooltip>
            <Tooltip title={mgr.getActionBindingLabel("PlayPattern")}>
                <Button className={undefined/*transportState === 'play-pattern' ? 'active' : undefined*/} onClick={onPlayPattern} title={mgr.getActionBindingLabel("PlayPattern")}>
                    <span className="icon" aria-hidden="true">
                        {CharMap.RightTriangleOutlined}
                    </span>
                    Pat
                </Button>
            </Tooltip>
            <Tooltip title={mgr.getActionBindingLabel("PlayFromPosition")}>
                <Button className={undefined/*transportState === 'play-from-position' ? 'active' : undefined*/} onClick={onPlayFromPosition} title={mgr.getActionBindingLabel("PlayFromPosition")}>
                    <span className="icon" aria-hidden="true">
                        {CharMap.RightTriangleOutlined}
                    </span>
                    Pos
                </Button>
            </Tooltip>
            <Tooltip title={(<div>
                <div>Current position of {somaticTransportState.isPlaying ? "playhead" : "cursor"}.</div>
                <div>Total song length: <TransportTime positionSeconds={totalSongSeconds} /></div>
                <div>TIC-80 frames (i think something's borked in the calc): {Math.floor((somaticTransportState.isPlaying ? playheadPositionSeconds : cursorPositionSeconds) * Tic80Caps.frameRate)}</div>
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
                    <Button
                        type="button"
                        className={editorState.loopMode !== "off" ? "button-toggle button-toggle--on" : "button-toggle button-toggle--off"}
                        onClick={handleToggleLoop}
                    >
                        {CharMap.Refresh}
                    </Button>
                </Tooltip>
                <Dropdown<LoopMode>
                    triggerClassName={`loop-mode-select ${editorState.loopMode !== "off" ? "loop-mode-select--on" : "loop-mode-select--off"}`}
                    value={editorState.loopMode === "off" ? editorState.lastNonOffLoopMode : editorState.loopMode}
                    onChange={(next) => setLoopMode(next)}
                    options={LOOP_MODE_OPTIONS.filter(opt => opt.value !== "off")}
                    showCheckmark={false}
                />
            </ButtonGroup>
        </div>

    </div>
};