import {clamp, IsNullOrWhitespace, SanitizeFilename} from "../utils/utils";

import {Tic80Instrument, Tic80InstrumentDto} from "./instruments";
import {Pattern, PatternDto, isNoteCut} from "./pattern";
import {SongOrderDto, SongOrderItem} from "./songOrder";
import {Tic80Caps} from "./tic80Capabilities";
import {Tic80Waveform, Tic80WaveformDto} from "./waveform";

// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-tracks
// export type InstrumentData = ReturnType<Tic80Instrument['toData']>;
// export type PatternData = ReturnType<Pattern['toData']>;

export type SongDto = {
   name: string; //

   tempo: number; //
   speed: number;
   rowsPerPattern: number;

   highlightRowCount: number;
   patternEditStep: number;

   instruments: Tic80InstrumentDto[]; //
   waveforms: Tic80WaveformDto[];
   patterns: PatternDto[];
   songOrder: (number|SongOrderDto)[]; // index into patterns

   // replaces the BEGIN_CUSTOM_ENTRYPOINT block in the exported playroutine.
   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;

   arrangementThumbnailSize: ArrangementThumbnailSize;
};

export type ArrangementThumbnailSize = "off"|"small"|"normal"|"large";

const makeWaveformList = (data: Tic80WaveformDto[]): Tic80Waveform[] => {
   const ret = Array.from({length: Tic80Caps.waveform.count}, (_, i) => {
      const waveData = data[i];
      const ret = new Tic80Waveform(waveData);
      if (IsNullOrWhitespace(ret.name))
         ret.name = `WAVE ${i}`;
      return ret;
   });

   if (data.length === 0) {
      // new song; populate waveforms. the waveforms exist and amplitude arrays exist but are zero'd.
      // populate with triangle waves.
      for (let i = 0; i < Tic80Caps.waveform.count; i++) {
         const wave = ret[i]!;
         for (let p = 0; p < Tic80Caps.waveform.pointCount; p++) {
            const amp = Math.floor(
               (Tic80Caps.waveform.amplitudeRange - 1) *
               (p < Tic80Caps.waveform.pointCount / 2 ?
                   (p / (Tic80Caps.waveform.pointCount / 2)) :
                   (1 - (p - Tic80Caps.waveform.pointCount / 2) / (Tic80Caps.waveform.pointCount / 2))));
            wave.amplitudes[p] = amp;
         }
      }
   }
   return ret;
};

const makeInstrumentList = (data: Tic80InstrumentDto[]): Tic80Instrument[] => {
   //const length =  INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
   const list = Array.from({length: Tic80Caps.sfx.count}, (_, i) => {
      const instData = data[i]!;
      const ret = new Tic80Instrument(instData);
      if (IsNullOrWhitespace(ret.name)) {
         if (i === 0) {
            ret.name = "dontuse";
         } else if (i === 1) {
            ret.name = "off";
         } else {
            ret.name = `new inst ${i.toString(16).toUpperCase().padStart(2, "0")}`;
         }
      }
      return ret;
   });

   // ensure the "off" instrument at 1 is configured properly. really it just needs
   // to have a zero'd volume envelope.
   const offInst = list[1];
   offInst.volumeFrames.fill(0);

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
   songOrder: SongOrderItem[]; // index into patterns
   rowsPerPattern: number;
   // positions: number[];

   // tic80 music editor shows a range of 40-250. theoretically it's 32-255 apparently https://github.com/nesbox/TIC-80/issues/2153
   tempo: number;
   speed: number;

   // editor-specific
   name: string;
   highlightRowCount: number;
   patternEditStep: number;

   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;

   arrangementThumbnailSize: ArrangementThumbnailSize;

   constructor(data: Partial<SongDto> = {}) {
      this.instruments = makeInstrumentList(data.instruments || []);
      this.patterns = makePatternList(data.patterns || []);
      this.songOrder = (data.songOrder || [0]).map((item) => new SongOrderItem(item)); // default to first pattern
      this.waveforms = makeWaveformList(data.waveforms || []);
      this.rowsPerPattern = clamp(data.rowsPerPattern ?? Tic80Caps.pattern.maxRows, 1, Tic80Caps.pattern.maxRows);
      this.tempo = clamp(data.tempo ?? 120, 1, 255);
      this.speed = clamp(data.speed ?? 6, 1, 31);
      this.name = data.name ?? "New song";
      this.highlightRowCount = data.highlightRowCount ?? 4;
      this.patternEditStep = clamp(data.patternEditStep ?? 1, 0, 32);
      this.useCustomEntrypointLua = data.useCustomEntrypointLua ?? false;
      this.customEntrypointLua = data.customEntrypointLua || "";

      // Default to showing thumbnails (matches previous behavior).
      this.arrangementThumbnailSize = (data.arrangementThumbnailSize as ArrangementThumbnailSize) ?? "normal";
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

   setPatternEditStep(value: number) {
      this.patternEditStep = clamp(value, 0, 32);
   }

   setRowsPerPattern(value: number) {
      this.rowsPerPattern = clamp(value, 1, Tic80Caps.pattern.maxRows);
   }

   countInstrumentNotesInPattern(patternIndex: number, instrumentIndex: number): number {
      const pattern = this.patterns[patternIndex];
      const rowLimit = clamp(this.rowsPerPattern, 0, Tic80Caps.pattern.maxRows);
      let count = 0;

      for (let ch = 0; ch < pattern.channels.length; ch += 1) {
         const rows = pattern.channels[ch].rows;
         const limit = Math.min(rows.length, rowLimit);
         for (let r = 0; r < limit; r += 1) {
            const cell = rows[r] || {};
            if (cell.instrumentIndex === instrumentIndex && cell.midiNote !== undefined && !isNoteCut(cell)) {
               count += 1;
            }
         }
      }

      return count;
   }

   getInstrument(index: number): Tic80Instrument|null {
      if (index < 0 || index >= this.instruments.length)
         return null;
      return this.instruments[index]!;
   }

   getFilename(extensionWithDot: string): string {
      const safeName = SanitizeFilename(this.name, "untitled");
      return `${safeName}${extensionWithDot}`;
   }

   toData(): Required<SongDto> {
      return {
         instruments: this.instruments.map((inst) => inst.toData()),
         patterns: this.patterns.map((pattern) => pattern.toData()),
         waveforms: this.waveforms.map((wave) => wave.toData()),
         songOrder: this.songOrder.map((item) => item.toData()),
         tempo: this.tempo,
         speed: this.speed,
         rowsPerPattern: this.rowsPerPattern,
         name: this.name,
         highlightRowCount: this.highlightRowCount,
         patternEditStep: this.patternEditStep,
         useCustomEntrypointLua: this.useCustomEntrypointLua,
         customEntrypointLua: this.customEntrypointLua,

         arrangementThumbnailSize: this.arrangementThumbnailSize,
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


export const formatPatternIndex = (index: number) => index.toString().padStart(2, "0");
