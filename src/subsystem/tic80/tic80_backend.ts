// TIC80 specific

import {NoteRegistry} from "../../utils/music/noteRegistry";
import {SelectionRect2D} from "../../hooks/useRectSelection2D";
import {SomaticInstrument} from "../../models/instruments";
import type {Pattern} from "../../models/pattern";
import type {Song} from "../../models/song";
import {gTic80ChannelsArray, Tic80Caps, TicMemoryMap} from "../../models/tic80Capabilities";
import type {Tic80BridgeHandle} from "./Tic80Bridged";
import {convertTic80MusicStateToSomatic, getBakedSongPosition} from "./bakeSong";
import {LoopMode, MakeEmptySomaticTransportState, SomaticTransportState, Tic80TransportState} from "../../audio/backend";
import {serializeSongForTic80Bridge, Tic80SerializedSong} from "./tic80_cart_serializer";
import {clamp} from "../../utils/utils";

export type BackendPlaySongArgs = {
   reason: string;                           //
   song: Song,                               //
   cursorSongOrder: number,                  //
   cursorChannelIndex: number,               //
   cursorRowIndex: number,                   //
   patternSelection: SelectionRect2D | null, //
   audibleChannels: Set<number>,             //
   startPosition: number,                    //
   startRow: number,                         //
   loopMode: LoopMode,                       //
   songOrderSelection: SelectionRect2D | null,
};

type PlaybackSession = Omit<BackendPlaySongArgs, "reason" | "song" | "startPosition" | "startRow">;

type ActivePlayback = {
   serializedSong: Tic80SerializedSong;
   session: PlaybackSession;
};

function cloneSelection(selection: SelectionRect2D | null): SelectionRect2D | null {
   return selection ? new SelectionRect2D(selection.toData()) : null;
}

function clonePlaybackSession(args: BackendPlaySongArgs): PlaybackSession {
   return {
      cursorSongOrder: args.cursorSongOrder,
      cursorChannelIndex: args.cursorChannelIndex,
      cursorRowIndex: args.cursorRowIndex,
      patternSelection: cloneSelection(args.patternSelection),
      audibleChannels: new Set(args.audibleChannels),
      loopMode: args.loopMode,
      songOrderSelection: cloneSelection(args.songOrderSelection),
   };
}

// Loop mode and mute/solo state are live playback controls. Audibility can
// change without affecting the active loop's anchor, while selecting a new
// loop mode intentionally captures the editor's current cursor/selection.
function mergeLivePlaybackControls(session: PlaybackSession, args: BackendPlaySongArgs): PlaybackSession {
   if (session.loopMode !== args.loopMode) {
      return clonePlaybackSession(args);
   }
   return {
      ...session,
      audibleChannels: new Set(args.audibleChannels),
   };
}

function clampSelection(
   selection: SelectionRect2D | null,
   maxXInclusive: number,
   maxYInclusive: number,
): SelectionRect2D | null {
   if (!selection)
      return null;
   return selection.withClampedCoords((coord) => ({
      x: clamp(coord.x, 0, Math.max(0, maxXInclusive)),
      y: clamp(coord.y, 0, Math.max(0, maxYInclusive)),
   }));
}

function makeSessionArgs(
   session: PlaybackSession,
   song: Song,
   reason: string,
   startPosition: number,
   startRow: number,
): BackendPlaySongArgs {
   const cursorSongOrder = clamp(session.cursorSongOrder | 0, 0, Math.max(0, song.songOrder.length - 1));
   const cursorRowIndex = clamp(session.cursorRowIndex | 0, 0, Math.max(0, song.rowsPerPattern - 1));
   return {
      ...session,
      reason,
      song,
      cursorSongOrder,
      cursorRowIndex,
      patternSelection: clampSelection(
         session.patternSelection, Math.max(0, song.subsystem.channelCount - 1), Math.max(0, song.rowsPerPattern - 1)),
      songOrderSelection: clampSelection(
         session.songOrderSelection, 0, Math.max(0, song.songOrder.length - 1)),
      startPosition,
      startRow,
   };
}


// TIC-80 backend: owns transport state and delegates uploads/commands to the bridge.
export class Tic80Backend {
   private readonly bridge: () => Tic80BridgeHandle | null;
   private activePlayback: ActivePlayback | null = null;
   private playbackEpoch = 0;
   //private lastKnownTi80TransportState: Tic80TransportState = MakeEmptyTic80TransportState();
   private lastKnownSomaticTransportState: SomaticTransportState = MakeEmptySomaticTransportState();

   constructor(bridgeGetter: () => Tic80BridgeHandle | null) {
      this.bridge = bridgeGetter;
   }

   async sfxNoteOn(instrumentIndex: number, instrument: SomaticInstrument, midiNote: number, channel: number) {
      const b = this.bridge();
      if (!b || !b.isReady())
         return;

      await b.invokeExclusive("sfxNoteOn", async (tx) => {
         const noteInfo = NoteRegistry.get(midiNote);
         if (!noteInfo)
            return;
         const note = noteInfo.tic.absoluteNoteIndex;
         const speed = instrument.speed;

         await tx.playSfx({sfxId: instrumentIndex, tic80Note: note, channel, speed}).catch((err) => {
            console.warn("[Tic80Backend] sfxNoteOn failed", err);
         });
      });
   }

   async sfxNoteOff(channel: number) {
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

      type PlaybackRequest = { channel: number; sfxId: number; tic80Note: number; speed: number; volumeU8?: number; panU8?: number };
      const requests: PlaybackRequest[] = [];

      for (let channelIndex = 0; channelIndex < Tic80Caps.song.audioChannels; channelIndex++) {
         const cell = pattern.getCell(channelIndex, rowNumber);
         if (!cell.midiNote || cell.instrumentIndex == null) {
            continue;
         }

         const noteInfo = NoteRegistry.get(cell.midiNote);
         if (!noteInfo) {
            continue;
         }

         const instrumentIndex = cell.instrumentIndex;

         const clampedInstrumentIndex = Math.max(0, Math.min(song.instruments.length - 1, instrumentIndex));
         const instrument = song.instruments[clampedInstrumentIndex];
         if (!instrument) {
            continue;
         }

         const speed = Math.max(
            Tic80Caps.sfx.speedMin,
            Math.min(Tic80Caps.sfx.speedMax, instrument.speed ?? Tic80Caps.sfx.speedMin),
         );

         requests.push({
            channel: channelIndex,
            sfxId: clampedInstrumentIndex,
            tic80Note: noteInfo.tic.absoluteNoteIndex,
            speed,
            volumeU8: cell.volumeU8,
            panU8: cell.panU8,
         });
      }

      await b.invokeExclusive("playRow", async (tx) => {
         for (const channel of gTic80ChannelsArray) {
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

      const reason = `transmit: ${args.reason}`;
      await b.invokeExclusive(reason, async (tx) => {
         await tx.transmit({
            data: serializedSong, //
            reason                //
         });
      });
      return serializedSong;
   };

   // Upload an edited song. If its baked content changed while the
   // transport is running, restart from the current position.
   // Instrument/waveform-only edits use a cheaper transmit-only path.
   async transmitEditedSong(args: BackendPlaySongArgs): Promise<Tic80SerializedSong | null> {
      const b = this.bridge();
      if (!b || !b.isReady())
         return null;

      const active = this.activePlayback;
      const currentState = this.getSomaticTransportState();
      if (!active || !currentState.isPlaying || currentState.currentSomaticSongPosition == null ||
         currentState.currentSomaticRowIndex == null) {
         if (!currentState.isPlaying) {
            this.activePlayback = null;
         }
         return this.transmit(args);
      }

      const epoch = this.playbackEpoch;
      const nextSession = mergeLivePlaybackControls(active.session, args);
      const sessionArgs = makeSessionArgs(
         nextSession,
         args.song,
         args.reason,
         currentState.currentSomaticSongPosition,
         currentState.currentSomaticRowIndex,
      );
      const serializedSong = this.prepareForTransmit(sessionArgs);
      if (!serializedSong)
         return null;

      const reason = `transmitEditedSong: ${args.reason}`;
      let restarted = false;
      let playbackSessionAccepted = false;
      await b.invokeExclusive(reason, async (tx) => {
         const latestState = this.getSomaticTransportState();
         const canRestart = epoch === this.playbackEpoch && this.activePlayback === active && latestState.isPlaying &&
            latestState.currentSomaticSongPosition != null && latestState.currentSomaticRowIndex != null;
         const sequencedPlaybackChanged =
            serializedSong.playbackFingerprint !== active.serializedSong.playbackFingerprint;

         if (!canRestart || !sequencedPlaybackChanged) {
            await tx.transmit({data: serializedSong, reason});
            playbackSessionAccepted = canRestart;
            return;
         }

         const resumeAt = getBakedSongPosition(
            serializedSong.bakedSong,
            latestState.currentSomaticSongPosition!,
            latestState.currentSomaticRowIndex!,
         );
         serializedSong.bakedSong.startPosition = resumeAt.songPosition;
         serializedSong.bakedSong.startRow = resumeAt.rowIndex;
         await tx.transmitAndPlay({data: serializedSong, reason});
         restarted = true;
         playbackSessionAccepted = true;
      });

      if (playbackSessionAccepted && epoch === this.playbackEpoch && this.activePlayback === active) {
         this.activePlayback = {
            // Transmit-only updates do not replace the bake that currently
            // interprets the bridge's transport counters.
            serializedSong: restarted ? serializedSong : active.serializedSong,
            session: nextSession,
         };
      }
      return serializedSong;
   }

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
      const epoch = ++this.playbackEpoch;
      const session = clonePlaybackSession(args);
      let played = false;

      await b.invokeExclusive(reason, async (tx) => {
         if (epoch !== this.playbackEpoch) {
            await tx.transmit({data: serializedSong, reason});
            return;
         }
         await tx.transmitAndPlay({data: serializedSong, reason});
         played = true;
      });
      if (played && epoch === this.playbackEpoch) {
         this.activePlayback = {serializedSong, session};
      }
      return serializedSong;
   }

   async panic() {
      this.playbackEpoch++;
      this.activePlayback = null;
      this.lastKnownSomaticTransportState = MakeEmptySomaticTransportState();
      const b = this.bridge();
      if (!b || !b.isReady()) {
         return;
      }

      await b.invokeExclusive("panic", async (tx) => {
         for (const channel of gTic80ChannelsArray) {
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
      this.playbackEpoch++;
      this.activePlayback = null;
      this.lastKnownSomaticTransportState = MakeEmptySomaticTransportState();
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

      // Only the bake that was acknowledged as playing may interpret the bridge's
      // transport counters. Transmit-only edits deliberately leave this mapping alone.
      const tic80State = this.getTic80TransportState();
      if (!this.activePlayback) {
         return this.lastKnownSomaticTransportState;
      }
      const somaticState = convertTic80MusicStateToSomatic(this.activePlayback.serializedSong.bakedSong, tic80State);
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
