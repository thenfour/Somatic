// here we specify actual capabilities of TIC-80.
// avoid hardcoding these values elsewhere in the codebase.

import {clamp} from "../utils/utils";

export const Tic80Caps = {
   frameRate: 60,

   // song general aka "track".
   song: {
      audioChannels: 4,
      maxSongLength: 16, // MUSIC_TRACKS
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

export const TicMemoryMap = {
   // BRIDGE_MEMORY_MAP
   MARKER_ADDR: 0x14e24,
   REGISTERS_ADDR: 0x14e40,
   INBOX_ADDR: 0x14e80,
   OUTBOX_ADDR: 0x14ec0,

   MAILBOX_MUTEX_ADDR: 0x14e40 + 12,
   MAILBOX_SEQ_ADDR: 0x14e40 + 13,
   MAILBOX_TOKEN_ADDR: 0x14e40 + 14,
   OUTBOX_MUTEX_ADDR: 0x14e80 + 12,
   OUTBOX_SEQ_ADDR: 0x14e80 + 13,
   OUTBOX_TOKEN_ADDR: 0x14e80 + 14,
   LOG_WRITE_PTR_ADDR: 0x14e80 + 7,
   LOG_BASE: 0x14e80 + 16,
   LOG_SIZE: 240,

   // TIC cartridge chunk IDs (subset)
   // CHUNK_WAVEFORMS: 10,
   // CHUNK_SFX: 9,
   // CHUNK_MUSIC_TRACKS: 14,
   // CHUNK_MUSIC_PATTERNS: 15,

   // RAM destinations for the chunk payloads (bank 0)
   WAVEFORMS_ADDR: 0x0ffe4,
   // WAVEFORMS_SIZE: 0x100, // 256 bytes
   // SFX_ADDR: 0x100e4,
   // SFX_SIZE: 66 * 64, // 64 sfx slots * 66 bytes
   // PATTERNS_ADDR: 0x11164,
   // PATTERNS_SIZE: 0x2d00, // 11520 bytes
   // TRACKS_ADDR: 0x13e64,
   // TRACKS_SIZE: 51 * 8, // 8 tracks * 51 bytes

   // local track = peek(0x13FFC)
   // local frame = peek(0x13FFD)
   // local row = peek(0x13FFE)
   // local flags = peek(0x13FFF)

   MUSIC_STATE_TRACK: 0x13ffc,
   MUSIC_STATE_FRAME: 0x13ffd,
   MUSIC_STATE_ROW: 0x13ffe,
   MUSIC_STATE_FLAGS: 0x13fff,
   MUSIC_STATE_CHROMATIC_SONG_POSITION: 0x14e40 /*REGISTERS_ADDR*/ + 0,
   MUSIC_STATE_CHROMATIC_PATTERN_ID: 0x14e40 /*REGISTERS_ADDR*/ + 1,
} as const;

export const TicBridge = {
   MARKER_TEXT: "CHROMATIC_TIC80_V1",

   // outbox commands are from tic->host
   OUT_CMD_LOG: 1,

   // inbox cmd IDs
   CMD_NOP: 0,
   CMD_PLAY: 1,
   CMD_STOP: 2,
   CMD_PING: 3,
   CMD_BEGIN_UPLOAD: 4,
   CMD_END_UPLOAD: 5,
   CMD_PLAY_SFX_ON: 6,
   CMD_PLAY_SFX_OFF: 7,

} as const;