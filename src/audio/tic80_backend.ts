import { AudioBackend, BackendContext } from './backend';
import type { Wave } from '../models/instruments';
import type { Pattern } from '../models/pattern';
import type { Song } from '../models/song';
import type { Tic80BridgeHandle, Tic80BridgeTransaction } from '../ui/Tic80Bridged';
import { serializeSongToCart } from './tic80_cart_serializer';

// Minimal TIC-80 backend: delegates transport commands to the bridge.
// Song/instrument upload is not implemented yet; this is a transport stub.
export class Tic80Backend implements AudioBackend {
    private readonly emit: BackendContext['emit'];
    private readonly bridge: () => Tic80BridgeHandle | null;
    private song: Song | null = null;
    private serializedSong: Uint8Array | null = null;
    private volume = 0.3;

    constructor(ctx: BackendContext, bridgeGetter: () => Tic80BridgeHandle | null) {
        this.emit = ctx.emit;
        this.bridge = bridgeGetter;
    }

    async setSong(song: Song | null) {
        this.song = song;
        if (song) {
            this.serializedSong = serializeSongToCart(song);
            //await this.tryUploadSong();
        } else {
            // todo: an actual empty song.
            this.serializedSong = null;
        }
    }

    async setVolume(vol: number) {
        this.volume = vol;
        // TODO: route to cart when mixer control exists
    }

    async playInstrument(instrument: Wave, note: number) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;

        await b.invokeExclusive(async (tx) => {
            await this.tryUploadSong(tx);

            const sfxId = this.findInstrumentIndex(instrument);
            const clampedNote = Math.max(0, Math.min(95, Math.round(note)));

            await tx.playSfx({ sfxId, note: clampedNote }).catch((err) => {
                console.warn('[Tic80Backend] playInstrument failed', err);
            });
        });
    }

    async playRow(_pattern: Pattern, _rowNumber: number) {
        console.warn('[Tic80Backend] playRow not yet implemented');
    }

    async playPattern(_pattern: Pattern) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;
        b.invokeExclusive(async (tx) => {
            await this.tryUploadSong(tx);
            // todo: proper pattern playback support
            await tx.play({ track: 0, frame: 0, row: 0, loop: true });
        });
        // todo: emit correct position
        this.emit.row(0, _pattern);
    }

    async playSong(startPosition: number) {
        const b = this.bridge();
        if (!b || !b.isReady()) return;
        // Currently just triggers play track 0; proper song sequencing will come after uploads
        // todo: implement
        await b.invokeExclusive(async (tx) => {
            await this.tryUploadSong(tx);
            await tx.play({ track: startPosition, frame: 0, row: 0, loop: true });
        });
        this.emit.position(startPosition);
        //await this.tryUploadSong();
        //await b.play({ track: startPosition, frame: 0, row: 0, loop: true });
        //this.emit.position(startPosition);
    }

    async stop() {
        const b = this.bridge();
        if (b && b.isReady()) await b.invokeExclusive(async (tx) => {
            await tx.stop();
        });
        this.emit.stop();
    }

    private async tryUploadSong(tx: Tic80BridgeTransaction) {
        if (!this.serializedSong) return; // todo: empty song should be a real empty song.
        const b = this.bridge();
        if (!b || !b.isReady()) return;

        await tx.uploadSongData(this.serializedSong);
    }

    private findInstrumentIndex(instrument: Wave): number {
        if (!this.song) return 1;
        const idx = this.song.instruments.findIndex((inst) => inst === instrument);
        if (idx >= 0) return idx;
        // Fallback to first instrument if not found
        return 1;
    }

}
