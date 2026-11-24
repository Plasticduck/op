// A rival appears: the gallop of the Maxx motif answered in B minor, stopping
// on the dominant so the 'rival' song can resolve it.
import { defineSong } from '../format'

export default defineSong({
  id: 'versus',
  title: 'A Rival Appears',
  key: 'B minor',
  tempo: 150,
  loop: false,
  setup: { p1: '@bright o4 l8', p2: '@lead o3 l8 v10', tri: '@bass o2 l4', noise: 'l8' },
  parts: {
    A: {
      chords: 'Bm | G F#',
      p1: 'b8 b16 b16 >d8 <b8 >f+4 e8 d8 | g8 g16 g16 b8 g8 a+2',
      p2: 'b8 b16 b16 >d8 <b8 >f+4 e8 d8 | d8 d16 d16 g8 d8 f+2',
      tri: 'b b b b | >g g f+2',
      noise: 'k k16 k16 s k k s s16 s16 s16 s16 | k k16 k16 s k c2',
    },
  },
  play: 'A',
})
