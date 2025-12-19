# Somatic tracker

The idea of Somatic tracker is that a real tic80 is used as the sound engine,
but the tracker interface is a web-based SPA with more ... ergonomics.

features you might find interesting:

* MIDI device support
* export as `.tic` cartridge
* Undo/redo support
* Mute/Solo per channel
* editing features
  * box selection in song order + operations like duplicate, move selection
  * block operations
  * transpose, instrument, command interpolation
* Copy/paste supported everywhere
* waveform manipulation tools like smoothing, normalization, mixing in harmonics
* instrument editor (sfx) shows the waveform sequence
* Themes: dark/light supported
* Guaranteed sound accuracy because it uses a real TIC-80 as the sound engine.
* Song optimization: unused waveforms, sfx, and patterns don't become part of the exported cart.
* Song compression: pattern data is bloaty and gets compressed to keep code size down
* Live insights about the size of the song (size of resulting code, playroutine, song data, cart size...)

# try it

Live @ https://somatic.tenfourmusic.net

# export procedure

To use a Somatic track in your demo,

- export as a cartridge via the file menu
- your demo can now import the music data from this cart
- and you can copy/paste the code as the playroutine.

All your demo needs to do is

```lua
function TIC()
	somatic_tick()
    ...
end

```

You can get realtime frame and row data from `somatic_get_state()`.

```lua
local track, currentFrame, currentRow = somatic_get_state()
print(string.format("t:%d f:%d r:%d", track, currentFrame, currentRow), 0, 0)
```



# Limitations

- Using the TIC-80 as a sound engine means a bit of lag.
- using a web app as a sophisticated music production tool has its own limitations too, like awkward keyboard shortcut support.

# motivations / history

This started as a fork of https://reverietracker.github.io/chromatic/

however, Somatic has basically nothing related to the original anymore.
Reverietracker/Chromatic uses its own custom player in order to:

- allow longer tracks (by default tic80 supports 8 tracks @ 16 frames which is not long)
- allow procedurally-synthesized instruments
- play with correct note tuning (though maybe could be hacked via pitch commands?)

I care less about the synthesized instruments, but I do care about song length.
So a custom playroutine is important still, though i will attempt to keep using
`music()` for its effect support and simplicity.

In the future, a custom playroutine is probably worth exploring, but code size
is a tradeoff.

# issues

this was made like, yesterday. it has bugs. file them @ https://github.com/thenfour/Somatic/issues

# How does it work

A TIC-80 lives in an `<iframe>`, and Somatic establishes 2-way communication with it
through a custom cart called "bridge.tic" (source of bridge is @ `/bridge/bridge.lua`).
Based on that, Somatic can write to TIC-80 memory, and tell the bridge to do things like play, stop, etc.

It's pretty reliable but not 100% perfect -- it does introduce lag, and it's harder
to do things like make realtime updates. Could be solved but introduces complexity.

# dev stuff

```

npm install
npm start
npm run typecheck


npm run build
npx webpack --mode production
npx serve


```

