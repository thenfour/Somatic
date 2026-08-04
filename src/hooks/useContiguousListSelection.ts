import React from "react";
import {SelectionRange1D} from "../models/selectionRange1D";
import {clamp} from "../utils/utils";

type UseContiguousListSelectionArgs = {
   selection: SelectionRange1D|null;
   itemCount: number;
   onChange: (next: SelectionRange1D|null) => void;
   focusIndex?: (index: number) => void;
   pageSize?: number;
};

export function useContiguousListSelection({
   selection,
   itemCount,
   onChange,
   focusIndex,
   pageSize = 4,
}: UseContiguousListSelectionArgs) {
   const selectionRef = React.useRef(selection);
   const selectingRef = React.useRef(false);
   const dragAnchorRef = React.useRef<number|null>(null);
   const dragFocusRef = React.useRef<number|null>(null);
   const focusIndexRef = React.useRef(focusIndex);
   const onChangeRef = React.useRef(onChange);
   const [isSelecting, setIsSelecting] = React.useState(false);

   selectionRef.current = selection;
   focusIndexRef.current = focusIndex;
   onChangeRef.current = onChange;

   const clampIndex = React.useCallback((index: number) => {
      return clamp(Math.trunc(index), 0, Math.max(0, itemCount - 1));
   }, [itemCount]);

   const apply = React.useCallback((next: SelectionRange1D|null) => {
      const clamped = next && itemCount > 0 ? next.withClampedBounds(0, itemCount - 1) : null;
      selectionRef.current = clamped;
      onChangeRef.current(clamped);
   }, [itemCount]);

   const selectIndex = React.useCallback((index: number, extend = false) => {
      if (itemCount <= 0)
         return;
      const target = clampIndex(index);
      const current = selectionRef.current;
      const anchor = extend && current ? current.anchor : target;
      apply(new SelectionRange1D({anchor, focus: target}));
   }, [apply, clampIndex, itemCount]);

   const begin = React.useCallback((index: number, extend: boolean) => {
      if (itemCount <= 0)
         return;
      const target = clampIndex(index);
      const current = selectionRef.current;
      const anchor = extend && current ? current.anchor : target;
      dragAnchorRef.current = anchor;
      dragFocusRef.current = target;
      selectingRef.current = true;
      setIsSelecting(true);
      apply(new SelectionRange1D({anchor, focus: target}));
      focusIndexRef.current?.(target);
   }, [apply, clampIndex, itemCount]);

   const move = React.useCallback((index: number) => {
      if (!selectingRef.current || dragAnchorRef.current === null)
         return;
      const target = clampIndex(index);
      dragFocusRef.current = target;
      apply(new SelectionRange1D({anchor: dragAnchorRef.current, focus: target}));
   }, [apply, clampIndex]);

   const end = React.useCallback(() => {
      if (!selectingRef.current)
         return;
      selectingRef.current = false;
      setIsSelecting(false);
      dragAnchorRef.current = null;
      const focus = dragFocusRef.current;
      dragFocusRef.current = null;
      if (focus !== null)
         focusIndexRef.current?.(focus);
   }, []);

   React.useEffect(() => {
      if (!isSelecting)
         return;
      const onUp = () => end();
      window.addEventListener("mouseup", onUp);
      return () => window.removeEventListener("mouseup", onUp);
   }, [end, isSelecting]);

   const onItemMouseDown = React.useCallback((e: React.MouseEvent, index: number) => {
      if (e.button !== 0)
         return;
      begin(index, e.shiftKey);
   }, [begin]);

   const onItemMouseEnter = React.useCallback((index: number) => move(index), [move]);

   const onItemKeyDown = React.useCallback((e: React.KeyboardEvent, index: number): boolean => {
      if (itemCount <= 0)
         return false;

      const activeIndex = selectionRef.current?.focus ?? index;
      let target: number;
      switch (e.key) {
         case "ArrowUp":
            target = activeIndex - 1;
            break;
         case "ArrowDown":
            target = activeIndex + 1;
            break;
         case "Home":
            target = 0;
            break;
         case "End":
            target = itemCount - 1;
            break;
         case "PageUp":
            target = activeIndex - pageSize;
            break;
         case "PageDown":
            target = activeIndex + pageSize;
            break;
         default:
            return false;
      }

      e.preventDefault();
      const next = clampIndex(target);
      selectIndex(next, e.shiftKey);
      focusIndexRef.current?.(next);
      return true;
   }, [clampIndex, itemCount, pageSize, selectIndex]);

   const indices = React.useMemo(() => selection?.indices() ?? [], [selection]);

   return {
      selection,
      indices,
      first: selection?.firstInclusive() ?? null,
      last: selection?.lastInclusive() ?? null,
      count: selection?.count() ?? 0,
      isSelecting,
      includes: (index: number) => selection?.includes(index) ?? false,
      onItemMouseDown,
      onItemMouseEnter,
      onItemKeyDown,
      selectIndex,
      setSelection: apply,
      end,
   };
}
