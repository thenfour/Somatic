// here we specify actual capabilities of TIC-80.
// avoid hardcoding these values elsewhere in the codebase.

import {clamp, parseAddress} from "../utils/utils";
import bridgeConfig from "../../bridge/bridge_config";

//const mem = bridgeConfig.memory as Record<string, string|number>;

const mem = bridgeConfig.memory;

export const SomaticCaps = {
   maxPatternCount: 256,
   maxSongLength: 256,
   noteCutInstrumentIndex: 1, // 0 = reserved
   maxPatternLengthToBridge: 40000,
   maxSongTitleLength: 200,
   maxMorphGradientNodes: 16,
   // Reject imported WAVs larger than this
   maxImportedWavBytes: 5 * 1024 * 1024,
   // UI limit for the sample->morph conversion target duration.
   maxMorphGradientTotalDurationSeconds: 15,
   waveMorph: {
      minDurationSeconds: 0.01,
      maxDurationSeconds: 16.0, // 1024 frames
      defaultDurationSeconds: 0.5,
   }
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

export const TIC80_EFFECT_LETTERS: Record<SomaticEffectCommand, string> = {
   [SomaticEffectCommand.M]: "M",
   [SomaticEffectCommand.C]: "C",
   [SomaticEffectCommand.J]: "J",
   [SomaticEffectCommand.S]: "S",
   [SomaticEffectCommand.P]: "P",
   [SomaticEffectCommand.V]: "V",
   [SomaticEffectCommand.D]: "D",
};

export const TIC80_EFFECT_DESCRIPTIONS: Record<SomaticEffectCommand, string> = {
   [SomaticEffectCommand.M]: "Master volume",
   [SomaticEffectCommand.C]: "Chord",
   [SomaticEffectCommand.J]: "Jump (not supported in Somatic)",
   [SomaticEffectCommand.S]: "Slide",
   [SomaticEffectCommand.P]: "Pitch",
   [SomaticEffectCommand.V]: "Vibrato",
   [SomaticEffectCommand.D]: "Delay",
};

export enum SomaticPatternCommand {
   EffectStrengthScale = 0, // 'E'
   SetLFOPhase = 1,         // 'L'
   FilterFrequency = 2,     // 'F'
}

export const SOMATIC_PATTERN_COMMAND_KEYS: Record<string, SomaticPatternCommand> = {
   "e": SomaticPatternCommand.EffectStrengthScale,
   "f": SomaticPatternCommand.FilterFrequency,
   "l": SomaticPatternCommand.SetLFOPhase,
};

export const SOMATIC_PATTERN_COMMAND_LETTERS: Record<SomaticPatternCommand, string> = {
   [SomaticPatternCommand.EffectStrengthScale]: "E",
   [SomaticPatternCommand.FilterFrequency]: "F",
   [SomaticPatternCommand.SetLFOPhase]: "L",
};

export const SOMATIC_PATTERN_COMMAND_DESCRIPTIONS: Record<SomaticPatternCommand, string> = {
   [SomaticPatternCommand.EffectStrengthScale]: "Effect strength scale (00=bypass, FF=max)",
   [SomaticPatternCommand.FilterFrequency]: "Lowpass frequency (00=min, FF=bypass)",
   [SomaticPatternCommand.SetLFOPhase]: "Set LFO phase (00 - FF)",
};

export const Tic80Caps = {
   frameRate: 60,

   // song general aka "track".
   song: {
      audioChannels: 4,
      maxSongLength: 16, // MUSIC_TRACKS
      songSpeedMin: 1,   // todo: verify
      songSpeedMax: 7,   // todo: verify
      minTempo: 32,      // todo: verify
      maxTempo: 254,     // todo: verify
   },

   // "track data"
   // https://github.com/nesbox/TIC-80/wiki/.tic-File-Format#music-tracks
   arrangement: {
      count: 16,
   },

   // pattern
   pattern: {
      count: 60, // MUSIC_PATTERNS
      minRows: 1,
      maxRows: 64, // MUSIC_PATTERN_ROWS
      octaveCount: 8,
      memory: {
         start: parseAddress(mem.PATTERNS_ADDR),
         limit: parseAddress(mem.PATTERN_MEM_LIMIT),
      },
      buffers: {
         front: {
            index: mem.PATTERN_BUFFER_A_INDEX as number,
            addr: parseAddress(mem.PATTERN_BUFFER_A_ADDR),
         },
         back: {
            index: mem.PATTERN_BUFFER_B_INDEX as number,
            addr: parseAddress(mem.PATTERN_BUFFER_B_ADDR),
         },
      },
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

export const Tic80PatternBytes = Tic80Caps.pattern.maxRows * 3; // 192 bytes per pattern

export type Tic80ChannelIndex = 0|1|2|3;

export const ToTic80ChannelIndex = (value: number): Tic80ChannelIndex => {
   return clamp(value, 0, Tic80Caps.song.audioChannels - 1) as Tic80ChannelIndex;
};

export const gChannelsArray =
   [0 as Tic80ChannelIndex, 1 as Tic80ChannelIndex, 2 as Tic80ChannelIndex, 3 as Tic80ChannelIndex] as const;

export const gAllChannelsAudible = new Set<Tic80ChannelIndex>(gChannelsArray);

export const TicMemoryMap = {
   // BRIDGE_MEMORY_MAP (shared with bridge.lua via bridge_config.ts)
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

   // NB: IF THIS CHANGES YOU HAVE TO UPDATE maxPatternLengthToBridge IN SomaticCaps
   //TILE_BASE: parseAddress(mem.TILE_BASE),
   TF_ORDER_LIST: parseAddress(mem.TF_ORDER_LIST), // TILE_BASE: 1 length byte + 256 entries.
   TF_PATTERN_DATA: parseAddress(
      mem.TF_PATTERN_DATA), // theoretically you can support the whole tile+sprite+map area for pattern data.

   // Packed morphing instrument config (host -> cart). See bridge_config.ts for binary layout.
   SOMATIC_SFX_CONFIG: parseAddress(mem.SOMATIC_SFX_CONFIG),

   // RAM destinations for the chunk payloads (bank 0)
   WAVEFORMS_ADDR: parseAddress(mem.WAVEFORMS_ADDR),
   SFX_ADDR: parseAddress(mem.SFX_ADDR),
   PATTERNS_ADDR: parseAddress(mem.PATTERNS_ADDR),
   PATTERN_MEM_LIMIT: parseAddress(mem.PATTERN_MEM_LIMIT),
   PATTERN_BUFFER_A_INDEX: mem.PATTERN_BUFFER_A_INDEX as number,
   PATTERN_BUFFER_B_INDEX: mem.PATTERN_BUFFER_B_INDEX as number,
   PATTERN_BUFFER_A_ADDR: parseAddress(mem.PATTERN_BUFFER_A_ADDR),
   PATTERN_BUFFER_B_ADDR: parseAddress(mem.PATTERN_BUFFER_B_ADDR),
   TRACKS_ADDR: parseAddress(mem.TRACKS_ADDR),

   __AUTOGEN_TEMP_PTR_A: parseAddress(mem.__AUTOGEN_TEMP_PTR_A),
   __AUTOGEN_TEMP_PTR_B: parseAddress(mem.__AUTOGEN_TEMP_PTR_B),
   __AUTOGEN_BUF_PTR_A: parseAddress(mem.PATTERN_BUFFER_A_ADDR),
   __AUTOGEN_BUF_PTR_B: parseAddress(mem.PATTERN_BUFFER_B_ADDR),

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
   CMD_TRANSMIT: bridgeConfig.inboxCommands.TRANSMIT,
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
