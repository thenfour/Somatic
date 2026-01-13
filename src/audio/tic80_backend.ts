import {getNoteInfo} from "../defs";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {SomaticInstrument} from "../models/instruments";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {gChannelsArray, Tic80Caps, Tic80ChannelIndex, TicMemoryMap} from "../models/tic80Capabilities";
import type {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {convertTic80MusicStateToSomatic} from "../utils/bakeSong";
import {LoopMode, MakeEmptySomaticTransportState, MakeEmptyTic80TransportState, SomaticTransportState, Tic80TransportState} from "./backend";
import {serializeSongForTic80Bridge, Tic80SerializedSong} from "./tic80_cart_serializer";

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
   private readonly bridge: () => Tic80BridgeHandle | null;
   private serializedSong: Tic80SerializedSong|null = null; // the last uploaded song.
   //private lastKnownTi80TransportState: Tic80TransportState = MakeEmptyTic80TransportState();
   private lastKnownSomaticTransportState: SomaticTransportState = MakeEmptySomaticTransportState();

   constructor(bridgeGetter: () => Tic80BridgeHandle | null) {
      this.bridge = bridgeGetter;
   }

   async sfxNoteOn(
      instrumentIndex: number, instrument: SomaticInstrument, midiNote: number, channel: Tic80ChannelIndex) {
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

   prepareForTransmit(args: BackendPlaySongArgs): Tic80SerializedSong|null //
   {
      const b = this.bridge();
      if (!b || !b.isReady())
         return null;

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

      //console.log("[Tic80Backend] transmitAndPlay uploading song:", serializedSong);
      this.serializedSong = serializedSong;
      return serializedSong;
   };

   async transmit(args: BackendPlaySongArgs): Promise<Tic80SerializedSong|null> //
   {
      const b = this.bridge();
      if (!b || !b.isReady())
         return null;

      const serializedSong = this.prepareForTransmit(args);
      if (!serializedSong) {
         return null;
      }

      const reason = `transmitAndPlay: ${args.reason}`;
      await b.invokeExclusive(reason, async (tx) => {
         await tx.transmit({
            data: serializedSong, //
            reason                //
         });
      });
      return serializedSong;
   };

   async transmitAndPlay(args: BackendPlaySongArgs): Promise<Tic80SerializedSong|null> //
   {
      const b = this.bridge();
      if (!b || !b.isReady())
         return null;

      // always serialize & transmit the up-to-date song.
      // serialize will bake in looping to the output and can request forever looping.
      const serializedSong = this.prepareForTransmit(args);
      if (!serializedSong) {
         return null;
      }

      const reason = `transmitAndPlay: ${args.reason}`;

      await b.invokeExclusive(reason, async (tx) => {
         await tx.transmitAndPlay({
            data: serializedSong, //
            reason                //
         });
      });
      return serializedSong;
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

   private getTic80TransportState(): Tic80TransportState {
      const b = this.bridge()!;

      const row = b.peekU8(TicMemoryMap.MUSIC_STATE_ROW);
      const somaticSongPosition = b.peekS8(TicMemoryMap.MUSIC_STATE_SOMATIC_SONG_POSITION);

      //console.log(`[Tic80Backend] getTic80TransportState: row=${row} somaticSongPosition=${somaticSongPosition}`);


      const next: Tic80TransportState = {
         tic80RowIndex: row,
         reportedSongPosition: somaticSongPosition,
         isPlaying: somaticSongPosition >= 0,
      };
      return next;

      // // do not spam new instances. check if it actually changed;
      // if (JSON.stringify(this.lastKnownTi80TransportState) !== JSON.stringify(next)) {
      //    this.lastKnownTi80TransportState = next;
      // }

      // return this.lastKnownTi80TransportState;
   }

   getSomaticTransportState(): SomaticTransportState {
      const b = this.bridge();
      if (!b || !b.isReady()) {
         return this.lastKnownSomaticTransportState;
      }

      // uses last serialized song's baked info to map tic80 state back to somatic state.
      // note that there's a potential desync here if the song was changed since last upload.
      // instead of trying to detect that though (it's not trivial without clamping down a lot of stuff),
      // just deal with the possibility of desync in the UI.
      const tic80State = this.getTic80TransportState();
      if (!this.serializedSong) {
         return this.lastKnownSomaticTransportState;
      }
      const somaticState = convertTic80MusicStateToSomatic(this.serializedSong?.bakedSong, tic80State);
      // avoid spamming new instances.
      if (JSON.stringify(somaticState) !== JSON.stringify(this.lastKnownSomaticTransportState)) {
         this.lastKnownSomaticTransportState = somaticState;
      }
      return this.lastKnownSomaticTransportState;
   };

   getFPS(): number {
      const b = this.bridge();
      if (!b || !b.isReady())
         return 0;
      return b.peekU8(TicMemoryMap.FPS);
   }
}
