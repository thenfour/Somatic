import React from "react";
import {assert, Coord2D, Rect2D, signNonZero, Size2D} from "../utils/utils";

// it's not a geometric rect because of sizing and anchoring behavior.
export class SelectionRect2D {
   constructor(rect: Rect2D|null = null) {
      if (!rect)
         return;
      this.anchor = {
         x: rect.start.x, //
         y: rect.start.y
      };
      this.size = {
         width: rect.size.width, //
         height: rect.size.height
      };
   }

   toData(): Rect2D|null {
      if (!this.anchor || !this.size)
         return null;
      return {start: {x: this.anchor.x, y: this.anchor.y}, size: {width: this.size.width, height: this.size.height}};
   }

   includesCoord(coord: Coord2D): boolean {
      if (!this.anchor || !this.size)
         return false;
      const left = this.leftInclusive()!;
      const right = this.rightInclusive()!;
      const top = this.topInclusive()!;
      const bottom = this.bottomInclusive()!;
      return coord.x >= left && coord.x <= right && coord.y >= top && coord.y <= bottom;
   }

   includesX(x: number): boolean {
      if (!this.anchor || !this.size)
         return false;
      const left = this.leftInclusive()!;
      const right = this.rightInclusive()!;
      return x >= left && x <= right;
   }

   includesY(y: number): boolean {
      if (!this.anchor || !this.size)
         return false;
      const top = this.topInclusive()!;
      const bottom = this.bottomInclusive()!;
      return y >= top && y <= bottom;
   }

   topInclusive(): number|null {
      if (!this.anchor || !this.size)
         return null;
      if (this.size.height >= 0) {
         return this.anchor.y;
      } else {
         return this.anchor.y + this.size.height;
      }
   }

   leftInclusive(): number|null {
      if (!this.anchor || !this.size)
         return null;
      if (this.size.width >= 0) {
         return this.anchor.x;
      } else {
         return this.anchor.x + this.size.width;
      }
   }

   rightInclusive(): number|null {
      if (!this.anchor || !this.size)
         return null;
      if (this.size.width >= 0) {
         return this.anchor.x + this.size.width - 1;
      } else {
         return this.anchor.x;
      }
   }

   bottomInclusive(): number|null {
      if (!this.anchor || !this.size)
         return null;
      if (this.size.height >= 0) {
         return this.anchor.y + this.size.height - 1;
      } else {
         return this.anchor.y;
      }
   }

   rowCount(): number|null {
      if (!this.size)
         return null;
      return Math.abs(this.size.height);
   }

   columnCount(): number|null {
      if (!this.size)
         return null;
      return Math.abs(this.size.width);
   }

   getAllCells(): Coord2D[] {
      const cells: Coord2D[] = [];
      const left = this.leftInclusive();
      const right = this.rightInclusive();
      const top = this.topInclusive();
      const bottom = this.bottomInclusive();
      if (left === null || right === null || top === null || bottom === null)
         return cells;
      for (let y = top; y <= bottom; y++) {
         for (let x = left; x <= right; x++) {
            cells.push({x, y});
         }
      }
      return cells;
   }

   isNull(): boolean {
      return this.anchor === null || this.size === null;
   }

   isNotNull(): boolean {
      return !this.isNull();
   }

   withNudgedSize(delta: Size2D): SelectionRect2D {
      const next = new SelectionRect2D(this.toData());
      if (!next.size)
         return next;
      next.size = {
         width: next.size.width + delta.width,
         height: next.size.height + delta.height,
      };
      // avoid 0-sized rects
      if (next.size.width === 0) {
         if (delta.width > 0) {
            next.size.width = 1;
         } else if (delta.width < 0) {
            next.size.width = -1;
         }
      }
      if (next.size.height === 0) {
         if (delta.height > 0) {
            next.size.height = 1;
         } else if (delta.height < 0) {
            next.size.height = -1;
         }
      }
      return next;
   }

   withClampedCoords(clampFunc: (coord: Coord2D) => Coord2D): SelectionRect2D {
      const next = new SelectionRect2D(this.toData());
      if (!next.anchor || !next.size)
         return next;

      // simplify the calculation by assuming anchor is already in bounds. so only the size needs adjusting.
      const clampedAnchor = clampFunc(next.anchor);
      assert(clampedAnchor.x === clampedAnchor.x);
      assert(clampedAnchor.y === clampedAnchor.y);

      // ensure size is adjusted so that the end coordinate is clamped.
      // because size can be negative, check top & left
      if (next.size.width < 0) {
         const left = this.leftInclusive()!;
         const clampedLeft = clampFunc({x: left, y: next.anchor.y}).x;
         const adjustmentDeltaX = clampedLeft - left;
         next.size = {
            width: next.size.width + adjustmentDeltaX,
            height: next.size.height,
         };
      } else {
         const right = this.rightInclusive()!;
         const clampedRight = clampFunc({x: right, y: next.anchor.y}).x;
         const adjustmentDeltaX = clampedRight - right;
         next.size = {
            width: next.size.width + adjustmentDeltaX,
            height: next.size.height,
         };
      }

      if (next.size.height < 0) {
         const top = this.topInclusive()!;
         const clampedTop = clampFunc({x: next.anchor.x, y: top}).y;
         const adjustmentDeltaY = clampedTop - top;
         next.size = {
            width: next.size.width,
            height: next.size.height + adjustmentDeltaY,
         };
      } else {
         const bottom = this.bottomInclusive()!;
         const clampedBottom = clampFunc({x: next.anchor.x, y: bottom}).y;
         const adjustmentDeltaY = clampedBottom - bottom;
         next.size = {
            width: next.size.width,
            height: next.size.height + adjustmentDeltaY,
         };
      }

      return next;
   }

   private anchor: Coord2D|null = null;
   private size: Size2D|null = null;

   toString(): string {
      return `[anchor=${this.anchor ? `{x:${this.anchor.x},y:${this.anchor.y}}` : "null"}, size=${
         this.size ? `{width:${this.size.width},height:${this.size.height}} -> lt[${this.leftInclusive()},${
                        this.topInclusive()}] rb[${this.rightInclusive()},${this.bottomInclusive()}]` :
                     "null"}]`;
   }
};

type UseRectSelection2DArgs = {
   selection: SelectionRect2D|null; onChange: (next: SelectionRect2D) => void;

   clampCoord: (coord: Coord2D) => Coord2D;

   // How to get the anchor from an existing selection when extend=true and no anchorRef exists.
   // With start+size semantics, default anchor is simply the rect's start.
   //getAnchorFromSelection?: (sel: Rect2D) => Coord2D; //
   normalize: boolean; // whether to normalize the rect (make size positive) on apply
};

function sizeFromAnchorToEnd(anchor: Coord2D, end: Coord2D): Size2D {
   const dy = end.y - anchor.y;
   const dx = end.x - anchor.x;
   // inclusive: distance 0 => size 1
   const height = dy === 0 ? 1 : dy + signNonZero(dy);
   const width = dx === 0 ? 1 : dx + signNonZero(dx);
   return {height, width};
}

export function useRectSelection2D({
   selection,
   onChange,
   clampCoord,
}: UseRectSelection2DArgs) {
   const anchorRef = React.useRef<Coord2D|null>(null);
   const selectingRef = React.useRef(false);
   const [isSelecting, setIsSelecting] = React.useState(false);

   const setAnchor = React.useCallback(
      (coord: Coord2D) => {
         anchorRef.current = clampCoord(coord);
      },
      [clampCoord],
   );

   const apply = React.useCallback(
      (rect: SelectionRect2D) => {
         console.log("apply rect:", rect.toString());
         const next = rect.withClampedCoords(clampCoord);
         onChange(next);
      },
      [onChange],
   );

   // Apply a selection from anchor -> end coordinates
   const applyFromAnchorToEnd = React.useCallback(
      (anchor: Coord2D, end: Coord2D) => {
         const a = clampCoord(anchor);
         const e = clampCoord(end);
         const size = sizeFromAnchorToEnd(a, e);
         const rect = new SelectionRect2D({start: a, size});
         apply(rect);
      },
      [clampCoord, onChange, apply],
   );

   const begin = React.useCallback(
      (coord: Coord2D, extend: boolean) => {
         const c = clampCoord(coord);

         let anchor: Coord2D|null = anchorRef.current;

         // ensure we have an anchor; also if not extending (new selection like first click), set this as the anchor.
         if (!anchor || !extend) {
            anchor = c;
         }
         anchorRef.current = anchor;

         selectingRef.current = true;
         setIsSelecting(true);

         applyFromAnchorToEnd(anchor, c);
      },
      [clampCoord, selection, applyFromAnchorToEnd],
   );

   const move = React.useCallback(
      (coord: Coord2D) => {
         if (!selectingRef.current)
            return;
         const anchor = anchorRef.current;
         if (!anchor)
            return;
         applyFromAnchorToEnd(anchor, coord);
      },
      [applyFromAnchorToEnd],
   );

   const end = React.useCallback(() => {
      selectingRef.current = false;
      setIsSelecting(false);
   }, []);

   React.useEffect(() => {
      if (!isSelecting)
         return;
      const onUp = () => end();
      window.addEventListener("mouseup", onUp);
      return () => window.removeEventListener("mouseup", onUp);
   }, [isSelecting, end]);

   const onCellMouseDown = React.useCallback(
      (e: React.MouseEvent, coord: Coord2D) => {
         if (e.button !== 0)
            return;
         begin(coord, e.shiftKey);
      },
      [begin],
   );

   const onCellMouseEnter = React.useCallback((coord: Coord2D) => move(coord), [move]);

   const nudgeActiveEnd = React.useCallback(
      (delta: {delta: Size2D}) => {
         if (!selection)
            return;
         const next = selection.withNudgedSize(delta.delta);
         apply(next);
      },
      [selection],
   );

   return {
      isSelecting,
      setAnchor,
      onCellMouseDown,
      onCellMouseEnter,
      end,

      nudgeActiveEnd,
   };
}
