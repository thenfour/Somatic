import {assert, clamp} from "../utils/utils";
import {SomaticCaps, Tic80Caps, Tic80ChannelIndex} from "./tic80Capabilities";


export type PatternCell = {
   midiNote?: number; // (when serializde to tic80, N is the note number (4-15 for notes and <4 for stops))
   instrumentIndex?:
      number; // 0-based internal instrument index. When serialized to tic80, this is +1 (1-based; 0 means no instrument).
   effect?: number;  // 0-7. 0 is the same as null / no effect. 1-7 = MCJSPVD
   effectX?: number; // 0-15
   effectY?: number; // 0-15
};

export const MakeEmptyPatternCell = (): PatternCell => ({});

export function isNoteCut(cell: PatternCell): boolean {
   return cell.instrumentIndex === SomaticCaps.noteCutInstrumentIndex;
}

export type PatternChannelDto = {
   rows: PatternCell[];
};

export class PatternChannel implements PatternChannelDto {
   rows: PatternCell[];

   constructor(data?: PatternChannelDto) {
      this.rows = data ? [...data.rows] : [];
      // ensure we have all rows. the reason is that upon render we can weed out; for editing just make sure we always have data.
      this.ensureRows(Tic80Caps.pattern.maxRows);
   }

   setRow(index: number, cellValue: PatternCell) {
      if (index < 0 || index >= this.rows.length)
         return;
      this.ensureRows(index + 1);
      this.rows[index] = {...cellValue};
   }

   ensureRows(count: number) {
      while (this.rows.length < count) {
         this.rows.push({});
      }
   }

   toData(): PatternChannelDto {
      return {rows: this.rows.map((row) => ({...row}))};
   }

   static fromData(data: PatternChannelDto): PatternChannel {
      return new PatternChannel(data);
   }

   clone(): PatternChannel {
      return PatternChannel.fromData(this.toData());
   }
}

//////////////////////////////////////////////////////////////////////////////////
export type PatternDto = {
   name: string; channels: [PatternChannelDto, PatternChannelDto, PatternChannelDto, PatternChannelDto];
};

export class Pattern implements PatternDto {
   name: string;
   channels: [PatternChannel, PatternChannel, PatternChannel, PatternChannel];

   constructor(data?: PatternDto) {
      if (data) {
         assert(data.channels.length === Tic80Caps.song.audioChannels);
         this.name = data.name ?? "";
         this.channels = [
            new PatternChannel(data.channels[0]),
            new PatternChannel(data.channels[1]),
            new PatternChannel(data.channels[2]),
            new PatternChannel(data.channels[3]),
         ];
      } else {
         this.name = "";
         this.channels = [
            new PatternChannel(),
            new PatternChannel(),
            new PatternChannel(),
            new PatternChannel(),
         ];
      }
   }

   toData(): PatternDto {
      return {
         name: this.name, channels: [
            this.channels[0].toData(),
            this.channels[1].toData(),
            this.channels[2].toData(),
            this.channels[3].toData(),
         ]
      }
   }

   setCell(channelIndex: Tic80ChannelIndex, rowIndex: number, cellValue: PatternCell) {
      this.channels[channelIndex].setRow(rowIndex, cellValue);
   }

   getCell(channelIndex: Tic80ChannelIndex, rowIndex: number): PatternCell {
      this.channels[channelIndex].ensureRows(rowIndex + 1);
      return this.channels[channelIndex].rows[rowIndex];
   }

   static fromData(data: PatternDto): Pattern {
      return new Pattern(data);
   }

   clone(): Pattern {
      return Pattern.fromData(this.toData());
   }

   contentSignature(): string {
      const dto = this.toData();
      return JSON.stringify({channels: dto.channels});
   }

   contentSignatureForColumn(channelIndex: Tic80ChannelIndex): string {
      const dto = this.toData();
      return JSON.stringify({channel: dto.channels[channelIndex]});
   }
}
