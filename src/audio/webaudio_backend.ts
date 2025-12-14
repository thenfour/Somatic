import { AudioBackend, BackendContext } from './backend';
import { TICSynth } from './ticsynth';
import { NOTES_BY_NUM } from '../defs';
import type { Pattern } from '../models/pattern';
import type { Song } from '../models/song';
import type { Wave, FrameData } from '../models/instruments';

type InstrumentFrameCallback = (frameNumber: number) => FrameData;

type ChannelPlaybackState = {
    instrumentNumber: number;
    instrumentCallback: InstrumentFrameCallback | null;
    instrumentFrame: number;
};

export class WebAudioBackend implements AudioBackend {
    private readonly emit: BackendContext['emit'];
    private audioStarted = false;
    private ticSynth: TICSynth | null = null;
    private gainNode: GainNode | null = null;
    private volume = 0.3;
    private song: Song | null = null;
    private channelStates: ChannelPlaybackState[] = [];

    private isPlaying = false;

    constructor(ctx: BackendContext) {
        this.emit = ctx.emit;
        for (let i = 0; i < 4; i++) {
            this.channelStates[i] = {
                instrumentNumber: 1,
                instrumentCallback: null,
                instrumentFrame: 0,
            };
        }
    }

    setSong(song: Song | null) {
        this.song = song;
    }

    setVolume(vol: number) {
        this.volume = vol;
        if (this.gainNode) this.gainNode.gain.value = vol;
    }

    playInstrument(instrument: Wave, note: number) {
        const frequency = NOTES_BY_NUM[note]?.frequency;
        if (!frequency) return;
        const instrumentFrameCallback = instrument.getFrameCallback(frequency);
        const frameCallback = (frameNumber: number) => [instrumentFrameCallback(frameNumber)];
        this.play(frameCallback);
    }

    playRow(pattern: Pattern, rowNumber: number) {
        this.clearChannelStates();
        this.readRow(pattern, rowNumber);
        const frameCallback = () => this.channelStates.map((state) => (
            state.instrumentCallback ? state.instrumentCallback(state.instrumentFrame++) : null
        ));
        this.play(frameCallback);
    }

    playPattern(pattern: Pattern) {
        if (!this.song) return;
        const tempo = this.song.tempo;
        const speed = this.song.speed;
        const DEFAULT_SPEED = 6;
        const NOTES_PER_MINUTE = 900; // 60 fps * 60 sec / 4 rows-per-beat

        let tick = 0;
        let rowNumber = 0;
        this.clearChannelStates();
        const frameCallback = () => {
            const nextRow = Math.floor((tick * tempo * DEFAULT_SPEED) / (speed * NOTES_PER_MINUTE));
            if (nextRow !== rowNumber) {
                rowNumber = nextRow % 64;
                this.readRow(pattern, rowNumber);
                this.emit.row(rowNumber, pattern);
            }
            tick++;
            return this.channelStates.map((state) => (
                state.instrumentCallback ? state.instrumentCallback(state.instrumentFrame++) : null
            ));
        };
        this.isPlaying = true;
        this.play(frameCallback);
    }

    playSong(startPosition: number) {
        if (!this.song) return;
        const tempo = this.song.tempo;
        const speed = this.song.speed;
        const DEFAULT_SPEED = 6;
        const NOTES_PER_MINUTE = 900;

        let positionNumber = startPosition;
        let rowNumber = 0;
        let tick = 0;
        this.clearChannelStates();
        this.emit.position(positionNumber);
        const frameCallback = () => {
            const nextRow = Math.floor((tick * tempo * DEFAULT_SPEED) / (speed * NOTES_PER_MINUTE));
            if (nextRow !== rowNumber) {
                rowNumber = nextRow;
                if (rowNumber >= 64) {
                    rowNumber = 0;
                    positionNumber = (positionNumber + 1) % this.song!.length;
                    this.emit.position(positionNumber);
                }
                const patternNumber = this.song!.positions[positionNumber];
                const pattern = this.song!.patterns[patternNumber];
                this.readRow(pattern, rowNumber);
                this.emit.row(rowNumber, pattern);
            }
            tick++;
            return this.channelStates.map((state) => (
                state.instrumentCallback ? state.instrumentCallback(state.instrumentFrame++) : null
            ));
        };
        this.isPlaying = true;
        this.play(frameCallback);
    }

    stop() {
        if (!this.ticSynth) {
            this.isPlaying = false;
            this.emit.stop();
            return;
        }
        this.ticSynth.frameCallback = null;
        this.isPlaying = false;
        this.emit.stop();
    }

    // Internal helpers

    private ensureAudio() {
        if (this.audioStarted && this.ticSynth && this.gainNode) return;

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) throw new Error('Web Audio API not supported');
        const audioContext = new AudioContextClass({ latencyHint: 'interactive' });

        this.ticSynth = new TICSynth(audioContext.sampleRate);
        const scriptNode = audioContext.createScriptProcessor(0, 0, 1);
        scriptNode.onaudioprocess = (audioProcessingEvent: AudioProcessingEvent) => {
            if (!this.ticSynth) return;
            const outputBuffer = audioProcessingEvent.outputBuffer;
            const audioData = outputBuffer.getChannelData(0);
            this.ticSynth.generate(audioData);
        };
        this.gainNode = audioContext.createGain();
        this.gainNode.gain.value = this.volume;

        scriptNode.connect(this.gainNode);
        this.gainNode.connect(audioContext.destination);

        this.audioStarted = true;
    }

    private play(frameCallback: (frameNumber: number) => Array<FrameData | null>) {
        this.ensureAudio();
        if (!this.ticSynth) return;

        this.ticSynth.frameNumber = 0;
        this.ticSynth.frameCallback = frameCallback;
        this.ticSynth.onFrame = (frameData) => {
            this.emit.frame(frameData);
        };
    }

    private clearChannelStates() {
        for (let i = 0; i < 4; i++) {
            this.channelStates[i].instrumentCallback = null;
            this.channelStates[i].instrumentFrame = 0;
        }
    }

    private readRow(pattern: Pattern, rowNumber: number) {
        if (!this.song) return;
        for (let chan = 0; chan < 4; chan++) {
            const row = pattern.channels[chan].rows[rowNumber];
            const note = row.note;
            if (note !== 0) {
                const frequency = NOTES_BY_NUM[note]?.frequency;
                if (!frequency) continue;
                if (row.instrument) {
                    this.channelStates[chan].instrumentNumber = row.instrument;
                }
                const instrument = this.song.instruments[this.channelStates[chan].instrumentNumber];
                this.channelStates[chan].instrumentCallback = instrument.getFrameCallback(frequency);
                this.channelStates[chan].instrumentFrame = 0;
            }
        }
    }
}
