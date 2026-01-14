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
import { IconButton } from './Buttons/IconButton';
import { mdiSync } from '@mdi/js';

export type PatternAdvancedPanelProps = {
    enabled?: boolean;
    song: Song;
    currentInstrument: number;
    onTranspose: (amount: number, scope: AdvancedEditScope) => void;
    onSetInstrument: (instrument: number, scope: AdvancedEditScope) => void;
    onChangeInstrument: (fromInstrument: number, toInstrument: number, scope: AdvancedEditScope) => void;
    onNudgeInstrument: (amount: number, scope: AdvancedEditScope) => void;
    onInterpolate: (target: InterpolateTarget, scope: AdvancedEditScope) => void;

    onClearNotes: (scope: AdvancedEditScope) => void;
    onClearInstrument: (scope: AdvancedEditScope) => void;
    onClearEffect: (scope: AdvancedEditScope) => void;
    onClearParamX: (scope: AdvancedEditScope) => void;
    onClearParamY: (scope: AdvancedEditScope) => void;
    onClearParamXY: (scope: AdvancedEditScope) => void;
    onClearSomaticEffect: (scope: AdvancedEditScope) => void;
    onClearSomaticParam: (scope: AdvancedEditScope) => void;

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

// Advanced edit operations can optionally be filtered to a specific instrument.
// instrumentIndex === null means "all instruments".
export type AdvancedEditScope = {
    scope: ScopeValue;
    instrumentIndex: number | null;
};
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
    currentInstrument,
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
    const [scopeValue, setScopeValue] = useState<ScopeValue>('selection');
    const [scopeInstrumentIndex, setScopeInstrumentIndex] = useState<number | null>(null);
    const [setInstrumentValue, setSetInstrumentValue] = useState<number>(2);
    const [changeInstrumentFrom, setChangeInstrumentFrom] = useState<number>(2);
    const [changeInstrumentTo, setChangeInstrumentTo] = useState<number>(3);
    const [interpolateTarget, setInterpolateTarget] = useState<InterpolateTarget>('notes');
    const mgr = useShortcutManager<GlobalActionId>();

    const advancedEditPanelKeyshortcut = mgr.getActionBindingLabel("ToggleAdvancedEditPanel") || "Unbound";

    const instrumentOptions = React.useMemo(() => {
        return Array.from({ length: Tic80Caps.sfx.maxSupported }, (_, i) => ({
            value: i,
            label: <InstrumentChip
                instrumentIndex={i}
                instrument={song.instruments[i]}
                showTooltip={false}
            //width={200}
            />,
        }));
    }, [song.instruments]);

    const scope: AdvancedEditScope = React.useMemo(() => {
        return {
            scope: scopeValue,
            instrumentIndex: scopeInstrumentIndex,
        };
    }, [scopeInstrumentIndex, scopeValue]);

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
                    {/* <div className="pattern-advanced-panel__scope"> */}
                    <ButtonGroup orientation="vertical">
                        {scopeOptions.map((option) => (
                            <CheckboxButton
                                key={option.value}
                                checked={scopeValue === option.value}
                                onChange={() => setScopeValue(option.value)}
                            >
                                {option.label}
                            </CheckboxButton>
                        ))}
                        <Divider />
                        <CheckboxButton
                            checked={scopeInstrumentIndex !== null}
                            onChange={(checked) => {
                                setScopeInstrumentIndex(checked ? (scopeInstrumentIndex ?? 2) : null);
                            }}
                        >
                            Filter instrument
                        </CheckboxButton>
                        <div className="pattern-advanced-panel__inputRow div-row">
                            <ButtonGroup>
                                <Dropdown
                                    value={scopeInstrumentIndex ?? 2}
                                    disabled={scopeInstrumentIndex === null}
                                    onChange={(inst) => setScopeInstrumentIndex(inst)}
                                    options={instrumentOptions}
                                    showCaret={false}
                                    triggerClassName="div-row-grow"
                                    renderTriggerLabel={(opt) => {
                                        const instId = opt?.value ?? 0;
                                        return (
                                            <InstrumentChip
                                                instrumentIndex={instId}
                                                instrument={song.instruments[instId]}
                                                width={170}
                                            />
                                        );
                                    }}
                                />
                                <Tooltip title="Set to current instrument">
                                    <IconButton
                                        className="div-row-shrink"
                                        iconPath={mdiSync}
                                        onClick={() => setScopeInstrumentIndex(currentInstrument)}
                                        disabled={!enabled}
                                    />
                                </Tooltip>
                            </ButtonGroup>
                        </div>
                    </ButtonGroup>
                    {/* </div> */}
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
                            <ButtonGroup>
                                <Button
                                    onClick={() => onSetInstrument(setInstrumentValue, scope)}
                                    disabled={!enabled}
                                    className="div-row-shrink"
                                >
                                    Set {CharMap.RightTriangle}
                                </Button>
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
                                            width={100}
                                        />
                                    }}
                                />
                                <Tooltip title="Set to current instrument">
                                    <IconButton
                                        className="div-row-shrink"
                                        iconPath={mdiSync}
                                        onClick={() => setSetInstrumentValue(currentInstrument)}
                                        disabled={!enabled}
                                    />
                                </Tooltip>
                            </ButtonGroup>
                        </div>
                        {/* <div className="pattern-advanced-panel__inputRow">
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
                        </div> */}
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
