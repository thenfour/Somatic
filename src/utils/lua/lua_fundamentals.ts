//import { assert } from "../errorHandling";

// takes string contents, returns Lua string literal with quotes and escapes.
export function toLuaStringLiteral(str: string): string {
  const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

// Replace one or more Lua "blocks" delimited by begin/end marker lines.
// - Markers are matched as substrings within their lines (so callers can pass "-- BEGIN_BLARG").
// - The entire block (including marker lines and inner contents) is replaced with `replacement`.
type LuaBlockSpan = {
  eol: string;
  beginLineStart0: number;
  innerStart: number;
  endLineStart0: number;
  blockEnd: number;
  nextSearchFrom: number;
};

function findNextLuaBlockSpan(
  src: string,
  beginMarker: string,
  endMarker: string,
  searchFrom: number,
  strict: boolean,
): LuaBlockSpan | null {
  const eol = src.includes("\r\n") ? "\r\n" : "\n";

  const beginIdx = src.indexOf(beginMarker, searchFrom);
  if (beginIdx < 0) return null;

  const beginLineStart = Math.max(0, src.lastIndexOf(eol, beginIdx));
  const beginLineStart0 = beginLineStart === 0 ? 0 : beginLineStart + eol.length;
  const beginLineEnd = src.indexOf(eol, beginIdx);
  const innerStart = beginLineEnd < 0 ? src.length : beginLineEnd + eol.length;

  const endIdx = src.indexOf(endMarker, innerStart);
  if (endIdx < 0) {
    if (strict) {
      // assert(false, `replaceLuaBlock: end marker not found: ${endMarker}`);
      throw new Error(`replaceLuaBlock: end marker not found: ${endMarker}`);
    }
    return null;
  }

  const endLineStart = Math.max(0, src.lastIndexOf(eol, endIdx));
  const endLineStart0 = endLineStart === 0 ? 0 : endLineStart + eol.length;
  const endLineEnd = src.indexOf(eol, endIdx);
  const blockEnd = endLineEnd < 0 ? src.length : endLineEnd + eol.length;

  return {
    eol,
    beginLineStart0,
    innerStart,
    endLineStart0,
    blockEnd,
    nextSearchFrom: beginLineStart0,
  };
}

export function replaceLuaBlock(src: string, beginMarker: string, endMarker: string, replacement: string): string {
  let out = src;
  let searchFrom = 0;
  while (true) {
    const span = findNextLuaBlockSpan(out, beginMarker, endMarker, searchFrom, true);
    if (!span) break;

    // Normalize line endings to match the surrounding source.
    // If the replaced block was followed by more content, ensure the replacement ends with EOL
    // so the last replacement line doesn't get merged into the following line.
    let replacementNorm = replacement.replace(/\r?\n/g, span.eol);
    if (replacementNorm.length > 0 && !replacementNorm.endsWith(span.eol) && span.blockEnd < out.length) {
      replacementNorm += span.eol;
    }

    out = out.slice(0, span.beginLineStart0) + replacementNorm + out.slice(span.blockEnd);
    searchFrom = span.beginLineStart0 + replacementNorm.length;
  }

  return out;
}

export type ExtractedLuaBlock = {
  placeholder: string;
  content: string;
};

// Extract blocks delimited by begin/end markers and replace them with placeholders.
// Similar scanning semantics to replaceLuaBlock(), but captures inner content for reinsertion.
export function extractLuaBlocks(
  src: string,
  beginMarker: string,
  endMarker: string,
  placeholderFactory: (index: number) => string,
  options?: { strict?: boolean },
): { code: string; blocks: ExtractedLuaBlock[] } {
  const strict = options?.strict ?? false;
  const blocks: ExtractedLuaBlock[] = [];

  let out = src;
  let searchFrom = 0;
  let i = 0;

  while (true) {
    const span = findNextLuaBlockSpan(out, beginMarker, endMarker, searchFrom, strict);
    if (!span) break;

    const content = out.slice(span.innerStart, span.endLineStart0);
    const placeholder = placeholderFactory(i);
    const replacement = placeholder + span.eol;

    blocks.push({ placeholder, content });
    out = out.slice(0, span.beginLineStart0) + replacement + out.slice(span.blockEnd);
    searchFrom = span.beginLineStart0 + replacement.length;
    i++;
  }

  return { code: out, blocks };
}

// Remove any Lua lines that contain one of the specified marker substrings.
// Useful for stripping marker comments while leaving surrounding code untouched.
export function removeLuaBlockMarkers(src: string, markers: string[]): string {
  if (markers.length === 0) return src;

  const eol = src.includes("\r\n") ? "\r\n" : "\n";
  const lines = src.split(/\r?\n/);
  const filtered = lines.filter((line) => !markers.some((m) => m && line.includes(m)));
  return filtered.join(eol);
}
