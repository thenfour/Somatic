import { AudioBackend, BackendContext } from './backend';
import type { Wave } from '../models/instruments';
import type { Pattern } from '../models/pattern';
import type { Song } from '../models/song';
import type { Tic80BridgeHandle } from '../ui/Tic80Bridged';
import { serializeSongToCart } from './tic80_cart_serializer';

// Minimal TIC-80 backend: delegates transport commands to the bridge.
// Song/instrument upload is not implemented yet; this is a transport stub.
export class Tic80Backend implements AudioBackend {
    private readonly emit: BackendContext['emit'];
    private readonly bridge: () => Tic80BridgeHandle | null;
    private song: Song | null = null;
    private pendingSongData: Uint8Array | null = null;
    private volume = 0.3;

    constructor(ctx: BackendContext, bridgeGetter: () => Tic80BridgeHandle | null) {
        this.emit = ctx.emit;
        this.bridge = bridgeGetter;
    }

    async setSong(song: Song | null) {
        this.song = song;
        if (song) {
            this.pendingSongData = serializeSongToCart(song);
            await this.tryUploadSong();
        } else {
            this.pendingSongData = null;
        }
    }

    async setVolume(vol: number) {
        this.volume = vol;
        // TODO: route to cart when mixer control exists
    }

    async playInstrument(instrument: Wave, frequency: number) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;

        await this.tryUploadSong();

        const sfxId = this.findInstrumentIndex(instrument);
        const note = this.frequencyToNote(frequency);

        b.playSfx({ sfxId, note }).catch((err) => {
            console.warn('[Tic80Backend] playInstrument failed', err);
        });
    }

    async playRow(_pattern: Pattern, _rowNumber: number) {
        console.warn('[Tic80Backend] playRow not yet implemented');
    }

    async playPattern(_pattern: Pattern) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;
        await this.tryUploadSong();
        await b.play({ track: 0, frame: 0, row: 0, loop: true });
        this.emit.row(0, _pattern);
    }

    async playSong(startPosition: number) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;
        await this.tryUploadSong();
        // Currently just triggers play track 0; proper song sequencing will come after uploads
        await b.play({ track: startPosition, frame: 0, row: 0, loop: true });
        this.emit.position(startPosition);
    }

    async stop() {
        const b = this.bridge();
        if (b && b.isReady()) await b.stop();
        this.emit.stop();
    }

    private async tryUploadSong() {
        if (!this.pendingSongData) return;
        const b = this.bridge();
        if (!b || !b.isReady()) return;

        await b.uploadSongData(this.pendingSongData);
    }

    private findInstrumentIndex(instrument: Wave): number {
        if (!this.song) return 1;
        const idx = this.song.instruments.findIndex((inst) => inst === instrument);
        if (idx >= 0) return idx;
        // Fallback to first instrument if not found
        return 1;
    }

    private frequencyToNote(freq: number): number {
        if (!isFinite(freq) || freq <= 0) return 0;
        const note = Math.round(58 + 12 * Math.log2(freq / 440));
        // TIC sfx note accepts 0..95
        return Math.max(0, Math.min(95, note));
    }
}
