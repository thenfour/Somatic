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
   rects: IdenticonRect[];
};

export function generateIdenticonDrawList(input: string, width: number, height: number): IdenticonDrawList {
   const w = Math.max(1, width | 0);
   const h = Math.max(1, height | 0);

   const seed = hash32Fnv1a(input);
   const rand = xorshift32(seed ^ 0x9e3779b9);

   const foreground = (rand() % 16) as TicPaletteIndex;
   const background = SWEETIE16_CONTRAST_INDEX[foreground];

   const rects: IdenticonRect[] = [];
   // background fill
   rects.push({x: 0, y: 0, w: w, h: h, color: background});

   const halfW = Math.ceil(w / 2);

   // horizontal mirroring gives the standard identicon look
   for (let y = 0; y < h; y++) {
      for (let x = 0; x < halfW; x++) {
         const bit = (rand() >>> 31) & 1;
         if (bit === 0)
            continue;

         rects.push({x, y, w: 1, h: 1, color: foreground});

         const mirrorX = w - 1 - x;
         if (mirrorX !== x) {
            rects.push({x: mirrorX, y, w: 1, h: 1, color: foreground});
         }
      }
   }

   return {
      width: w,
      height: h,
      foreground,
      background,
      rects,
   };
}
