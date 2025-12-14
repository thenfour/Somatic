import { Tic80Instrument } from './instruments';
import { Pattern } from './pattern';
import { PATTERN_COUNT, INSTRUMENT_COUNT } from '../defs';

const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

export type InstrumentData = ReturnType<Tic80Instrument['toData']>;
export type PatternData = ReturnType<Pattern['toData']> | null;
export type SongData = {
    instruments?: (InstrumentData | Partial<InstrumentData> | undefined)[];
    patterns?: (PatternData | undefined)[];
    positions?: number[];
    tempo?: number;
    speed?: number;
    length?: number;
    highlightRowCount?: number;
};

const makeInstrumentList = (data?: SongData['instruments']): Tic80Instrument[] => {
    const length = INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
    const list = Array.from({ length }, (_, i) => {
        const instData = data && data[i];
        return new Tic80Instrument(instData || {});
    });
    if (!list[1].name) list[1].name = 'SFX 1';
    return list;
};

const makePatternList = (data?: SongData['patterns']): Pattern[] => {
    return Array.from({ length: PATTERN_COUNT }, (_, i) => Pattern.fromData(data ? data[i] : undefined));
};

export class Song {
    instruments: Tic80Instrument[];
    patterns: Pattern[];
    positions: number[];
    tempo: number;
    speed: number;
    length: number;
    highlightRowCount: number;

    constructor(data: SongData = {}) {
        this.instruments = makeInstrumentList(data.instruments);
        this.patterns = makePatternList(data.patterns);
        this.positions = Array.from({ length: 256 }, (_, i) => clamp(data.positions?.[i] ?? 0, 0, PATTERN_COUNT - 1));
        this.tempo = clamp(data.tempo ?? 120, 1, 255);
        this.speed = clamp(data.speed ?? 6, 1, 31);
        this.length = clamp(data.length ?? 1, 1, 256);
        this.highlightRowCount = clamp(data.highlightRowCount ?? 16, 1, 64);
    }

    usedPatterns(): Set<number> {
        const patterns = new Set<number>();
        for (let i = 0; i < this.length; i++) patterns.add(this.positions[i]);
        return patterns;
    }

    usedInstruments(): Set<number> {
        const instruments = new Set<number>();
        for (const patternNumber of this.usedPatterns()) {
            const pattern = this.patterns[patternNumber];
            for (const inst of pattern.usedInstruments()) instruments.add(inst);
        }
        return instruments;
    }

    setPosition(index: number, value: number) {
        if (index < 0 || index >= this.positions.length) return;
        this.positions[index] = clamp(value, 0, PATTERN_COUNT - 1);
    }

    setLength(value: number) {
        this.length = clamp(value, 1, 256);
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

    getLuaCode(): string {
        // Simplified export: return a Lua script that contains serialized TIC-80 style instrument and pattern data.
        const data = this.toData();
        const json = JSON.stringify(data, null, 2);
        return `-- TIC-80 song data (JSON blob for tooling; not a runnable player)\nreturn [[${json}]]`;
    }

    toData(): Required<SongData> {
        return {
            instruments: this.instruments.map((inst) => inst.toData()),
            patterns: this.patterns.map((pattern) => pattern.toData()),
            positions: [...this.positions],
            tempo: this.tempo,
            speed: this.speed,
            length: this.length,
            highlightRowCount: this.highlightRowCount,
        };
    }

    toJSON(): string {
        return JSON.stringify(this.toData());
    }

    static fromData(data?: SongData | null): Song {
        return new Song(data || {});
    }

    static fromJSON(json: string): Song {
        try {
            const data: SongData = JSON.parse(json);
            return Song.fromData(data);
        } catch (err) {
            console.error('Failed to parse song JSON', err);
            return new Song();
        }
    }

    clone(): Song {
        return Song.fromData(this.toData());
    }
}
