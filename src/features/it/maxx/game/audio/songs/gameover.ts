// Game over: the Maxx motif setting out and falling short. It reaches for the
// top note and only gets to the sixth, sighs back, tries again a step up over
// a minor chord, and comes gently home. Sad, but not for long.
import { defineSong } from '../format'

export default defineSong({
  id: 'gameover',
  title: 'Out of Lives',
  key: 'C major',
  tempo: 108,
  loop: false,
  setup: { p1: '@lead o5 l8', p2: '@soft o5 l8', tri: '@sub o3 l2', noise: 'l4' },
  parts: {
    A: {
      chords: 'C Am | Fm Dm7b5 | G7 C',
      p1: 'e8 e16 g16 a4. g8 e4 | f8 f16 a-16 g4. f8 c4 | d4 <b4 >c2',
      p2: 'c8 c16 e16 e4. e8 c4 | <a-8 a-16 >c16 c4. c8 <a-4 | f4 d4 e2',
      tri: 'c <a | >f d | <g >c',
      noise: 'v8 k r r2 | k r r2 | k r v6 c2',
    },
  },
  play: 'A',
})
