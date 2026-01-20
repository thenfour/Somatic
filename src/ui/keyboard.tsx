import { mdiWindowClose } from "@mdi/js";
import { useMemo, useState } from "react";
import { GlobalActionId, GlobalActions } from "../keyb/ActionIds";
import { useShortcutManager } from "../keyb/KeyboardShortcutManager";
import { NoteRegistry } from "../utils/music/noteRegistry";
import { IconButton } from "./Buttons/IconButton";
import { Tooltip } from "./basic/tooltip";
import './keyboard.css';

const KEY_POSITIONS = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

type KeyboardProps = {
    //instrument: Wave;
    //audio: AudioController;
    onNoteOn: (midiNoteValue: number) => void;
    onNoteOff: (midiNoteValue: number) => void;
    onClose?: () => void;
};

export const Keyboard: React.FC<KeyboardProps> = ({ onNoteOn, onNoteOff, onClose }) => {
    const mgr = useShortcutManager<GlobalActionId>();
    const closeTooltip = useMemo(() => {
        const actionSuffix = mgr.getActionBindingLabelAsTooltipSuffix(GlobalActions.ToggleOnScreenKeyboard);
        return `Hide on-screen keyboard ${actionSuffix}`;
    }, [mgr]);

    // track active notes
    const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

    const keys = NoteRegistry.all.filter((info) => info.tic.isPatternEncodable).map((info) => {
        const semitone = info.pitchClass.value;
        const isBlack = [1, 3, 6, 8, 10].includes(semitone);
        return {
            id: `${info.octave}-${semitone}`,
            noteName: info.labelFixedWidth,
            midiNoteValue: info.midi,
            className: `key ${isBlack ? 'black' : 'white'} ${activeNotes.has(info.midi) ? 'active' : ''}`,
            left: ((info.octave - 1) * 7 + KEY_POSITIONS[semitone]) * 32,
        };
    });

    const handleNoteOn = (midi: number) => {
        // avoid retriggering if already active
        if (activeNotes.has(midi)) return;
        setActiveNotes((prev) => new Set(prev).add(midi));
        onNoteOn(midi);
    };

    const handleNoteOff = (midi: number) => {
        // avoid triggering if not active
        if (!activeNotes.has(midi)) return;
        setActiveNotes((prev) => {
            const next = new Set(prev);
            next.delete(midi);
            return next;
        });
        onNoteOff(midi);
    };

    return (
        <div className="on-screen-keyboard">
            {onClose && (
                <div className="on-screen-keyboard__close">
                    <Tooltip title={closeTooltip}>
                        <IconButton onClick={onClose} iconPath={mdiWindowClose} />
                    </Tooltip>
                </div>
            )}
            <ul id="keyboard">
                {keys.map((key) => (
                    <button
                        key={key.id}
                        className={key.className}
                        style={{ left: `${key.left}px` }}
                        onMouseDown={() => handleNoteOn(key.midiNoteValue)}
                        onMouseUp={() => handleNoteOff(key.midiNoteValue)}
                        onMouseLeave={() => handleNoteOff(key.midiNoteValue)}
                    >
                        {key.noteName}
                    </button>
                ))}
            </ul>
        </div>
    );
};
