

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format

// these should be semi-semantic, not just random symbols.
// NOTE: keep in sync with
// - theme vars
// - <SongOrderMarkerValue>
export const SongOrderMarkerVariantValues = [
   "default",
   "star",
   //"asterisk",

   "question",
   "exclamation",
   "check",

   //"up",

   "circle1",
   "circle2",
   "circle3",
   "circle4",

   "heart",
   // "diamond",
   // "club",
   // "spade",
   "blank",
   "trash",
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
