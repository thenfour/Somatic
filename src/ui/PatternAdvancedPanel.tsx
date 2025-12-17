import React from 'react';

export type PatternAdvancedPanelProps = {
    open: boolean;
    //onToggle: () => void;
};

export const PatternAdvancedPanel: React.FC<PatternAdvancedPanelProps> = ({ open }) => {
    return (
        <aside
            id="pattern-advanced-panel"
            className={`pattern-advanced-panel${open ? ' pattern-advanced-panel--open' : ''}`}
            aria-hidden={!open}
        >
            <header className="pattern-advanced-panel__header">Advanced Edit</header>
            <div className="pattern-advanced-panel__body">
                <p>Coming soon: block transforms, interpolation, scaling, and more.</p>
            </div>
        </aside>
    );
};
