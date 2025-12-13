import { Wave } from "./instruments";
import { Pattern } from "./pattern";
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

row_frame=0
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
 if row_frame==0 then
  read_row()
 end
 row_frame=(row_frame+1)%song_speed
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

const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

const makeInstrumentList = (data) => {
    const length = INSTRUMENT_COUNT + 1; // index 0 unused, indexes 1..INSTRUMENT_COUNT
    const list = Array.from({ length }, (_, i) => {
        const instData = data && data[i];
        return new Wave(instData || {});
    });
    if (!list[1].name) list[1].name = "Square";
    return list;
};

const makePatternList = (data) => {
    const list = Array.from({ length: PATTERN_COUNT }, (_, i) => Pattern.fromData(data ? data[i] : undefined));
    return list;
};

export class Song {
    constructor(data = {}) {
        this.instruments = makeInstrumentList(data.instruments);
        this.patterns = makePatternList(data.patterns);
        this.positions = Array.from({ length: 256 }, (_, i) => clamp(data.positions?.[i] ?? 0, 0, PATTERN_COUNT - 1));
        this.speed = clamp(data.speed ?? 6, 1, 31);
        this.length = clamp(data.length ?? 1, 1, 256);
    }

    usedPatterns() {
        const patterns = new Set();
        for (let i = 0; i < this.length; i++) {
            patterns.add(this.positions[i]);
        }
        return patterns;
    }

    usedInstruments() {
        const instruments = new Set();
        for (const patternNumber of this.usedPatterns()) {
            const pattern = this.patterns[patternNumber];
            for (const inst of pattern.usedInstruments()) {
                instruments.add(inst);
            }
        }
        return instruments;
    }

    setPosition(index, value) {
        if (index < 0 || index >= this.positions.length) return;
        this.positions[index] = clamp(value, 0, PATTERN_COUNT - 1);
    }

    setLength(value) {
        this.length = clamp(value, 1, 256);
    }

    setSpeed(value) {
        this.speed = clamp(value, 1, 31);
    }

    getLuaCode() {
        const exportedPatterns = [];
        const patternMap = {};
        for (const patternNumber of this.usedPatterns()) {
            exportedPatterns.push(this.patterns[patternNumber]);
            patternMap[patternNumber] = exportedPatterns.length;
        }

        const positions = this.positions.slice(0, this.length);
        for (let i = 0; i < positions.length; i++) {
            positions[i] = patternMap[positions[i]];
        }

        const exportedInstruments = [];
        const instrumentsMap = {};
        for (const instrumentNumber of this.usedInstruments()) {
            exportedInstruments.push(this.instruments[instrumentNumber]);
            instrumentsMap[instrumentNumber] = exportedInstruments.length;
        }

        const patternsData = exportedPatterns.map((pattern) => pattern.getLuaData(instrumentsMap)).join(",\n");

        const instrumentsCode = exportedInstruments.map((instrument) => instrument.getLuaCode()).join(",\n");
        return `
instruments={
${instrumentsCode}
}
patterns={
${patternsData}
}
positions={${positions.join(',')}}
song_speed=${this.speed}

${PLAYER_CODE}
`;
    }

    toData() {
        return {
            instruments: this.instruments.map((inst) => inst.toData()),
            patterns: this.patterns.map((pattern) => pattern.toData()),
            positions: [...this.positions],
            speed: this.speed,
            length: this.length,
        };
    }

    toJSON() {
        return JSON.stringify(this.toData());
    }

    static fromData(data) {
        return new Song(data || {});
    }

    static fromJSON(json) {
        try {
            const data = JSON.parse(json);
            return Song.fromData(data);
        } catch (err) {
            console.error("Failed to parse song JSON", err);
            return new Song();
        }
    }

    clone() {
        return Song.fromData(this.toData());
    }
}
