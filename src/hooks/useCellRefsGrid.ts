import {useRef} from "react";

export function useCellRefsGrid<T extends Element>(rowCount: number, colCount: number): (T|null)[][] {
   const gridRef = useRef<(T | null)[][]>([]);

   const rows = Math.max(0, Math.floor(rowCount));
   const cols = Math.max(0, Math.floor(colCount));

   const grid = gridRef.current;

   if (grid.length > rows) {
      grid.length = rows;
   }

   while (grid.length < rows) {
      grid.push([]);
   }

   for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      const row = grid[rowIndex] ?? (grid[rowIndex] = []);
      if (row.length > cols) {
         row.length = cols;
      }
      while (row.length < cols) {
         row.push(null);
      }
   }

   return grid;
}
