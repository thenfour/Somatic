import React, { useState, useMemo } from 'react';
import './debug_panel.css';
import { AppPanelShell } from './AppPanelShell';
import { OptimizationRuleOptions, processLua } from '../audio/lua_processor';

export const DebugPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
   const [inputLua, setInputLua] = useState<string>(`-- Sample Lua code
function test()
   -- BEGIN_DEBUG_ONLY
   log("debug message")
   -- END_DEBUG_ONLY
   
   -- Regular code
   return 42
end

-- DEBUG_ONLY
trace("single line debug")
`);

   const [options, setOptions] = useState<OptimizationRuleOptions>({
      stripComments: false,
      stripDebugBlocks: true,
      maxIndentLevel: 10,
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
               <div className="debug-panel-output-label">Processed Output:</div>
               <div className="debug-panel-output-content">{outputLua}</div>
            </div>
         </div>
      </AppPanelShell>
   );
};
