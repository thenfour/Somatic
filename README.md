# Somatic: A music tracker for the TIC-80

## try it

Live @ https://somatic.tenfourmusic.net

## Main features

- MIDI device support
- export as `.tic` cartridge
- ability to import music from existing tic carts
- Guaranteed sound accuracy because it uses a real TIC-80 as the sound engine.
- supports long songs (255 frames)
- Saves your current workspace locally so you always start where you left off.
- Dynamic instrument waveform rendering (tick-based "K-rate" rendering)
  - PWM synthesis
  - Lowpass filter automation
  - Waveform crossfading ("gradients")
  - wavefolding shaper
  - Hard sync
  - LFO & envelope modulation
  - Sample import & slicing
- Tracker ergonomics
  - show carried-over effect status at end of pattern
  - show usage of patterns / instruments
  - highlighting current instrument
  - Pattern thumbnails shown on the song order to get a complete "minimap" of the song, with highlighting of the current instrument.
  - warnings on pattern editor
  - allow highlight color for specific instruments
  - allow naming patterns, instruments
  - allow markers for song order
- Light/dark mode themes
- Keyboard support
  - keyboard note input should be more keyboard-layout-agnostic
  - all keyboard shortcuts can be configurable and saved to localstorage / exported
  - tooltips over most commands revealing shortcut
  - almost every command can be configured with a keyboard shortcut
- transport
  - Mute/Solo per channel
  - looping modes
- pattern editing features
  - block operations
  - transpose, instrument, command interpolation
  - Copy/paste supported everywhere
  - arranger editing
  - Undo/redo support
  - box selection in song order + operations like duplicate, move selection
- Song optimizations
  - Show unused waveforms, sfx, and patterns don't become part of the exported cart.
  - Show compression journey: pattern data is bloaty and gets optimized and compressed
  - Live insights about the size of the song (size of resulting code, playroutine, song data, cart size...)
- Extras
  - Tools for encoding/decoding base64, hex-encoded, base85 and LZ-compressed Lua strings.
  - a built-in Lua minifier

## Features that are less obvious

- <kbd>Esc</kbd> enables keyboard editing in the pattern grid.
- <kbd>Shift+Backspace</kbd> inserts a note-off in the pattern grid.
- <kbd>Ctrl+Click</kbd> on a note or instrument column to select that instrument.
- holding <kbd>Shift+drag</kbd> while drawing on the waveform editor canvas draws straight lines
- <kbd>Ctrl+Click</kbd> on a knob will reset it to default value
- <kbd>Shift+drag</kbd> on a knob for fine control

## Somatic pattern commands

additional per-pattern effect columns that do Somatic-specific things

- **E**: Effect strength scale (00=bypass, FF=max)
- **L**: Set LFO phase (00-FF)
- **F**: set filter strength (00-FF, only if LP is enabled on the instrument)

## How to export / how to use in a demo

To use a Somatic track in your demo,

- export as a cartridge via the file menu
- your demo can now import the music data from this cart
- and you can copy/paste the code as the playroutine.
- NOTE: Even though Somatic has a lot of stuff outside of the built-in music routine, all of its data gets stored in music blocks in the .tic cart, and in the Lua playroutine code.
- NOTE: Export only supports Lua for the playroutine.

All your demo needs to do is

```lua
function TIC()
	local state = somatic_tick()
	-- drive visuals from state.demoBeats / state.demoPatternIndex / state.demoPatternRow
	...
	somatic_end_frame()
end
```

`somatic_tick()` returns the current external transport state. `demoBeats` is the preferred sync
value for animation; pattern and row fields are also included for tracker-style sync.

```lua
local state = somatic_tick()
print(string.format("beat:%.2f pat:%d row:%d", state.demoBeats, state.demoPatternIndex, state.demoPatternRow), 0, 0)
```

public API:

```lua
somatic_tick(wallDeltaMillisOverride, syncOffsetMS) -- call once per TIC frame; returns state
somatic_get_time(syncOffsetMS)                      -- read state without advancing time
somatic_get_raw_time()                              -- read music transport state without sync correction
somatic_project_time(state, syncOffsetMS)           -- project a state through a time offset
somatic_seek(beat, syncOffsetMS)                    -- seek to an external beat, including fractional beats
somatic_set_options(options)                        -- tempo/speed/isPlaying/isMuted/loopSongForever/syncOffsetMS
somatic_advance_frame()                             -- advance paused demo time by one 60Hz frame
somatic_end_frame()                                 -- for internal bookkeeping
```

`somatic_seek()` keeps `demoBeats` / `demoMillis` continuous for animation. TIC-80 audio can
only start on integer rows, so a fractional seek may produce a short silence until the next row
boundary before music resumes.

`syncOffsetMS` is a presentation-only latency correction in system milliseconds. Positive values
advance the returned external transport time. It does not change internal music playback state;
`somatic_get_raw_time()` exposes that unprojected state.

Transport state includes timing settings, play state, wall-clock fields, demo-clock fields, and song
length fields. "Wall clock" refers to the clock on your wall rather than in the song/demo.
The wall clock ticks even when the demo is paused. Useful for debug huds etc.

```lua
state.tempo
state.speed
state.rowsPerBeat
state.rowsPerPattern
state.isPlaying
state.isMuted
state.loopSongForever
state.didSeek
state.playbackRate
state.syncOffsetMS

state.wallFrame
state.wallDeltaMillis
state.wallMillis

state.demoMillis
state.demoDeltaMillis
state.demoBeats
state.demoDeltaBeats
state.demoPatternIndex
state.demoPatternRow

state.songPatternCount
state.songRowCount
state.songBeatCount
state.songMillis

state.rawDemoMillis -- internal time with no sync offset applied
state.rawDemoBeats  -- internal time with no sync offset applied
```

For example:

```lua
if btnp(1) then
	state = somatic_set_options({ isPlaying = not state.isPlaying })
end
if btnp(2) then
	state = somatic_seek(math.max(0, state.demoBeats - 1))
end
if btnp(3) then
	state = somatic_seek(math.min(state.songBeatCount, state.demoBeats + 1))
end
```

`tempo` and `speed` can be overridden together for slowed playback. `rowsPerBeat`
is based on Somatic's highlight rows.

## How to use with ticbuild build system

[ticbuild](https://github.com/thenfour/ticbuild) is a multi-file asset manager and build system
for TIC-80. It's easy to import a Somatic song into a `ticbuild` project.

For an example, install ticbuild and initialize a new project using the `piggybossa` template.

```bash
> npm i -g ticbuild
> ticbuild init c:\myprojects\projectname --template-name piggybossa

```

Importing is just a matter of importing chunks from the Somatic-exported `.tic` file,
and call `somatic_tick()` from your `TIC()` function.

In your `ticbuild` project manifest

```jsonc
{
  "imports": [
    // import the song cartridge like this:
    {
      "name": "song",
      "path": "path_to_your_song.tic",
    },
  ],
  "assembly": {
    "blocks": [
      // Add this to import the non-code Somatic music data
      {
        "asset": "song",
        "chunks": ["MUSIC_PATTERNS", "MUSIC_TRACKS", "WAVEFORMS", "SFX"],
      },
    ],
  },
}
```

And in your Lua code,

```Lua
--#include "asset:song:CODE" -- include music routines

function TIC()
  local state = somatic_tick() -- music + transport update per frame
end
```

## motivations / history

This started as a fork of https://reverietracker.github.io/chromatic/. However, Somatic has basically nothing related to the original anymore. Sound engine, UI, pattern, playroutine have all been
since replaced.

Somatic has 2 main goals:

1. be an ultra-ergonomic UX. to be "the ultimate tracker UX"
2. provide reasonably-musical playroutine that augments the built-in TIC-80 music routine.

## Song schema versioning

Somatic song JSON includes a top-level `schemaVersion` number.

- `schemaVersion = 1` (current):
  - pattern cells represent note-off as a boolean flag (`noteOff: true`) and instrument indices are Somatic-owned (`instrumentIndex` is 0-based and may be `null`). TIC-80 reserved instruments (0 and 1) are injected only during TIC-80 serialization.

## issues / limitations

this was made like, yesterday. it has bugs. file them @ https://github.com/thenfour/Somatic/issues

Other stuff worth metioning:

- Mobile: Absolutely will not be a good experience on mobile / small screens. This thing works like a
  desktop app and wants mouse + keyboard.
- There are quirks due to using the embedded TIC-80, and the goofy playroutine. Instrument/waveform
  updates tend to be updated in real-time, but pattern/order changes, or changing looping mode
  requires stopping / playing again to hear the change.

## How does it work

A TIC-80 lives in an `<iframe>`, and Somatic establishes 2-way communication with it
through a custom cart called "bridge.tic" (source of bridge is @ `/bridge/bridge.lua`).
Based on that, Somatic can write to TIC-80 memory, and tell the bridge to do things like play, stop, etc.

### Why an `<iframe>`?

because the tic80 will capture input from its whole `document` which conflicts with Somatic. It has to be isolated.

## dev stuff

```

npm install
npm start
npm run typecheck
npm run tests
npm run build
npx serve


```

### bridge.lua and playroutine.lua

The tracker's embedded TIC-80 loads a cart that's built as part of the project build process.
The `build-bridge` webpack plugin, `bridge.lua`, gets injected with a bunch of stuff (constants
from memory map / TIC-80 constants / shared playback Lua routines), and built into a .tic cart.

`build-bridge` is also run automatically at runtime when relevant files are changed. It's finnicky though.

`playroutine.lua` is a template that is used for exporting the song.

### Song's journey from UI to TIC80.

The `Song` in Somatic's editor largely resembles the built-in TIC-80 song format,
with a bunch of differences (>16 frames supported, various waveform effects, etc)

The playroutine uses the built-in `music()` TIC-80 function, so there's a lot of
conversion that goes on between Somatic and the exported cartridge.

- **Baking**: your play options (channel muting, looping, selection) change the song that gets played by the TIC-80. For example if you choose to loop a 4-row bit of song, it gets converted to a song with only those 4 rows, looped.
- **Optimization**: detecting which instruments, waveforms, patterns are unused or duplicates, removing them and sliding them to be together. We also break Somatic patterns into 4 individual channels (the way
  TIC-80 does patterns)
- **Transmission**:
  - For Somatic tracker's live web play, we `POKE` it into the TIC-80's memory in a way that the runtime playroutine can use.
    - Waveform and sfx are placed directly in the standard WAVEFORM and SFX memory locations
    - song order ("frames") & pattern data get stuffed in the large graphics memory area so the playroutine can blit from it.
  - For exported carts, we do similar for waveform & sfx, however Pattern & frame data get exported an Lua strings, encoded & compressed.

## screenshot gallery (WIP)

### the app

![Somatic app](.attachments/image-1.png)

### pattern editor

![pattern editor](.attachments/image-2.png)

- Set pattern names
- See if this pattern is used in the song (& how many times)
- Mute/Solo controls
- Columns: Note, instrument, effect, param XY, somatic command, somatic param
- Current instrument is highlighted with an orange box
- Instruments can be configured to display with different colors (18 and 07 are blue for drums)
- Effect carry-over is displayed at the bottom of the pattern
- shows other useful tech data; in this case some waveform rendering info is displayed

![pattern editor - warnings](.attachments/image-3.png)

- Box-selection and block operations
- Warnings are shown when tech conflicts are detected

### pattern advanced edit panel

![pattern advanced edit panel](.attachments/image-4.png)

- Select where thes block ops will be applied (you can make whole-song adjustments here)
- You can also choose to apply edits to a single instrument.
- Sync button sets the value to the current instrument
- Transpose notes by octave or semitone
- Interpolate notes (select a region, this will fill in all notes between with a ramp)
- Clear note column
- Set to instrument
- increment / decrement instrument
- Clear instrument column
- Clear effect column or Somatic FX column
- Clear or interpolate the effect param columns (X only, Y only, or XY together)

### waveform editor

![waveform editor](.attachments/image-5.png)

### SFX (Instrument) editor

### arrangement editor ("song order" / "frames"...)

![arrangement editor](.attachments/image-6.png)

### instruments mgmt panel

![instruments mgmt panel](.attachments/image-7.png)

### export cart / song stats

![Song stats](.attachments/image-8.png)

# Versioning

Somatic uses npm-style `package.json` versioning for the app version, e.g. `v1.0.10`.
The About dialog also displays useful git build info like commit hash, commit date, and whether
the build was dirty.

# Pattern end somatic pattern / "cut to next pattern" command.

Somatic effect `C` cuts to the next pattern.

## Why no param?

Traditional trackers (IT, FT / xm / s3m) accept a parameter for `Cxx` / `Dxx` where `xx`
is the row number of the next pattern to play.

For us that introduces complexity and it's currently not forseen to need it.

It can be a feature to build afterwards anyway, as needed.

## Spec / details

Current row plays (the row containing the `C` command), and
the next row to be played is the 1st row in the next play order's pattern.

If there's no next order, the song ends.

This command can only appear in the "somatic effect" column; not the TIC-80 effect column.
The tic-80 native `J` pattern effect command remains unsupported.

Scope: The somatic `C` command affects all channels.

Multiple `C` commands: the first one encountered wins. Subsequent would be unreachable and untouched.

`C` on last row is effectively a NOP. No special handling is needed in this case but worth noting.

## Implementation notes

- `Song` and other models shall need methods to calculate timings. While previously
  we could rely on simple arithmetic for converting between rows/beats/patterns/time,
  now the song needs to be walked; each pattern will expose a method to get
  effective rows.
- All timing-based calcs in Somatic shall use methods for calculation to centralize
  the logic, no longer relying on assumptions regarding fixed rows-per-pattern.
- Any reliance on `song.rowsPerPattern` need updating. All use of
  `song.rowsPerPattern` as a means to calculate timings or transport details should be
  updated to calculate. The song conceptually turns into "each pattern has its own
  length"; this should be how the app shall feel. And `song.rowsPerPattern` becomes a
  tic80 detail / pattern default.
- To simplify the changes needed for the playroutine, we can export a mapping of
  pattern -> effective pattern rows. When the playroutines encounter a playroutine
  that needs cutting short, a `J` command can be synthesized.
- Playroutine (bridge + playroutine.lua) will need to synthesize a native `J` command
  to the next pattern during playback.
- We should document practical constraints if they exist (for example is a 1-row pattern
  possible; does that give the playroutine enough time to do the pattern blit?).
  We should allow `C` on all rows, but at least document if this could cause playback
  glitches / undefined behavior.
- Pattern editor should indicate unreachable rows with minimal code changes: we
  can just show a simple indication similar to other row-based warnings.
- Pattern editor still uses `song.rowsPerPattern`, and even allows editing beyond
  the usable pattern area; unreachable area is dimmed. Transport and song
  export/playback/render use the effective length.
- All loop modes shall be aware of pattern length for calculating the loop region.
- Public transport API (`somatic_get_time` et al) can still expose `rowsPerPattern`.
  Consumers are expected to understand constraints on its use.
- Cue sheet shall include the effective row count (as a `rows` field) per entry.

## Semantics of `Jxy` Tic-80 command

https://github.com/nesbox/TIC-80/wiki/Music-editor

`Jxy`: Jump to frame/beat

- Jumps to frame (pattern) x, beat (row) y.
- `J00` jumps to the beginning of the song, so if you use it, remember to remove
  the rule before exporting the music track.

Testing shows that:

- Like our `Cxx` command, `Jxy` performs the jump after the current row.
- `x` is the frame number (0-15)
- `y` is the row number (0-15; rows 16... are unable to be jumped to)


# Change log

## 1.0.10

- #189 Somatic can now act as a full transport system for demo prods. Demos tend to use
  music as the source of timing, so this codifies that.
- #188 runtime mute support
- #187 cue sheet export support

## 1.0.11

https://github.com/thenfour/Somatic/milestone/3?closed=1

- #192 allow specifying minification options for release export
- #191 fixing minification bugs that were fixed in ticbuild
- #190 playroutine transport now supports fractional row seeking
- #193 #195 ability to export a cue sheet and transport config metadata

## 1.0.12

- #197 cue sheet format updated and includes more info
- #198 adding somatic `C` pattern effect command to jump to next pattern.
