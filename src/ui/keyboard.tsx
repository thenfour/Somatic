import { useState } from "react";
import { AudioController } from "../audio/controller";
import { NOTE_INFOS } from "../defs";

const KEY_POSITIONS = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];

type KeyboardProps = {
    //instrument: Wave;
    //audio: AudioController;
    onNoteOn: (midiNoteValue: number) => void;
    onNoteOff: (midiNoteValue: number) => void;
};

export const Keyboard: React.FC<KeyboardProps> = ({ onNoteOn, onNoteOff }) => {

    // track active notes
    const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

    const keys = NOTE_INFOS.filter((info) => info.isAvailableInPattern).map((info) => {
        const isBlack = [1, 3, 6, 8, 10].includes(info.semitone);
        return {
            id: `${info.octave}-${info.semitone}`,
            noteName: info.name,
            midiNoteValue: info.midi,
            className: `key ${isBlack ? 'black' : 'white'} ${activeNotes.has(info.midi) ? 'active' : ''}`,
            left: ((info.octave - 1) * 7 + KEY_POSITIONS[info.semitone]) * 32,
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
    );
};
