// Shared morph/sfx payload schema and encoder.
// Uses the bitpack helpers to keep layout authoritative in one place.

import {clamp} from "../src/utils/utils";
import {BitWriter, C, MemoryRegion} from "./bitpack";
import type {Codec} from "./bitpack";

export type MorphEffectKind = "none"|"wavefold"|"hardSync";

export type MorphEntryInput = {
   instrumentId: number; //
   cfg: {
      waveEngineId: number;           //
      sourceWaveformIndex: number;    //
      morphWaveB: number;             //
      renderWaveformSlot: number;     //
      pwmDuty5: number;               //
      pwmDepth5: number;              //
      morphDurationTicks12: number;   //
      morphCurveS6: number;           //
      lowpassEnabled: boolean;        //
      lowpassDurationTicks12: number; //
      lowpassCurveS6: number;         //
      lowpassModSource: number;       //
      effectKind: MorphEffectKind;    //
      effectAmtU8: number;
      effectDurationTicks12: number;
      effectCurveS6: number;
      effectModSource: number;
      lfoCycleTicks12: number;
   };
};

type MorphEntryPacked = {
   instrumentId: number;        //
   waveEngineId: number;        //
   sourceWaveformIndex: number; //
   morphWaveB: number;
   renderWaveformSlot: number;
   morphDurationTicks12: number;         //
   morphCurveS6: number;                 //
   pwmDuty5: number;                     //
   pwmDepth5: number;                    //
   lfoCycleTicks12: number;              //
   lowpassEnabled: number;               //
   lowpassDurationTicks12: number;       //
   lowpassCurveS6: number;               //
   lowpassModSource: number;             //
   effectKind: MorphEffectKind | number; //
   effectAmtU8: number;
   effectDurationTicks12: number;
   effectCurveS6: number;
   effectModSource: number;
};

const MorphEffectKindCodec = C.enum("MorphEffectKind", 2, {
   none: 0,
   wavefold: 1,
   hardSync: 2,
});

export const MorphEntryCodec = C.struct("MorphEntry", [
   C.field("instrumentId", C.u8()),
   C.field("waveEngineId", C.u(2)),
   C.field("sourceWaveformIndex", C.u(4)),
   C.field("morphWaveB", C.u(4)),
   C.field("renderWaveformSlot", C.u(4)),
   C.field("morphDurationTicks12", C.u(12)),
   C.field("morphCurveS6", C.i(6)),
   C.field("pwmDuty5", C.u(5)),
   C.field("pwmDepth5", C.u(5)),
   C.field("lfoCycleTicks12", C.u(12)),
   C.field("lowpassEnabled", C.bool()),
   C.field("lowpassDurationTicks12", C.u(12)),
   C.field("lowpassCurveS6", C.i(6)),
   C.field("lowpassModSource", C.bool()),
   C.field("effectKind", MorphEffectKindCodec),
   C.field("effectAmtU8", C.u8()),
   C.field("effectDurationTicks12", C.u(12)),
   C.field("effectCurveS6", C.i(6)),
   C.field("effectModSource", C.bool()),
]);

export const MorphEntryFieldNamesToRename = [
   "instrumentId",
   "waveEngineId",
   "sourceWaveformIndex",
   "morphWaveB",
   "renderWaveformSlot",
   "morphDurationTicks12",
   "morphCurveS6",
   "pwmDuty5",
   "pwmDepth5",
   "lfoCycleTicks12",
   "lowpassEnabled",
   "lowpassDurationTicks12",
   "lowpassCurveS6",
   "lowpassModSource",
   "effectKind",
   "effectAmtU8",
   "effectDurationTicks12",
   "effectCurveS6",
   "effectModSource",
] as const;

const MorphHeaderCodec = C.struct("MorphHeader", [
   C.field("entryCount", C.u8()),
]);

function fixedBits(codec: Codec<unknown>, name: string): number {
   if (codec.bitSize === "variable")
      throw new Error(`${name} codec must be fixed size`);
   return codec.bitSize;
}

export const MORPH_ENTRY_BITS = fixedBits(MorphEntryCodec, "MorphEntry");
export const MORPH_ENTRY_BYTES = MorphEntryCodec.byteSizeCeil!();
export const MORPH_HEADER_BITS = fixedBits(MorphHeaderCodec, "MorphHeader");
export const MORPH_HEADER_BYTES = MorphHeaderCodec.byteSizeCeil!();

function clampU(value: number, min: number, max: number) {
   return clamp(Math.trunc(value), min, max);
}

function clampS(value: number, min: number, max: number) {
   return clamp(Math.trunc(value), min, max);
}

function clampBit(value: boolean|number) {
   return clampU(Number(value), 0, 1);
}

function normalizeEntry(entry: MorphEntryInput): MorphEntryPacked {
   const {cfg} = entry;
   return {
      instrumentId: clampU(entry.instrumentId, 0, 0xff),
      waveEngineId: clampU(cfg.waveEngineId, 0, 3),
      sourceWaveformIndex: clampU(cfg.sourceWaveformIndex, 0, 0x0f),
      morphWaveB: clampU(cfg.morphWaveB, 0, 0x0f),
      renderWaveformSlot: clampU(cfg.renderWaveformSlot, 0, 0x0f),
      morphDurationTicks12: clampU(cfg.morphDurationTicks12, 0, 0x0fff),
      morphCurveS6: clampS(cfg.morphCurveS6, -32, 31),
      pwmDuty5: clampU(cfg.pwmDuty5, 0, 0x1f),
      pwmDepth5: clampU(cfg.pwmDepth5, 0, 0x1f),
      lfoCycleTicks12: clampU(cfg.lfoCycleTicks12, 0, 0x0fff),
      lowpassEnabled: clampBit(cfg.lowpassEnabled),
      lowpassDurationTicks12: clampU(cfg.lowpassDurationTicks12, 0, 0x0fff),
      lowpassCurveS6: clampS(cfg.lowpassCurveS6, -32, 31),
      lowpassModSource: clampBit(cfg.lowpassModSource),
      effectKind: cfg.effectKind,
      effectAmtU8: clampU(cfg.effectAmtU8, 0, 0xff),
      effectDurationTicks12: clampU(cfg.effectDurationTicks12, 0, 0x0fff),
      effectCurveS6: clampS(cfg.effectCurveS6, -32, 31),
      effectModSource: clampBit(cfg.effectModSource),
   };
}

export function encodeMorphPayload(entries: MorphEntryInput[], totalBytes?: number): Uint8Array {
   const entryCount = entries.length;
   const neededBytes = MORPH_HEADER_BYTES + entryCount * MORPH_ENTRY_BYTES;
   if (typeof totalBytes === "number" && neededBytes > totalBytes) {
      throw new Error(`SOMATIC_SFX_CONFIG overflow: need ${neededBytes} bytes, have ${totalBytes}`);
   }

   const out = new Uint8Array(totalBytes ?? neededBytes);
   out.fill(0);

   const region = new MemoryRegion("morph_payload", 0, out.length);
   const writer = new BitWriter(out, region);

   MorphHeaderCodec.encode({entryCount}, writer);
   for (const entry of entries) {
      writer.alignToByte(); // ensure each entry starts on a byte boundary for the Lua decoder
      MorphEntryCodec.encode(normalizeEntry(entry), writer);
   }

   return out;
}
