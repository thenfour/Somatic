import type { Wave, FrameData } from '../models/instruments';
import type { Pattern } from '../models/pattern';
import type { Song } from '../models/song';

export type BackendEmitters = {
    frame: (data: Array<FrameData | null>) => void;
    row: (rowNumber: number, pattern: Pattern) => void;
    position: (positionNumber: number) => void;
    stop: () => void;
};

export interface AudioBackend {
    setSong(song: Song | null): void | Promise<void>;
    setVolume(vol: number): void | Promise<void>;
    playInstrument(instrument: Wave, frequency: number): void | Promise<void>;
    playRow(pattern: Pattern, rowNumber: number): void | Promise<void>;
    playPattern(pattern: Pattern): void | Promise<void>;
    playSong(startPosition: number): void | Promise<void>;
    stop(): void | Promise<void>;
}

export interface BackendContext {
    emit: BackendEmitters;
}
