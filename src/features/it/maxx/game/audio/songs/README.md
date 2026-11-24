# Songs

One file per song or jingle. The file name is the id (`MusicId` or `JingleId` in `game/contract.ts`),
and adding a file is all it takes: `../library.ts` finds them with `import.meta.glob`.

**The format is documented at the top of `../format.ts`, with an annotated example.** Read that first.
`title.ts` and `sunny.ts` are full songs to copy from; `grimed.ts` and `secret.ts` show bends, custom
instruments and an echo voice.

Checking a song (nobody can hear a text file, so the script reads it back to you):

```
node scripts/maxx/audio-render.mjs --out some/folder          # everything: WAV files + report
node scripts/maxx/audio-render.mjs --only title --brief       # one song, flags only
node scripts/maxx/audio-render.mjs --only title --roll        # one song as a piano roll in text
```

It prints length, levels, the loop seam, notes per voice, how loud each voice is next to the melody
and a bar by bar harmony report against the `key` and `chords` you declared. It exits 1 if a bar
does not add up, voices differ in length, anything clips or is silent, or the loop seam clicks.
`<id>.looped.wav` is the intro plus the loop twice, so you can listen across the seam.

`node scripts/maxx/tests/audio-songs.mjs` holds what a script can judge for good: a loop's melody
only touches the notes above E6, and every loop, as played, is within 2 LU of the others. A song that
is quiet by design is lifted with `gainDb` (see Loudness in `../format.ts`), not by raising `v`.

A mistake in the text never stops the game: the song is skipped or played as far as it makes sense,
and each problem is listed with its part, voice, bar and the text around it, in the browser console
while developing and at the top of the report:

```
bonus: part A, p1, bar 6: this bar has 3.5 beats, not 4 (near "g4 a8 b8 >c4 | d2 r2")
bonus: part B, tri, bar 2: did not understand "h4" (notes are c d e f g a b); it is played as a rest (near "f4 g4 h4 a4")
```

House style, so the score feels like one work:

- Every song declares `key`, `tempo` and `chords` for each part.
- Melody in `p1`, harmony or a countermelody in `p2`, the bass in `tri`, drums in `noise`.
- The Maxx motif is scale degrees 3 3 5 8 in a gallop (eighth, two sixteenths, a held note):
  in C, `e8 e16 g16 >c2`. It opens `title.ts`; quote or answer it somewhere in each song.
- Keep the melody between C5 and E6 (`o5 c` to `o6 e`). A pulse wave above that is piercing: use it
  for one climax, not for the tune. A level song is heard for minutes, so write it lower than a jingle.
- Say a thing twice, differently. A part that comes back should change something the ear notices:
  a harmony voice, a new accompaniment figure, a higher ending (`A` and `A2` in both songs).
- The bass is its own voice. Let it move against the melody at cadences (down when the tune goes
  up), and do not let it follow the tune in octaves or fifths: the report flags that. Two eighths
  where the kick plays two eighths make the groove.
- A voice plays one note at a time and every note has stopped by its own end, which is why
  loops are seamless. A drum rings until the next drum hit.
- The triangle has no volume control on the real chip. Keep it at `v12` and shape the line
  with note lengths (`q`) instead.
- Original melodies only. Nothing that quotes an existing tune, including the famous jingles of
  the genre: play your first three notes against the ones everybody knows before you keep them.
