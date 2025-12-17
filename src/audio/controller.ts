import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import type {AudioBackend} from "./backend";
import {Tic80Backend} from "./tic80_backend";
import {VoiceManager} from "./voice_manager";

// type RowListener = (rowNumber: number, pattern: Pattern) => void;
// type PositionListener = (positionNumber: number) => void;
// type StopListener = () => void;

export class AudioController {
   backend: AudioBackend;
   song: Song|null;
   volume: number;
   isPlaying: boolean;
   private voiceManager: VoiceManager;

   // private rowListeners = new Set<RowListener>();
   // private positionListeners = new Set<PositionListener>();
   // private stopListeners = new Set<StopListener>();

   constructor(opts: {bridgeGetter: () => Tic80BridgeHandle | null}) {
      this.volume = 0.3;
      this.song = null;
      this.isPlaying = false;
      this.voiceManager = new VoiceManager();
      this.backend = new Tic80Backend(opts.bridgeGetter);
   }

   setSong(song: Song|null, reason: string) {
      this.song = song;
      this.backend.setSong(song, reason);
   }

   stop() {
      this.backend.stop();
      this.isPlaying = false;
   }

   getMusicState() {
      return this.backend.getMusicState();
   }

   sfxNoteOn(instrumentIndex: number, note: number) {
      if (!this.song) {
         return;
      }
      const channel = this.voiceManager.allocateVoice(instrumentIndex, note);
      this.backend.sfxNoteOn(instrumentIndex, this.song.instruments[instrumentIndex], note, channel);
   }

   sfxNoteOff(note: number) {
      const channel = this.voiceManager.releaseVoice(note);
      if (channel !== null) {
         this.backend.sfxNoteOff(channel);
      }
   }

   readRow(pattern: Pattern, rowNumber: number) {
      // Deprecated in favor of backend-driven playback; preserved for UI callers.
      this.backend.playRow(pattern, rowNumber);
   }

   playRow(pattern: Pattern, rowNumber: number) {
      this.backend.playRow(pattern, rowNumber);
   }

   // playPattern(pattern: Pattern) {
   //    this.backend.playPattern(pattern);
   //    this.isPlaying = true;
   // }

   playSong(startPosition: number, startRow?: number) {
      this.backend.playSong(startPosition, startRow);
      this.isPlaying = true;
   }

   panic() {
      this.voiceManager.releaseAll();
      this.backend.panic();
      this.isPlaying = false;
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
