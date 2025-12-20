import {Tic80Caps, Tic80ChannelIndex} from "../models/tic80Capabilities";


type VoiceState = {
   channel: Tic80ChannelIndex;     //
   midiNote: number | null;        //
   instrumentIndex: number | null; //
   timestamp: number;              // for LRU replacement
};

export class VoiceManager {
   private voices: VoiceState[] = [];

   constructor() {
      for (let i = 0; i < Tic80Caps.song.audioChannels; i++) {
         this.voices.push({
            channel: i as Tic80ChannelIndex,
            midiNote: null,
            instrumentIndex: null,
            timestamp: 0,
         });
      }

      // assert that channelindexes are the same as array indexes
      for (let i = 0; i < this.voices.length; i++) {
         if (this.voices[i].channel !== i) {
            throw new Error("VoiceManager channel index mismatch; required to make allocation logic efficient.");
         }
      }
   }

   allocateVoice(instrumentIndex: number, midiNote: number, preferredChannel: Tic80ChannelIndex|null = 0):
      Tic80ChannelIndex //
   {
      const now = performance.now();
      const startChannel = (preferredChannel || 0) % Tic80Caps.song.audioChannels;

      // try to find an idle voice beginning from preferredChannel
      for (let offset = 0; offset < Tic80Caps.song.audioChannels; offset++) {
         const channelIndex = (startChannel + offset) % Tic80Caps.song.audioChannels;
         const voice = this.voices[channelIndex];
         if (voice.midiNote === null) {
            voice.midiNote = midiNote;
            voice.instrumentIndex = instrumentIndex;
            voice.timestamp = now;
            return voice.channel;
         }
      }

      // All voices busy; steal the oldest one (LRU)
      let oldest = this.voices[0];
      for (const voice of this.voices) {
         if (voice.timestamp < oldest.timestamp) {
            oldest = voice;
         }
      }

      oldest.midiNote = midiNote;
      oldest.instrumentIndex = instrumentIndex;
      oldest.timestamp = now;
      return oldest.channel;
   }

   releaseVoice(midiNote: number): Tic80ChannelIndex|null {
      for (const voice of this.voices) {
         if (voice.midiNote === midiNote) {
            const channel = voice.channel;
            voice.midiNote = null;
            voice.instrumentIndex = null;
            voice.timestamp = 0;
            return channel;
         }
      }
      return null;
   }

   releaseAll(): Tic80ChannelIndex[] {
      const channels: Tic80ChannelIndex[] = [];
      for (const voice of this.voices) {
         if (voice.midiNote !== null) {
            channels.push(voice.channel);
            voice.midiNote = null;
            voice.instrumentIndex = null;
            voice.timestamp = 0;
         }
      }
      return channels;
   }

   getChannelForNote(midiNote: number): Tic80ChannelIndex|null {
      for (const voice of this.voices) {
         if (voice.midiNote === midiNote) {
            return voice.channel;
         }
      }
      return null;
   }
}
