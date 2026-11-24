// The title theme. Its first bar is the Maxx motif (degrees 3 3 5 8 in a
// gallop) that the other songs quote.
//
// Shape: A asks (half cadence), A2 answers and climbs one step higher than A
// ever went before it comes home, B is the quiet stepwise bridge that winds
// back up to the dominant. The bass walks in quarters, doubles up with the
// kick on beat three, and moves against the tune at every cadence.
import { defineSong } from '../format'

export default defineSong({
  id: 'title',
  title: 'Super Mighty Maxx',
  key: 'C major',
  tempo: 150,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    // Two bars on the dominant: a drum roll and a run up to the downbeat.
    I: {
      chords: 'G | G7',
      p1: 'o4 g8 g16 g16 b8 >d8 g8 g16 g16 f8 d8 | <b8 >d8 f8 g8 b4 r4',
      p2: '@soft o4 d8 d16 d16 g8 b8 >d8 d16 d16 d8 <b8 | g8 b8 >d8 d8 f4 r4',
      tri: 'o2 g g g g | g a b r',
      noise: 'k s16 s16 k s k s16 s16 k s | [s16]8 s s t t',
    },
    // The hook, ending on a question (half cadence). Under the last bar the bass walks down while the tune climbs.
    A: {
      chords: 'C | C Am | F6 | G | C | Am | Dm F | G',
      p1: `e8 e16 g16 >c2 <g8 a8 | g4. e8 c4 d8 e8 | f8 f16 a16 >d2 c8 <a8 | b4. g8 d4 r4 |
           e8 e16 g16 >c2 <g8 a8 | >c4. <a8 e4 a8 >c8 | d4 c8 <a8 f4 a4 | g4 b8 >d4. r4`,
      p2: `[r e r g]2 | [r e r g]2 | [r a r >c<]2 | [r g r b]2 |
           [r e r g]2 | [r e r a]2 | [r f r a]2 | r g r b r >d <b g`,
      tri: `c e g8 g8 a | >c <b a8 a8 g | f a >c8 c8 <a | g d g8 g8 b |
            >c <g e8 e8 g | a >c <a8 a8 e | d f a f+ | g f e d`,
      noise: `c h s h k k s h | [k h s h k k s h]2 | k h s h k s16 s16 s s |
              [k h s h k k s h]3 | k s s16 s16 s t t s16 s16 s16 s16`,
    },
    // The hook again, reaching up to the high E before the answer (ii V I, the bass dropping an octave on V).
    A2: {
      chords: 'C | C Am | F6 | G | C | Am | Dm G | C',
      p1: `e8 e16 g16 >c2 <g8 a8 | g4. e8 c4 d8 e8 | f8 f16 a16 >d2 c8 <a8 | b4. g8 d4 r4 |
           e8 e16 g16 >c2 <g8 a8 | >c4. <a8 e4 a8 >c8 | e4 d8 c8 d4 <b4 | >c2. r4`,
      // The second pulse now echoes the gallop under each held note.
      p2: `@soft r4 g8 g16 >c16 e4 r4 | @stab <[r e r g]2 | @soft r4 a8 a16 >c16 f4 r4 | @stab <[r g r b]2 |
           @soft r4 g8 g16 >c16 e4 r4 | @stab <[r e r a]2 | r a r f r g r b | r e r g >c4 r4`,
      tri: `c e g8 g8 a | >c <b a8 a8 g | f a >c8 c8 <a | g d g8 g8 b |
            >c <g e8 e8 g | a >c <a8 a8 e | d a g <g | >c e g8 g8 >c`,
      noise: `c h s h k k s h | [k h s h k k s h]2 | k h s h k s16 s16 s s |
              [k h s h k k s h]3 | k h s h k s16 s16 t t`,
    },
    // The bridge: a singing line that steps down inside each chord, then climbs through D7 to the dominant.
    B: {
      chords: 'F | G | Em | Am | F6 | D7 | G | G7',
      p1: `a4. g8 f4 a4 | b4. a8 g4 b4 | g4. f8 e4 g4 | a2 r8 e8 a8 >c8 |
           d4. c8 <a4 f4 | f+4. a8 >d4 c4 | <b4 g8 b8 >d2 | d8 c8 <b8 a8 g8 f8 d8 f8`,
      p2: `@soft o5 f4. e8 c4 f4 | g4. f8 d4 g4 | e4. d8 <b4 >e4 | e2 r8 c8 e8 a8 |
           f4. a8 f4 d4 | d4. f+8 a2 | g4 d8 g8 b2 | f2 d4 <b4`,
      tri: `f >c <a >c | <g >d <b >d | <e b g b | a e a >c |
            <f a >c d | <d a f+ d | g b g d | g d <g8 g8 b4`,
      noise: `c h s h k h s o | [k h s h k h s o]6 | k s k s s16 s16 s16 s16 t t`,
    },
  },
  intro: 'I',
  play: 'A A2 B',
})
