import { NOTE_NUMS_BY_NAME, NOTES_BY_NUM } from '../defs';

const EMPTY_ROW = () => ({ note: 0, instrument: 0 });

export class Channel {
    constructor(rows) {
        this.rows = rows || Array.from({ length: 64 }, () => EMPTY_ROW());
    }

    setRow(index, field, value) {
        if (index < 0 || index >= this.rows.length) return;
        const row = { ...this.rows[index], [field]: value };
        this.rows[index] = row;
    }

    getLuaData(instrumentsMap) {
        const rowData = this.rows.map((row) => {
            return `{${row.note},${row.instrument === 0 ? 0 : instrumentsMap[row.instrument]}}`;
        }).join(",");
        return `  {${rowData}}`;
    }

    usedInstruments() {
        const instruments = new Set();
        for (const row of this.rows) {
            if (row.instrument !== 0) {
                instruments.add(row.instrument);
            }
        }
        return instruments;
    }

    isEmpty() {
        return this.rows.every((row) => row.note === 0 && row.instrument === 0);
    }

    toData() {
        if (this.isEmpty()) return null;
        return this.rows.map((row) => ({ ...row }));
    }

    static fromData(data) {
        if (!data) return new Channel();
        const rows = Array.from({ length: 64 }, (_, i) => {
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

    clone() {
        return Channel.fromData(this.rows.map((r) => ({ ...r }))); // reuse fromData for consistency
    }
}

export class Pattern {
    constructor(channels) {
        this.channels = channels || Array.from({ length: 4 }, () => new Channel());
    }

    getLuaData(instrumentsMap) {
        const channelsData = this.channels.map((channel) => channel.getLuaData(instrumentsMap)).join(",\n");
        return ` {
${channelsData}
 }`;
    }

    usedInstruments() {
        const instruments = new Set();
        for (const channel of this.channels) {
            for (const inst of channel.usedInstruments()) instruments.add(inst);
        }
        return instruments;
    }

    isEmpty() {
        return this.channels.every((channel) => channel.isEmpty());
    }

    toData() {
        if (this.isEmpty()) return null;
        return this.channels.map((channel) => channel.toData());
    }

    static fromData(data) {
        if (!data) return new Pattern();
        const channels = Array.from({ length: 4 }, (_, i) => Channel.fromData(data[i]));
        return new Pattern(channels);
    }

    clone() {
        return Pattern.fromData(this.channels.map((channel) => channel.rows.map((r) => ({ ...r }))));
    }
}