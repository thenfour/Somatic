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

export type PatternAdvancedPanelProps = {
    enabled?: boolean;
    song: Song;
    onTranspose: (amount: number, scope: ScopeValue) => void;
    onSetInstrument: (instrument: number, scope: ScopeValue) => void;
    onChangeInstrument: (fromInstrument: number, toInstrument: number, scope: ScopeValue) => void;
    onNudgeInstrument: (amount: number, scope: ScopeValue) => void;
    onInterpolate: (target: InterpolateTarget, scope: ScopeValue) => void;
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

export const PatternAdvancedPanel: React.FC<PatternAdvancedPanelProps> = ({ song, enabled = true, onTranspose, onSetInstrument, onChangeInstrument, onNudgeInstrument, onInterpolate, onClose }) => {
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
                width={200}
            />,
        }));
    }, [song.instruments]);

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
                <fieldset className="pattern-advanced-panel__group" aria-labelledby={`${scopeGroupId}-legend`}>
                    <legend id={`${scopeGroupId}-legend`}>Apply to</legend>
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

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__sectionTitle">Transpose</div>
                    <div className="pattern-advanced-panel__buttonRow">
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
                    </div>
                </section>

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__inputRow">
                        <Dropdown
                            value={setInstrumentValue}
                            onChange={(inst) => setSetInstrumentValue(inst)}
                            options={instrumentOptions}
                        />
                    </div>
                    <div className="pattern-advanced-panel__inputRow">
                        <Button
                            onClick={() => onSetInstrument(setInstrumentValue, scope)}
                            disabled={!enabled}
                        >
                            Set instrument
                        </Button>
                    </div>
                    <div className="pattern-advanced-panel__inputRow">
                        <Dropdown
                            value={changeInstrumentFrom}
                            onChange={(inst) => setChangeInstrumentFrom(inst)}
                            options={instrumentOptions}
                        />
                    </div>
                    <div className="pattern-advanced-panel__inputRow">
                        <span className="pattern-advanced-panel__arrow">{CharMap.RightTriangle}</span>
                        <Dropdown
                            value={changeInstrumentTo}
                            onChange={(inst) => setChangeInstrumentTo(inst)}
                            options={instrumentOptions}
                        />
                    </div>
                    <div className="pattern-advanced-panel__inputRow">
                        <Tooltip
                            title={`Change instrument from ${changeInstrumentFrom} to ${changeInstrumentTo}`}
                        >
                            <Button
                                onClick={() => onChangeInstrument(changeInstrumentFrom, changeInstrumentTo, scope)}
                                disabled={!enabled}
                            >
                                Change Instrument
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
                                Inst-1
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
                                Inst+1
                            </Button>
                        </Tooltip>
                    </ButtonGroup>
                </section>

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
                </section>

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
