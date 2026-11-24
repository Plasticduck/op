// Token rooms: sixteen seconds of glee. An oom-pah bass under open hats on
// every off-beat, and a tune that bounces up the chord, the same bounce a
// fourth higher, then runs up to the one high F.
//
// B runs up a staircase of gallops on one chord (A A C, C C F, F F A: the last
// steps are the Maxx motif itself), giggles round the top in sixteenths over
// sparkling broken chords, and tumbles back down to the start.
import { defineSong } from '../format'

export default defineSong({
  id: 'bonus',
  title: 'Token Room',
  key: 'F major',
  tempo: 176,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    A: {
      chords: 'F | Bb | C7 | F | F | Bb | Gm7 C7 | F',
      p1: `c f a f >c4 <a4 | d f b- f >d4 <b-4 | e g >c <g b- >c d e | f4 c <a f4 r4 |
           c f a f >c4 <a4 | d f b- f >d4 <b-4 | a g f e d e f g | a4 f4 c4 r4`,
      p2: `[r a r >c<]2 | [r b- r >d<]2 | [r g r b-]2 | [r a r >c<]2 |
           [r a r >c<]2 | [r b- r >d<]2 | r b- r >d< r g r b- | [r a r >c<]2`,
      tri: `o3 f c f c | <b- >f <b- >f | c g c <g | >f a >c <a |
            f c f c | <b- >f <b- >f | g d c g | f c f c`,
      noise: `c o s o k o s o | k o s o k o s s16 s16 | k o s o k o s o | k s16 s16 s s16 s16 k k s s16 s16 |
              c o s o k o s o | k o s o k o s s16 s16 | k o s o k k s o | k s16 s16 s s16 s16 k k s s16 s16`,
    },
    B: {
      chords: 'F | Bb | Gm7 C7 | C7',
      p1: `o4 a8 a16 >c16 c8 c16 f16 f8 f16 a16 >c4 | d16 c16 <b-16 >c16 d8 <b-8 f8 b-8 >d4 |
           c16 <b-16 a16 b-16 >c8 <a8 g8 e8 g8 >c8 | <b-8 a8 g8 f8 e8 d8 e8 g8`,
      p2: `@pluck l16 r2 f a >c <a f a >c <a | [f b- >d <b-]4 | [g b- >d <b-]2 [e g b- g]2 | [g b- >c <b-]4`,
      tri: `o3 f a >c <a | <b- >f d f | g b- c e | c g e b-`,
      noise: `c o s o k o s s16 s16 | k o s o k o s s16 s16 | k o s o k s16 s16 s s16 s16 |
              k s16 s16 k s16 s16 s16 s16 s16 s16 t m`,
    },
  },
  play: 'A B',
})
