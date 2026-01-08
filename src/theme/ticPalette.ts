export type TicPaletteIndex = number; // 0..15

// Sweetie16 palette (TIC-80 default palette)
// Stored as hex strings for applying to CSS variables in the host.
export const SWEETIE16_HEX: readonly string[] = [
   "#1a1c2c",
   "#5d275d",
   "#b13e53",
   "#ef7d57",
   "#ffcd75",
   "#a7f070",
   "#38b764",
   "#257179",
   "#29366f",
   "#3b5dc9",
   "#41a6f6",
   "#73eff7",
   "#f4f4f4",
   "#94b0c2",
   "#566c86",
   "#333c57",
] as const;

// Contrast mapping expressed in palette indices.
// This is the same mapping as the `--tic-*-contrast` vars previously defined in `somatic.css`.
export const SWEETIE16_CONTRAST_INDEX: readonly TicPaletteIndex[] = [
   12, // 0 -> 12
   12, // 1 -> 12
   12, // 2 -> 12
   0,  // 3 -> 0
   0,  // 4 -> 0
   0,  // 5 -> 0
   0,  // 6 -> 0
   12, // 7 -> 12
   12, // 8 -> 12
   12, // 9 -> 12
   0,  // 10 -> 0
   0,  // 11 -> 0
   0,  // 12 -> 0
   0,  // 13 -> 0
   12, // 14 -> 12
   12, // 15 -> 12
] as const;

export function applySweetie16CssVars(style: CSSStyleDeclaration): void {
   for (let i = 0; i < SWEETIE16_HEX.length; i++) {
      style.setProperty(`--tic-${i}`, SWEETIE16_HEX[i]);
   }
   for (let i = 0; i < SWEETIE16_CONTRAST_INDEX.length; i++) {
      const contrastIdx = SWEETIE16_CONTRAST_INDEX[i];
      style.setProperty(`--tic-${i}-contrast`, `var(--tic-${contrastIdx})`);
   }
}
