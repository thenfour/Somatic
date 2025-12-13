import { Wave } from './instruments';
import { Pattern } from './pattern';
import { PATTERN_COUNT, INSTRUMENT_COUNT } from '../defs';

const PLAYER_CODE = `
note_freqs={}
for n=1,107 do
 note_freqs[n]=440*2^((n-58)/12)
end

chan_states={}
for i=0,3 do
 chan_states[i]={inst=1,iframe=0,nfreq=440}
end

row_tick=0
row_num=0
position_num=0
pattern_num=0

function fetch_position()
 pattern_num=positions[position_num+1]
 row_num=0
end

fetch_position()

function read_row()
 for c=0,3 do
  note=patterns[pattern_num][c+1][row_num+1]
  note_num=note[1]
  if note_num~=0 then
   chan=chan_states[c]
   inst=note[2]
   if inst~=0 then
    chan.inst=inst
   end
   chan.iframe=0
   chan.nfreq=note_freqs[note_num]
  end
 end
 row_num=row_num+1
 if row_num==64 then
  position_num=(position_num+1)%(#positions)
  fetch_position()
 end
end

function music_frame()
 local next_row = math.floor(row_tick*song_tempo*6/(song_speed*900))
 if next_row~=row_num then
  row_num=next_row%64
  read_row()
 end
 row_tick=row_tick+1
 for c=0,3 do
  chan=chan_states[c]
  if chan.inst~=0 then
   instruments[chan.inst](c,15,chan.nfreq,chan.iframe)
   chan.iframe=chan.iframe+1
  end
 end
end

function TIC()
 cls()
 music_frame()
end
`;

const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

export type InstrumentData = ReturnType<Wave['toData']>;
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

const makeInstrumentList = (data?: SongData['instruments']): Wave[] => {
    const length = INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
    const list = Array.from({ length }, (_, i) => {
        const instData = data && data[i];
        return new Wave(instData || {});
    });
    if (!list[1].name) list[1].name = 'Square';
    return list;
};

const makePatternList = (data?: SongData['patterns']): Pattern[] => {
    return Array.from({ length: PATTERN_COUNT }, (_, i) => Pattern.fromData(data ? data[i] : undefined));
};

export class Song {
    instruments: Wave[];
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
        const exportedPatterns: Pattern[] = [];
        const patternMap: Record<number, number> = {};
        for (const patternNumber of this.usedPatterns()) {
            exportedPatterns.push(this.patterns[patternNumber]);
            patternMap[patternNumber] = exportedPatterns.length;
        }

        const positions = this.positions.slice(0, this.length);
        for (let i = 0; i < positions.length; i++) positions[i] = patternMap[positions[i]];

        const exportedInstruments: Wave[] = [];
        const instrumentsMap: Record<number, number> = {};
        for (const instrumentNumber of this.usedInstruments()) {
            exportedInstruments.push(this.instruments[instrumentNumber]);
            instrumentsMap[instrumentNumber] = exportedInstruments.length;
        }

        const patternsData = exportedPatterns.map((pattern) => pattern.getLuaData(instrumentsMap)).join(',\n');
        const instrumentsCode = exportedInstruments.map((instrument) => instrument.getLuaCode()).join(',\n');

        return `
instruments={
${instrumentsCode}
}
patterns={
${patternsData}
}
positions={${positions.join(',')}}
    song_tempo=${this.tempo}
song_speed=${this.speed}

${PLAYER_CODE}
`;
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
