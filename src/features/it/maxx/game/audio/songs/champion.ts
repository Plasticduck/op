// Champion of Rival Row: the Maxx motif on I and on IV, then the big
// bVI bVII I cadence and three final hits.
import { defineSong } from '../format'

export default defineSong({
  id: 'champion',
  title: 'Champion of Rival Row',
  key: 'C major',
  tempo: 140,
  loop: false,
  setup: { p1: '@lead o5 l8', p2: '@soft o5 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    A: {
      chords: 'C | F | Ab Bb | C | C',
      p1: 'e8 e16 g16 >c2 <g8 >c8 | <a8 a16 >c16 f2 c8 f8 | c4 <a-8 >c8 d4 <b-8 >d8 | e1 | c8 r8 c8 r8 c2',
      p2: 'c8 c16 e16 g2 e8 g8 | f8 f16 a16 a2 a8 a8 | a-4 e-8 a-8 b-4 f8 b-8 | >c1 | <e8 r8 e8 r8 e2',
      tri: 'c c8 c8 c e | f f8 f8 f a | a- a- b- b- | @sub >c1 | @bass c8 r8 c8 r8 @sub <c2',
      noise: 'c4 k k s4 t t | c4 k k s4 t t | [s16]16 | c1 | k r k r c2',
    },
  },
  play: 'A',
})
