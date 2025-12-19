import React from "react";
import {Coord2D, Rect2D} from "../utils/utils";

type UseRectSelection2DArgs = {
   selection: Rect2D|null; //
   onChange: (next: Rect2D) => void;

   // how to treat "extend selection" when shift is held and there is an existing selection
   getAnchorFromSelection?: (sel: Rect2D) => Coord2D; // default: {row: sel.startRow, col: sel.startCol}

   // Optional clamp for keyboard/mouse programmatic moves (grid bounds, etc.)
   clampCoord: (coord: Coord2D) => Coord2D;

   // If you want to always store normalized rects (min/max) in your state
   //normalize?: boolean; // default false (keep anchor semantics raw)
};

// function normalizeRect(r: Rect2D): Rect2D {
//    const startRow = Math.min(r.startRow, r.endRow);
//    const endRow = Math.max(r.startRow, r.endRow);
//    const startCol = Math.min(r.startCol, r.endCol);
//    const endCol = Math.max(r.startCol, r.endCol);
//    return {startRow, endRow, startCol, endCol};
// }

export function useRectSelection2D({
   selection,
   onChange,
   getAnchorFromSelection = (sel) => ({row: sel.startRow, col: sel.startCol}),
   clampCoord,
   //normalize = false,
}: UseRectSelection2DArgs) {
   const anchorRef = React.useRef<Coord2D|null>(null);
   const selectingRef = React.useRef(false);
   const [isSelecting, setIsSelecting] = React.useState(false);

   const apply = (next: Rect2D) => {
      console.log("apply selection", next);
      onChange(next);
   };

   const setAnchor = React.useCallback((coord: Coord2D) => {
      anchorRef.current = clampCoord ? clampCoord(coord) : coord;
   }, [clampCoord]);

   const resolveAnchorForExtend = React.useCallback((): Coord2D|null => {
      if (anchorRef.current)
         return anchorRef.current;
      if (selection)
         return getAnchorFromSelection(selection);
      return null;
   }, [selection, getAnchorFromSelection]);

   const begin = React.useCallback((coord: Coord2D, extend: boolean) => {
      const c = clampCoord ? clampCoord(coord) : coord;
      let anchor = anchorRef.current;

      if (extend) {
         if (!anchor && selection)
            anchor = getAnchorFromSelection(selection);
      } else {
         anchor = null; // start new selection
      }

      if (!anchor)
         anchor = c;
      anchorRef.current = anchor;

      selectingRef.current = true;
      setIsSelecting(true);

      apply({
         startRow: anchor.row,
         endRow: c.row,
         startCol: anchor.col,
         endCol: c.col,
      });
   }, [selection, getAnchorFromSelection, clampCoord, apply]);

   const move = React.useCallback((coord: Coord2D) => {
      if (!selectingRef.current)
         return;
      const anchor = anchorRef.current;
      if (!anchor)
         return;
      const c = clampCoord ? clampCoord(coord) : coord;

      apply({
         startRow: anchor.row,
         endRow: c.row,
         startCol: anchor.col,
         endCol: c.col,
      });
   }, [clampCoord, apply]);

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

   const onCellMouseEnter = React.useCallback(
      (coord: Coord2D) => move(coord),
      [move],
   );

   /**
   * Programmatically extend (or replace) selection to a coordinate.
   * Use this for keyboard-driven selection changes.
   *
   * Typical usage:
   * - shift+arrow: extendTo(nextFocus, true)
   * - arrow (no shift): extendTo(nextFocus, false) and also setAnchor(nextFocus)
   */
   const extendTo = React.useCallback((coord: Coord2D, extend: boolean = true) => {
      const c = clampCoord ? clampCoord(coord) : coord;

      let anchor: Coord2D|null = null;
      if (extend)
         anchor = resolveAnchorForExtend();

      if (!extend || !anchor) {
         // replace selection and reset anchor to the new point
         anchor = c;
         anchorRef.current = c;
      }

      apply({
         startRow: anchor.row,
         endRow: c.row,
         startCol: anchor.col,
         endCol: c.col,
      });
   }, [clampCoord, resolveAnchorForExtend, apply]);

   /**
   * Move the *active end* of the current selection by a delta (shift+arrow).
   * If no selection exists, behaves like extendTo(anchor+delta) with a fresh anchor.
   */
   const nudgeActiveEnd = React.useCallback((delta: {dRow: number; dCol: number}) => {
      // Determine current "active end" to move.
      // If we have a selection, use its end (not normalized) to preserve direction.
      const currentEnd: Coord2D|null = selection ? //
         {row: selection.endRow, col: selection.endCol} :
         anchorRef.current;

      const base = currentEnd ?? resolveAnchorForExtend() ?? {row: 0, col: 0};
      const next = {row: base.row + delta.dRow, col: base.col + delta.dCol};

      console.log("nudgeActiveEnd", {base, next, delta, currentEnd});

      // Always extending when nudging (this is the shift+arrow primitive)
      extendTo(next, true);
   }, [selection, resolveAnchorForExtend, extendTo]);

   return {
      isSelecting,
      setAnchor,
      onCellMouseDown,
      onCellMouseEnter,
      end,

      extendTo,
      nudgeActiveEnd,
   };
}
