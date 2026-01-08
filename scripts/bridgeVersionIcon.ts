import {toLuaStringLiteral} from "../src/utils/utils";
import {generateIdenticonDrawList} from "../src/utils/identicon";
import {getSomaticVersionString, type BuildInfoLike} from "../src/utils/versionString";

export function emitBridgeVersionIconLua(
   info: BuildInfoLike, opts?: {resolution?: {w: number; h: number}}): {versionString: string; lua: string;} {
   const resolution = opts?.resolution ?? {w: 8, h: 8};

   const versionString = getSomaticVersionString(info, "Somatic");
   const icon = generateIdenticonDrawList(versionString, resolution.w, resolution.h);

   const lines: string[] = [];
   lines.push("-- Version identicon + version string (generated)");
   lines.push(`SOMATIC_VERSION_STRING = ${toLuaStringLiteral(versionString)}`);
   lines.push("");

   // Emit data as a flat array of numbers: x,y,w,h,color, ...
   // This keeps the Lua simple and deterministic.
   const flat: number[] = [];
   for (const r of icon.rects) {
      flat.push(r.x | 0, r.y | 0, r.w | 0, r.h | 0, r.color | 0);
   }
   lines.push(`local __somatic_version_icon_w = ${icon.width}`);
   lines.push(`local __somatic_version_icon_h = ${icon.height}`);
   lines.push(`local __somatic_version_icon_rects = { ${flat.join(", ")} }`);
   lines.push("");

   lines.push("function renderVersionIcon(x, y, scale)");
   lines.push("  scale = scale or 1");
   lines.push("  local rs = __somatic_version_icon_rects");
   lines.push("  local i = 1");
   lines.push("  while i <= #rs do");
   lines.push("    local rx = rs[i]; local ry = rs[i+1]; local rw = rs[i+2]; local rh = rs[i+3]; local col = rs[i+4]");
   lines.push("    rect(x + rx * scale, y + ry * scale, rw * scale, rh * scale, col)");
   lines.push("    i = i + 5");
   lines.push("  end");
   lines.push("end");
   lines.push("");

   return {versionString, lua: lines.join("\n")};
}
