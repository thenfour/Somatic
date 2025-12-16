import {getNoteInfo} from "../defs";
import {Tic80Instrument} from "../models/instruments";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80Caps, Tic80ChannelIndex, TicMemoryMap} from "../models/tic80Capabilities";
import type {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {AudioBackend, MakeEmptyMusicState, MusicState} from "./backend";
import {serializeSongForTic80Bridge, Tic80SerializedSong} from "./tic80_cart_serializer";

// Minimal TIC-80 backend: delegates transport commands to the bridge.
// Song/instrument upload is not implemented yet; this is a transport stub.
export class Tic80Backend implements AudioBackend {
   //private readonly emit: BackendContext["emit"];
   private readonly bridge: () => Tic80BridgeHandle | null;
   private song: Song|null = null;
   private serializedSong: Tic80SerializedSong|null = null;
   private lastKnownMusicState: MusicState = MakeEmptyMusicState();
   //private volume = 0.3;

   constructor(bridgeGetter: () => Tic80BridgeHandle | null) {
      //this.emit = ctx.emit;
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
            tx.uploadSongData(this.serializedSong!, "Song has been modified.");
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

   async playRow(pattern: Pattern, rowNumber: number) {
      const song = this.song;
      if (!song) {
         return;
      }

      const b = this.bridge();
      if (!b || !b.isReady()) {
         return;
      }

      type PlaybackRequest = { channel: Tic80ChannelIndex; sfxId: number; tic80Note: number; speed: number };
      const requests: PlaybackRequest[] = [];

      for (let channel = 0; channel < Tic80Caps.song.audioChannels; channel++) {
         const channelIndex = channel as Tic80ChannelIndex;
         const cell = pattern.getCell(channelIndex, rowNumber);
         if (!cell.midiNote || cell.instrumentIndex == null) {
            continue;
         }

         const noteInfo = getNoteInfo(cell.midiNote);
         if (!noteInfo) {
            continue;
         }

         const instrumentIndex = cell.instrumentIndex;

         const clampedInstrumentIndex = Math.max(0, Math.min(song.instruments.length - 1, instrumentIndex));
         const instrument = song.instruments[clampedInstrumentIndex];
         if (!instrument) {
            continue;
         }

         const speed = Math.max(0, Math.min(7, instrument.speed ?? 0));

         requests.push({
            channel: channelIndex,
            sfxId: clampedInstrumentIndex,
            tic80Note: noteInfo.ticAbsoluteNoteIndex,
            speed,
         });
      }

      await b.invokeExclusive(async (tx) => {
         for (const channel of [0, 1, 2, 3] as const) {
            try {
               await tx.stopSfx({channel: channel as Tic80ChannelIndex});
            } catch (err) {
               console.warn("[Tic80Backend] stopSfx failed", err);
            }
         }

         for (const req of requests) {
            try {
               await tx.playSfx(req);
            } catch (err) {
               console.warn("[Tic80Backend] playSfx failed", err);
            }
         }
      });
   }

   async playPattern(_pattern: Pattern) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;
      b.invokeExclusive(
         async (tx) => {
            //await this.tryUploadSong(tx);
            // todo: proper pattern playback support
            //await tx.play({songPosition: 0, row: 0, loop: true});
         });
      //this.emit.row(0, _pattern);
   }

   async playSong(startPosition: number, startRow?: number) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;
      await b.invokeExclusive(async (tx) => {
         await tx.play({songPosition: startPosition, row: startRow ?? 0});
      });
      //this.emit.position(startPosition);
   }

   async panic() {
      const b = this.bridge();
      if (!b || !b.isReady()) {
         return;
      }

      await b.invokeExclusive(async (tx) => {
         for (const channel of [0, 1, 2, 3] as const) {
            try {
               await tx.stopSfx({channel: channel as Tic80ChannelIndex});
            } catch (err) {
               console.warn("[Tic80Backend] panic stopSfx failed", err);
            }
         }

         try {
            await tx.stop();
         } catch (err) {
            console.warn("[Tic80Backend] panic stop failed", err);
         }
      });

      //this.emit.stop();
   }

   async stop() {
      const b = this.bridge();
      if (b && b.isReady())
         await b.invokeExclusive(async (tx) => {
            await tx.stop();
         });
      //this.emit.stop();
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
         chromaticSongPosition: chromaticSongPosition === 255 ? -1 : chromaticSongPosition,
         isLooping,
      };
      return this.lastKnownMusicState;
   }
}
