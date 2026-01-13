
import {SomaticInstrument, SomaticInstrumentDto} from "../../models/instruments";
import {Song, SongDto} from "../../models/song";
import {Tic80Caps} from "../../models/tic80Capabilities";
import {Tic80Waveform, Tic80WaveformDto} from "../../models/waveform";
import {IsNullOrWhitespace} from "../../utils/utils";
import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../base/SubsystemBackendBase";

const DEFAULT_CHANNEL_COUNT = 4;
const DEFAULT_MAX_ROWS_PER_PATTERN = 64;

const makeWaveformList = (data: Tic80WaveformDto[]): Tic80Waveform[] => {
   // POC: reuse existing waveform data model so existing UI continues to work.
   const list = Array.from({length: Tic80Caps.waveform.count}, (_, i) => {
      const waveData = data[i];
      const wave = new Tic80Waveform(waveData);
      if (IsNullOrWhitespace(wave.name))
         wave.name = `WAVE ${i}`;
      return wave;
   });

   if (data.length === 0) {
      // New song: populate with a simple triangle-ish default.
      for (let i = 0; i < Tic80Caps.waveform.count; i++) {
         const wave = list[i]!;
         for (let p = 0; p < Tic80Caps.waveform.pointCount; p++) {
            const amp = Math.floor(
               (Tic80Caps.waveform.amplitudeRange - 1) *
                  (p < Tic80Caps.waveform.pointCount / 2 ?
                      (p / (Tic80Caps.waveform.pointCount / 2)) :
                      (1 - (p - Tic80Caps.waveform.pointCount / 2) / (Tic80Caps.waveform.pointCount / 2))),
            );
            wave.amplitudes[p] = amp;
         }
      }
   }

   return list;
};

const makeInstrumentList = (data: SomaticInstrumentDto[]): SomaticInstrument[] => {
   // POC: reuse current instrument structure for now.
   const list = Array.from({length: Tic80Caps.sfx.count}, (_, i) => {
      const instData = data[i]!;
      const inst = new SomaticInstrument(instData);
      if (IsNullOrWhitespace(inst.name)) {
         if (i === 0)
            inst.name = "dontuse";
         else if (i === 1)
            inst.name = "off";
         else
            inst.name = `new inst ${i.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      return inst;
   });

   const offInst = list[1];
   offInst.volumeFrames.fill(0);
   return list;
};

export class AmigaModSubsystemBackend implements SomaticSubsystemBackend<Song, SongDto> {
   subsystemType: SubsystemTypeKey = kSubsystem.key.AMIGAMOD;

   channelCount: number = DEFAULT_CHANNEL_COUNT;
   maxRowsPerPattern: number = DEFAULT_MAX_ROWS_PER_PATTERN;
   defaultRowsPerPattern: number = DEFAULT_MAX_ROWS_PER_PATTERN;

   // POC: keep ranges broadly compatible with existing UI expectations.
   minSongSpeed: number = 1;
   maxSongSpeed: number = 31;
   defaultSongSpeed: number = 6;

   minSongTempo: number = 32;
   maxSongTempo: number = 255;
   defaultSongTempo: number = 125;

   minPatternMidiNote: number = 0;
   maxPatternMidiNote: number = 127;

   // POC: keep the existing instrument count so panels don't need to change yet.
   maxInstruments: number = Tic80Caps.sfx.count;

   initWaveformsAndInstruments(song: Song, data: Partial<SongDto>): void {
      song.instruments = makeInstrumentList(data.instruments || []);
      song.waveforms = makeWaveformList(data.waveforms || []);
   }

   onInitOrSubsystemTypeChange(_song: Song): void {
   }

   calculateBpm({songTempo, songSpeed, rowsPerBeat}: {songTempo: number; songSpeed: number; rowsPerBeat: number;}):
      number {
      return (24 * songTempo) / (songSpeed * rowsPerBeat);
   }

   calculateSongPositionInSeconds(args: {songTempo: number; songSpeed: number; rowIndex: number;}): number {
      const {songTempo, songSpeed, rowIndex} = args;
      const bpm = this.calculateBpm({songTempo, songSpeed, rowsPerBeat: 4});
      const beatsPerSecond = bpm / 60;
      const rowsPerSecond = beatsPerSecond * 4;
      return rowIndex / rowsPerSecond;
   }
}
