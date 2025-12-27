

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
import {clamp, CoalesceBoolean} from "../utils/utils";
import {Tic80Caps} from "./tic80Capabilities";

export const SongOrderMarkerVariantValues = [
   "default",
   "star",
   "question",
   "exclamation",
   "check",

   "blank",
   "asterisk",
   "circle",
   "up",
   "doubleUp",


   "heart",
   "diamond",
   "club",
   "spade",
] as const;

export type SongOrderMarkerVariant = typeof SongOrderMarkerVariantValues[number];


export interface SongOrderDto {
   patternIndex: number;
   markerVariant: SongOrderMarkerVariant;
}

export class SongOrderItem {
   patternIndex: number;
   markerVariant: SongOrderMarkerVariant;

   constructor(data: Partial<SongOrderDto|number> = {}) {
      if (typeof data === "number") {
         this.patternIndex = data;
         this.markerVariant = "default";
      } else {
         this.patternIndex = data.patternIndex ?? 0;
         this.markerVariant = data.markerVariant ?? "default";
      }
   }

   static fromData(data?: Partial<SongOrderDto>): SongOrderItem {
      return new SongOrderItem(data || {});
   }

   toData(): SongOrderDto {
      return {
         patternIndex: this.patternIndex,  //
         markerVariant: this.markerVariant //
      };
   }

   clone(): SongOrderItem {
      return new SongOrderItem(this.toData());
   }

   contentSignature(): string {
      return this.patternIndex.toString();
   }
}
