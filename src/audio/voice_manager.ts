
type VoiceState = {
   channel: number;                //
   midiNote: number | null;        //
   instrumentIndex: number | null; //
   timestamp: number;              // for LRU replacement
};

export class VoiceManager {
   private voices: VoiceState[] = [];
   private voiceCount: number;

   constructor(voiceCount: number) {
      this.voiceCount = voiceCount;
      for (let i = 0; i < voiceCount; i++) {
         this.voices.push({
            channel: i,
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

   allocateVoice(instrumentIndex: number, midiNote: number, preferredChannel: number|null = 0): number //
   {
      const now = performance.now();
      const startChannel = (preferredChannel || 0) % this.voiceCount;

      // try to find an idle voice beginning from preferredChannel
      for (let offset = 0; offset < this.voiceCount; offset++) {
         const channelIndex = (startChannel + offset) % this.voiceCount;
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

   releaseVoice(midiNote: number): number|null {
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

   releaseAll(): number[] {
      const channels: number[] = [];
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

   getChannelForNote(midiNote: number): number|null {
      for (const voice of this.voices) {
         if (voice.midiNote === midiNote) {
            return voice.channel;
         }
      }
      return null;
   }
}
