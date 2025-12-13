import { EventEmitter } from 'events';
import { TICSynth } from './ticsynth';
import { NOTES_BY_NUM } from '../defs';
import { FrameData, Wave } from '../models/instruments';
import { Pattern } from '../models/pattern';
import { Song } from '../models/song';

type InstrumentFrameCallback = (frameNumber: number) => FrameData;

type ChannelPlaybackState = {
    instrumentNumber: number;
    instrumentCallback: InstrumentFrameCallback | null;
    instrumentFrame: number;
};

export class AudioController extends EventEmitter {
    audioStarted: boolean;
    ticSynth: TICSynth | null;
    gainNode: GainNode | null;
    volume: number;
    song: Song | null;
    channelStates: ChannelPlaybackState[];

    isPlaying: boolean;

    constructor() {
        super();
        this.audioStarted = false;
        this.ticSynth = null;
        this.gainNode = null;
        this.volume = 0.3;
        this.song = null;
        this.channelStates = [];

        this.isPlaying = false;

        for (let i = 0; i < 4; i++) {
            this.channelStates[i] = {
                instrumentNumber: 1,
                instrumentCallback: null,
                instrumentFrame: 0,
            };
        }
    }

    ensureAudio() {
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

    play(frameCallback: (frameNumber: number) => Array<FrameData | null>) {
        /* Start playback of TIC audio. The frameCallback function will
         * be called for each frame with the frame number as its argument,
         * and should return an array of 4 channel data objects. Each channel
         * data object should have 'waveform' (array of 32 volume values),
         * 'volume' (0-15), and 'frequency' (in Hz) properties. If a channel
         * data object is null, that channel will be silent.
         */
        this.ensureAudio();
        if (!this.ticSynth) return;

        this.ticSynth.frameNumber = 0;
        this.ticSynth.frameCallback = frameCallback;
        this.ticSynth.onFrame = (frameData) => {
            this.emit('frame', frameData);
        };
    }

    stop() {
        if (!this.ticSynth) {
            this.isPlaying = false;
            this.emit('stop');
            return;
        }
        this.ticSynth.frameCallback = null;
        this.isPlaying = false;
        this.emit('stop');
    }

    playInstrument(instrument: Wave, frequency: number) {
        const instrumentFrameCallback = instrument.getFrameCallback(frequency);
        const frameCallback = (frameNumber: number) => [instrumentFrameCallback(frameNumber)];
        this.play(frameCallback);
    }

    clearChannelStates() {
        for (let i = 0; i < 4; i++) {
            this.channelStates[i].instrumentCallback = null;
            this.channelStates[i].instrumentFrame = 0;
        }
    }

    readRow(pattern: Pattern, rowNumber: number) {
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
        let rowNumber = 0;
        let rowFrameNumber = 0;
        this.clearChannelStates();
        const frameCallback = () => {
            if (rowFrameNumber === 0) {
                this.readRow(pattern, rowNumber);
                this.emit('row', rowNumber, pattern);
            }
            rowFrameNumber++;
            if (rowFrameNumber >= this.song!.speed) {
                rowFrameNumber = 0;
                rowNumber++;
                if (rowNumber >= 64) {
                    rowNumber = 0;
                }
            }
            return this.channelStates.map((state) => (
                state.instrumentCallback ? state.instrumentCallback(state.instrumentFrame++) : null
            ));
        };
        this.isPlaying = true;
        this.play(frameCallback);
    }

    playSong(startPosition: number) {
        if (!this.song) return;
        let positionNumber = startPosition;
        let rowNumber = 0;
        let rowFrameNumber = 0;
        this.clearChannelStates();
        this.emit('position', positionNumber);
        const frameCallback = () => {
            if (rowFrameNumber === 0) {
                const patternNumber = this.song!.positions[positionNumber];
                const pattern = this.song!.patterns[patternNumber];
                this.readRow(pattern, rowNumber);
                this.emit('row', rowNumber, pattern);
            }
            rowFrameNumber++;
            if (rowFrameNumber >= this.song!.speed) {
                rowFrameNumber = 0;
                rowNumber++;
                if (rowNumber >= 64) {
                    rowNumber = 0;
                    positionNumber = (positionNumber + 1) % this.song!.length;
                    this.emit('position', positionNumber);
                }
            }
            return this.channelStates.map((state) => (
                state.instrumentCallback ? state.instrumentCallback(state.instrumentFrame++) : null
            ));
        };
        this.isPlaying = true;
        this.play(frameCallback);
    }

    setVolume(vol: number) {
        this.volume = vol;
        if (this.gainNode) this.gainNode.gain.value = vol;
    }
}
