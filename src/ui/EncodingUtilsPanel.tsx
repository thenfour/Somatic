import { useState } from "react";
import { AppPanelShell } from "./AppPanelShell"
import { BarValue, SizeValue } from "./basic/BarValue";
import { useClipboard } from "../hooks/useClipboard";
import { Button } from "./Buttons/PushButton";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { RadioButton } from "./Buttons/RadioButton";

/*

Output:
- number list ({1,2,3})
- hex string ("1a2bff00")
- lz-base85 string ("3f!@#...")

*/

type SnipFormat = "numberList" | "hexString" | "lzBase85";


export const EncodingUtilsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [inputText, setInputText] = useState("\"1a1c2c5d275db13e53ef7d57ffcd75a7f07038b76425717929366f3b5dc941a6f673eff7f4f4f494b0c2566c86333c57\"");
    const [inputFormat, setInputFormat] = useState<SnipFormat | "auto">("auto");
    const [outputText, setOutputText] = useState("");
    const [outputFormat, setOutputFormat] = useState<SnipFormat>("hexString");
    const clipboard = useClipboard();
    return <AppPanelShell title="Encoding Utilities" className="encoding-utils-panel" onClose={onClose}>
        <div className="encoding-utils-panel__content">
            <ButtonGroup>
                <RadioButton selected={inputFormat === "numberList"} onChange={() => setInputFormat("numberList")}>Number list</RadioButton>
                <RadioButton selected={inputFormat === "hexString"} onChange={() => setInputFormat("hexString")} >Hex string</RadioButton>
                <RadioButton selected={inputFormat === "lzBase85"} onChange={() => setInputFormat("lzBase85")}>LZ Base85</RadioButton>
                <RadioButton selected={inputFormat === "auto"} onChange={() => setInputFormat("auto")}>Auto</RadioButton>
            </ButtonGroup>
            <textarea className="debug-panel-textarea" value={inputText} onChange={e => setInputText(e.target.value)} />

            <div className="debug-panel-output">
                <div className="debug-panel-output-label">Processed Output</div>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    maxWidth: "300px",
                }}>
                    <BarValue value={inputText.length} max={Math.max(inputText.length, outputText.length)} label={<SizeValue value={inputText.length} />} />
                    <BarValue value={outputText.length} max={Math.max(inputText.length, outputText.length)} label={<SizeValue value={outputText.length} />} />
                    <ButtonGroup>
                        <Button onClick={() => clipboard.copyTextToClipboard(outputText)}>Copy</Button>
                    </ButtonGroup>
                </div>
                <div className="debug-panel-output-content">{outputText}</div>
            </div>
        </div>
    </AppPanelShell>;
}

