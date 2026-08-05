import {SomaticMemoryLayout} from "./memory_layout";

export class BridgeExtraSongDataOverflowError extends Error {
   constructor(
      readonly compressedBytes: number,
      readonly limitBytes: number,
      readonly rawBytes: number,
      ) {
      super(
         `Bridge extra-song payload overflow: compressed need ${compressedBytes} bytes, limit ${limitBytes}; `
         + `export remains available`,
      );
      this.name = "BridgeExtraSongDataOverflowError";
   }
}

// somatic "extra song data" can overflow with complex songs (tons of uncompressable
// volume/pan/fx fields). important to report the error if the song can't be serialized.
export function encodeBridgeExtraSongDataTransaction(
   compressed: Uint8Array,
   rawBytes: number,
   ): Uint8Array {
   const limit = SomaticMemoryLayout.computed.BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES;
   if (compressed.length > limit)
      throw new BridgeExtraSongDataOverflowError(compressed.length, limit, rawBytes);

   const transaction = new Uint8Array(2 + compressed.length);
   transaction[0] = compressed.length & 0xff;
   transaction[1] = (compressed.length >> 8) & 0xff;
   transaction.set(compressed, 2);
   return transaction;
}
