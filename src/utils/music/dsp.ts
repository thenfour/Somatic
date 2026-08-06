export function linearGainToDecibels(gain: number): number {
   return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}
