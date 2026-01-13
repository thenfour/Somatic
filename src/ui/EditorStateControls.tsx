import React from 'react';
import { AudioController } from '../audio/controller';
//import { INSTRUMENT_COUNT, OCTAVE_COUNT, PATTERN_COUNT } from '../defs';
import { EditorState } from '../models/editor_state';
import { Song } from '../models/song';
//import { PositionList } from './position_list';
import { GlobalActionId } from '../keyb/ActionIds';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { Tic80Caps } from '../models/tic80Capabilities';
import { CharMap } from '../utils/utils';
import { Dropdown } from './basic/Dropdown';
import { IntegerUpDown } from './basic/NumericUpDown';
import { Tooltip } from './basic/tooltip';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { IconButton } from './Buttons/IconButton';
import { InstrumentChip } from './InstrumentChip';

type EditorStateControlsProps = {
    song: Song;
    editorState: EditorState;
    onSongChange: (args: { mutator: (song: Song) => void; description: string; undoable: boolean }) => void;
    onEditorStateChange: (mutator: (state: EditorState) => void) => void;
    audio: AudioController;
};

export const EditorStateControls: React.FC<EditorStateControlsProps> = ({ song, editorState, onSongChange, onEditorStateChange, audio }) => {
    const mgr = useShortcutManager();

    const onOctaveChange = (val: number) => {
        onEditorStateChange((state) => state.setOctave(val));
    };

    const onHighlightRowCountChange = (val: number) => {
        //const val = TryParseInt(e.target.value);
        //if (val === null) return;
        onSongChange({ description: 'Set highlight row count', undoable: true, mutator: (s) => s.setHighlightRowCount(val) });
    };

    const onEditStepChange = (val: number) => {
        onSongChange({ description: 'Set edit step', undoable: true, mutator: (s) => s.setPatternEditStep(val) });
    };

    const getActionBindingLabel = (actionId: GlobalActionId) => {
        return mgr.getActionBindingLabel(actionId) || "Unbound";
    };

    const bpm = song.subsystem.calculateBpm({ songTempo: song.tempo, songSpeed: song.speed, rowsPerBeat: 4 });

    const instrumentOptions = React.useMemo(() => {
        return Array.from({ length: Tic80Caps.sfx.count }, (_, i) => ({
            value: i,
            label: <InstrumentChip instrumentIndex={i} instrument={song.instruments[i]} showTooltip={false} width={300} />,
        }));
    }, [song.instruments]);

    return (
        <div className="editor-state-controls">
            <label>
                Highlight rows
                <IntegerUpDown
                    min={1}
                    max={64}
                    value={song.highlightRowCount}
                    onChange={onHighlightRowCountChange}
                />
            </label>
            <Tooltip title={`Number of rows the cursor moves after note input. ${getActionBindingLabel("IncreaseEditStep")} / ${getActionBindingLabel("DecreaseEditStep")} to adjust.`}>
                <label>
                    Edit step
                    <IntegerUpDown
                        min={0}
                        max={32}
                        value={song.patternEditStep}
                        onChange={onEditStepChange}
                    />
                </label>
            </Tooltip>
            <Tooltip title={`Current octave for note input. ${getActionBindingLabel("IncreaseOctave")} / ${getActionBindingLabel("DecreaseOctave")} to adjust.`}>
                <label>
                    Octave
                    <IntegerUpDown
                        min={1}
                        max={Tic80Caps.pattern.octaveCount/* -1 + 1 for 1-baseddisplay */}
                        value={editorState.octave}
                        onChange={onOctaveChange}
                    />
                </label>
            </Tooltip>
            <ButtonGroup>
                <label>Instrument
                    <Dropdown
                        value={editorState.currentInstrument}
                        showCaret={false}
                        onChange={(newInstr) => {
                            onEditorStateChange((state) => state.setCurrentInstrument(newInstr));
                        }}
                        options={instrumentOptions}
                    />
                </label>
                <Tooltip title={`Decrease instrument (${getActionBindingLabel("DecreaseInstrument")}).`}>
                    <IconButton
                        // style={{ display: "inline-block", margin: 0, padding: 0 }}
                        onClick={() => {
                            onEditorStateChange((state) => {
                                const newInstr = (state.currentInstrument - 1 + Tic80Caps.sfx.count) % Tic80Caps.sfx.count;
                                state.setCurrentInstrument(newInstr);
                            });
                        }}
                    >{CharMap.LeftTriangle}</IconButton>
                </Tooltip>
                <Tooltip title={`Increase instrument (${getActionBindingLabel("IncreaseInstrument")}).`}>
                    <IconButton
                        // style={{ display: "inline-block", margin: 0, padding: 0 }}
                        onClick={() => {
                            onEditorStateChange((state) => {
                                const newInstr = (state.currentInstrument + 1) % Tic80Caps.sfx.count;
                                state.setCurrentInstrument(newInstr);
                            });
                        }}
                    >{CharMap.RightTriangle}</IconButton>
                </Tooltip>
            </ButtonGroup>
            {/* <label>
                Song title
                <input
                    type="text"
                    className='song-title-input'
                    maxLength={SomaticCaps.maxSongTitleLength}
                    value={song.name}
                    onChange={(e) => onSongChange({
                        description: 'Set song title',
                        undoable: true,
                        mutator: (s) => {
                            s.name = e.target.value;
                        },
                    })}
                />
            </label> */}
        </div>
    );
};


