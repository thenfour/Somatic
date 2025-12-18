https://github.com/thenfour/chromatic/issues

fork of https://reverietracker.github.io/chromatic/

however, this is basically nothing related to the original anymore.
Reverietracker/Chromatic uses its own custom player in order to:

- allow longer tracks (by default tic80 supports 8 tracks @ 16 frames which is not long)
- allow procedurally-synthesized instruments
- play with correct note tuning (though maybe could be hacked via pitch commands?)

I don't care about the synthesized instruments, but I do care about song length.
So a custom playroutine is important still, though i will attempt to keep using
`music()` for its effect support and simplicity.

```
dev stuff:

npm install
npm start
npm run typecheck

build stuff:

npm run build
npx webpack --mode production



```

