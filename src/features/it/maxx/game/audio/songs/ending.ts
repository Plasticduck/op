// The ending: the title theme again, slower and warmer, under the parade of
// clean cars and the credits.
//
// The tune and the bass are the title's own. What is new is the second pulse:
// a countermelody that moves while the tune holds its long notes (it climbs
// under the first high C, falls under the second) and fills the bars where the
// tune rests. B, the title's bridge, rides on broken chords instead; A2 has the
// high E. The coda is the Maxx motif broadened on F, the one note above E6 in
// the song, and then a slow walk down the scale over F, F minor, C over G, G7
// to C: a final cadence, a bar of quiet, and the parade comes round again.
import { defineSong } from '../format'

export default defineSong({
  id: 'ending',
  title: 'Spotless Forever',
  key: 'C major',
  tempo: 110,
  loop: true,
  quotes: ['title'],
  setup: { p1: '@lead o5 l8', p2: '@soft o5 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    I: {
      chords: 'Fmaj7 | G7',
      p1: 'r1 | r1',
      p2: '@pluck o4 [f a >c e<]2 | [g b >d f<]2',
      tri: 'o3 f2 c2 | o2 g2 b2',
      noise: '[n]8 | [n]4 s16 s16 s16 s16 t t',
    },
    A: {
      chords: 'C | C Am | F6 | G | C | Am | Dm F | G',
      p1: `e8 e16 g16 >c2 <g8 a8 | g4. e8 c4 d8 e8 | f8 f16 a16 >d2 c8 <a8 | b4. g8 d4 r4 |
           e8 e16 g16 >c2 <g8 a8 | >c4. <a8 e4 a8 >c8 | d4 c8 <a8 f4 a4 | g4 b8 >d4. r4`,
      p2: `o5 c4 d8 e8 g4 e4 | o5 e4 d8 <b8 a4 b8 >c8 | o4 a4 >c4 f2 | o5 g4. d8 <b4 >d8 f8 |
           o5 c4 g8 f8 e4 c4 | o4 a4 g8 a8 >c4 e4 | o5 f4 e8 c8 <a4 >c4 | o5 d4 g8 a8 g4 d8 <b8`,
      tri: `c e g8 g8 a | >c <b a8 a8 g | f a >c8 c8 <a | g d g8 g8 b |
            >c <g e8 e8 g | a >c <a8 a8 e | d f a f+ | g f e d`,
      noise: `[k n x n k k x n]7 | k n x n k x16 x16 x t`,
    },
    // The bridge on broken chords.
    B: {
      chords: 'F | G | Em | Am | F6 | D7 | G | G7',
      p1: `a4. g8 f4 a4 | b4. a8 g4 b4 | g4. f8 e4 g4 | a2 r8 e8 a8 >c8 |
           d4. c8 <a4 f4 | f+4. a8 >d4 c4 | <b4 g8 b8 >d2 | d8 c8 <b8 a8 g8 f8 d8 f8`,
      p2: `@pluck o4 [f a >c <a]2 | [g b >d <b]2 | [e g b g]2 | [e a >c <a]2 |
           [f a >d <a]2 | [f+ a >c <a]2 | [g b >d <b]2 | [f g b >d<]2`,
      tri: `f >c <a >c | <g >d <b >d | <e b g b | a e a >c |
            <f a >c d | <d a f+ d | g b g d | g d <g8 g8 b4`,
      noise: `c n x n k n x x | [k n x n k n x x]6 | k s k s s16 s16 s16 s16 t t`,
    },
    // The tune with its high E, the countermelody under it in sixths at the close, over a parade drum.
    A2: {
      chords: 'C | C Am | F6 | G | C | Am | Dm G7 | C',
      p1: `e8 e16 g16 >c2 <g8 a8 | g4. e8 c4 d8 e8 | f8 f16 a16 >d2 c8 <a8 | b4. g8 d4 r4 |
           e8 e16 g16 >c2 <g8 a8 | >c4. <a8 e4 a8 >c8 | e4 d8 c8 d4 <b4 | >c2. r4`,
      p2: `o5 c4 d8 e8 g4 e4 | o5 e4 d8 <b8 a4 b8 >c8 | o4 a4 >c4 f2 | o5 g4. d8 <b4 >d8 f8 |
           o5 c4 g8 f8 e4 c4 | o4 a4 g8 a8 >c4 e4 | o5 a4 f8 e8 f4 d4 | o5 e2. r4`,
      tri: `c e g8 g8 a | >c <b a8 a8 g | f a >c8 c8 <a | g d g8 g8 b |
            >c <g e8 e8 g | a >c <a8 a8 e | d a g <g | >c e g8 g8 >c`,
      noise: `c x s x k s16 s16 s x | [k x s x k s16 s16 s x]2 | k x s x k s16 s16 s s |
              [k x s x k s16 s16 s x]3 | k x s x k s16 s16 t t`,
    },
    // The coda: IV, iv, I over the fifth, V7, I. Then one quiet bar before the loop.
    E: {
      chords: 'F | Fm | C/G G7 | C | C',
      p1: `o5 a4 a8 >c8 f2 | <a-2 g4 f4 | e2 d2 | c1 | r1`,
      p2: `o5 c4 c8 f8 a2 | c2 c4 <a-4 | o4 g2 f2 | e1 | @pluck v9 o4 [c e g >c<]2`,
      tri: `o3 f2 a4 >c4 | <f2 c4 <a-4 | o2 g2 g4 b4 | @sub o3 c1 | @bass o3 c2 <g2`,
      noise: `c4 k k s4 k k | k4 h h s4 h h | k4 h h [s16]8 | c2. r4 | r2 n n n n`,
    },
  },
  intro: 'I',
  play: 'A B A2 E',
})
