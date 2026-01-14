import {SomaticInstrument, SomaticInstrumentDto} from "../../models/instruments";
import {Song, SongDto} from "../../models/song";
import {Tic80Caps} from "../../models/tic80Capabilities";
import {Tic80Waveform, Tic80WaveformDto} from "../../models/waveform";
import {kSubsystem, SomaticSubsystemBackend, SubsystemTypeKey} from "../base/SubsystemBackendBase";

const DEFAULT_CHANNEL_COUNT = 3;
const DEFAULT_MAX_ROWS_PER_PATTERN = 64;


const makeWaveformList = (data: Tic80WaveformDto[]): Tic80Waveform[] => {
   return [new Tic80Waveform()];
};

const makeInstrumentList = (data: SomaticInstrumentDto[]): SomaticInstrument[] => {
   const list = Array.from({length: Tic80Caps.sfx.maxSupported}, (_, i) => {
      const instData = data[i]!;
      const inst = new SomaticInstrument(instData);
      inst.name = `new inst ${i.toString(16).toUpperCase().padStart(2, "0")}`;
      return inst;
   });

   const offInst = list[1];
   offInst.volumeFrames.fill(0);
   return list;
};

export class SidSubsystemBackend implements SomaticSubsystemBackend<Song, SongDto> {
   subsystemType: SubsystemTypeKey = kSubsystem.key.SID;

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

   minEditorOctave: number = 1;
   maxEditorOctave: number = 8;
   defaultEditorOctave: number = 4;

   // POC: keep the existing instrument count so panels don't need to change yet.
   maxInstruments: number = Tic80Caps.sfx.maxSupported;

   maxSongOrder: number = 16; // todo

   initWaveformsAndInstruments(song: Song, data: Partial<SongDto>): void {
      song.instruments = makeInstrumentList(data.instruments || []);
      song.waveforms = makeWaveformList(data.waveforms || []);
   }

   onInitOrSubsystemTypeChange(_song: Song): void {
   }

   calculateBpm({songTempo, songSpeed, rowsPerBeat}: {songTempo: number; songSpeed: number; rowsPerBeat: number;}) {
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
