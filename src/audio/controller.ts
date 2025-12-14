import type { Wave, FrameData } from '../models/instruments';
import type { Pattern } from '../models/pattern';
import type { Song } from '../models/song';
import type { AudioBackend } from './backend';
import { WebAudioBackend } from './webaudio_backend';
import { Tic80Backend } from './tic80_backend';

type FrameListener = (frame: Array<FrameData | null>) => void;
type RowListener = (rowNumber: number, pattern: Pattern) => void;
type PositionListener = (positionNumber: number) => void;
type StopListener = () => void;

export class AudioController {
    backend: AudioBackend;
    song: Song | null;
    volume: number;
    isPlaying: boolean;

    private frameListeners = new Set<FrameListener>();
    private rowListeners = new Set<RowListener>();
    private positionListeners = new Set<PositionListener>();
    private stopListeners = new Set<StopListener>();

    constructor(opts?: { useTic80?: boolean; bridgeGetter?: () => any | null }) {
        this.volume = 0.3;
        this.song = null;
        this.isPlaying = false;
        const useTic = opts?.useTic80 ?? false;
        const ctx = {
            emit: {
                frame: (data: Array<FrameData | null>) => this.emitFrame(data),
                row: (rowNumber: number, pattern: Pattern) => this.emitRow(rowNumber, pattern),
                position: (positionNumber: number) => this.emitPosition(positionNumber),
                stop: () => this.emitStop(),
            },
        } as const;
        this.backend = useTic && opts?.bridgeGetter
            ? new Tic80Backend(ctx, opts.bridgeGetter)
            : new WebAudioBackend(ctx);
    }

    setSong(song: Song | null) {
        this.song = song;
        this.backend.setSong(song);
    }

    stop() {
        this.backend.stop();
        this.isPlaying = false;
    }

    playInstrument(instrument: Wave, frequency: number) {
        this.backend.playInstrument(instrument, frequency);
    }

    readRow(pattern: Pattern, rowNumber: number) {
        // Deprecated in favor of backend-driven playback; preserved for UI callers.
        this.backend.playRow(pattern, rowNumber);
    }

    playRow(pattern: Pattern, rowNumber: number) {
        this.backend.playRow(pattern, rowNumber);
    }

    playPattern(pattern: Pattern) {
        this.backend.playPattern(pattern);
        this.isPlaying = true;
    }

    playSong(startPosition: number) {
        this.backend.playSong(startPosition);
        this.isPlaying = true;
    }

    setVolume(vol: number) {
        this.volume = vol;
        this.backend.setVolume(vol);
    }

    onFrame(cb: FrameListener) { this.frameListeners.add(cb); return () => this.frameListeners.delete(cb); }
    offFrame(cb: FrameListener) { this.frameListeners.delete(cb); }
    onRow(cb: RowListener) { this.rowListeners.add(cb); return () => this.rowListeners.delete(cb); }
    offRow(cb: RowListener) { this.rowListeners.delete(cb); }
    onPosition(cb: PositionListener) { this.positionListeners.add(cb); return () => this.positionListeners.delete(cb); }
    offPosition(cb: PositionListener) { this.positionListeners.delete(cb); }
    onStop(cb: StopListener) { this.stopListeners.add(cb); return () => this.stopListeners.delete(cb); }
    offStop(cb: StopListener) { this.stopListeners.delete(cb); }

    private emitFrame(data: Array<FrameData | null>) { this.frameListeners.forEach((cb) => cb(data)); }
    private emitRow(row: number, pattern: Pattern) { this.rowListeners.forEach((cb) => cb(row, pattern)); }
    private emitPosition(pos: number) { this.positionListeners.forEach((cb) => cb(pos)); }
    private emitStop() { this.isPlaying = false; this.stopListeners.forEach((cb) => cb()); }
}
