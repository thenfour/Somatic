import {getNoteInfo} from "../defs";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {Tic80Instrument} from "../models/instruments";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {gChannelsArray, Tic80Caps, Tic80ChannelIndex, TicMemoryMap} from "../models/tic80Capabilities";
import type {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {LoopMode, MakeEmptyMusicState, MusicState} from "./backend";
import {serializeSongForTic80Bridge} from "./tic80_cart_serializer";

export type BackendPlaySongArgs = {
   reason: string;                           //
   song: Song,                               //
   cursorSongOrder: number,                  //
   cursorChannelIndex: Tic80ChannelIndex,    //
   cursorRowIndex: number,                   //
   patternSelection: SelectionRect2D | null, //
   audibleChannels: Set<Tic80ChannelIndex>,  //
   startPosition: number,                    //
   startRow: number,                         //
   loopMode: LoopMode,                       //
   songOrderSelection: SelectionRect2D | null,
};


// Minimal TIC-80 backend: delegates transport commands to the bridge.
// Song/instrument upload is not implemented yet; this is a transport stub.
export class Tic80Backend {
   //private readonly emit: BackendContext["emit"];
   private readonly bridge: () => Tic80BridgeHandle | null;
   //private song: Song|null = null;
   //private serializedSong: Tic80SerializedSong|null = null;
   private lastKnownMusicState: MusicState = MakeEmptyMusicState();
   //private volume = 0.3;

   constructor(bridgeGetter: () => Tic80BridgeHandle | null) {
      //this.emit = ctx.emit;
      this.bridge = bridgeGetter;
   }

   async sfxNoteOn(instrumentIndex: number, instrument: Tic80Instrument, midiNote: number, channel: Tic80ChannelIndex) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;

      await b.invokeExclusive("sfxNoteOn", async (tx) => {
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

      await b.invokeExclusive("sfxNoteOff", async (tx) => {
         await tx.stopSfx({channel}).catch((err) => {
            console.warn("[Tic80Backend] sfxNoteOff failed", err);
         });
      });
   }

   async playRow(song: Song, pattern: Pattern, rowNumber: number) {
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

      await b.invokeExclusive("playRow", async (tx) => {
         for (const channel of gChannelsArray) {
            try {
               await tx.stopSfx({channel});
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

   async transmitAndPlay(args: BackendPlaySongArgs) //
   {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;

      // always serialize & transmit the up-to-date song.
      // serialize will bake in looping to the output and can request forever looping.

      const serializedSong = serializeSongForTic80Bridge({
         song: args.song,
         cursorSongOrder: args.cursorSongOrder,
         cursorChannelIndex: args.cursorChannelIndex,
         cursorRowIndex: args.cursorRowIndex,
         patternSelection: args.patternSelection,
         audibleChannels: args.audibleChannels,
         startPosition: args.startPosition,
         startRow: args.startRow,
         loopMode: args.loopMode,
         songOrderSelection: args.songOrderSelection,
      });

      console.log("[Tic80Backend] transmitAndPlay uploading song:", serializedSong);

      const reason = `transmitAndPlay: ${args.reason}`;

      await b.invokeExclusive(reason, async (tx) => {
         //await tx.uploadSongData(serializedSong, "playing baked song");
         await tx.uploadAndPlay({
            data: serializedSong, //
            reason                //
         });
      });
   }

   async panic() {
      const b = this.bridge();
      if (!b || !b.isReady()) {
         return;
      }

      await b.invokeExclusive("panic", async (tx) => {
         for (const channel of gChannelsArray) {
            try {
               await tx.stopSfx({channel});
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
         await b.invokeExclusive("stop", async (tx) => {
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
      //const somaticPatternIndex = b.peekU8(TicMemoryMap.MUSIC_STATE_SOMATIC_PATTERN_ID);
      const somaticSongPosition = b.peekU8(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION);

      const isLooping = !!(flags & 0x1);
      const next: MusicState = {
         tic80RowIndex: row,
         tic80FrameIndex: frame,
         tic80TrackIndex: track,
         //somaticPatternIndex,
         somaticSongPosition: somaticSongPosition === 255 ? -1 : somaticSongPosition,
         isPlaying: somaticSongPosition !== 255,
         isLooping,
      };

      // do not spam instances. check if it actually changed.
      if (JSON.stringify(this.lastKnownMusicState) !== JSON.stringify(next)) {
         this.lastKnownMusicState = next;
      }

      return this.lastKnownMusicState;
   }

   getFPS(): number {
      const b = this.bridge();
      if (!b || !b.isReady())
         return 0;
      return b.peekU8(TicMemoryMap.FPS);
   }

   setChannelVolumes(volumes: [number, number, number, number]) {
      // unfortunately this doesn't seem to work. my guess is that the music() system overrides it
      console.error("Tic80Backend.setChannelVolumes is not supported by TIC-80 audio backend");
      const b = this.bridge();
      if (!b || !b.isReady())
         return;
      b.pokeU8(TicMemoryMap.CHANNEL_VOLUME_0, volumes[0]);
      b.pokeU8(TicMemoryMap.CHANNEL_VOLUME_1, volumes[1]);
      b.pokeU8(TicMemoryMap.CHANNEL_VOLUME_2, volumes[2]);
      b.pokeU8(TicMemoryMap.CHANNEL_VOLUME_3, volumes[3]);
   }
}
