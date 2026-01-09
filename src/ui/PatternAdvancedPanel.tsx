import React, { useId, useState } from 'react';
import { CharMap } from '../utils/utils';
import { Tooltip } from './basic/tooltip';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';
import { GlobalActionId } from '../keyb/ActionIds';
import { Dropdown } from './basic/Dropdown';
import { InstrumentChip } from './InstrumentChip';
import { Tic80Caps } from '../models/tic80Capabilities';
import { Song } from '../models/song';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { Button } from './Buttons/PushButton';
import { RadioButton } from './Buttons/RadioButton';
import { CheckboxButton } from './Buttons/CheckboxButton';
import { Divider } from './basic/Divider';

export type PatternAdvancedPanelProps = {
    enabled?: boolean;
    song: Song;
    onTranspose: (amount: number, scope: ScopeValue) => void;
    onSetInstrument: (instrument: number, scope: ScopeValue) => void;
    onChangeInstrument: (fromInstrument: number, toInstrument: number, scope: ScopeValue) => void;
    onNudgeInstrument: (amount: number, scope: ScopeValue) => void;
    onInterpolate: (target: InterpolateTarget, scope: ScopeValue) => void;

    onClearNotes: (scope: ScopeValue) => void;
    onClearInstrument: (scope: ScopeValue) => void;
    onClearEffect: (scope: ScopeValue) => void;
    onClearParamX: (scope: ScopeValue) => void;
    onClearParamY: (scope: ScopeValue) => void;
    onClearParamXY: (scope: ScopeValue) => void;
    onClearSomaticEffect: (scope: ScopeValue) => void;
    onClearSomaticParam: (scope: ScopeValue) => void;

    onClose: () => void;
};

const scopeOptions = [
    { value: 'selection', label: 'Selection' },
    { value: 'channel-pattern', label: 'Column in pattern' },
    { value: 'channel-song', label: 'Column in song' },
    { value: 'pattern', label: 'Whole pattern' },
    { value: 'song', label: 'Whole song' },
] as const;

export type ScopeValue = (typeof scopeOptions)[number]['value'];
const interpolateOptions = [
    { value: 'notes', label: 'Notes' },
    { value: 'paramX', label: 'X' },
    { value: 'paramY', label: 'Y' },
    { value: 'paramXY', label: 'XY' },
    { value: 'somaticParamXY', label: 'SXY' },
] as const;

export type InterpolateTarget = (typeof interpolateOptions)[number]['value'];

export const PatternAdvancedPanel: React.FC<PatternAdvancedPanelProps> = ({
    song,
    enabled = true,
    onTranspose,
    onSetInstrument,
    onChangeInstrument,
    onNudgeInstrument,
    onInterpolate,
    onClearNotes,
    onClearInstrument,
    onClearEffect,
    onClearParamX,
    onClearParamY,
    onClearParamXY,
    onClearSomaticEffect,
    onClearSomaticParam,
    onClose,
}) => {
    const scopeGroupId = useId();
    const keyboardShortcutMgr = useShortcutManager<GlobalActionId>();
    const [scope, setScope] = useState<ScopeValue>('selection');
    const [setInstrumentValue, setSetInstrumentValue] = useState<number>(2);
    const [changeInstrumentFrom, setChangeInstrumentFrom] = useState<number>(2);
    const [changeInstrumentTo, setChangeInstrumentTo] = useState<number>(3);
    const [interpolateTarget, setInterpolateTarget] = useState<InterpolateTarget>('notes');
    const mgr = useShortcutManager<GlobalActionId>();

    const advancedEditPanelKeyshortcut = mgr.getActionBindingLabel("ToggleAdvancedEditPanel") || "Unbound";

    const instrumentOptions = React.useMemo(() => {
        return Array.from({ length: Tic80Caps.sfx.count }, (_, i) => ({
            value: i,
            label: <InstrumentChip
                instrumentIndex={i}
                instrument={song.instruments[i]}
                showTooltip={false}
            //width={200}
            />,
        }));
    }, [song.instruments]);

    const handleInterpolateNotes = () => {
        onInterpolate('notes', scope);
    };

    const handleClearNotes = () => {
        onClearNotes(scope);
    };

    const handleClearInstrument = () => {
        onClearInstrument(scope);
    };

    const handleClearEffect = () => {
        onClearEffect(scope);
    };

    const handleClearX = () => {
        onClearParamX(scope);
    };
    const handleClearY = () => {
        onClearParamY(scope);
    };
    const handleClearXY = () => {
        onClearParamXY(scope);
    };

    const handleInterpolateX = () => {
        onInterpolate('paramX', scope);
    };

    const handleInterpolateY = () => {
        onInterpolate('paramY', scope);
    };
    const handleInterpolateXY = () => {
        onInterpolate('paramXY', scope);
    };

    const handleClearSFX = () => {
        onClearSomaticEffect(scope);
    };
    const handleClearSParam = () => {
        onClearSomaticParam(scope);
    };

    const handleInterpolateSParam = () => {
        onInterpolate('somaticParamXY', scope);
    };



    return (
        <aside
            id="pattern-advanced-panel"
            className={`pattern-advanced-panel`}
        >
            <header className="pattern-advanced-panel__header">Advanced Edit</header>
            <Tooltip title={`Close (${advancedEditPanelKeyshortcut})`}>
                <button
                    className='aside-toggle-button pattern-advanced-panel-close-button'
                    onClick={onClose}
                >
                    {CharMap.LeftTriangle}
                </button>
            </Tooltip>
            <div className="pattern-advanced-panel__body">
                <fieldset>
                    <legend>Apply to</legend>
                    <div className="pattern-advanced-panel__scope">
                        {scopeOptions.map((option) => (
                            <label key={option.value} className="pattern-advanced-panel__scopeOption">
                                <input
                                    type="radio"
                                    name={`${scopeGroupId}-scope`}
                                    value={option.value}
                                    checked={scope === option.value}
                                    onChange={() => setScope(option.value)}
                                />
                                <span>{option.label}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                <fieldset>
                    <legend>Notes</legend>
                    <section className="pattern-advanced-panel__section">
                        <ButtonGroup>
                            {[-12, -1, 1, 12].map((step) => {
                                const actionId: GlobalActionId =
                                    step === -12 ? "TransposeSelectionDownOctave" :
                                        step === -1 ? "TransposeSelectionDownSemitone" :
                                            step === 1 ? "TransposeSelectionUpSemitone" :
                                                "TransposeSelectionUpOctave";
                                const label = keyboardShortcutMgr.getActionBindingLabel(actionId);
                                const title = label ? `Shortcut: ${label}` : undefined;
                                return (
                                    <Tooltip key={step} title={title} disabled={!title}>
                                        <Button
                                            onClick={() => onTranspose(step, scope)}
                                            disabled={!enabled}
                                        >
                                            {step > 0 ? `+${step}` : step}
                                        </Button>
                                    </Tooltip>
                                );
                            })}
                        </ButtonGroup>
                        <ButtonGroup>
                            <Button onClick={handleInterpolateNotes}>Interpolate</Button>
                            <Button onClick={handleClearNotes}>Clear</Button>
                        </ButtonGroup>
                    </section>

                </fieldset>
                <fieldset>
                    <legend>Instrument</legend>
                    <section className="pattern-advanced-panel__section">
                        <div className="pattern-advanced-panel__inputRow div-row">
                            <Dropdown
                                value={setInstrumentValue}
                                onChange={(inst) => setSetInstrumentValue(inst)}
                                options={instrumentOptions}
                                showCaret={false}
                                triggerClassName="div-row-grow"
                                renderTriggerLabel={(opt) => {
                                    return <InstrumentChip
                                        instrumentIndex={opt?.value ?? 0}
                                        instrument={song.instruments[opt?.value ?? 0]}
                                        //showTooltip={false}
                                        width={120}
                                    />
                                }}
                            />
                            <Button
                                onClick={() => onSetInstrument(setInstrumentValue, scope)}
                                disabled={!enabled}
                                className="div-row-shrink"
                            >
                                Set
                            </Button>
                        </div>
                        <div className="pattern-advanced-panel__inputRow">
                            <Dropdown
                                value={changeInstrumentFrom}
                                onChange={(inst) => setChangeInstrumentFrom(inst)}
                                options={instrumentOptions}
                                showCaret={false}
                                renderTriggerLabel={(opt) => {
                                    return <InstrumentChip
                                        instrumentIndex={opt?.value ?? 0}
                                        instrument={song.instruments[opt?.value ?? 0]}
                                        //showTooltip={false}
                                        width={40}
                                    />
                                }}
                            />
                            <span className="pattern-advanced-panel__arrow">{CharMap.RightTriangle}</span>
                            <Dropdown
                                value={changeInstrumentTo}
                                onChange={(inst) => setChangeInstrumentTo(inst)}
                                options={instrumentOptions}
                                showCaret={false}
                                renderTriggerLabel={(opt) => {
                                    return <InstrumentChip
                                        instrumentIndex={opt?.value ?? 0}
                                        instrument={song.instruments[opt?.value ?? 0]}
                                        //showTooltip={false}
                                        width={40}
                                    />
                                }}
                            />
                            <Tooltip
                                title={`Change instrument from ${changeInstrumentFrom} to ${changeInstrumentTo}`}
                            >
                                <Button
                                    onClick={() => onChangeInstrument(changeInstrumentFrom, changeInstrumentTo, scope)}
                                    disabled={!enabled}
                                >
                                    Repl.
                                </Button>
                            </Tooltip>
                        </div>
                        <ButtonGroup>
                            <Tooltip
                                title={`Dec instrument (${keyboardShortcutMgr.getActionBindingLabel("DecrementInstrumentInSelection")})`}
                                disabled={!keyboardShortcutMgr.getActionBindingLabel("DecrementInstrumentInSelection")}
                            >
                                <Button
                                    onClick={() => onNudgeInstrument(-1, scope)}
                                    disabled={!enabled}
                                >
                                    -1
                                </Button>
                            </Tooltip>
                            <Tooltip
                                title={`Inc instrument (${keyboardShortcutMgr.getActionBindingLabel("IncrementInstrumentInSelection")})`}
                                disabled={!keyboardShortcutMgr.getActionBindingLabel("IncrementInstrumentInSelection")}
                            >
                                <Button
                                    onClick={() => onNudgeInstrument(1, scope)}
                                    disabled={!enabled}
                                >
                                    +1
                                </Button>
                            </Tooltip>
                            <Divider />
                            <Button onClick={handleClearInstrument}>Clear</Button>
                        </ButtonGroup>
                    </section>

                </fieldset>
                <fieldset>
                    <legend>Effect</legend>
                    <ButtonGroup>
                        <Button onClick={handleClearEffect}>Clear</Button>
                    </ButtonGroup>
                </fieldset>
                <fieldset>
                    <legend>Param</legend>
                    <ButtonGroup>
                        <Button onClick={handleClearX}>Clear X</Button>
                        <Button onClick={handleInterpolateX}>Interpolate X</Button>
                    </ButtonGroup>
                    <ButtonGroup>
                        <Button onClick={handleClearY}>Clear Y</Button>
                        <Button onClick={handleInterpolateY}>Interpolate Y</Button>
                    </ButtonGroup>
                    <ButtonGroup>
                        <Button onClick={handleClearXY}>Clear XY</Button>
                        <Button onClick={handleInterpolateXY}>Interpolate XY</Button>
                    </ButtonGroup>
                </fieldset>
                <fieldset>
                    <legend>SFX</legend>
                    <ButtonGroup>
                        <Button onClick={handleClearSFX}>Clear</Button>
                    </ButtonGroup>
                </fieldset>
                <fieldset>
                    <legend>SParam</legend>
                    <ButtonGroup>
                        <Button onClick={handleClearSParam}>Clear</Button>
                        <Divider />
                        <Button onClick={handleInterpolateSParam}>Interpolate</Button>
                    </ButtonGroup>
                </fieldset>

                {/* 
                <section className="pattern-advanced-panel__section">
                    <ButtonGroup>
                        {interpolateOptions.map((option) => (
                            <CheckboxButton
                                //name={`${scopeGroupId}-interp`}
                                //value={option.value}
                                //checked={interpolateTarget === option.value}
                                checked={interpolateTarget === option.value}
                                key={option.value}
                                onChange={() => setInterpolateTarget(option.value)}
                            >
                                <span>{option.label.toUpperCase()}</span>
                            </CheckboxButton>
                        ))}
                    </ButtonGroup>
                    <Button
                        onClick={() => onInterpolate(interpolateTarget, scope)}
                        disabled={!enabled}
                    >
                        Interpolate
                    </Button>
                </section> */}

                {/* TODO:
                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__buttonRow">
                        <button type="button" className="pattern-advanced-panel__button pattern-advanced-panel__button--primary">Expand 2×</button>
                        <button type="button" className="pattern-advanced-panel__button pattern-advanced-panel__button--primary">Shrink ½</button>
                    </div>
                </section> */}
            </div>
        </aside>
    );
};
