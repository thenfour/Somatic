// here we specify actual capabilities of TIC-80.
// avoid hardcoding these values elsewhere in the codebase.

import {clamp, parseAddress} from "../utils/utils";
import bridgeConfig from "../../bridge/bridge_config.jsonc";

export const SomaticCaps = {
   maxPatternCount: 256,
   maxSongLength: 256,
   noteCutInstrumentIndex: 1, // 0 = reserved
   maxPatternLengthToBridge: 40000,
   maxSongTitleLength: 200,
} as const;

export enum SomaticEffectCommand {
   // NOTE: these correspond with our 0-based pattern editor, NOT TIC-80's 1-based effect commands.
   M = 0,
   C = 1,
   J = 2,
   S = 3,
   P = 4,
   V = 5,
   D = 6,
}

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

export const gChannelsArray =
   [0 as Tic80ChannelIndex, 1 as Tic80ChannelIndex, 2 as Tic80ChannelIndex, 3 as Tic80ChannelIndex] as const;

export const gAllChannelsAudible = new Set<Tic80ChannelIndex>(gChannelsArray);

const mem = bridgeConfig.memory as Record<string, string|number>;

export const TicMemoryMap = {
   // BRIDGE_MEMORY_MAP (shared with bridge.lua via bridge_config.jsonc)
   MARKER_ADDR: parseAddress(mem.MARKER_ADDR),
   REGISTERS_ADDR: parseAddress(mem.REGISTERS_ADDR),
   INBOX_ADDR: parseAddress(mem.INBOX_ADDR),
   OUTBOX_ADDR: parseAddress(mem.OUTBOX_ADDR),

   MAILBOX_MUTEX_ADDR: parseAddress(mem.INBOX_ADDR) + 12,
   MAILBOX_SEQ_ADDR: parseAddress(mem.INBOX_ADDR) + 13,
   MAILBOX_TOKEN_ADDR: parseAddress(mem.INBOX_ADDR) + 14,
   OUTBOX_MUTEX_ADDR: parseAddress(mem.OUTBOX_ADDR) + 12,
   OUTBOX_SEQ_ADDR: parseAddress(mem.OUTBOX_ADDR) + 13,
   OUTBOX_TOKEN_ADDR: parseAddress(mem.OUTBOX_ADDR) + 14,

   LOG_WRITE_PTR_ADDR: parseAddress(mem.OUTBOX_ADDR) + 7,

   LOG_BASE: parseAddress(mem.OUTBOX_ADDR) + 16,
   LOG_SIZE: mem.LOG_SIZE as number,

   CHANNEL_VOLUME_0: parseAddress(mem.CHANNEL_VOLUME_0),
   CHANNEL_VOLUME_1: parseAddress(mem.CHANNEL_VOLUME_1),
   CHANNEL_VOLUME_2: parseAddress(mem.CHANNEL_VOLUME_2),
   CHANNEL_VOLUME_3: parseAddress(mem.CHANNEL_VOLUME_3),

   // NB: IF THIS CHANGES YOU HAVE TO UPDATE maxPatternLengthToBridge IN SomaticCaps
   TILE_BASE: parseAddress(mem.TILE_BASE),
   TF_ORDER_LIST: parseAddress(mem.TF_ORDER_LIST), // TILE_BASE: 1 length byte + 256 entries.
   TF_PATTERN_DATA: parseAddress(
      mem.TF_PATTERN_DATA), // theoretically you can support the whole tile+sprite+map area for pattern data.

   // RAM destinations for the chunk payloads (bank 0)
   WAVEFORMS_ADDR: parseAddress(mem.WAVEFORMS_ADDR),
   SFX_ADDR: parseAddress(mem.SFX_ADDR),
   PATTERNS_ADDR: parseAddress(mem.PATTERNS_ADDR),
   TRACKS_ADDR: parseAddress(mem.TRACKS_ADDR),

   MUSIC_STATE_TRACK: parseAddress(mem.MUSIC_STATE_TRACK),
   MUSIC_STATE_FRAME: parseAddress(mem.MUSIC_STATE_FRAME),
   MUSIC_STATE_ROW: parseAddress(mem.MUSIC_STATE_ROW),
   MUSIC_STATE_FLAGS: parseAddress(mem.MUSIC_STATE_FLAGS),
   MUSIC_STATE_SOMATIC_SONG_POSITION: parseAddress(mem.MUSIC_STATE_SOMATIC_SONG_POSITION),
   FPS: parseAddress(mem.FPS),
} as const;

export const TicBridge = {
   MARKER_TEXT: bridgeConfig.markerText,

   // outbox commands are from tic->host
   OUT_CMD_LOG: bridgeConfig.outboxCommands.LOG,

   // inbox cmd IDs
   CMD_NOP: bridgeConfig.inboxCommands.NOP,
   CMD_TRANSMIT_AND_PLAY: bridgeConfig.inboxCommands.TRANSMIT_AND_PLAY,
   CMD_STOP: bridgeConfig.inboxCommands.STOP,
   CMD_PING: bridgeConfig.inboxCommands.PING,
   CMD_PLAY_SFX_ON: bridgeConfig.inboxCommands.PLAY_SFX_ON,
   CMD_PLAY_SFX_OFF: bridgeConfig.inboxCommands.PLAY_SFX_OFF,

} as const;

export function calculateBpm(
   {songTempo, songSpeed, rowsPerBeat}: {songTempo: number, songSpeed: number, rowsPerBeat: number}): number {
   // https://itch.io/t/197936/music-editor-how-spd-relates-to-tempo-beats-per-minute
   // that formula assumes 4 rows per beat.
   // so for arbitrary rows per beat,
   // bpm = 24 * T / S L
   return (24 * songTempo) / (songSpeed * rowsPerBeat);
};

// calculates the song position in seconds at a given row index (assume row 0 = 0 seconds)
export function calculateSongPositionInSeconds(args: {songTempo: number; songSpeed: number; rowIndex: number;}):
   number {
   const {songTempo, songSpeed, rowIndex} = args;
   const bpm = calculateBpm({songTempo, songSpeed, rowsPerBeat: 4});
   const beatsPerSecond = bpm / 60;
   const rowsPerSecond = beatsPerSecond * 4;
   return rowIndex / rowsPerSecond;
};
