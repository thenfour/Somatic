import {SelectionRect2D} from "../hooks/useRectSelection2D";
import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80ChannelIndex} from "../models/tic80Capabilities";
import {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {Rect2D} from "../utils/utils";
import {LoopMode} from "./backend";
import {BackendPlaySongArgs, Tic80Backend} from "./tic80_backend";
import {VoiceManager} from "./voice_manager";

// type RowListener = (rowNumber: number, pattern: Pattern) => void;
// type PositionListener = (positionNumber: number) => void;
// type StopListener = () => void;

export class AudioController {
   backend: Tic80Backend;
   //song: Song|null;
   //volume: number;
   //isPlaying: boolean;
   private voiceManager: VoiceManager;

   // private rowListeners = new Set<RowListener>();
   // private positionListeners = new Set<PositionListener>();
   // private stopListeners = new Set<StopListener>();

   constructor(opts: {bridgeGetter: () => Tic80BridgeHandle | null}) {
      //this.volume = 0.3;
      //this.song = null;
      //this.isPlaying = false;
      this.voiceManager = new VoiceManager();
      this.backend = new Tic80Backend(opts.bridgeGetter);
   }

   async transmitSong(song: Song, reason: string, audibleChannels: Set<Tic80ChannelIndex>) {
      //this.song = song;
      await this.backend.transmitSong(song, reason, audibleChannels, "off");
   }

   stop() {
      this.backend.stop();
      //this.isPlaying = false;
   }

   getMusicState() {
      return this.backend.getMusicState();
   }

   getFPS(): number {
      return this.backend.getFPS();
   }

   sfxNoteOn(song: Song, instrumentIndex: number, note: number, preferredChannel: Tic80ChannelIndex|null = null) {
      const channel = this.voiceManager.allocateVoice(instrumentIndex, note, preferredChannel);
      this.backend.sfxNoteOn(instrumentIndex, song.instruments[instrumentIndex], note, channel);
   }

   sfxNoteOff(note: number) {
      const channel = this.voiceManager.releaseVoice(note);
      if (channel !== null) {
         this.backend.sfxNoteOff(channel);
      }
   }

   readRow(song: Song, pattern: Pattern, rowNumber: number) {
      // Deprecated in favor of backend-driven playback; preserved for UI callers.
      this.backend.playRow(song, pattern, rowNumber);
   }

   playRow(song: Song, pattern: Pattern, rowNumber: number) {
      this.backend.playRow(song, pattern, rowNumber);
   }

   playSong(args: BackendPlaySongArgs) {
      this.backend.playSong(args);
   }

   panic() {
      this.voiceManager.releaseAll();
      this.backend.panic();
      //this.isPlaying = false;
   }

   setChannelVolumes(volumes: [number, number, number, number]) {
      this.backend.setChannelVolumes(volumes);
   }

   // onRow(cb: RowListener) {
   //    this.rowListeners.add(cb);
   //    return () => this.rowListeners.delete(cb);
   // }
   // offRow(cb: RowListener) {
   //    this.rowListeners.delete(cb);
   // }
   // onPosition(cb: PositionListener) {
   //    this.positionListeners.add(cb);
   //    return () => this.positionListeners.delete(cb);
   // }
   // offPosition(cb: PositionListener) {
   //    this.positionListeners.delete(cb);
   // }
   // onStop(cb: StopListener) {
   //    this.stopListeners.add(cb);
   //    return () => this.stopListeners.delete(cb);
   // }
   // offStop(cb: StopListener) {
   //    this.stopListeners.delete(cb);
   // }
}
