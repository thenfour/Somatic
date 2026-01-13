// here we specify actual capabilities of TIC-80.
// avoid hardcoding these values elsewhere in the codebase.

import {clamp, parseAddress} from "../utils/utils";
import bridgeConfig from "../../bridge/bridge_config";
import {defineEnum} from "../utils/enum";

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

export const kTic80EffectCommand = defineEnum({
   M: {
      value: 0,             // somatic-serialized value
      tic80EncodedValue: 1, // TIC-80 pattern commands are 1-based.
      description: "Master volume",
      keyboardShortcut: "m",
      patternChar: "M",
      nominalX: 15,
      nominalY: 15,
   },
   C: {
      value: 1,
      tic80EncodedValue: 2,
      description: "Chord",
      keyboardShortcut: "c",
      patternChar: "C",
      nominalX: 0,
      nominalY: 0,
   },
   J: {
      value: 2,
      tic80EncodedValue: 3,
      description: "Jump (not supported in Somatic)",
      keyboardShortcut: "j",
      patternChar: "J",
      nominalX: undefined,
      nominalY: undefined,
   },
   S: {
      value: 3,
      tic80EncodedValue: 4,
      description: "Slide",
      keyboardShortcut: "s",
      patternChar: "S",
      nominalX: 0,
      nominalY: 0,
   },
   P: {
      value: 4,
      tic80EncodedValue: 5,
      description: "Pitch",
      keyboardShortcut: "p",
      patternChar: "P",
      nominalX: 0,
      nominalY: 0,
   },
   V: {
      value: 5,
      tic80EncodedValue: 6,
      description: "Vibrato",
      keyboardShortcut: "v",
      patternChar: "V",
      nominalX: 0,
      nominalY: 0,
   },
   D: {
      value: 6,
      tic80EncodedValue: 7,
      description: "Delay",
      keyboardShortcut: "d",
      patternChar: "D",
      nominalX: 0,
      nominalY: 0,
   },
} as const);

export type Tic80EffectCommand = typeof kTic80EffectCommand.$key;

// export enum Tic80EffectCommand {
//    // NOTE: these correspond with our 0-based pattern editor, NOT TIC-80's 1-based effect commands.
//    M = 0,
//    C = 1,
//    J = 2,
//    S = 3,
//    P = 4,
//    V = 5,
//    D = 6,
// }

// export const TIC80_EFFECT_LETTERS: Record<Tic80EffectCommand, string> = {
//    [Tic80EffectCommand.M]: "M",
//    [Tic80EffectCommand.C]: "C",
//    [Tic80EffectCommand.J]: "J",
//    [Tic80EffectCommand.S]: "S",
//    [Tic80EffectCommand.P]: "P",
//    [Tic80EffectCommand.V]: "V",
//    [Tic80EffectCommand.D]: "D",
// };

// export const TIC80_EFFECT_DESCRIPTIONS: Record<Tic80EffectCommand, string> = {
//    [Tic80EffectCommand.M]: "Master volume",
//    [Tic80EffectCommand.C]: "Chord",
//    [Tic80EffectCommand.J]: "Jump (not supported in Somatic)",
//    [Tic80EffectCommand.S]: "Slide",
//    [Tic80EffectCommand.P]: "Pitch",
//    [Tic80EffectCommand.V]: "Vibrato",
//    [Tic80EffectCommand.D]: "Delay",
// };

export const kSomaticPatternCommand = defineEnum({
   EffectStrengthScale: {
      value: 0,
      tic80SerializedValue: 1, // 1-based so that 0 can mean "no effect"
      keyboardShortcut: "e",
      patternChar: "E",
      description: "Effect strength scale (00=bypass, FF=max)",
      nomivalValue: 0xff,
   },
   SetLFOPhase: {
      value: 1,
      tic80SerializedValue: 2,
      keyboardShortcut: "l",
      patternChar: "L",
      description: "Set LFO phase (00 - FF)",
      nomivalValue: undefined,
   },
   FilterFrequency: {
      value: 2,
      tic80SerializedValue: 3,
      keyboardShortcut: "f",
      patternChar: "F",
      description: "Lowpass strength scale (00=bypass, FF=max)",
      nomivalValue: 0xff,
   },
});

export type SomaticPatternCommand = typeof kSomaticPatternCommand.$key;

// export enum SomaticPatternCommand {
//    EffectStrengthScale = 0, // 'E'
//    SetLFOPhase = 1,         // 'L'
//    FilterFrequency = 2,     // 'F'
// }

// export const SOMATIC_PATTERN_COMMAND_KEYS: Record<string, SomaticPatternCommand> = {
//    "e": SomaticPatternCommand.EffectStrengthScale,
//    "f": SomaticPatternCommand.FilterFrequency,
//    "l": SomaticPatternCommand.SetLFOPhase,
// };

// export const SOMATIC_PATTERN_COMMAND_LETTERS: Record<SomaticPatternCommand, string> = {
//    [SomaticPatternCommand.EffectStrengthScale]: "E",
//    [SomaticPatternCommand.FilterFrequency]: "F",
//    [SomaticPatternCommand.SetLFOPhase]: "L",
// };

// export const SOMATIC_PATTERN_COMMAND_DESCRIPTIONS: Record<SomaticPatternCommand, string> = {
//    [SomaticPatternCommand.EffectStrengthScale]: "Effect strength scale (00=bypass, FF=max)",
//    [SomaticPatternCommand.FilterFrequency]: "Lowpass strength scale (00=bypass, FF=max)",
//    [SomaticPatternCommand.SetLFOPhase]: "Set LFO phase (00 - FF)",
// };

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
      //minRows: 1,
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
