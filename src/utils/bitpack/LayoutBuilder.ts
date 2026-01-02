import {BitWriter, Codec, MemoryRegion} from "./bitpack";

/**
 * A section in the binary layout, identified by a unique ID.
 */
type LayoutSection = {
   id: string; //
   codec: Codec<unknown>;
   data: unknown;
};

/**
 * The result of finalizing a layout, containing computed offsets and total size.
 */
export type LayoutPlan = {
   /** Map from section ID to its byte offset in the final output */
   offsets: Map<string, number>;
   /** Total size needed for all sections in bytes */
   totalBytes: number;
};

/**
 * Helper for planning binary data layouts with mixed fixed and variable-size sections.
 * 
 * Declaratively describe your layout by adding sections, then finalize to compute
 * offsets and total size. Each section is byte-aligned automatically.
 * 
 * Example usage:
 * ```typescript
 * const layout = new LayoutBuilder();
 * layout.addSection("header", HeaderCodec, headerData);
 * layout.addSection("entries", EntriesCodec, entriesData);
 * layout.addSection("blob_0", BlobCodec, blobData);
 * 
 * const plan = layout.finalize();
 * // Now encode with known offsets:
 * const blobOffset = plan.offsets.get("blob_0")!;
 * ```
 */
export class LayoutBuilder {
   private sections: LayoutSection[] = [];

   /**
    * Add a section to the layout. Sections are encoded in the order they are added.
    * Each section will be byte-aligned automatically.
    * 
    * @param id - Unique identifier for this section (used to look up its offset later)
    * @param codec - The codec that will encode this section
    * @param data - The data to encode for this section
    */
   addSection(id: string, codec: Codec<unknown>, data: unknown): void {
      if (this.sections.some(s => s.id === id)) {
         throw new Error(`LayoutBuilder: duplicate section ID '${id}'`);
      }
      this.sections.push({id, codec, data});
   }

   /**
    * Compute byte offsets for all sections and determine total size.
    * 
    * For fixed-size codecs, uses byteSizeCeil(). For variable-size codecs,
    * performs a measurement encode to determine actual size.
    * 
    * @returns Layout plan with offsets map and total size
    */
   finalize(): LayoutPlan {
      const offsets = new Map<string, number>();
      let bytePosition = 0;

      for (const section of this.sections) {
         // Each section starts at a byte boundary
         offsets.set(section.id, bytePosition);

         const sizeBytes = this.measureSectionSize(section.codec, section.data);
         bytePosition += sizeBytes;
      }

      return {
         offsets,
         totalBytes: bytePosition,
      };
   }

   /**
    * Measure the byte size of encoding the given data with the given codec.
    * For fixed-size codecs, returns byteSizeCeil(). For variable-size codecs,
    * performs a dry-run encode to measure actual size.
    */
   private measureSectionSize(codec: Codec<unknown>, data: unknown): number {
      if (codec.bitSize !== "variable") {
         // Fixed size - can compute directly
         const byteSizeCeil = codec.byteSizeCeil?.();
         if (byteSizeCeil !== undefined) {
            return byteSizeCeil;
         }
         // Fallback: compute from bitSize
         return Math.ceil(codec.bitSize / 8);
      }

      // Variable size - need to measure by encoding
      const measureBuffer = new Uint8Array(256 * 1024); // 256KB should be enough for measurement
      const measureRegion = new MemoryRegion("layout_measure", 0, measureBuffer.length);
      const measureWriter = new BitWriter(measureBuffer, measureRegion);

      codec.encode(data, measureWriter);

      return measureWriter.cur.currentByteIndex();
   }

   /**
    * Get the number of sections added so far.
    */
   getSectionCount(): number {
      return this.sections.length;
   }

   /**
    * Check if a section with the given ID exists.
    */
   hasSection(id: string): boolean {
      return this.sections.some(s => s.id === id);
   }
}
