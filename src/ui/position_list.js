import React, { useEffect, useRef, useState } from "react";

export const PositionList = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const containerRef = useRef(null);
    const enteredNumber = useRef("");
    const [playingPosition, setPlayingPosition] = useState(null);

    useEffect(() => {
        if (!audio) return undefined;
        const handlePosition = (pos) => setPlayingPosition(pos);
        const handleStop = () => setPlayingPosition(null);
        audio.on("position", handlePosition);
        audio.on("stop", handleStop);
        return () => {
            audio.removeListener("position", handlePosition);
            audio.removeListener("stop", handleStop);
        };
    }, [audio]);

    const setSelectedPosition = (pos) => {
        onEditorStateChange((state) => state.setSelectedPosition(pos));
    };

    const setPatternFromPosition = (posIndex) => {
        const targetPattern = song.positions[posIndex];
        onEditorStateChange((state) => state.setPattern(targetPattern));
    };

    const setPositionValue = (index, value) => {
        onSongChange((s) => s.setPosition(index, value));
    };

    const onKeyDown = (index, e) => {
        if (e.key === "ArrowLeft" && index > 0) {
            containerRef.current?.children[index - 1]?.focus();
            e.preventDefault();
            return;
        }
        if (e.key === "ArrowRight" && index < song.positions.length - 1) {
            containerRef.current?.children[index + 1]?.focus();
            e.preventDefault();
            return;
        }
        if (e.key >= "0" && e.key <= "9") {
            enteredNumber.current += e.key;
            const newValue = parseInt(enteredNumber.current, 10);
            if (!Number.isNaN(newValue)) setPositionValue(index, newValue);
            e.preventDefault();
            return;
        }
        if (e.key === "Backspace") {
            enteredNumber.current = enteredNumber.current.slice(0, -1);
            const newValue = parseInt(enteredNumber.current, 10);
            setPositionValue(index, Number.isNaN(newValue) ? 0 : newValue);
            e.preventDefault();
        }
    };

    const onFocus = (index) => {
        enteredNumber.current = "";
        setSelectedPosition(index);
    };

    return (
        <div className="position-list" ref={containerRef}>
            {song.positions.map((pos, i) => {
                const disabled = i >= song.length;
                const isSelected = editorState.selectedPosition === i;
                const isPlaying = playingPosition === i;
                const classNames = [
                    disabled ? "disabled" : "",
                    isSelected ? "selected-position" : "",
                    isPlaying ? "playing-position" : "",
                ]
                    .filter(Boolean)
                    .join(" ");
                return (
                    <button
                        key={i}
                        tabIndex={0}
                        className={classNames}
                        onKeyDown={(e) => onKeyDown(i, e)}
                        onFocus={() => onFocus(i)}
                        onDoubleClick={(e) => {
                            e.preventDefault();
                            setPatternFromPosition(i);
                        }}
                    >
                        {pos}
                    </button>
                );
            })}
        </div>
    );
};
