import {hash32Fnv1a, xorshift32} from "./utils";
import {SWEETIE16_CONTRAST_INDEX, type TicPaletteIndex} from "../theme/ticPalette";

export type IdenticonRect = {
   x: number; //
   y: number; //
   w: number;
   h: number;
   color: TicPaletteIndex;
};

export type IdenticonDrawList = {
   width: number; //
   height: number;
   foreground: TicPaletteIndex; //
   background: TicPaletteIndex;
   border: TicPaletteIndex;
   rects: IdenticonRect[];
};

export function generateIdenticonDrawList(input: string, width: number, height: number): IdenticonDrawList {
   // `width`/`height` are the *total* icon resolution, including the 1-cell border.
   // Callers that previously used 5x5 should use 6x6 to keep a similar inner density.
   const w = Math.max(1, width | 0);
   const h = Math.max(1, height | 0);

   const seed = hash32Fnv1a(input);
   const rand = xorshift32(seed ^ 0x9e3779b9);

   const foreground = (rand() % 16) as TicPaletteIndex;
   const background = SWEETIE16_CONTRAST_INDEX[foreground];
   const border = background;

   const rects: IdenticonRect[] = [];
   // background fill
   rects.push({x: 0, y: 0, w: w, h: h, color: background});

   // 1-cell border around the icon, to keep contrast against surrounding UI.
   // For our Sweetie16 contrast map, `background` is typically 0 or 12; taking its contrast
   // yields a reliable opposite for the border.
   if (w >= 2) {
      rects.push({x: 0, y: 0, w: w, h: 1, color: border});     // top
      rects.push({x: 0, y: h - 1, w: w, h: 1, color: border}); // bottom
   }
   if (h >= 2) {
      rects.push({x: 0, y: 0, w: 1, h: h, color: border});     // left
      rects.push({x: w - 1, y: 0, w: 1, h: h, color: border}); // right
   }

   const innerW = Math.max(1, w - 2);
   const innerH = Math.max(1, h - 2);

   const halfW = Math.ceil(innerW / 2);

   //console.log(`Identicon gen: input=${input} seed=${seed.toString(16)} fg=${foreground} bg=${background}`);

   // horizontal mirroring gives the standard identicon look
   for (let y = 0; y < innerH; y++) {
      for (let x = 0; x < halfW; x++) {
         const bit = (rand() >>> 31) & 1;
         if (bit === 0)
            continue;

         rects.push({x: x + 1, y: y + 1, w: 1, h: 1, color: foreground});

         const mirrorX = innerW - 1 - x;
         if (mirrorX !== x) {
            rects.push({x: mirrorX + 1, y: y + 1, w: 1, h: 1, color: foreground});
         }
      }
   }

   return {
      width: w,
      height: h,
      foreground,
      background,
      border,
      rects,
   };
}
