import React from "react";

export type Rect2D = {
   startRow: number; endRow: number; startCol: number; endCol: number
};
export type Coord2D = {
   row: number; col: number
};

type UseRectSelection2DArgs = {
   selection: Rect2D|null; onChange: (next: Rect2D) => void;
   // how to treat "extend selection" when shift is held and there is an existing selection
   getAnchorFromSelection?: (sel: Rect2D) => Coord2D; // default: {row: sel.startRow, col: sel.startCol}
};

export function useRectSelection2D({
   selection,
   onChange,
   getAnchorFromSelection = (sel) => ({row: sel.startRow, col: sel.startCol}),
}: UseRectSelection2DArgs) {
   const anchorRef = React.useRef<Coord2D|null>(null);
   const selectingRef = React.useRef(false);
   const [isSelecting, setIsSelecting] = React.useState(false);

   const setAnchor = React.useCallback((coord: Coord2D) => {
      //console.log("rect selection set anchor ", coord);
      anchorRef.current = coord;
   }, []);

   const begin = React.useCallback((coord: Coord2D, extend: boolean) => {
      let anchor = anchorRef.current;

      if (extend) {
         if (!anchor && selection) {
            //console.log("extending selection from existing selection");
            anchor = getAnchorFromSelection(selection);
         }
      } else {
         // if not extending, then start a new selection
         anchor = null;
      }

      if (!anchor) {
         //console.log("setting new anchor ", coord);
         anchor = coord;
      }
      anchorRef.current = anchor;

      selectingRef.current = true;
      setIsSelecting(true);

      onChange({
         startRow: anchor.row,
         endRow: coord.row,
         startCol: anchor.col,
         endCol: coord.col,
      });
   }, [selection, getAnchorFromSelection, onChange]);

   const move = React.useCallback((coord: Coord2D) => {
      //console.log("rect selection move to ", coord);
      if (!selectingRef.current)
         return;
      const anchor = anchorRef.current;
      if (!anchor)
         return;

      onChange({
         startRow: anchor.row,
         endRow: coord.row,
         startCol: anchor.col,
         endCol: coord.col,
      });
   }, [onChange]);

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
         //console.log("cell mouse down", coord);
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

   return {isSelecting, setAnchor, onCellMouseDown, onCellMouseEnter, end};
}
