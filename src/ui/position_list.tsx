// import React, { useEffect, useRef, useState } from 'react';
// import { AudioController } from '../audio/controller';
// import { EditorState } from '../models/editor_state';
// import { Song } from '../models/song';

// type PositionListProps = {
//     song: Song;
//     editorState: EditorState;
//     onSongChange: (mutator: (song: Song) => void) => void;
//     onEditorStateChange: (mutator: (state: EditorState) => void) => void;
//     audio: AudioController;
// };

// export const PositionList: React.FC<PositionListProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
//     const containerRef = useRef<HTMLDivElement | null>(null);
//     const enteredNumber = useRef('');
//     const [playingPosition, setPlayingPosition] = useState<number | null>(null);

//     useEffect(() => {
//         if (!audio) return undefined;
//         const handlePosition = (pos: number) => setPlayingPosition(pos);
//         const handleStop = () => setPlayingPosition(null);
//         const offPos = audio.onPosition(handlePosition);
//         const offStop = audio.onStop(handleStop);
//         return () => {
//             offPos();
//             offStop();
//         };
//     }, [audio]);

//     const setSelectedPosition = (pos: number) => {
//         onEditorStateChange((state) => state.setSelectedPosition(pos));
//     };

//     const setPatternFromPosition = (posIndex: number) => {
//         const targetPattern = song.positions[posIndex];
//         onEditorStateChange((state) => state.setPattern(targetPattern));
//     };

//     const setPositionValue = (index: number, value: number) => {
//         onSongChange((s) => s.setPosition(index, value));
//     };

//     const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
//         if (e.key === 'ArrowLeft' && index > 0) {
//             const el = containerRef.current?.children[index - 1] as HTMLElement | undefined;
//             el?.focus();
//             e.preventDefault();
//             return;
//         }
//         if (e.key === 'ArrowRight' && index < song.positions.length - 1) {
//             const el = containerRef.current?.children[index + 1] as HTMLElement | undefined;
//             el?.focus();
//             e.preventDefault();
//             return;
//         }
//         if (e.key >= '0' && e.key <= '9') {
//             enteredNumber.current += e.key;
//             const newValue = parseInt(enteredNumber.current, 10);
//             if (!Number.isNaN(newValue)) setPositionValue(index, newValue);
//             e.preventDefault();
//             return;
//         }
//         if (e.key === 'Backspace') {
//             enteredNumber.current = enteredNumber.current.slice(0, -1);
//             const newValue = parseInt(enteredNumber.current, 10);
//             setPositionValue(index, Number.isNaN(newValue) ? 0 : newValue);
//             e.preventDefault();
//         }
//     };

//     const onFocus = (index: number) => {
//         enteredNumber.current = '';
//         setSelectedPosition(index);
//     };

//     return (
//         <div className="position-list" ref={containerRef}>
//             {song.positions.map((pos, i) => {
//                 const disabled = i >= song.length;
//                 const isSelected = editorState.selectedPosition === i;
//                 const isPlaying = playingPosition === i;
//                 const classNames = [
//                     disabled ? 'disabled' : '',
//                     isSelected ? 'selected-position' : '',
//                     isPlaying ? 'playing-position' : '',
//                 ]
//                     .filter(Boolean)
//                     .join(' ');
//                 return (
//                     <button
//                         key={i}
//                         tabIndex={0}
//                         className={classNames}
//                         onKeyDown={(e) => onKeyDown(i, e)}
//                         onFocus={() => onFocus(i)}
//                         onDoubleClick={(e) => {
//                             e.preventDefault();
//                             setPatternFromPosition(i);
//                         }}
//                     >
//                         {pos}
//                     </button>
//                 );
//             })}
//         </div>
//     );
// };
