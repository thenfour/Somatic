import {defineEnum} from "../utils/enum";

export const kPatternGridHighlightStyle = defineEnum({
   alternating: {
      value: "alternating",
      label: "Alternating rows",
   },
   sectionHeader: {
      value: "sectionHeader",
      label: "Section header highlight",
   },
} as const);

export type PatternGridHighlightStyle = typeof kPatternGridHighlightStyle.$value;