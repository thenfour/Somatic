import {kDefaultReleaseMinificationOptions} from "../models/exportConfiguration";
import {OptimizationRuleOptions} from "../utils/lua/lua_processor";
import {Dropdown} from "./basic/Dropdown";
import {IntegerUpDown} from "./basic/NumericUpDown";
import {ButtonGroup} from "./Buttons/ButtonGroup";
import {CheckboxButton} from "./Buttons/CheckboxButton";
import {Button} from "./Buttons/PushButton";

export interface LuaOptimizationOptionsProps {
   value: OptimizationRuleOptions;
   onChange: (newOptions: OptimizationRuleOptions) => void;
}

export const LuaOptimizationOptions: React.FC<LuaOptimizationOptionsProps> = ({value, onChange}) => {
   const handleOptionChange = (key: keyof OptimizationRuleOptions) => {
      onChange({
         ...value,
         [key]: typeof value[key] === 'boolean' ? !value[key] : value[key],
      });
   };

   return <div className="debug-panel-options">
      <Button onClick={() => onChange(kDefaultReleaseMinificationOptions)} >Set to defaults</Button>
      <ButtonGroup orientation='vertical'>
         <CheckboxButton
            checked={value.stripComments}
            onChange={() => handleOptionChange('stripComments')}
         >Strip Comments</CheckboxButton>
         <CheckboxButton
            checked={value.stripDebugBlocks}
            onChange={() => handleOptionChange('stripDebugBlocks')}
         >Strip Debug Blocks</CheckboxButton>
         <CheckboxButton
            checked={value.aliasRepeatedExpressions}
            onChange={() => handleOptionChange('aliasRepeatedExpressions')}
         >Alias Repeated Expressions</CheckboxButton>
         <CheckboxButton
            checked={value.aliasLiterals}
            onChange={() => handleOptionChange('aliasLiterals')}
         >Alias Literals</CheckboxButton>
         <CheckboxButton
            checked={value.renameLocalVariables}
            onChange={() => handleOptionChange('renameLocalVariables')}
         >Rename Local Variables</CheckboxButton>
         <CheckboxButton
            checked={value.packLocalDeclarations}
            onChange={() => handleOptionChange('packLocalDeclarations')}
         >Pack Local Declarations</CheckboxButton>
         <CheckboxButton
            checked={value.simplifyExpressions}
            onChange={() => handleOptionChange('simplifyExpressions')}
         >Simplify Expressions</CheckboxButton>
         <CheckboxButton
            checked={value.removeUnusedLocals}
            onChange={() => handleOptionChange('removeUnusedLocals')}
         >Remove Unused Locals</CheckboxButton>
         <CheckboxButton
            checked={value.removeUnusedFunctions}
            onChange={() => handleOptionChange('removeUnusedFunctions')}
         >Remove Unused Functions</CheckboxButton>
         <CheckboxButton
            checked={value.renameTableFields}
            onChange={() => handleOptionChange('renameTableFields')}
         >Rename Table Fields</CheckboxButton>
      </ButtonGroup>
      <div className="debug-panel-option-group">
         <label>
            Max Indent Level (0-50):
            <IntegerUpDown
               min={0}
               max={50}
               value={value.maxIndentLevel}
               onChange={val => {
                  onChange({
                     ...value,
                     maxIndentLevel: val,
                  });
               }}
            />
         </label>
      </div>
      <div className="debug-panel-option-group">
         <label>
            Line Behavior:
            <span style={{marginLeft: '0.5rem'}}>
               <Dropdown<OptimizationRuleOptions['lineBehavior']>
                  value={value.lineBehavior}
                  onChange={(lineBehavior) =>
                     onChange({
                        ...value,
                        lineBehavior,
                     })
                  }
                  options={[
                     {value: 'pretty', label: 'Pretty'},
                     {value: 'tight', label: 'Tight (pack lines)'},
                     {value: 'single-line-blocks', label: 'Single-line blocks'},
                  ]}
                  showCheckmark={false}
               />
            </span>
         </label>
      </div>
      <div className="debug-panel-option-group">
         <label>
            Max Line Length:
            <input
               type="range"
               min="1"
               max="500"
               value={value.maxLineLength}
               onChange={(e) =>
                  onChange({
                     ...value,
                     maxLineLength: parseInt(e.target.value, 10) || 0,
                  })
               }
               style={{width: '80px', marginLeft: '0.5rem'}}
            />
         </label>
         <div style={{display: "flex", gap: "0.25rem", marginTop: "0.25rem"}}>
            <ButtonGroup>
               {[20, 40, 60, 80, 120, 180, 240, 500].map((len) => (
                  <Button
                     onClick={() => onChange({
                        ...value,
                        maxLineLength: len,
                     })}
                     key={len}
                     highlighted={value.maxLineLength === len}
                  >{len}</Button>
               ))}
            </ButtonGroup>
            <span>Current: {value.maxLineLength}</span>
         </div>
      </div>
   </div>;
};
