export interface MemoryRegionDto {
   name: string;
   address: number;
   size: number;
   hashKey?: string;
   type?: "used"|"free";
}
;

export class MemoryRegion {
   name: string;
   address: number;
   size: number;

   hashKey?: string;
   type?: "used"|"free";

   constructor(data: MemoryRegionDto) {
      if (data.size < 0) {
         throw new Error(`MemoryRegion ${data.name} cannot have negative size (${data.size})`);
      }
      this.name = data.name;
      this.address = data.address;
      this.size = data.size;
      this.hashKey = data.hashKey ?? `${data.address.toString(16)}_${data.size.toString(16)}`;
      this.type = data.type;
   }
   endAddress() {
      return this.address + this.size;
   }
   beginAddress() {
      return this.address;
   }
   containsAddress(addr: number) {
      return addr >= this.address && addr < this.endAddress();
   }
   containsRegion(other: MemoryRegion) {
      return this.address <= other.address && this.endAddress() >= other.endAddress();
   }
   getName() {
      return this.name;
   }
   getSize() {
      return this.size;
   }
   withSizeDelta(delta: number) {
      const newSize = this.size + delta;
      if (newSize < 0)
         throw new Error(`MemoryRegion ${this.name} cannot have negative size (${newSize})`);
      return new MemoryRegion({
         name: this.name,       //
         address: this.address, //
         size: newSize,
         type: this.type
      });
   }
   withBeginAddress(newAddress: number) {
      const delta = this.address - newAddress;
      const newSize = this.size + delta;
      if (newSize < 0)
         throw new Error(`MemoryRegion ${this.name} cannot have negative size (${newSize})`);
      return new MemoryRegion({name: this.name, address: newAddress, size: newSize, type: this.type});
   }
   toString() {
      return `${this.name} [0x${this.address.toString(16)}..0x${this.endAddress().toString(16)}] (${this.size} bytes)`;
   }
   getCell(cellSize: number, cellIndex: number) {
      const cellAddr = this.address + cellSize * cellIndex;
      const ret =
         new MemoryRegion({name: `${this.name}_cell${cellIndex}`, address: cellAddr, size: cellSize, type: this.type});
      if (!this.containsRegion(ret)) {
         throw new Error(`MemoryRegion ${this.name} cannot provide cell index ${cellIndex} (out of range)`);
      }
      return ret;
   }
   // Allocate a region from the top (end) of this region, moving downward
   allocFromTop(size: number, name?: string): MemoryRegion {
      const newAddr = this.endAddress() - size;
      if (newAddr < this.address) {
         throw new Error(`Cannot allocate ${size} bytes from top of ${this.name} (would underflow)`);
      }
      return new MemoryRegion({name: name || `${this.name}_top`, address: newAddr, size, type: this.type});
   }
   // Allocate a region from the bottom (start) of this region, moving upward
   allocFromBottom(size: number, name?: string): MemoryRegion {
      if (size > this.size) {
         throw new Error(`Cannot allocate ${size} bytes from bottom of ${this.name} (exceeds size)`);
      }
      return new MemoryRegion({name: name || `${this.name}_bottom`, address: this.address, size, type: this.type});
   }
   // Get the address as a hex string suitable for Lua or config
   toHexString(): string {
      return `0x${this.address.toString(16)}`;
   }
   // Get a new region representing the remaining space after allocating from bottom
   remainingAfterBottomAllocation(allocatedFromBottom: number): MemoryRegion {
      if (allocatedFromBottom > this.size) {
         throw new Error(`Allocated ${allocatedFromBottom} exceeds size ${this.size} of ${this.name}`);
      }
      return new MemoryRegion({
         name: `${this.name}_remaining`,
         address: this.address + allocatedFromBottom,
         size: this.size - allocatedFromBottom,
         type: this.type
      });
   }
}

/**
 * A cursor that tracks a bit-level position within a memory region.
 * Unlike conventional byte-based cursors, this operates at bit granularity.
 */
export class BitCursor {
   region: MemoryRegion;
   bitOffset: number;
   constructor(region: MemoryRegion, bitOffset = 0) {
      this.region = region;
      this.bitOffset = bitOffset | 0;
   }
   clone() {
      return new BitCursor(this.region, this.bitOffset);
   }
   tellBits() {
      return this.bitOffset;
   }
   currentByteIndex() {
      return (this.bitOffset / 8) | 0;
   }
   /**
    * Returns the number of bytes required to cover all bits written so far.
    * Equivalent to ceil(bitOffset / 8).
    */
   currentByteLengthCeil() {
      return ((this.bitOffset + 7) / 8) | 0;
   }
   byteIndexAbs() {
      return (this.region.address + ((this.bitOffset / 8) | 0)) | 0;
   }
   bitIndexInByte() {
      return (this.bitOffset & 7) | 0;
   }
   seekBits(deltaBits: number) {
      this.bitOffset = (this.bitOffset + (deltaBits | 0)) | 0;
      return this;
   }
   /**
    * Advances the cursor to the next byte boundary if not already aligned.
    * If already at a byte boundary, no change occurs.
    */
   advanceToNextByteBoundary() {
      const m = this.bitOffset & 7;
      if (m !== 0)
         this.bitOffset = (this.bitOffset + (8 - m)) | 0;
      return this;
   }
}
