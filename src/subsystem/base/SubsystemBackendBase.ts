// models can see this, but not individual subsystem implementations (for dependency reasons)

import {defineEnum} from "../../utils/enum";

export const kSubsystem = defineEnum({
   TIC80: {
      value: 1,
      title: "TIC-80",
   },
   AMIGAMOD: {
      value: 2,
      title: "Amiga MOD",
   },
   // SID
   // PICO8
   // NES
   // GB
   // ...
} as const);

export type SubsystemTypeKey = typeof kSubsystem.$key; // "TIC80" | "AMIGAMOD"

export interface SomaticSubsystemBackend<TSong, TSongDto> {
   subsystemType: SubsystemTypeKey;

   // for now support a fixed # of tracker channels per subsystem.
   // in theory there could be various channel configs per subsystem,
   // like 4 vs 8 channel, or special PCM channels or so.
   channelCount: number;

   maxRowsPerPattern: number;
   defaultRowsPerPattern: number;

   initWaveformsAndInstruments(song: TSong, data: Partial<TSongDto>): void;
   onInitOrSubsystemTypeChange(song: TSong): void;
}
