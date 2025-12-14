// https://github.com/nesbox/TIC-80/wiki/.tic-File-Format
import { clamp } from "../utils/utils";

// per frame
// u8 volume:4;
// u8 wave index:4;
// u8 chord:4; // aka arpeggio
// s8 pitch:4;

// sfx data layout (after frames)
// u8 octave:3;
// u8 pitch16x:1; // pitch factor
// s8 speed:SFX_SPEED_BITS;
// u8 reverse:1; // chord reverse
// u8 note:4;
// u8 stereo_left:1;
// u8 stereo_right:1;
// u8 temp:2;


const SFX_FRAME_COUNT = 30;

export interface Tic80InstrumentFields {
    name: string;

    speed: number; // 0-7 
    baseNote: number; // 0-15
    octave: number; // 0-7
    stereoLeft: boolean;
    stereoRight: boolean;

    // volume envelope
    volumeFrames: Uint8Array; // volume frames (0-15)
    volumeLoopStart: number; // 0-29
    volumeLoopLength: number; // 0-29

    // arpeggio frames
    arpeggioFrames: Uint8Array; // arpeggio frames (0-15)
    arpeggioLoopStart: number; // 0-29
    arpeggioLoopLength: number; // 0-29
    arpeggioDown: boolean;

    // waveform id frames
    waveFrames: Uint8Array;
    waveLoopStart: number; // 0-29
    waveLoopLength: number; // 0-29

    // pitch frames
    pitchFrames: Int8Array;
    pitchLoopStart: number; // 0-29
    pitchLoopLength: number; // 0-29
    pitch16x: boolean;
};

// aka "SFX" aka "sample" (from tic.h / sound.c)
export class Tic80Instrument implements Tic80InstrumentFields
{
    name: string;

    speed: number; // 0-7 
    baseNote: number; // 0-15
    octave: number; // 0-7
    stereoLeft: boolean;
    stereoRight: boolean;

    // volume envelope
    volumeFrames: Uint8Array; // volume frames (0-15)
    volumeLoopStart: number; // 0-29
    volumeLoopLength: number; // 0-29

    // arpeggio frames
    arpeggioFrames: Uint8Array; // arpeggio frames (0-15)
    arpeggioLoopStart: number; // 0-29
    arpeggioLoopLength: number; // 0-29
    arpeggioDown: boolean;

    // waveform id frames
    waveFrames: Uint8Array;
    waveLoopStart: number; // 0-29
    waveLoopLength: number; // 0-29

    // pitch frames
    pitchFrames: Int8Array;
    pitchLoopStart: number; // 0-29
    pitchLoopLength: number; // 0-29
    pitch16x: boolean;

    // editor-only...
    constructor(data: Partial<Tic80InstrumentFields> = {}) {
        this.name = data.name ?? '';
        
        this.speed = clamp(data.speed ?? 0, 0, 7);
        this.baseNote = clamp(data.baseNote ?? 0, 0, 15);
        this.octave = clamp(data.octave ?? 0, 0, 7);
        this.stereoLeft = Boolean(data.stereoLeft);
        this.stereoRight = Boolean(data.stereoRight);
        
        this.volumeFrames = data.volumeFrames ? new Uint8Array(data.volumeFrames) : new Uint8Array(SFX_FRAME_COUNT);
        this.volumeLoopStart = clamp(data.volumeLoopStart ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.volumeLoopLength = clamp(data.volumeLoopLength ?? 0, 0, SFX_FRAME_COUNT - 1);

        this.arpeggioFrames = data.arpeggioFrames ? new Uint8Array(data.arpeggioFrames) : new Uint8Array(SFX_FRAME_COUNT);
        this.arpeggioLoopStart = clamp(data.arpeggioLoopStart ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.arpeggioLoopLength = clamp(data.arpeggioLoopLength ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.arpeggioDown = Boolean(data.arpeggioDown);

        this.waveFrames = data.waveFrames ? new Uint8Array(data.waveFrames) : new Uint8Array(SFX_FRAME_COUNT);
        this.waveLoopStart = clamp(data.waveLoopStart ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.waveLoopLength = clamp(data.waveLoopLength ?? 0, 0, SFX_FRAME_COUNT - 1);

        this.pitchFrames = data.pitchFrames ? new Int8Array(data.pitchFrames) : new Int8Array(SFX_FRAME_COUNT);
        this.pitchLoopStart = clamp(data.pitchLoopStart ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.pitchLoopLength = clamp(data.pitchLoopLength ?? 0, 0, SFX_FRAME_COUNT - 1);
        this.pitch16x = Boolean(data.pitch16x);
    }

    static fromData(data?: Partial<Tic80InstrumentFields>): Tic80InstrumentFields {
        return new Tic80Instrument(data || {});
    }

    toData(): Tic80InstrumentFields {
        return {
            name: this.name,

            speed: this.speed,
            baseNote: this.baseNote,
            octave: this.octave,
            stereoLeft: this.stereoLeft,
            stereoRight: this.stereoRight,
            volumeFrames: new Uint8Array(this.volumeFrames),
            volumeLoopStart: this.volumeLoopStart,
            volumeLoopLength: this.volumeLoopLength,
            arpeggioFrames: new Uint8Array(this.arpeggioFrames),
            arpeggioLoopStart: this.arpeggioLoopStart,
            arpeggioLoopLength: this.arpeggioLoopLength,
            arpeggioDown: this.arpeggioDown,
            waveFrames: new Uint8Array(this.waveFrames),
            waveLoopStart: this.waveLoopStart,
            waveLoopLength: this.waveLoopLength,
            pitchFrames: new Int8Array(this.pitchFrames),
            pitchLoopStart: this.pitchLoopStart,
            pitchLoopLength: this.pitchLoopLength,
            pitch16x: this.pitch16x,
        };
    };

    clone(): Tic80Instrument {
        return new Tic80Instrument(this);
    }
}
