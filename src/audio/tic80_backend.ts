import {getNoteInfo} from "../defs";
import {Tic80Instrument} from "../models/instruments";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80ChannelIndex, TicMemoryMap} from "../models/tic80Capabilities";
import type {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {AudioBackend, BackendContext, MakeEmptyMusicState, MusicState} from "./backend";
import {serializeSongForTic80Bridge, Tic80SerializedSong} from "./tic80_cart_serializer";

// Minimal TIC-80 backend: delegates transport commands to the bridge.
// Song/instrument upload is not implemented yet; this is a transport stub.
export class Tic80Backend implements AudioBackend {
   private readonly emit: BackendContext["emit"];
   private readonly bridge: () => Tic80BridgeHandle | null;
   private song: Song|null = null;
   private serializedSong: Tic80SerializedSong|null = null;
   private lastKnownMusicState: MusicState = MakeEmptyMusicState();
   //private volume = 0.3;

   constructor(ctx: BackendContext, bridgeGetter: () => Tic80BridgeHandle | null) {
      this.emit = ctx.emit;
      this.bridge = bridgeGetter;
   }

   async setSong(song: Song|null) {
      this.song = song;
      if (song) {
         this.serializedSong = serializeSongForTic80Bridge(song);

         const b = this.bridge();
         if (!b || !b.isReady())
            return;

         await b.invokeExclusive(async tx => {
            tx.uploadSongData(this.serializedSong!);
         });
      } else {
         // todo: an actual empty song.
         this.serializedSong = null;
      }
   }

   //    async setVolume(vol: number) {
   //       this.volume = vol;
   //       // TODO: route to cart when mixer control exists
   //    }

   async sfxNoteOn(instrumentIndex: number, instrument: Tic80Instrument, midiNote: number, channel: Tic80ChannelIndex) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;

      await b.invokeExclusive(async (tx) => {
         //await this.tryUploadSong(tx);

         //const sfxId = this.findInstrumentIndex(instrument);
         //const clampedNote = Math.max(0, Math.min(95, Math.round(note)));
         //const ch = Math.max(0, Math.min(3, Math.round(channel)));
         const note = getNoteInfo(midiNote)!.ticAbsoluteNoteIndex;
         const speed = instrument.speed;

         await tx.playSfx({sfxId: instrumentIndex, tic80Note: note, channel, speed}).catch((err) => {
            console.warn("[Tic80Backend] sfxNoteOn failed", err);
         });
      });
   }

   async sfxNoteOff(channel: Tic80ChannelIndex) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;

      await b.invokeExclusive(async (tx) => {
         await tx.stopSfx({channel}).catch((err) => {
            console.warn("[Tic80Backend] sfxNoteOff failed", err);
         });
      });
   }

   async playRow(_pattern: Pattern, _rowNumber: number) {
      console.warn("[Tic80Backend] playRow not yet implemented");
   }

   async playPattern(_pattern: Pattern) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;
      b.invokeExclusive(async (tx) => {
         //await this.tryUploadSong(tx);
         // todo: proper pattern playback support
         await tx.play({track: 0, frame: 0, row: 0, loop: true});
      });
      // todo: emit correct position
      this.emit.row(0, _pattern);
   }

   async playSong(startPosition: number) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;
      // Currently just triggers play track 0; proper song sequencing will come after uploads
      // todo: implement
      await b.invokeExclusive(async (tx) => {
         //await this.tryUploadSong(tx);
         await tx.play({track: startPosition, frame: 0, row: 0, loop: true});
      });
      this.emit.position(startPosition);
      //await this.tryUploadSong();
      //await b.play({ track: startPosition, frame: 0, row: 0, loop: true });
      //this.emit.position(startPosition);
   }

   async stop() {
      const b = this.bridge();
      if (b && b.isReady())
         await b.invokeExclusive(async (tx) => {
            await tx.stop();
         });
      this.emit.stop();
   }

   getMusicState(): MusicState {
      const b = this.bridge();
      if (!b || !b.isReady())
         return this.lastKnownMusicState;

      const track = b.peekS8(TicMemoryMap.MUSIC_STATE_TRACK);
      const frame = b.peekU8(TicMemoryMap.MUSIC_STATE_FRAME);
      const row = b.peekU8(TicMemoryMap.MUSIC_STATE_ROW);
      const flags = b.peekU8(TicMemoryMap.MUSIC_STATE_FLAGS);
      const chromaticPatternIndex = b.peekU8(TicMemoryMap.MUSIC_STATE_CHROMATIC_PATTERN_ID);
      const chromaticSongPosition = b.peekU8(TicMemoryMap.MUSIC_STATE_CHROMATIC_SONG_POSITION);

      const isLooping = !!(flags & 0x1);
      this.lastKnownMusicState = {
         tic80RowIndex: row,
         tic80FrameIndex: frame,
         tic80TrackIndex: track,
         chromaticPatternIndex,
         chromaticSongPosition,
         isLooping,
      };
      return this.lastKnownMusicState;
   }


   //    private async tryUploadSong(tx: Tic80BridgeTransaction) {
   //       if (!this.serializedSong)
   //          return;
   //       const b = this.bridge();
   //       if (!b || !b.isReady())
   //          return;

   //       await tx.uploadSongData(this.serializedSong);
   //    }

   //    private findInstrumentIndex(instrument: Tic80Instrument): number {
   //       if (!this.song)
   //          return 1;
   //       const idx = this.song.instruments.findIndex((inst) => inst === instrument);
   //       if (idx >= 0)
   //          return idx;
   //       // Fallback to first instrument if not found
   //       return 1;
   //    }
}
