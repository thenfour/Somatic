export class MemoryRegion {
   name: string;
   address: number;
   size: number;
   constructor(name: string, address: number, size: number) {
      if (size < 0) {
         throw new Error(`MemoryRegion ${name} cannot have negative size (${size})`);
      }
      this.name = name;
      this.address = address;
      this.size = size;
   }
   endAddress() {
      return this.address + this.size;
   }
   beginAddress() {
      return this.address;
   }
   contains(addr: number) {
      return addr >= this.address && addr < this.endAddress();
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
      return new MemoryRegion(this.name, this.address, newSize);
   }
   withBeginAddress(newAddress: number) {
      const delta = this.address - newAddress;
      const newSize = this.size + delta;
      if (newSize < 0)
         throw new Error(`MemoryRegion ${this.name} cannot have negative size (${newSize})`);
      return new MemoryRegion(this.name, newAddress, newSize);
   }
   toString() {
      return `${this.name} [0x${this.address.toString(16)}..0x${this.endAddress().toString(16)}] (${this.size} bytes)`;
   }
   getCell(cellSize: number, cellIndex: number) {
      const cellAddr = this.address + cellSize * cellIndex;
      if (!this.contains(cellAddr) || !this.contains(cellAddr + cellSize - 1)) {
         throw new Error(`MemoryRegion ${this.name} cannot provide cell index ${cellIndex} (out of range)`);
      }
      return new MemoryRegion(`${this.name}_cell${cellIndex}`, cellAddr, cellSize);
   }
   // Allocate a region from the top (end) of this region, moving downward
   allocFromTop(size: number, name?: string): MemoryRegion {
      const newAddr = this.endAddress() - size;
      if (newAddr < this.address) {
         throw new Error(`Cannot allocate ${size} bytes from top of ${this.name} (would underflow)`);
      }
      return new MemoryRegion(name || `${this.name}_top`, newAddr, size);
   }
   // Allocate a region from the bottom (start) of this region, moving upward
   allocFromBottom(size: number, name?: string): MemoryRegion {
      if (size > this.size) {
         throw new Error(`Cannot allocate ${size} bytes from bottom of ${this.name} (exceeds size)`);
      }
      return new MemoryRegion(name || `${this.name}_bottom`, this.address, size);
   }
   // Get the address as a hex string suitable for Lua or config
   toHexString(): string {
      return `0x${this.address.toString(16)}`;
   }
   // Get a new region representing the remaining space after allocating from bottom
   remaining(allocatedFromBottom: number): MemoryRegion {
      if (allocatedFromBottom > this.size) {
         throw new Error(`Allocated ${allocatedFromBottom} exceeds size ${this.size} of ${this.name}`);
      }
      return new MemoryRegion(
         `${this.name}_remaining`, this.address + allocatedFromBottom, this.size - allocatedFromBottom);
   }
}

export class RegionCursor {
   region: MemoryRegion;
   bitOffset: number;
   constructor(region: MemoryRegion, bitOffset = 0) {
      this.region = region;
      this.bitOffset = bitOffset | 0;
   }
   clone() {
      return new RegionCursor(this.region, this.bitOffset);
   }
   tellBits() {
      return this.bitOffset;
   }
   tellBytesFloor() {
      return (this.bitOffset / 8) | 0;
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
   alignToByte() {
      const m = this.bitOffset & 7;
      if (m !== 0)
         this.bitOffset = (this.bitOffset + (8 - m)) | 0;
      return this;
   }
}
