import { SomaticInstrument, SomaticInstrumentDto } from "../../models/instruments";
import { Song, SongDto } from "../../models/song";
import { Tic80Caps } from "../../models/tic80Capabilities";
import { Tic80Waveform, Tic80WaveformDto } from "../../models/waveform";
import { IsNullOrWhitespace } from "../../utils/utils";
import { kSubsystem, SomaticSubsystem, SubsystemTypeKey } from "../base/SubsystemBase";

const makeWaveformList = (data: Tic80WaveformDto[]): Tic80Waveform[] => {
    const ret = Array.from({ length: Tic80Caps.waveform.count }, (_, i) => {
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
    //const length =  INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
    const list = Array.from({ length: Tic80Caps.sfx.count }, (_, i) => {
        const instData = data[i]!;
        const ret = new SomaticInstrument(instData);
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



export class Tic80Subsystem implements SomaticSubsystem<Song, SongDto> {
    subsystemType: SubsystemTypeKey = kSubsystem.key.TIC80;
    channelCount: number = Tic80Caps.song.audioChannels;
    maxRowsPerPattern: number = Tic80Caps.pattern.maxRows;
    defaultRowsPerPattern: number = 64;

    initWaveformsAndInstruments(song: Song, data: Partial<SongDto>): void {
        song.instruments = makeInstrumentList(data.instruments || []);
        song.waveforms = makeWaveformList(data.waveforms || []);
    }

    onInitOrSubsystemTypeChange(song: Song): void {
    }
}

