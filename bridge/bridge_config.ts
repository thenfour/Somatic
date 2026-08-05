import {RegionForMusicPattern, RegionForSfx, RegionForWaveform, SomaticMemoryLayout, Tic80Constants, Tic80MemoryMap} from "./memory_layout";

export const TIC80_BRIDGE_SONG_ORDER_CAPACITY = 256;
const TF_ORDER_LIST_ENTRIES_OFFSET = 1;
const TF_ORDER_LIST_ROWS_OFFSET =
   TF_ORDER_LIST_ENTRIES_OFFSET + TIC80_BRIDGE_SONG_ORDER_CAPACITY * Tic80Constants.MUSIC_CHANNELS;
const TF_PATTERN_DATA_OFFSET = TF_ORDER_LIST_ROWS_OFFSET + TIC80_BRIDGE_SONG_ORDER_CAPACITY;

// IN GENERAL, we can only really use pattern memory for our own use for the playroutines.
// we cannot make any guarantees about other code in the demo (to live beside playroutines),
// so for example map / sprite memory can't be used even if it's tempting.
//
// BUT for bridge, we don't need to support other code living beside the playroutine,
// so we CAN use other memory regions. For the mailbox system therefore we can use map memory.

// .--------------------------------------.
// |         96KB IO ADDRESS SPACE        |
// |--------------------------------------|
// | ADDR    | INFO              | BYTES  |
// |---------+-------------------+--------|
// | 0x00000 | <VRAM bank 0>     | 16,384 | 32kB Video RAM (see below)
// |         |    ...or <bank 1> |        |
// | 0x04000 | TILES             | 8,192  | 256 8x8 4-bit bg tiles - #0 to #255
// | 0x06000 | SPRITES           | 8,192  | 256 8x8 4-bit fg sprites - #256 to #511
// | 0x08000 | MAP               | 32,640 | 240x136 map - indexed by tile/sprite
// | 0x0FF80 | GAMEPADS          | 4      | button state for 4 gamepads
// | 0x0FF84 | MOUSE             | 4      | mouse state X / Y / buttons / scroll
// | 0x0FF88 | KEYBOARD          | 4      | keyboard state, up to 4 pressed buttons
// | 0x0FF8C | SFX STATE         | 16     |
// | 0x0FF9C | SOUND REGISTERS   | 72     | ...
// | 0x0FFE4 | WAVEFORMS         | 256    | 16 waveforms, each 32 x 4-bit values
// | 0x100E4 | SFX               | 4,224  | ...
// | 0x11164 | MUSIC PATTERNS    | 11,520 | ...
// | 0x13E64 | MUSIC TRACKS      | 408    | ...
// | 0x13FFC | SOUND STATE       | 4      | ...
// | 0x14000 | STEREO VOLUME     | 4      |
// | 0x14004 | PERSISTENT MEMORY | 1,024  | persistent RAM, per cartridge
// | 0x14404 | SPRITE FLAGS      | 512    |
// | 0x14604 | SYSTEM FONT       | 2,048  | 256 8x8 1-bit font (used by print)
// | 0x14E04 | GAMEPAD MAPPING   | 32     | keycodes for gamepad mappings
// | 0x14E36 | ** RESERVED **    | 12,764 |
// '--------------------------------------'
// NOTE: Tic80MemoryMap is now defined in memory_layout.ts to avoid circular dependencies


// determine the NEEDS of our various systems.
// - bridge infrastructure
// - bridge-specific song serialization
// - cart song serialization
//   - temp buffers (patterns, (sfx/waveforms..), sfx mpping, automation lanes)
//   - pattern, song order, sfx compressed storage

// determine packed layout. even though we compress data, the decompressed payload
// still needs to fit in a smallish space. esp. the sfx config region. most fields
// don't require 8-bit width so it wins a LOT to pack things tightly.

const bridgeConfig = {
   // Marker string written into RAM for host detection
   markerText: "SOMATIC_TIC80_V1",

   // Outbox command IDs (cart -> host)
   outboxCommands: {
      LOG: 1 //
   },

   // Inbox command IDs (host -> cart)
   inboxCommands: {
      NOP: 0,               //
      TRANSMIT_AND_PLAY: 1, //
      STOP: 2,
      PING: 3, //
      TRANSMIT: 4,
      PLAY_SFX_ON: 6,
      PLAY_SFX_OFF: 7 //
   },

   tic80MemoryMap: Tic80MemoryMap,

   RegionForMusicPattern,
   RegionForSfx,
   RegionForWaveform,

   // Shared memory layout for bridge (cart + host)
   memory: {
      // Waveforms/sfx/patterns/tracks payload destinations (TIC-80 layout)
      WAVEFORMS_ADDR: Tic80MemoryMap.Waveforms.beginAddress(), //"0x0ffe4",
      SFX_ADDR: Tic80MemoryMap.Sfx.beginAddress(),
      PATTERNS_ADDR: Tic80MemoryMap.MusicPatterns.beginAddress(),
      TRACKS_ADDR: Tic80MemoryMap.MusicTracks.beginAddress(),

      // Pattern memory usable for packed compressed columns ends before PATTERN_MEM_LIMIT.
      // Front blit buffer uses patterns 46-49 (pattern 46 at 0x133e4); back buffer uses 50-53 (pattern 50 at 0x136e4).
      PATTERN_MEM_LIMIT: SomaticMemoryLayout.computed.PATTERN_MEM_LIMIT,
      PATTERN_BUFFER_A_INDEX: SomaticMemoryLayout.computed.PATTERN_BUFFER_A_INDEX,
      PATTERN_BUFFER_B_INDEX: SomaticMemoryLayout.computed.PATTERN_BUFFER_B_INDEX,
      PATTERN_BUFFER_A_ADDR: SomaticMemoryLayout.computed.PATTERN_BUFFER_A_ADDR,
      PATTERN_BUFFER_B_ADDR: SomaticMemoryLayout.computed.PATTERN_BUFFER_B_ADDR,

      // Compressed Somatic extra-song data uses one contiguous bridge-only
      // transaction arena spanning Tiles + Sprites.
      BRIDGE_EXTRA_SONG_DATA_ADDR: SomaticMemoryLayout.computed.BRIDGE_EXTRA_SONG_DATA_ADDR,
      BRIDGE_EXTRA_SONG_DATA_SIZE: SomaticMemoryLayout.computed.BRIDGE_EXTRA_SONG_DATA_SIZE,
      BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES:
         SomaticMemoryLayout.computed.BRIDGE_EXTRA_SONG_DATA_MAX_COMPRESSED_BYTES,

      // Somatic bridge state lives in the top of MAP (0x8000..0x0ff7f),
      // above all tracker-format pattern data.
      //
      // Layout within MAP:
      //   See memory_layout.ts for complete allocation strategy
      MARKER_ADDR: SomaticMemoryLayout.computed.MARKER_ADDR,
      REGISTERS_ADDR: SomaticMemoryLayout.computed.REGISTERS_ADDR,
      INBOX_ADDR: SomaticMemoryLayout.computed.INBOX_ADDR,
      OUTBOX_ADDR: SomaticMemoryLayout.computed.OUTBOX_ADDR,
      LOG_SIZE: SomaticMemoryLayout.computed.LOG_SIZE,

      // Tracker-format (Somatic) song data encoded into Map RAM.
      TF_ORDER_LIST: Tic80MemoryMap.Map.beginAddress(),
      TF_ORDER_LIST_COUNT: Tic80MemoryMap.Map.addressWithOffset(0),
      TF_ORDER_LIST_CAPACITY: TIC80_BRIDGE_SONG_ORDER_CAPACITY,
      // song order entries are 4 bytes each (one pattern-column index per channel)
      TF_ORDER_LIST_ENTRIES: Tic80MemoryMap.Map.addressWithOffset(TF_ORDER_LIST_ENTRIES_OFFSET),
      TF_ORDER_LIST_ROWS: Tic80MemoryMap.Map.addressWithOffset(TF_ORDER_LIST_ROWS_OFFSET),
      // pattern data begins after the fixed-capacity entry and effective-row tables.
      TF_PATTERN_DATA: Tic80MemoryMap.Map.addressWithOffset(TF_PATTERN_DATA_OFFSET),

      // Music state snapshot written by TIC-80 runtime
      MUSIC_STATE_TRACK: 0x13ffc,
      MUSIC_STATE_FRAME: 0x13ffd,
      MUSIC_STATE_ROW: 0x13ffe,
      MUSIC_STATE_FLAGS: 0x13fff,

      // Somatic playroutine state (kept in REGISTERS_ADDR region above)
      MUSIC_STATE_SOMATIC_SONG_POSITION: SomaticMemoryLayout.computed.REGISTERS_ADDR,
      FPS: SomaticMemoryLayout.computed.REGISTERS_ADDR + 1,

      // Pattern decoding retains two 1 KiB scratch buffers. Extra-song data is
      // decoded separately to Lua heap tables. Pattern memory looks like:
      // [compressed_pattern_data]
      // [8 patterns to be actually be played, used as front/back buffers]
      // [temp buffer A]
      // [temp buffer B]
      __AUTOGEN_TEMP_PTR_A: SomaticMemoryLayout.computed.TEMP_BUFFER_A_ADDR,
      __AUTOGEN_TEMP_PTR_B: SomaticMemoryLayout.computed.TEMP_BUFFER_B_ADDR
   }
};

export default bridgeConfig;
export type BridgeConfig = typeof bridgeConfig;
