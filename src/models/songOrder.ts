

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
import {clamp, CoalesceBoolean} from "../utils/utils";
import {Tic80Caps} from "./tic80Capabilities";

export interface SongOrderDto {
   patternIndex: number;
}

export class SongOrderItem {
   patternIndex: number;

   constructor(data: Partial<SongOrderDto|number> = {}) {
      if (typeof data === "number") {
         this.patternIndex = data;
      } else {
         this.patternIndex = data.patternIndex ?? 0;
      }
   }

   static fromData(data?: Partial<SongOrderDto>): SongOrderItem {
      return new SongOrderItem(data || {});
   }

   toData(): SongOrderDto {
      return {patternIndex: this.patternIndex};
   }

   clone(): SongOrderItem {
      return new SongOrderItem(this.toData());
   }

   contentSignature(): string {
      return this.patternIndex.toString();
   }
}
