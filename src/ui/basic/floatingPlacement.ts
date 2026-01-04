// reusable "floating UI" placement engine (tooltips/popovers/etc).
// example:

// const anchorRect = el.getBoundingClientRect();
// const boundary = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

// const result = computeFloatingPlacement({
//   anchor: { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height },
//   floatingSize: { width: tooltipW, height: tooltipH },
//   boundary,
//   preferred: { side: "top", align: "center" },
//   offset: 8,
//   padding: 8,
//   allowShift: true,
//   allowOverlapAnchor: false,
//   lastPlacement: prevPlacement,
//   hysteresisPx: 12,
//   arrow: { enabled: true, edgePadding: 10 },
// });


import {clamp} from "../../utils/utils";

export type Side = "top"|"bottom"|"left"|"right";
export type Align = "start"|"center"|"end";

export type Placement = {
   side: Side; align: Align;
};

export type Rect = {
   left: number; top: number; width: number; height: number;
};

export type Size = {
   width: number; height: number;
};

export type ArrowResult = {
   // Which edge of the floating element the arrow should be attached to.
   side: Side;
   // Offset along the edge, in pixels, relative to the floating element's top-left corner.
   // For top/bottom arrows, use x. For left/right arrows, use y.
   x?: number;
   y?: number;
};

export type PlacementResult = {
   placement: Placement;
   // Final floating element top-left in the same coordinate space as the rects you passed in.
   x: number;
   y: number;
   // Useful if you want to apply translation vs. setting left/top directly.
   rect: Rect;
   // Diagnostics
   score: number;
   overflowPx: number;
   // arrow positioning:
   arrow?: ArrowResult;
};

export type PlacementOptions = {
   anchor: Rect; //
   floatingSize: Size;
   boundary: Rect;

   preferred?: Placement;

   // Gap between anchor and floating element (main axis).
   offset?: number;

   // Keep at least this many pixels inside boundary on all sides.
   padding?: number;

   // If true, the engine may slide along cross-axis to fit
   allowShift?: boolean;

   // If false, overlap between anchor and floating is penalized (true for tooltips).
   allowOverlapAnchor?: boolean;

   // If provided, the engine will resist switching placements unless "meaningfully better".
   lastPlacement?: Placement;
   hysteresisPx?: number; // score delta threshold

   // For arrow positioning
   arrow?: {
      enabled: boolean;
      // Minimum distance from floating element corners along the arrow edge.
      // (Prevents arrow being too close to rounded corners.)
      edgePadding?: number;
   };

   // Scoring weights
   weights?: {
      overflow?: number;  // big
      overlap?: number;   // big-ish
      distance?: number;  // small
      preferred?: number; // tiny bonus (subtract from score)
   };

   // Candidate ordering strategy:
   // - "smart": preferred first, then same-side other aligns, then opposite side, then perpendiculars
   // - "all": all 12 candidates in deterministic order
   candidateStrategy?: "smart" | "all";
};

export function computeFloatingPlacement(opts: PlacementOptions): PlacementResult {
   const preferred: Placement = opts.preferred ?? {side: "top", align: "center"};
   const offset = opts.offset ?? 8;
   const padding = opts.padding ?? 8;

   const allowShift = opts.allowShift ?? true;
   const allowOverlapAnchor = opts.allowOverlapAnchor ?? false;

   const hysteresisPx = opts.hysteresisPx ?? 12;

   const weights = {
      overflow: opts.weights?.overflow ?? 50,
      overlap: opts.weights?.overlap ?? 20,
      distance: opts.weights?.distance ?? 1,
      preferred: opts.weights?.preferred ?? 0.5,
   };

   const candidates = generateCandidates(preferred, opts.candidateStrategy ?? "smart");

   const scored: PlacementResult[] = candidates.map((placement) => {
      const base = computeRectForPlacement(opts.anchor, opts.floatingSize, placement, offset);

      // shift (cross-axis clamp), if enabled
      const shifted = allowShift ? shiftIntoBoundary(base, opts.boundary, padding, placement) : base;

      // compute score
      const overflowPx = totalOverflowPx(shifted, opts.boundary, padding);
      const overlapArea = allowOverlapAnchor ? 0 : intersectionArea(shifted, opts.anchor);
      const distance = anchorToFloatingDistance(opts.anchor, shifted, placement);

      let score = 0;
      score += overflowPx * weights.overflow;
      score += overlapArea * weights.overlap;
      score += distance * weights.distance;

      // small preference bonus to break ties
      if (placement.side === preferred.side)
         score -= weights.preferred;
      if (placement.align === preferred.align)
         score -= weights.preferred * 0.5;

      const res: PlacementResult = {
         placement,
         x: shifted.left,
         y: shifted.top,
         rect: shifted,
         score,
         overflowPx,
      };

      // arrow positioning (optional)
      if (opts.arrow?.enabled) {
         res.arrow = computeArrowOffset({
            placement,
            anchor: opts.anchor,
            floating: shifted,
            boundary: opts.boundary,
            padding,
            edgePadding: opts.arrow.edgePadding ?? 8,
         });
      }

      return res;
   });

   // best candidate
   scored.sort((a, b) => a.score - b.score);
   let best = scored[0];

   // hysteresis: keep lastPlacement unless best is meaningfully better
   if (opts.lastPlacement) {
      const prev = scored.find(
         (s) => s.placement.side === opts.lastPlacement!.side && s.placement.align === opts.lastPlacement!.align);
      if (prev) {
         // If switching doesn't improve score by at least hysteresisPx, stick with previous.
         if (prev.score <= best.score + hysteresisPx) {
            best = prev;
         }
      }
   }

   return best;
}

function generateCandidates(preferred: Placement, strategy: "smart"|"all"): Placement[] {
   const all: Placement[] = [
      {side: "top", align: "start"},
      {side: "top", align: "center"},
      {side: "top", align: "end"},
      {side: "bottom", align: "start"},
      {side: "bottom", align: "center"},
      {side: "bottom", align: "end"},
      {side: "left", align: "start"},
      {side: "left", align: "center"},
      {side: "left", align: "end"},
      {side: "right", align: "start"},
      {side: "right", align: "center"},
      {side: "right", align: "end"},
   ];

   if (strategy === "all")
      return all;

   // "smart" ordering:
   // 1) preferred
   // 2) same side other aligns
   // 3) opposite side preferred align + other aligns
   // 4) perpendicular sides (preferred align first)
   const opposite: Record<Side, Side> = {top: "bottom", bottom: "top", left: "right", right: "left"};
   const perpendicular: Record<Side, Side[]> = {
      top: ["left", "right"],
      bottom: ["left", "right"],
      left: ["top", "bottom"],
      right: ["top", "bottom"],
   };
   const aligns: Align[] = ["start", "center", "end"];

   const out: Placement[] = [];
   const pushUnique = (p: Placement) => {
      if (!out.some((q) => q.side === p.side && q.align === p.align))
         out.push(p);
   };

   pushUnique(preferred);

   // same side, other aligns
   for (const a of aligns)
      pushUnique({side: preferred.side, align: a});

   // opposite side
   for (const a of aligns)
      pushUnique({side: opposite[preferred.side], align: a});

   // perpendicular sides
   for (const s of perpendicular[preferred.side]) {
      // try preferred align first, then others
      pushUnique({side: s, align: preferred.align});
      for (const a of aligns)
         pushUnique({side: s, align: a});
   }

   return out;
}

function computeRectForPlacement(anchor: Rect, size: Size, placement: Placement, offset: number): Rect {
   const aLeft = anchor.left;
   const aTop = anchor.top;
   const aRight = anchor.left + anchor.width;
   const aBottom = anchor.top + anchor.height;

   const aCenterX = aLeft + anchor.width / 2;
   const aCenterY = aTop + anchor.height / 2;

   let left = 0;
   let top = 0;

   // main axis
   switch (placement.side) {
      case "top":
         top = aTop - size.height - offset;
         break;
      case "bottom":
         top = aBottom + offset;
         break;
      case "left":
         left = aLeft - size.width - offset;
         break;
      case "right":
         left = aRight + offset;
         break;
   }

   // cross axis alignment
   if (placement.side === "top" || placement.side === "bottom") {
      // align X against anchor
      if (placement.align === "start")
         left = aLeft;
      else if (placement.align === "end")
         left = aRight - size.width;
      else
         left = aCenterX - size.width / 2;
   } else {
      // left/right => align Y against anchor
      if (placement.align === "start")
         top = aTop;
      else if (placement.align === "end")
         top = aBottom - size.height;
      else
         top = aCenterY - size.height / 2;
   }

   return {left, top, width: size.width, height: size.height};
}

function shiftIntoBoundary(rect: Rect, boundary: Rect, padding: number, placement: Placement): Rect {
   const bLeft = boundary.left + padding;
   const bTop = boundary.top + padding;
   const bRight = boundary.left + boundary.width - padding;
   const bBottom = boundary.top + boundary.height - padding;

   let left = rect.left;
   let top = rect.top;

   if (placement.side === "top" || placement.side === "bottom") {
      // shift along X only
      const minLeft = bLeft;
      const maxLeft = bRight - rect.width;
      left = clamp(left, minLeft, maxLeft);
   } else {
      // shift along Y only
      const minTop = bTop;
      const maxTop = bBottom - rect.height;
      top = clamp(top, minTop, maxTop);
   }

   return {...rect, left, top};
}

function totalOverflowPx(rect: Rect, boundary: Rect, padding: number): number {
   const bLeft = boundary.left + padding;
   const bTop = boundary.top + padding;
   const bRight = boundary.left + boundary.width - padding;
   const bBottom = boundary.top + boundary.height - padding;

   const rLeft = rect.left;
   const rTop = rect.top;
   const rRight = rect.left + rect.width;
   const rBottom = rect.top + rect.height;

   const overflowLeft = Math.max(0, bLeft - rLeft);
   const overflowTop = Math.max(0, bTop - rTop);
   const overflowRight = Math.max(0, rRight - bRight);
   const overflowBottom = Math.max(0, rBottom - bBottom);

   return overflowLeft + overflowTop + overflowRight + overflowBottom;
}

function intersectionArea(a: Rect, b: Rect): number {
   const ax2 = a.left + a.width;
   const ay2 = a.top + a.height;
   const bx2 = b.left + b.width;
   const by2 = b.top + b.height;

   const ix1 = Math.max(a.left, b.left);
   const iy1 = Math.max(a.top, b.top);
   const ix2 = Math.min(ax2, bx2);
   const iy2 = Math.min(ay2, by2);

   const w = ix2 - ix1;
   const h = iy2 - iy1;
   if (w <= 0 || h <= 0)
      return 0;
   return w * h;
}

function anchorToFloatingDistance(anchor: Rect, floating: Rect, placement: Placement): number {
   // Distance along main axis between anchor and floating (should be ~offset for "good" placements)
   const aLeft = anchor.left;
   const aTop = anchor.top;
   const aRight = anchor.left + anchor.width;
   const aBottom = anchor.top + anchor.height;

   const fLeft = floating.left;
   const fTop = floating.top;
   const fRight = floating.left + floating.width;
   const fBottom = floating.top + floating.height;

   switch (placement.side) {
      case "top":
         return Math.max(0, aTop - fBottom);
      case "bottom":
         return Math.max(0, fTop - aBottom);
      case "left":
         return Math.max(0, aLeft - fRight);
      case "right":
         return Math.max(0, fLeft - aRight);
   }
}

function computeArrowOffset(args: {
   placement: Placement; anchor: Rect; floating: Rect; boundary: Rect; padding: number; edgePadding: number;
}): ArrowResult {
   const {placement, anchor, floating, edgePadding} = args;

   const aCenterX = anchor.left + anchor.width / 2;
   const aCenterY = anchor.top + anchor.height / 2;

   const localX = aCenterX - floating.left;
   const localY = aCenterY - floating.top;

   if (placement.side === "top" || placement.side === "bottom") {
      const x = clamp(localX, edgePadding, floating.width - edgePadding);
      return {side: placement.side, x};
   } else {
      const y = clamp(localY, edgePadding, floating.height - edgePadding);
      return {side: placement.side, y};
   }
}
