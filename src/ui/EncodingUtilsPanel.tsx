import { useEffect, useMemo, useState } from "react";
import { AppPanelShell } from "./AppPanelShell"
import { BarValue, SizeValue } from "./basic/BarValue";
import { useClipboard } from "../hooks/useClipboard";
import { Button } from "./Buttons/PushButton";
import { ButtonGroup } from "./Buttons/ButtonGroup";
import { RadioButton } from "./Buttons/RadioButton";
import { base85Decode, base85Encode, gSomaticLZDefaultConfig, lzCompress, lzDecompress } from "../audio/encoding";
import { CharMap, err, ok, Ok, Result, toLuaStringLiteral } from "../utils/utils";
import { decodeRawString } from "../utils/lua/lua_utils";

/*

Output:
- number list ({1,2,3}) -- naive Lua table
- hex string ("1a2bff00") -- typical tic80 technique for binary packed data in a string; decoding uses tonumber(...)
- lz-base85 string ("3f!@#...") -- a LZ-compressed, and then base85-encoded string, as used in Somatic's playroutine

*/

type SnipFormat = "numberList" | "hexString" | "lzBase85";

function parseNumberListToBytes(src: string): Result<Uint8Array> {
    // Accept: {1,2,3} or 1,2,3 or with whitespace/newlines.
    const nums = src.match(/-?\d+/g) ?? [];
    if (nums.length === 0) {
        return err("No numbers found.");
    }
    const out = new Uint8Array(nums.length);
    for (let i = 0; i < nums.length; i++) {
        const n = Number.parseInt(nums[i], 10);
        if (!Number.isFinite(n)) {
            return err(`Invalid number: ${nums[i]}`);
        }
        if (n < 0 || n > 255) {
            return err(`Byte out of range (0..255): ${n}`);
        }
        out[i] = n & 0xff;
    }
    return ok(out);
}

function parseHexStringToBytes(src: string): Result<Uint8Array> {
    // Accept: "1a2bff00" or 1a 2b ff 00 (quotes optional)
    const parsed = decodeRawString(src);
    if (parsed === null) {
        return err("Could not parse hex string input.");
    }
    const body = parsed.replace(/\s+/g, "").toLowerCase();
    const cleaned = body.replace(/^0x/, "");
    if (cleaned.length === 0) {
        return err("Empty hex input.");
    }
    if (!/^[0-9a-f]+$/.test(cleaned)) {
        return err("Hex input contains non-hex characters.");
    }
    if (cleaned.length % 2 !== 0) {
        return err("Hex input has odd number of digits.");
    }
    const out = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < cleaned.length; i += 2) {
        out[i / 2] = Number.parseInt(cleaned.slice(i, i + 2), 16) & 0xff;
    }
    return ok(out);
}

// decoding base85 requires knowing the expected decoded length.
type B85LZPayload = {
    lua: string;
    decodedLength: number;
};

// decodes a lua string literal containing base85-encoded, LZ-compressed data, returns raw bytes.
function decodeLzBase85ToBytes(src: B85LZPayload): Result<Uint8Array> {
    try {
        const str = decodeRawString(src.lua);
        if (str === null) {
            return err("Could not parse Lua string literal.");
        }
        // if the passed-in length is not sane, deduce it based on input length.
        // base85 encodes 4 bytes into 5 chars, so decoded length is approx (input length * 4) / 5
        const expected = str.length * 4 / 5;
        const expectedMin = expected - 6;
        const expectedMax = expected + 6;
        if (src.decodedLength <= 0 || src.decodedLength < expectedMin || src.decodedLength > expectedMax) {
            src.decodedLength = Math.round(expected);
        }
        const compressed = base85Decode(str, src.decodedLength);
        const raw = lzDecompress(compressed);
        return ok(raw);
    } catch (e) {
        return err(`Decode failed: ${(e as Error).message ?? String(e)}`);
    }
}

function detectInputFormat(src: string): SnipFormat {
    const s = src.trim();
    // number list if it contains only digits, commas, whitespace, braces/brackets/parens, minus.
    if (/^[\s\d,{}\[\]()\-]+$/.test(s) && /\d/.test(s)) {
        return "numberList";
    }
    // hex string if it contains only hex digits, whitespace, quotes, 0x prefix.
    if (/^[\s0-9a-fA-F"'x]+$/.test(s) && /[0-9a-fA-F]/.test(s)) {
        return "hexString";
    }
    return "lzBase85";
}

function bytesToNumberListLua(bytes: Uint8Array): string {
    return `{${Array.from(bytes).join(",")}}`;
}

function bytesToHexStringLua(bytes: Uint8Array): string {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
    }
    return `"${hex}"`;
}

function bytesToLzBase85Lua(bytes: Uint8Array): B85LZPayload {
    const compressed = lzCompress(bytes, gSomaticLZDefaultConfig);
    const b85 = base85Encode(compressed);
    return { lua: toLuaStringLiteral(b85), decodedLength: compressed.length };
}


export const EncodingUtilsPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [inputText, setInputText] = useState("\"1a1c2c5d275db13e53ef7d57ffcd75a7f07038b76425717929366f3b5dc941a6f673eff7f4f4f494b0c2566c86333c57\"");

    // auto will try to detect which format the input is in
    // - number list if it contains only numbers, commas, whitespace, braces
    // - hex string if it contains only whitespace, hex digits, double-quotes
    // - lz-base85 otherwise
    // upon processing, we will sanitize the input so we are forgiving. for exmaple the number list may miss braces, or
    // hex string may or may not have quotes.
    //
    // output should be a Lua value.; e.g., "1a2b3c4d" or "{26,43,60,77}".
    const [inputFormat, setInputFormat] = useState<SnipFormat | "auto">("auto");
    const [inputDecodedLength, setInputDecodedLength] = useState(0);
    const [detectedFormat, setDetectedFormat] = useState<SnipFormat | "error">("error");
    const [outputText, setOutputText] = useState("");
    const [outputDecodedLength, setOutputDecodedLength] = useState("");
    const [outputFormat, setOutputFormat] = useState<SnipFormat>("hexString");
    const clipboard = useClipboard();

    const decodedBytes = useMemo((): Result<Uint8Array> => {
        const fmt: SnipFormat = inputFormat === "auto" ? detectInputFormat(inputText) : inputFormat;

        setDetectedFormat(fmt);

        if (fmt === "numberList") return parseNumberListToBytes(inputText);
        if (fmt === "hexString") return parseHexStringToBytes(inputText);
        return decodeLzBase85ToBytes({ lua: inputText, decodedLength: inputDecodedLength });
    }, [inputText, inputFormat, inputDecodedLength]);

    useEffect(() => {
        if (!decodedBytes.ok) {
            setOutputText(`-- ERROR\n${decodedBytes.error}`);
            return;
        }
        const bytes = decodedBytes.value;
        if (outputFormat === "numberList") setOutputText(bytesToNumberListLua(bytes));
        else if (outputFormat === "hexString") setOutputText(bytesToHexStringLua(bytes));
        else {
            //setOutputText(bytesToLzBase85Lua(bytes));
            const b85payload = bytesToLzBase85Lua(bytes);
            setOutputText(b85payload.lua);
            setOutputDecodedLength(b85payload.decodedLength.toString());
        }
    }, [decodedBytes, outputFormat]);

    const inputByteCount = decodedBytes.ok ? decodedBytes.value.length : 0;
    const outputByteCount = outputFormat === "lzBase85" && decodedBytes.ok
        ? lzCompress(decodedBytes.value, gSomaticLZDefaultConfig).length
        : inputByteCount;

    return <AppPanelShell title="Encoding Utilities" className="encoding-utils-panel" onClose={onClose}>
        <div className="encoding-utils-panel__content">
            <ButtonGroup>
                <RadioButton selected={inputFormat === "numberList"} onClick={() => setInputFormat("numberList")}>Number list</RadioButton>
                <RadioButton selected={inputFormat === "hexString"} onClick={() => setInputFormat("hexString")} >Hex string</RadioButton>
                <RadioButton selected={inputFormat === "lzBase85"} onClick={() => setInputFormat("lzBase85")}>LZ Base85</RadioButton>
                <RadioButton selected={inputFormat === "auto"} onClick={() => setInputFormat("auto")}>Auto</RadioButton>

                <div style={{ display: "flex", alignItems: "center" }}>{CharMap.RightTriangle}{detectedFormat}</div>
            </ButtonGroup>
            <div>
                <label>For LZ Base85 input, specify expected decoded byte length:
                    <input type="number" value={inputDecodedLength} onChange={e => setInputDecodedLength(Number(e.target.value))}></input>
                </label>
            </div>
            <textarea className="debug-panel-textarea" value={inputText} onChange={e => setInputText(e.target.value)} />

            <div className="debug-panel-output">
                <ButtonGroup>
                    <RadioButton selected={outputFormat === "numberList"} onClick={() => setOutputFormat("numberList")}>Number list</RadioButton>
                    <RadioButton selected={outputFormat === "hexString"} onClick={() => setOutputFormat("hexString")} >Hex string</RadioButton>
                    <RadioButton selected={outputFormat === "lzBase85"} onClick={() => setOutputFormat("lzBase85")}>LZ Base85</RadioButton>
                </ButtonGroup>
                <div className="debug-panel-output-label">Processed Output</div>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    maxWidth: "300px",
                }}>
                    <BarValue value={inputText.length} max={Math.max(inputText.length, outputText.length)} label={<SizeValue value={inputText.length} />} />
                    <BarValue value={outputText.length} max={Math.max(inputText.length, outputText.length)} label={<SizeValue value={outputText.length} />} />
                    <div className="debug-panel-output-label">Decoded bytes: {inputByteCount} (LZ bytes: {outputByteCount})</div>
                    <ButtonGroup>
                        <Button onClick={() => clipboard.copyTextToClipboard(outputText)}>Copy</Button>
                    </ButtonGroup>
                </div>
                <div className="debug-panel-output-content">{outputText}</div>
                {
                    outputFormat === "lzBase85" && (
                        <div className="debug-panel-output-label">LZ Base85 decoded length: {outputDecodedLength}</div>
                    )
                }
            </div>
        </div>
    </AppPanelShell>;
}

