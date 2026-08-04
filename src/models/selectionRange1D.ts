import {clamp} from "../utils/utils";

export interface SelectionRange1DDto {
   anchor: number;
   focus: number;
}

/**
 * inclusive, contiguous one-dimensional selection.
 *
 * `anchor` stays fixed while a selection is extended. `focus` is the active
 * end and can cross the anchor, which lets callers preserve selection
 * direction without signed-size edge cases.
 */
export class SelectionRange1D {
   constructor({anchor, focus}: SelectionRange1DDto) {
      this.anchor = Math.trunc(anchor);
      this.focus = Math.trunc(focus);
   }

   static single(index: number): SelectionRange1D {
      return new SelectionRange1D({anchor: index, focus: index});
   }

   static fromSignedSize(anchor: number, signedSize: number): SelectionRange1D {
      const focus = signedSize < 0 ? anchor + signedSize + 1 : anchor + Math.max(1, signedSize) - 1;
      return new SelectionRange1D({anchor, focus});
   }

   readonly anchor: number;
   readonly focus: number;

   firstInclusive(): number {
      return Math.min(this.anchor, this.focus);
   }

   lastInclusive(): number {
      return Math.max(this.anchor, this.focus);
   }

   count(): number {
      return this.lastInclusive() - this.firstInclusive() + 1;
   }

   includes(index: number): boolean {
      return index >= this.firstInclusive() && index <= this.lastInclusive();
   }

   indices(): number[] {
      return Array.from({length: this.count()}, (_, offset) => this.firstInclusive() + offset);
   }

   signedSize(): number {
      const delta = this.focus - this.anchor;
      if (delta === 0)
         return 1;
      return delta + (delta < 0 ? -1 : 1);
   }

   withFocus(focus: number): SelectionRange1D {
      return new SelectionRange1D({anchor: this.anchor, focus});
   }

   withNudge(delta: number): SelectionRange1D {
      return new SelectionRange1D({anchor: this.anchor + delta, focus: this.focus + delta});
   }

   withClampedBounds(minIndex: number, maxIndex: number): SelectionRange1D {
      const safeMax = Math.max(minIndex, maxIndex);
      return new SelectionRange1D({
         anchor: clamp(this.anchor, minIndex, safeMax),
         focus: clamp(this.focus, minIndex, safeMax),
      });
   }

   toData(): SelectionRange1DDto {
      return {anchor: this.anchor, focus: this.focus};
   }
}
