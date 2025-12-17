import React, { useId, useState } from 'react';

export type PatternAdvancedPanelProps = {
};

const scopeOptions = [
    { value: 'selection', label: 'Selection' },
    { value: 'channel-pattern', label: 'Channel column · pattern' },
    { value: 'channel-song', label: 'Channel column · song' },
    { value: 'pattern', label: 'Whole pattern' },
    { value: 'song', label: 'Whole song' },
] as const;

type ScopeValue = (typeof scopeOptions)[number]['value'];
type InterpolateTarget = 'x' | 'y';

export const PatternAdvancedPanel: React.FC<PatternAdvancedPanelProps> = ({ }) => {
    const scopeGroupId = useId();
    const [scope, setScope] = useState<ScopeValue>('selection');
    const [setInstrumentValue, setSetInstrumentValue] = useState<number>(2);
    const [changeInstrumentFrom, setChangeInstrumentFrom] = useState<number>(2);
    const [changeInstrumentTo, setChangeInstrumentTo] = useState<number>(3);
    const [interpolateTarget, setInterpolateTarget] = useState<InterpolateTarget>('x');

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
                        {[-12, -1, 1, 12].map((step) => (
                            <button key={step} type="button" className="pattern-advanced-panel__button">
                                {step > 0 ? `+${step}` : step}
                            </button>
                        ))}
                    </div>
                </section>

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__sectionTitle">Instrument Ops</div>
                    <label className="pattern-advanced-panel__stacked">
                        <span>Set instrument</span>
                        <div className="pattern-advanced-panel__inputRow">
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={setInstrumentValue}
                                onChange={(e) => setSetInstrumentValue(Number(e.target.value))}
                            />
                            <button type="button" className="pattern-advanced-panel__button pattern-advanced-panel__button--primary">Set instrument</button>
                        </div>
                    </label>
                    <label className="pattern-advanced-panel__stacked">
                        <span>Change instrument</span>
                        <div className="pattern-advanced-panel__inputRow">
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={changeInstrumentFrom}
                                onChange={(e) => setChangeInstrumentFrom(Number(e.target.value))}
                                aria-label="Change instrument: from"
                            />
                            <span className="pattern-advanced-panel__arrow">→</span>
                            <input
                                type="number"
                                min={0}
                                max={63}
                                value={changeInstrumentTo}
                                onChange={(e) => setChangeInstrumentTo(Number(e.target.value))}
                                aria-label="Change instrument: to"
                            />
                            <button type="button" className="pattern-advanced-panel__button">Change Inst</button>
                        </div>
                    </label>
                </section>

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__sectionTitle">Interpolate</div>
                    <div className="pattern-advanced-panel__toggleRow">
                        {(['x', 'y'] as InterpolateTarget[]).map((axis) => (
                            <label key={axis} className="pattern-advanced-panel__chip">
                                <input
                                    type="radio"
                                    name={`${scopeGroupId}-interp`}
                                    value={axis}
                                    checked={interpolateTarget === axis}
                                    onChange={() => setInterpolateTarget(axis)}
                                />
                                <span>Param {axis.toUpperCase()}</span>
                            </label>
                        ))}
                    </div>
                    <button type="button" className="pattern-advanced-panel__button pattern-advanced-panel__button--primary">
                        Interpolate
                    </button>
                </section>

                <section className="pattern-advanced-panel__section">
                    <div className="pattern-advanced-panel__sectionTitle">Time Tools</div>
                    <div className="pattern-advanced-panel__buttonRow">
                        <button type="button" className="pattern-advanced-panel__button">Expand 2×</button>
                        <button type="button" className="pattern-advanced-panel__button">Shrink ½</button>
                    </div>
                </section>
            </div>
        </aside>
    );
};
