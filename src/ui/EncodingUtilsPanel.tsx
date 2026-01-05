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

const NUMBER_LIST_FORMATS = ["u8", "s8", "u16", "s16", "u32", "s32"] as const;
type NumberListFormat = typeof NUMBER_LIST_FORMATS[number];
type SnipFormat2 = NumberListFormat | "hexString" | "lzBase85";

function isNumberListFormat(fmt: SnipFormat2): fmt is NumberListFormat {
    return (NUMBER_LIST_FORMATS as readonly string[]).includes(fmt);
}

function parseNumberListToNumbers(src: string): Result<number[]> {
    const nums = src.match(/-?\d+/g) ?? [];
    if (nums.length === 0) {
        return err("No numbers found.");
    }
    const out: number[] = [];
    for (const tok of nums) {
        const n = Number.parseInt(tok, 10);
        if (!Number.isFinite(n)) {
            return err(`Invalid number: ${tok}`);
        }
        out.push(n);
    }
    return ok(out);
}

function detectNumberListFormat(values: readonly number[]): NumberListFormat {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }

    const hasNeg = min < 0;
    if (hasNeg) {
        if (min >= -128 && max <= 127) return "s8";
        if (min >= -32768 && max <= 32767) return "s16";
        return "s32";
    }
    if (max <= 0xff) return "u8";
    if (max <= 0xffff) return "u16";
    return "u32";
}

function parseNumberListToBytes(src: string, fmt: NumberListFormat): Result<Uint8Array> {
    const parsed = parseNumberListToNumbers(src);
    if (!parsed.ok) return parsed;
    const values = parsed.value;

    const stride = (fmt === "u8" || fmt === "s8") ? 1 : (fmt === "u16" || fmt === "s16") ? 2 : 4;
    const out = new Uint8Array(values.length * stride);
    let o = 0;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (fmt === "u8") {
            if (v < 0 || v > 0xff) return err(`U8 out of range (0..255): ${v}`);
            out[o++] = v & 0xff;
        } else if (fmt === "s8") {
            if (v < -128 || v > 127) return err(`S8 out of range (-128..127): ${v}`);
            out[o++] = v & 0xff;
        } else if (fmt === "u16") {
            if (v < 0 || v > 0xffff) return err(`U16 out of range (0..65535): ${v}`);
            out[o++] = v & 0xff;
            out[o++] = (v >>> 8) & 0xff;
        } else if (fmt === "s16") {
            if (v < -32768 || v > 32767) return err(`S16 out of range (-32768..32767): ${v}`);
            const u = v & 0xffff;
            out[o++] = u & 0xff;
            out[o++] = (u >>> 8) & 0xff;
        } else if (fmt === "u32") {
            if (v < 0 || v > 0xffffffff) return err(`U32 out of range (0..4294967295): ${v}`);
            const u = v >>> 0;
            out[o++] = u & 0xff;
            out[o++] = (u >>> 8) & 0xff;
            out[o++] = (u >>> 16) & 0xff;
            out[o++] = (u >>> 24) & 0xff;
        } else {
            // s32
            if (v < -2147483648 || v > 2147483647) return err(`S32 out of range (-2147483648..2147483647): ${v}`);
            const u = v >>> 0;
            out[o++] = u & 0xff;
            out[o++] = (u >>> 8) & 0xff;
            out[o++] = (u >>> 16) & 0xff;
            out[o++] = (u >>> 24) & 0xff;
        }
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

function detectInputFormat(src: string): SnipFormat2 {
    const s = src.trim();
    // number list if it contains only digits, commas, whitespace, braces/brackets/parens, minus.
    if (/^[\s\d,{}\[\]()\-]+$/.test(s) && /\d/.test(s)) {
        const nums = parseNumberListToNumbers(s);
        if (nums.ok) return detectNumberListFormat(nums.value);
        return "u8";
    }
    // hex string if it contains only hex digits, whitespace, quotes, 0x prefix.
    if (/^[\s0-9a-fA-F"'x]+$/.test(s) && /[0-9a-fA-F]/.test(s)) {
        return "hexString";
    }
    return "lzBase85";
}

function bytesToNumberListLua(bytes: Uint8Array, fmt: NumberListFormat): Result<string> {
    const stride = (fmt === "u8" || fmt === "s8") ? 1 : (fmt === "u16" || fmt === "s16") ? 2 : 4;
    if (bytes.length % stride !== 0) {
        return err(`Byte length ${bytes.length} is not a multiple of ${stride} for ${fmt.toUpperCase()}.`);
    }

    const values: number[] = [];
    for (let i = 0; i < bytes.length; i += stride) {
        if (fmt === "u8") {
            values.push(bytes[i]);
        } else if (fmt === "s8") {
            const b = bytes[i];
            values.push(b >= 0x80 ? b - 0x100 : b);
        } else if (fmt === "u16") {
            values.push(bytes[i] | (bytes[i + 1] << 8));
        } else if (fmt === "s16") {
            const u = bytes[i] | (bytes[i + 1] << 8);
            values.push(u >= 0x8000 ? u - 0x10000 : u);
        } else if (fmt === "u32") {
            const u = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
            values.push(u);
        } else {
            const u = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0;
            values.push(u >= 0x80000000 ? u - 0x100000000 : u);
        }
    }
    return ok(`{${values.join(",")}}`);
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
    const [inputFormat, setInputFormat] = useState<SnipFormat2 | "auto">("auto");
    const [inputDecodedLength, setInputDecodedLength] = useState(0);
    const [detectedFormat, setDetectedFormat] = useState<SnipFormat2 | "error">("error");
    const [outputText, setOutputText] = useState("");
    const [outputDecodedLength, setOutputDecodedLength] = useState("");
    const [outputFormat, setOutputFormat] = useState<SnipFormat2>("hexString");
    const clipboard = useClipboard();

    const decodedBytes = useMemo((): Result<Uint8Array> => {
        const fmt: SnipFormat2 = inputFormat === "auto" ? detectInputFormat(inputText) : inputFormat;

        setDetectedFormat(fmt);

        if (isNumberListFormat(fmt)) return parseNumberListToBytes(inputText, fmt);
        if (fmt === "hexString") return parseHexStringToBytes(inputText);
        return decodeLzBase85ToBytes({ lua: inputText, decodedLength: inputDecodedLength });
    }, [inputText, inputFormat, inputDecodedLength]);

    useEffect(() => {
        if (!decodedBytes.ok) {
            setOutputText(`-- ERROR\n${decodedBytes.error}`);
            return;
        }
        const bytes = decodedBytes.value;
        if (isNumberListFormat(outputFormat)) {
            const lua = bytesToNumberListLua(bytes, outputFormat);
            setOutputText(lua.ok ? lua.value : `-- ERROR\n${lua.error}`);
        } else if (outputFormat === "hexString") {
            setOutputText(bytesToHexStringLua(bytes));
        } else {
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
                <RadioButton selected={inputFormat === "u8"} onClick={() => setInputFormat("u8")}>U8</RadioButton>
                <RadioButton selected={inputFormat === "s8"} onClick={() => setInputFormat("s8")}>S8</RadioButton>
                <RadioButton selected={inputFormat === "u16"} onClick={() => setInputFormat("u16")}>U16</RadioButton>
                <RadioButton selected={inputFormat === "s16"} onClick={() => setInputFormat("s16")}>S16</RadioButton>
                <RadioButton selected={inputFormat === "u32"} onClick={() => setInputFormat("u32")}>U32</RadioButton>
                <RadioButton selected={inputFormat === "s32"} onClick={() => setInputFormat("s32")}>S32</RadioButton>
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
                    <RadioButton selected={outputFormat === "u8"} onClick={() => setOutputFormat("u8")}>U8</RadioButton>
                    <RadioButton selected={outputFormat === "s8"} onClick={() => setOutputFormat("s8")}>S8</RadioButton>
                    <RadioButton selected={outputFormat === "u16"} onClick={() => setOutputFormat("u16")}>U16</RadioButton>
                    <RadioButton selected={outputFormat === "s16"} onClick={() => setOutputFormat("s16")}>S16</RadioButton>
                    <RadioButton selected={outputFormat === "u32"} onClick={() => setOutputFormat("u32")}>U32</RadioButton>
                    <RadioButton selected={outputFormat === "s32"} onClick={() => setOutputFormat("s32")}>S32</RadioButton>
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

