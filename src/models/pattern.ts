import {assert, clamp} from "../utils/utils";
import {Tic80Caps, Tic80ChannelIndex} from "./tic80Capabilities";

export type PatternCell = {
   midiNote?: number;        //
   instrumentIndex?: number; //
   effect?: number;
   effectArg?: number;
};

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

   toData(): PatternChannelDto { return {rows: this.rows.map((row) => ({...row}))}; }

   static fromData(data: PatternChannelDto): PatternChannel { return new PatternChannel(data); }

   clone(): PatternChannel { return PatternChannel.fromData(this.toData()); }
}

//////////////////////////////////////////////////////////////////////////////////
export type PatternDto = {
   channels: [PatternChannelDto, PatternChannelDto, PatternChannelDto, PatternChannelDto];
};

export class Pattern implements PatternDto {
   channels: [PatternChannel, PatternChannel, PatternChannel, PatternChannel];

   constructor(data?: PatternDto) {
      if (data) {
         assert(data.channels.length === Tic80Caps.song.audioChannels);
         this.channels = [
            new PatternChannel(data.channels[0]),
            new PatternChannel(data.channels[1]),
            new PatternChannel(data.channels[2]),
            new PatternChannel(data.channels[3]),
         ];
      } else {
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
         channels: [
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

   static fromData(data: PatternDto): Pattern { return new Pattern(data); }

   clone(): Pattern { return Pattern.fromData(this.toData()); }
}
