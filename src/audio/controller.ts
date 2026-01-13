import type {Pattern} from "../models/pattern";
import type {Song} from "../models/song";
import {Tic80Caps} from "../models/tic80Capabilities";
import {Tic80BridgeHandle} from "../ui/Tic80Bridged";
import {BackendPlaySongArgs, Tic80Backend} from "./tic80_backend";
import {VoiceManager} from "./voice_manager";

export class Tic80AudioController {
   backend: Tic80Backend;
   private voiceManager: VoiceManager;

   constructor(opts: {bridgeGetter: () => Tic80BridgeHandle | null}) {
      this.voiceManager = new VoiceManager(Tic80Caps.song.audioChannels);
      this.backend = new Tic80Backend(opts.bridgeGetter);
   }

   stop() {
      this.backend.stop();
   }

   getFPS(): number {
      return this.backend.getFPS();
   }

   sfxNoteOn(song: Song, instrumentIndex: number, note: number, preferredChannel: number|null = null) {
      const channel = this.voiceManager.allocateVoice(instrumentIndex, note, preferredChannel);
      this.backend.sfxNoteOn(instrumentIndex, song.instruments[instrumentIndex], note, channel);
   }

   sfxNoteOff(note: number) {
      const channel = this.voiceManager.releaseVoice(note);
      if (channel !== null) {
         this.backend.sfxNoteOff(channel);
      }
   }

   playRow(song: Song, pattern: Pattern, rowNumber: number) {
      this.backend.playRow(song, pattern, rowNumber);
   }

   getSomaticTransportState() {
      return this.backend.getSomaticTransportState();
   }

   async transmitAndPlay(args: BackendPlaySongArgs) {
      await this.backend.transmitAndPlay(args);
   }

   async transmit(args: BackendPlaySongArgs) {
      await this.backend.transmit(args);
   }

   panic() {
      this.voiceManager.releaseAll();
      this.backend.panic();
   }
}
