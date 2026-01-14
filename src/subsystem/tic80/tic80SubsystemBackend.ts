import {SomaticInstrument, SomaticInstrumentDto} from "../../models/instruments";
import {Song, SongDto} from "../../models/song";
import {Tic80Caps} from "../../models/tic80Capabilities";
import {Tic80Waveform, Tic80WaveformDto} from "../../models/waveform";
import {IsNullOrWhitespace} from "../../utils/utils";
import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../base/SubsystemBackendBase";

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


const makeInstrumentList = (data: SomaticInstrumentDto[]): SomaticInstrument[] => {
   const somaticCount = Math.max(0, Tic80Caps.sfx.maxSupported);
   return Array.from({length: somaticCount}, (_, i) => {
      const instData = data[i]!;
      const ret = new SomaticInstrument(instData);
      if (IsNullOrWhitespace(ret.name)) {
         ret.name = `new inst ${i.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      return ret;
   });
};



export class Tic80SubsystemBackend implements SomaticSubsystemBackend<Song, SongDto> {
   subsystemType: SubsystemTypeKey = kSubsystem.key.TIC80;
   channelCount: number = Tic80Caps.song.audioChannels;
   maxRowsPerPattern: number = Tic80Caps.pattern.maxRows;
   defaultRowsPerPattern: number = 64;

   minSongSpeed: number = Tic80Caps.song.songSpeedMin;
   maxSongSpeed: number = Tic80Caps.song.songSpeedMax;
   defaultSongSpeed: number = 4;

   minSongTempo: number = Tic80Caps.song.minTempo;
   maxSongTempo: number = Tic80Caps.song.maxTempo;
   defaultSongTempo: number = 150;

   minPatternMidiNote: number = Tic80Caps.pattern.minMidiNote;
   maxPatternMidiNote: number = Tic80Caps.pattern.maxMidiNote;

   maxInstruments: number = Tic80Caps.sfx.maxSupported;

   initWaveformsAndInstruments(song: Song, data: Partial<SongDto>): void {
      song.instruments = makeInstrumentList(data.instruments || []);
      song.waveforms = makeWaveformList(data.waveforms || []);
   }

   onInitOrSubsystemTypeChange(song: Song): void {
   }

   calculateBpm({songTempo, songSpeed, rowsPerBeat}: {songTempo: number, songSpeed: number, rowsPerBeat: number}) {
      // https://itch.io/t/197936/music-editor-how-spd-relates-to-tempo-beats-per-minute
      // that formula assumes 4 rows per beat.
      // so for arbitrary rows per beat,
      // bpm = 24 * T / S L
      return (24 * songTempo) / (songSpeed * rowsPerBeat);
   };

   // calculates the song position in seconds at a given row index (assume row 0 = 0 seconds)
   calculateSongPositionInSeconds(args: {songTempo: number; songSpeed: number; rowIndex: number;}): number {
      const {songTempo, songSpeed, rowIndex} = args;
      const bpm = this.calculateBpm({songTempo, songSpeed, rowsPerBeat: 4});
      const beatsPerSecond = bpm / 60;
      const rowsPerSecond = beatsPerSecond * 4;
      return rowIndex / rowsPerSecond;
   };
}
