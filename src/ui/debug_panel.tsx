import React, { useState, useMemo } from 'react';
import './debug_panel.css';
import { AppPanelShell } from './AppPanelShell';
import { OptimizationRuleOptions, processLua } from '../audio/lua_processor';
import { CharMap } from '../utils/utils';

export const DebugPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [inputLua, setInputLua] = useState<string>(`-- Sample Lua code with repeated expressions
local x = math.cos(1) + math.cos(2) + math.cos(3)
local y = math.sin(1) + math.sin(2) + math.sin(3)
local z = string.sub("hello", 1, 2) .. string.sub("world", 1, 2)

function calculateSum(firstNumber, secondNumber)
   local result = firstNumber + secondNumber
   -- BEGIN_DEBUG_ONLY
   log("Sum calculated: " .. result)
   -- END_DEBUG_ONLY
   return result
end

local angle = math.cos(0.5)
local pos = {x = math.cos(angle), y = math.sin(angle)}
`);

    const [options, setOptions] = useState<OptimizationRuleOptions>({
        stripComments: false,
        stripDebugBlocks: true,
        maxIndentLevel: 10,
        aliasRepeatedExpressions: false,
        bakeConstants: false,
        renameLocalVariables: false,
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

    return (
        <AppPanelShell
            title="Debug Panel"
            className="debug-panel"
            actions={
                <button type="button" onClick={onClose}>Close</button>
            }
        >
            <div className="debug-panel-content">
                <div className="debug-panel-options">
                    <div className="debug-panel-option-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.stripComments}
                                onChange={() => handleOptionChange('stripComments')}
                            />
                            Strip Comments
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.stripDebugBlocks}
                                onChange={() => handleOptionChange('stripDebugBlocks')}
                            />
                            Strip Debug Blocks
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.aliasRepeatedExpressions}
                                onChange={() => handleOptionChange('aliasRepeatedExpressions')}
                            />
                            Alias Repeated Expressions
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.bakeConstants}
                                onChange={() => handleOptionChange('bakeConstants')}
                            />
                            Bake Constants
                        </label>
                    </div>
                    <div className="debug-panel-option-group">
                        <label>
                            <input
                                type="checkbox"
                                checked={options.renameLocalVariables}
                                onChange={() => handleOptionChange('renameLocalVariables')}
                            />
                            Rename Local Variables
                        </label>
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
                    <div className="debug-panel-output-label">Processed Output ({inputLua.length}{CharMap.RightArrow}{outputLua.length}):</div>
                    <div className="debug-panel-output-content">{outputLua}</div>
                </div>
            </div>
        </AppPanelShell>
    );
};
