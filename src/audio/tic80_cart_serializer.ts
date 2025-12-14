import { INSTRUMENT_COUNT, PATTERN_COUNT } from "../defs";
import type { Song } from "../models/song";
import type { Pattern, Channel } from "../models/pattern";

/** Chunk type IDs from https://github.com/nesbox/TIC-80/wiki/.tic-File-Format */
const CHUNK = {
    SFX: 9,
    WAVEFORMS: 10,
    MUSIC_TRACKS: 14,
    MUSIC_PATTERNS: 15,
} as const;

const SONG_TRACK_STEPS = 16; // TIC-80 stores 16 pattern slots per track
const PATTERN_ROWS = 16; // patterns chunk stores 16 rows per channel (192 bytes)
const CHANNEL_COUNT = 4;

/** Trim trailing zero bytes (spec allows chunk truncation). */
function trimTrailingZeros(data: Uint8Array): Uint8Array {
    let last = data.length - 1;
    while (last >= 0 && data[last] === 0) last--;
    return data.slice(0, last + 1);
}

function writeChunk(type: number, payload: Uint8Array, bank = 0): Uint8Array {
    const data = trimTrailingZeros(payload);
    const header = new Uint8Array(4 + data.length);
    header[0] = ((bank & 0x07) << 5) | (type & 0x1f);
    header[1] = data.length & 0xff;
    header[2] = (data.length >> 8) & 0xff;
    header[3] = 0; // reserved
    header.set(data, 4);
    return header;
}

function encodeNoteTriplet(noteVal: number, instrument: number): [number, number, number] {
    // Rest/no-note
    if (!noteVal || noteVal <= 0) return [0, 0, 0];

    // TIC note nibble is 4..15 for C..B within an octave; octave 0..7 stored separately.
    const octave = Math.max(0, Math.min(7, Math.floor((noteVal + 11) / 12)));
    const semitone = (noteVal + 11) % 12; // 0..11
    const noteNibble = semitone + 4; // 4..15

    const sfx = Math.max(0, Math.min(255, instrument | 0));
    const command = 0; // no effect command for now
    const arg = 0;

    const byte0 = noteNibble & 0x0f;
    const byte1 = ((sfx >> 5) & 0x01) << 7 | ((command & 0x07) << 4) | (arg & 0x0f);
    const byte2 = ((octave & 0x07) << 5) | (sfx & 0x1f);
    return [byte0, byte1, byte2];
}

function encodePattern(pattern: Pattern): Uint8Array {
    const buf = new Uint8Array(PATTERN_ROWS * CHANNEL_COUNT * 3);

    for (let row = 0; row < PATTERN_ROWS; row++) {
        for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
            const rowData = pattern.channels[ch]?.rows[row];
            const noteVal = rowData?.note ?? 0;
            const inst = rowData?.instrument ?? 0;
            const [b0, b1, b2] = encodeNoteTriplet(noteVal, inst);
            const idx = (row * CHANNEL_COUNT + ch) * 3;
            buf[idx + 0] = b0;
            buf[idx + 1] = b1;
            buf[idx + 2] = b2;
        }
    }

    return buf;
}

function encodePatterns(song: Song): Uint8Array {
    const patterns = new Uint8Array(PATTERN_COUNT * PATTERN_ROWS * CHANNEL_COUNT * 3);
    for (let p = 0; p < PATTERN_COUNT; p++) {
        const pattern = song.patterns[p];
        if (!pattern) continue;
        const encoded = encodePattern(pattern);
        patterns.set(encoded, p * encoded.length);
    }
    return writeChunk(CHUNK.MUSIC_PATTERNS, patterns);
}

function encodeTrack(song: Song): Uint8Array {
    const buf = new Uint8Array(51); // 48 bytes positions + speed/rows/tempo
    const steps = Math.min(SONG_TRACK_STEPS, song.length);
    for (let i = 0; i < steps; i++) {
        const patIndex = song.positions[i] ?? 0;
        const packed = (patIndex & 0x3f) // F
            | ((patIndex & 0x3f) << 6) // S
            | ((patIndex & 0x3f) << 12) // T
            | ((patIndex & 0x3f) << 18); // Q
        const base = i * 3;
        buf[base + 0] = packed & 0xff;
        buf[base + 1] = (packed >> 8) & 0xff;
        buf[base + 2] = (packed >> 16) & 0xff;
    }

    // Speed: decode is (S + 6) % 255; clamp to 0..254
    const speedByte = (song.speed - 6 + 255) % 255;
    buf[48] = speedByte & 0xff;

    // Rows: decode is 64 - R
    buf[49] = 64 - 64; // we always encode 64 rows -> 0

    // Tempo: decode is T + 150; we do not track tempo, so default 150 -> store 0
    buf[50] = 0;

    return writeChunk(CHUNK.MUSIC_TRACKS, buf);
}

function encodeWaveforms(): Uint8Array {
    // 16 waveforms, 16 bytes each (two 4-bit samples per byte). Use a simple ramp for all.
    const waveCount = 16;
    const bytesPerWave = 16;
    const buf = new Uint8Array(waveCount * bytesPerWave);

    for (let w = 0; w < waveCount; w++) {
        for (let i = 0; i < bytesPerWave; i++) {
            const a = (i * 2) % 32;
            const b = (i * 2 + 1) % 32;
            const sampleA = Math.min(15, Math.round((a / 31) * 15));
            const sampleB = Math.min(15, Math.round((b / 31) * 15));
            buf[w * bytesPerWave + i] = (sampleA << 4) | sampleB;
        }
    }

    return writeChunk(CHUNK.WAVEFORMS, buf);
}

function encodeSfx(song: Song): Uint8Array {
    // 66 bytes per SFX (up to 64 entries in RAM). We only fill instruments (1..INSTRUMENT_COUNT).
    const sfxCount = INSTRUMENT_COUNT + 1; // reserve index 0
    const bytesPer = 66;
    const buf = new Uint8Array(sfxCount * bytesPer);

    for (let i = 1; i < sfxCount; i++) {
        const base = i * bytesPer;
        // Simple constant tone: volumes full, wave index 0. 30 frames -> 60 bytes V/W pairs.
        for (let j = 0; j < 60; j += 2) {
            buf[base + j + 0] = 0; // volume byte (inverted by spec; 0 = max)
            buf[base + j + 1] = 0; // wave byte (waveform 0)
        }
        // DXSSSOOO
        buf[base + 60] = 0; // down/up, pitch mul, sample speed, octave -> default 0
        // ---NNNN
        buf[base + 61] = 0; // base note nibble (0 = C)
        // LLLLFFFF (loop length / start)
        buf[base + 62] = 0;
        buf[base + 63] = 0;
        buf[base + 64] = 0;
    }

    return writeChunk(CHUNK.SFX, buf);
}

export function serializeSongToCart(song: Song): Uint8Array {
    const parts: Uint8Array[] = [];
    parts.push(encodeWaveforms());
    parts.push(encodeSfx(song));
    parts.push(encodePatterns(song));
    parts.push(encodeTrack(song));

    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}
