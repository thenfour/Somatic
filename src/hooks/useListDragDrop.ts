import type React from "react";
import {useEffect, useMemo, useRef, useState} from "react";
import {clamp} from "../utils/utils";

type UseListDragDropArgs = {
   getSelection: () => number[]; rowRefs: React.MutableRefObject<(HTMLElement|null)[]>;
   containerRef: React.RefObject<HTMLElement>;
   itemCount: number;
   onDrop: (args: {sourceIndices: number[]; targetIndex: number; isCopy: boolean}) => void;
};

type DragState = {
   source: number[]; isCopy: boolean;
};

export const useListDragDrop = ({getSelection, rowRefs, containerRef, itemCount, onDrop}: UseListDragDropArgs) => {
   const [dragState, setDragState] = useState<DragState|null>(null);
   const [dropIndex, setDropIndex] = useState<number|null>(null);
   const [isCopy, setIsCopy] = useState(false);

   const hasSelection = useMemo(() => getSelection().length > 0, [getSelection]);

   const selectionBounds = useMemo(() => {
      const sel = getSelection();
      if (!sel.length)
         return null;
      const rects = sel.map((i) => rowRefs.current[i]?.getBoundingClientRect()).filter((r): r is DOMRect => !!r);
      if (!rects.length)
         return null;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return {left, right, top, bottom};
   }, [getSelection, rowRefs]);

   const handleStyle = useMemo(() => {
      if (!selectionBounds)
         return null;
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect)
         return null;
      const top = selectionBounds.bottom - containerRect.top; // slightly above bottom to sit clear of buttons
      return {
         position: "absolute" as const,
         left: `1px`, // i dunno this looks best.
         top: `${top}px`,
      };
   }, [selectionBounds, containerRef]);

   // Compute insertion index based on pointer Y
   const computeDropIndex = (clientY: number): number => {
      const rects = rowRefs.current.map((node, idx) => ({node, idx})).filter((r): r is {
         node: HTMLElement;
         idx: number
      } => !!r.node);

      for (let i = 0; i < rects.length; i += 1) {
         const {node, idx} = rects[i];
         const r = node.getBoundingClientRect();
         const mid = r.top + r.height / 2;
         if (clientY < mid) {
            return idx;
         }
      }
      return itemCount; // after last
   };

   useEffect(() => {
      if (!dragState)
         return;

      const handleMove = (e: MouseEvent) => {
         const copy = e.ctrlKey || e.metaKey;
         setIsCopy(copy);
         const idx = computeDropIndex(e.clientY);
         setDropIndex(idx);
         e.preventDefault();
      };

      const handleUp = (e: MouseEvent) => {
         const copy = e.ctrlKey || e.metaKey;
         const idx = dropIndex ?? computeDropIndex(e.clientY);
         const bounded = clamp(idx, 0, itemCount);
         onDrop({sourceIndices: dragState.source, targetIndex: bounded, isCopy: copy});
         setDragState(null);
         setDropIndex(null);
         setIsCopy(false);
         window.removeEventListener("mousemove", handleMove, true);
         window.removeEventListener("mouseup", handleUp, true);
      };

      window.addEventListener("mousemove", handleMove, true);
      window.addEventListener("mouseup", handleUp, true);

      return () => {
         window.removeEventListener("mousemove", handleMove, true);
         window.removeEventListener("mouseup", handleUp, true);
      };
   }, [dragState, dropIndex, itemCount, onDrop]);

   const startDrag = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = Array.from(new Set(getSelection())).sort((a, b) => a - b);
      if (!sel.length)
         return;
      const copy = e.ctrlKey || e.metaKey;
      setDragState({source: sel, isCopy: copy});
      setIsCopy(copy);
      setDropIndex(sel[0]);
   };

   return {
      hasSelection,
      isDragging: !!dragState,
      dropIndex,
      isCopy,
      handleStyle,
      onHandleMouseDown: startDrag,
      setDropIndex,
   };
};
