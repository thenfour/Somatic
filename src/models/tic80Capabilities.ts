// here we specify actual capabilities of TIC-80.
// avoid hardcoding these values elsewhere in the codebase.

import {clamp} from "../utils/utils";

export const Tic80Caps = {
   frameRate: 60,

   // song general aka "track".
   song: {
      audioChannels: 4,
      maxSongLength: 256,
      songSpeedMax: 7,
   },

   // "track data"
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-tracks
   arrangement: {
      count: 16,
   },

   // pattern
   pattern: {
      count: 60,   // MUSIC_PATTERNS
      maxRows: 64, // MUSIC_PATTERN_ROWS
      octaveCount: 8,
      // and each row = 4 channels x 3 bytes [note, param1, param2, command, sfxhi, sfxlo, octave]
   },

   // sfx
   sfx: {
      count: 64,
      envelopeFrameCount: 30,
      speedMax: 7,
      volumeMax: 15,
      pitchMin: -8,
      pitchMax: 7,
      arpeggioMax: 15,
   },
   maxSfx: 64, // todo: remove (use sfx.count)

   // waveforms
   waveform: {
      count: 16,
      pointCount: 32,
      amplitudeRange: 16, // 0-15
   },
} as const;


export type Tic80ChannelIndex = 0|1|2|3;

export const ToTic80ChannelIndex = (value: number): Tic80ChannelIndex => {
   return clamp(value, 0, Tic80Caps.song.audioChannels - 1) as Tic80ChannelIndex;
};
