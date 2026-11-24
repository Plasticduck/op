// Level clear: the Maxx motif, then a quick IV V I.
import { defineSong } from '../format'

export default defineSong({
  id: 'clear',
  title: 'Spotless',
  key: 'C major',
  tempo: 160,
  loop: false,
  setup: { p1: '@lead o5 l8', p2: '@soft o5 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    A: {
      chords: 'C | F G | C',
      p1: 'e8 e16 g16 >c4. <g8 >c8 e8 | f8 f16 f16 e8 c8 d4. <b8 | >c2. r4',
      p2: 'c8 c16 e16 g4. e8 g8 >c8 | <a8 a16 a16 g8 e8 b4. g8 | e2. r4',
      tri: 'c c e g | f a g g | @sub c2. r4',
      noise: 'c4 k k s4 s s | k k16 k16 s k s16 s16 s16 s16 s s | c2. r4',
    },
  },
  play: 'A',
})
