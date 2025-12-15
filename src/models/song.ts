import {clamp, IsNullOrWhitespace} from "../utils/utils";

import {Tic80Instrument, Tic80InstrumentFields} from "./instruments";
import {Pattern, PatternDto} from "./pattern";
import {Tic80Caps} from "./tic80Capabilities";
import {Tic80Waveform, Tic80WaveformDto} from "./waveform";

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-tracks
// export type InstrumentData = ReturnType<Tic80Instrument['toData']>;
// export type PatternData = ReturnType<Pattern['toData']>;

export type SongDto = {
   instruments: Tic80InstrumentFields[]; //
   waveforms: Tic80WaveformDto[];
   patterns: PatternDto[];

   tempo: number;
   speed: number;
   rowsPerPattern: number;

   name: string;
   highlightRowCount: number;
};

const makeWaveformList = (data: Tic80WaveformDto[]): Tic80Waveform[] => {
   return Array.from({length: Tic80Caps.waveform.count}, (_, i) => {
      const waveData = data[i]!;
      const ret = new Tic80Waveform(waveData);
      if (IsNullOrWhitespace(ret.name))
         ret.name = `WAVE ${i}`;
      return ret;
   });
};

const makeInstrumentList = (data: Tic80InstrumentFields[]): Tic80Instrument[] => {
   //const length =  INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
   const list = Array.from({length: Tic80Caps.sfx.count}, (_, i) => {
      const instData = data[i]!;
      const ret = new Tic80Instrument(instData);
      if (IsNullOrWhitespace(ret.name))
         ret.name = `SFX ${i}`;
      return ret;
   });
   return list;
};

const makePatternList = (data: PatternDto[]): Pattern[] => {
   const ret = data.map((patternData) => Pattern.fromData(patternData));
   // ensure at least 1 pattern.
   if (ret.length === 0) {
      ret.push(new Pattern());
   }
   return ret;
};

export class Song {
   instruments: Tic80Instrument[];
   waveforms: Tic80Waveform[];
   patterns: Pattern[];
   rowsPerPattern: number;
   // positions: number[];

   // tic80 music editor shows a range of 40-250. theoretically it's 32-255 apparently https://github.com/nesbox/TIC-80/issues/2153
   tempo: number;
   speed: number;
   // length: number;

   // editor-specific
   name: string;
   highlightRowCount: number;

   constructor(data: Partial<SongDto> = {}) {
      this.instruments = makeInstrumentList(data.instruments || []);
      this.patterns = makePatternList(data.patterns || []);
      this.waveforms = makeWaveformList(data.waveforms || []);
      this.rowsPerPattern = clamp(data.rowsPerPattern ?? Tic80Caps.pattern.maxRows, 1, Tic80Caps.pattern.maxRows);
      // this.positions = Array.from(
      //     {length: 256},
      //     (_, i) => clamp(data.positions?.[i] ?? 0, 0, PATTERN_COUNT - 1));
      this.tempo = clamp(data.tempo ?? 120, 1, 255);
      this.speed = clamp(data.speed ?? 6, 1, 31);
      // this.length = clamp(data.length ?? 1, 1, 256);
      this.name = data.name ?? "New song";
      this.highlightRowCount = clamp(data.highlightRowCount ?? 16, 1, 64);
   }

   setTempo(value: number) {
      this.tempo = clamp(value, 1, 255);
   }

   setSpeed(value: number) {
      this.speed = clamp(value, 1, 31);
   }

   setHighlightRowCount(value: number) {
      this.highlightRowCount = clamp(value, 1, 64);
   }

   setRowsPerPattern(value: number) {
      this.rowsPerPattern = clamp(value, 1, Tic80Caps.pattern.maxRows);
   }

   toData(): Required<SongDto> {
      return {
         instruments: this.instruments.map((inst) => inst.toData()),
         patterns: this.patterns.map((pattern) => pattern.toData()),
         waveforms: this.waveforms.map((wave) => wave.toData()),
         tempo: this.tempo,
         speed: this.speed,
         rowsPerPattern: this.rowsPerPattern,
         name: this.name,
         highlightRowCount: this.highlightRowCount,
      };
   }

   toJSON(): string {
      return JSON.stringify(this.toData(), null, 2);
   }

   static fromData(data?: SongDto|null): Song {
      return new Song(data || {});
   }

   static fromJSON(json: string): Song {
      try {
         const data: SongDto = JSON.parse(json);
         return Song.fromData(data);
      } catch (err) {
         console.error("Failed to parse song JSON", err);
         return new Song();
      }
   }

   clone(): Song {
      return Song.fromData(this.toData());
   }
}
