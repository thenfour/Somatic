import React, { useState, useMemo } from 'react';
import './debug_panel.css';
import { AppPanelShell } from './AppPanelShell';
import { CharMap } from '../utils/utils';
import { BarValue, SizeValue } from './basic/BarValue';
import { useClipboard } from '../hooks/useClipboard';
import { MorphEntryFieldNamesToRename } from '../../bridge/morphSchema';
import { OptimizationRuleOptions, processLua } from '../utils/lua/lua_processor';
import { ComponentTester } from './ComponentTester';
import { ButtonGroup } from './Buttons/ButtonGroup';
import { Button } from './Buttons/PushButton';
import { CheckboxButton } from './Buttons/CheckboxButton';

export const DebugPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const clipboard = useClipboard();
    const [allowedTableKeyRenames, setAllowedTableKeyRenames] = useState<string>("");
    const [inputLua, setInputLua] = useState<string>(`-- Test repeated expressions and literals
local x = math.cos(1) + math.cos(2) + math.cos(3)
local y = "hello" .. "world" .. "hello" .. "hello"
local z = 65535 + 65535 + 65535

function draw()
   local a = string.sub("test", 1, 2)
   local b = string.sub("demo", 1, 2)
   local c = string.sub("code", 1, 2)
   print("test" .. "test" .. "test")
end
`);

    const [options, setOptions] = useState<OptimizationRuleOptions>({
        stripComments: false,
        stripDebugBlocks: true,
        maxIndentLevel: 10,
        lineBehavior: "pretty",
        maxLineLength: 120,
        aliasRepeatedExpressions: false,
        aliasLiterals: false,
        renameLocalVariables: false,
        packLocalDeclarations: false,
        simplifyExpressions: false,
        removeUnusedLocals: false,
        renameTableFields: false,
        tableEntryKeysToRename: [],
    });

    const outputLua = useMemo(() => {
        try {
            return processLua(inputLua, options);
        } catch (error) {
            return `Error processing Lua:\n${error instanceof Error ? error.message : String(error)}`;
        }
    }, [inputLua, options]);

    const handleOptionChange = (key: keyof OptimizationRuleOptions) => {
        setOptions((prev) => ({
            ...prev,
            [key]: typeof prev[key] === 'boolean' ? !prev[key] : prev[key],
        }));
    };

    // when allowedTableKeyRenames changes, update options
    React.useEffect(() => {
        const keys = allowedTableKeyRenames.split(',').map(k => k.trim()).filter(k => k.length > 0);
        setOptions((prev) => ({
            ...prev,
            tableEntryKeysToRename: keys,
        }));
    }, [allowedTableKeyRenames]);

    return (
        <AppPanelShell
            title="Debug Panel"
            className="debug-panel"
            onClose={onClose}
        >
            <div className="debug-panel-content">
                <div className="debug-panel-options">
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.stripComments}
                            onChange={() => handleOptionChange('stripComments')}
                        >Strip Comments</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.stripDebugBlocks}
                            onChange={() => handleOptionChange('stripDebugBlocks')}
                        >Strip Debug Blocks</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.aliasRepeatedExpressions}
                            onChange={() => handleOptionChange('aliasRepeatedExpressions')}
                        >Alias Repeated Expressions</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.aliasLiterals}
                            onChange={() => handleOptionChange('aliasLiterals')}
                        >Alias Literals</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.renameLocalVariables}
                            onChange={() => handleOptionChange('renameLocalVariables')}
                        >Rename Local Variables</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.packLocalDeclarations}
                            onChange={() => handleOptionChange('packLocalDeclarations')}
                        >Pack Local Declarations</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.simplifyExpressions}
                            onChange={() => handleOptionChange('simplifyExpressions')}
                        >Simplify Expressions</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.removeUnusedLocals}
                            onChange={() => handleOptionChange('removeUnusedLocals')}
                        >Remove Unused Locals</CheckboxButton>
                    </div>
                    <div className="debug-panel-option-group">
                        <CheckboxButton
                            checked={options.renameTableFields}
                            onChange={() => handleOptionChange('renameTableFields')}
                        >Rename Table Fields</CheckboxButton>
                    </div>

                    <div className="debug-panel-option-group">
                        <label>
                            Max Indent Level:
                            <input
                                type="number"
                                min="0"
                                max="20"
                                value={options.maxIndentLevel}
                                onChange={(e) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        maxIndentLevel: parseInt(e.target.value, 10) || 0,
                                    }))
                                }
                                style={{ width: '60px', marginLeft: '0.5rem' }}
                            />
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            Line Behavior:
                            <select
                                value={options.lineBehavior}
                                onChange={(e) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        lineBehavior: e.target.value as OptimizationRuleOptions['lineBehavior'],
                                    }))
                                }
                                style={{ marginLeft: '0.5rem' }}
                            >
                                <option value="pretty">Pretty</option>
                                <option value="tight">Tight (pack lines)</option>
                                <option value="single-line-blocks">Single-line blocks</option>
                            </select>
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            Max Line Length:
                            <input
                                type="range"
                                min="1"
                                max="500"
                                value={options.maxLineLength}
                                onChange={(e) =>
                                    setOptions((prev) => ({
                                        ...prev,
                                        maxLineLength: parseInt(e.target.value, 10) || 0,
                                    }))
                                }
                                style={{ width: '80px', marginLeft: '0.5rem' }}
                            />
                        </label>
                        <div style={{ display: "flex", gap: "0.25rem", marginTop: "0.25rem" }}>
                            <ButtonGroup>
                                {[20, 40, 60, 80, 120, 180, 240, 500].map((len) => (
                                    <Button
                                        onClick={() => setOptions((prev) => ({
                                            ...prev,
                                            maxLineLength: len,
                                        }))}
                                        key={len}
                                        highlighted={options.maxLineLength === len}
                                    >{len}</Button>
                                ))}
                            </ButtonGroup>
                            <span>Current: {options.maxLineLength}</span>
                        </div>
                    </div>
                    <div className="debug-panel-option-group">
                        <button onClick={() => setAllowedTableKeyRenames(MorphEntryFieldNamesToRename.join(", "))}>Morph entries</button>
                        <label>
                            Allowed Table Key Renames (comma-separated):
                            <input
                                type="text"
                                value={allowedTableKeyRenames}
                                onChange={(e) => setAllowedTableKeyRenames(e.target.value)}
                                style={{ width: '100%', marginTop: '0.25rem' }}
                            />
                        </label>
                    </div>
                </div>

                <div className="debug-panel-textarea-container">
                    <div className="debug-panel-textarea-label">Input Lua:</div>
                    <textarea
                        className="debug-panel-textarea"
                        value={inputLua}
                        onChange={(e) => setInputLua(e.target.value)}
                        placeholder="Enter Lua code here..."
                        spellCheck={false}
                    />
                </div>

                <div className="debug-panel-output">
                    <div className="debug-panel-output-label">Processed Output ({inputLua.length}{CharMap.RightArrow}{outputLua.length}, {(outputLua.length / Math.max(inputLua.length, outputLua.length) * 100).toFixed(0)}%):</div>
                    {/* // flex column with max width so the bars are stacked and same width */}
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.25rem",
                        maxWidth: "300px",
                    }}>
                        <BarValue value={inputLua.length} max={Math.max(inputLua.length, outputLua.length)} label={<SizeValue value={inputLua.length} />} />
                        <BarValue value={outputLua.length} max={Math.max(inputLua.length, outputLua.length)} label={<SizeValue value={outputLua.length} />} />
                        <button onClick={() => clipboard.copyTextToClipboard(outputLua)}>Copy</button>
                    </div>
                    <div className="debug-panel-output-content">{outputLua}</div>
                </div>

                <div>
                    <ComponentTester />
                </div>
            </div>
        </AppPanelShell >
    );
};
