import { NOTE_NUMS_BY_NAME } from '../defs';

export type Row = { note: number; instrument: number };
export type SerializedRow = Row | string | null | undefined;

const EMPTY_ROW = (): Row => ({ note: 0, instrument: 0 });
const ROW_COUNT = 64;
const CHANNEL_COUNT = 4;

export class Channel {
    rows: Row[];

    constructor(rows?: Row[]) {
        this.rows = rows ? [...rows] : Array.from({ length: ROW_COUNT }, EMPTY_ROW);
    }

    setRow(index: number, field: keyof Row, value: number) {
        if (index < 0 || index >= this.rows.length) return;
        const row = { ...this.rows[index], [field]: value } as Row;
        this.rows[index] = row;
    }

    getLuaData(instrumentsMap: Record<number, number>): string {
        const rowData = this.rows
            .map((row) => `{${row.note},${row.instrument === 0 ? 0 : instrumentsMap[row.instrument]}}`)
            .join(',');
        return `  {${rowData}}`;
    }

    usedInstruments(): Set<number> {
        const instruments = new Set<number>();
        for (const row of this.rows) {
            if (row.instrument !== 0) instruments.add(row.instrument);
        }
        return instruments;
    }

    isEmpty(): boolean {
        return this.rows.every((row) => row.note === 0 && row.instrument === 0);
    }

    toData(): Row[] | null {
        if (this.isEmpty()) return null;
        return this.rows.map((row) => ({ ...row }));
    }

    static fromData(data?: SerializedRow[] | null): Channel {
        if (!data) return new Channel();
        const rows = Array.from({ length: ROW_COUNT }, (_, i) => {
            const rowData = data[i];
            if (!rowData) return EMPTY_ROW();
            if (typeof rowData === 'string') {
                const noteName = rowData.substring(0, 3);
                const instrumentHex = rowData.substring(4, 5);
                return {
                    note: NOTE_NUMS_BY_NAME[noteName] || 0,
                    instrument: parseInt(instrumentHex, 16) || 0,
                };
            }
            return { note: rowData.note || 0, instrument: rowData.instrument || 0 };
        });
        return new Channel(rows);
    }

    clone(): Channel {
        return Channel.fromData(this.rows.map((r) => ({ ...r })));
    }
}

export class Pattern {
    channels: Channel[];

    constructor(channels?: Channel[]) {
        this.channels = channels ? [...channels] : Array.from({ length: CHANNEL_COUNT }, () => new Channel());
    }

    getLuaData(instrumentsMap: Record<number, number>): string {
        const channelsData = this.channels.map((channel) => channel.getLuaData(instrumentsMap)).join(',\n');
        return ` {
${channelsData}
 }`;
    }

    usedInstruments(): Set<number> {
        const instruments = new Set<number>();
        for (const channel of this.channels) {
            for (const inst of channel.usedInstruments()) instruments.add(inst);
        }
        return instruments;
    }

    isEmpty(): boolean {
        return this.channels.every((channel) => channel.isEmpty());
    }

    toData(): (Row[] | null)[] | null {
        if (this.isEmpty()) return null;
        return this.channels.map((channel) => channel.toData());
    }

    static fromData(data?: (SerializedRow[] | null)[] | null): Pattern {
        if (!data) return new Pattern();
        const channels = Array.from({ length: CHANNEL_COUNT }, (_, i) => Channel.fromData(data[i]));
        return new Pattern(channels);
    }

    clone(): Pattern {
        return Pattern.fromData(this.channels.map((channel) => channel.rows.map((r) => ({ ...r }))));
    }
}
