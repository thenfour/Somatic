import React, { useId, useState } from 'react';
import { CharMap } from '../utils/utils';
import { Tooltip } from './tooltip';
import { useShortcutManager } from '../keyb/KeyboardShortcutManager';

export type PatternAdvancedPanelProps = {
    enabled?: boolean;
    onTranspose: (amount: number, scope: ScopeValue) => void;
    onSetInstrument: (instrument: number, scope: ScopeValue) => void;
    onChangeInstrument: (fromInstrument: number, toInstrument: number, scope: ScopeValue) => void;
    onNudgeInstrument: (amount: number, scope: ScopeValue) => void;
    onInterpolate: (target: InterpolateTarget, scope: ScopeValue) => void;
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
] as const;

export type InterpolateTarget = (typeof interpolateOptions)[number]['value'];

export const PatternAdvancedPanel: React.FC<PatternAdvancedPanelProps> = ({ enabled = true, onTranspose, onSetInstrument, onChangeInstrument, onNudgeInstrument, onInterpolate }) => {
    const scopeGroupId = useId();
    const keyboardShortcutMgr = useShortcutManager();
    const [scope, setScope] = useState<ScopeValue>('selection');
    const [setInstrumentValue, setSetInstrumentValue] = useState<number>(2);
    const [changeInstrumentFrom, setChangeInstrumentFrom] = useState<number>(2);
    const [changeInstrumentTo, setChangeInstrumentTo] = useState<number>(3);
    const [interpolateTarget, setInterpolateTarget] = useState<InterpolateTarget>('notes');

    return (
        <aside
            id="pattern-advanced-panel"
            className={`pattern-advanced-panel`}
        >
            <header className="pattern-advanced-panel__header">Advanced Edit</header>
            <div className="pattern-advanced-panel__body">
                <fieldset className="pattern-advanced-panel__group" aria-labelledby={`${scopeGroupId}-legend`}>
                    <legend id={`${scopeGroupId}-legend`}>Apply edits to</legend>
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
                        {[-12, -1, 1, 12].map((step) => {
                            const actionId =
                                step === -12 ? "TransposeSelectionDownOctave" :
                                    step === -1 ? "TransposeSelectionDownSemitone" :
                                        step === 1 ? "TransposeSelectionUpSemitone" :
                                            "TransposeSelectionUpOctave";
                            const label = keyboardShortcutMgr.getActionBindingLabel(actionId);
                            const title = label ? `Shortcut: ${label}` : undefined;
                            return (
                                <Tooltip key={step} title={title} disabled={!title}>
                                    <button
                                        type="button"
                                        className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                                        onClick={() => onTranspose(step, scope)}
                                        disabled={!enabled}
                                    >
                                        {step > 0 ? `+${step}` : step}
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </div>
                </section>

                <section className="pattern-advanced-panel__section">
                    <label className="pattern-advanced-panel__stacked">
                        <div className="pattern-advanced-panel__inputRow">
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={setInstrumentValue}
                                onChange={(e) => setSetInstrumentValue(Number(e.target.value))}
                            />
                            <button
                                type="button"
                                className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                                onClick={() => onSetInstrument(setInstrumentValue, scope)}
                                disabled={!enabled}
                            >
                                Set instrument
                            </button>
                        </div>
                    </label>
                    <label className="pattern-advanced-panel__stacked">
                        <div className="pattern-advanced-panel__inputRow">
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={changeInstrumentFrom}
                                onChange={(e) => setChangeInstrumentFrom(Number(e.target.value))}
                                aria-label="Change instrument: from"
                            />
                            <span className="pattern-advanced-panel__arrow">{CharMap.RightTriangle}</span>
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={changeInstrumentTo}
                                onChange={(e) => setChangeInstrumentTo(Number(e.target.value))}
                                aria-label="Change instrument: to"
                            />
                            <button
                                type="button"
                                className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                                onClick={() => onChangeInstrument(changeInstrumentFrom, changeInstrumentTo, scope)}
                                disabled={!enabled}
                            >
                                Change Inst
                            </button>
                        </div>
                    </label>
                    <div className="pattern-advanced-panel__buttonRow">
                        <Tooltip
                            title={`Shortcut: ${keyboardShortcutMgr.getActionBindingLabel("DecrementInstrumentInSelection")}`}
                            disabled={!keyboardShortcutMgr.getActionBindingLabel("DecrementInstrumentInSelection")}
                        >
                            <button
                                type="button"
                                className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                                onClick={() => onNudgeInstrument(-1, scope)}
                                disabled={!enabled}
                            >
                                Inst-1
                            </button>
                        </Tooltip>
                        <Tooltip
                            title={`Shortcut: ${keyboardShortcutMgr.getActionBindingLabel("IncrementInstrumentInSelection")}`}
                            disabled={!keyboardShortcutMgr.getActionBindingLabel("IncrementInstrumentInSelection")}
                        >
                            <button
                                type="button"
                                className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                                onClick={() => onNudgeInstrument(1, scope)}
                                disabled={!enabled}
                            >
                                Inst+1
                            </button>
                        </Tooltip>
                    </div>
                </section>

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__toggleRow">
                        {interpolateOptions.map((option) => (
                            <label key={option.value} className="pattern-advanced-panel__chip">
                                <input
                                    type="radio"
                                    name={`${scopeGroupId}-interp`}
                                    value={option.value}
                                    checked={interpolateTarget === option.value}
                                    onChange={() => setInterpolateTarget(option.value)}
                                />
                                <span>{option.label.toUpperCase()}</span>
                            </label>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="pattern-advanced-panel__button pattern-advanced-panel__button--primary"
                        onClick={() => onInterpolate(interpolateTarget, scope)}
                        disabled={!enabled}
                    >
                        Interpolate
                    </button>
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
