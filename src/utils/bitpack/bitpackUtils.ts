import {MemoryRegion} from "./MemoryRegion";

/**
 * Returns a bitmask with the low N bits set to 1.
 * For example: maskLowBits(3) returns 0b111 (7)
 * 
 * @param bitCount - Number of low bits to set (0-32)
 * @returns Unsigned 32-bit integer with low bits masked
 */
export function maskLowBits(bitCount: number): number {
   if (bitCount <= 0)
      return 0;
   if (bitCount >= 32)
      return 0xFFFFFFFF >>> 0;
   return (Math.pow(2, bitCount) - 1) >>> 0;
}

/**
 * Validates that a bit range fits within a memory region's bounds.
 * Throws an error if the range would exceed the region.
 * 
 * @param region - The memory region to validate against
 * @param bitOffset - Starting bit position within the region
 * @param bitsNeeded - Number of bits required
 * @param context - Description of the operation (for error messages)
 * @throws Error if the bit range is out of bounds
 */
export function assertBitsFitInRegion(
   region: MemoryRegion,
   bitOffset: number,
   bitsNeeded: number,
   context: string,
   ): void {
   const totalBits = region.size * 8;
   if (bitOffset < 0 || bitOffset + bitsNeeded > totalBits) {
      throw new Error(
         `${context}: out of bounds (need ${bitsNeeded} bits at bitOffset ${bitOffset}, region=${region.toString()})`);
   }
}
