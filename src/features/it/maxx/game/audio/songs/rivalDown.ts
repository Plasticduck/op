// A rival is beaten: a run up the D major chord and a V7 I with a flourish.
import { defineSong } from '../format'

export default defineSong({
  id: 'rivalDown',
  title: 'Rival Down',
  key: 'D major',
  tempo: 160,
  loop: false,
  setup: { p1: '@lead o4 l16', p2: '@soft o4 l16', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    A: {
      chords: 'D | A7 D',
      p1: 'd f+ a >d <f+ a >d f+ a8 f+8 a4 | >c+8 <a8 >e8 c+8 d2',
      p2: 'r8 d f+ a d f+ a >f+8 d8 f+4 | a8 e8 >c+8 <a8 f+2',
      tri: 'd d d d | a a @sub d2',
      noise: 's16 s16 s16 s16 s16 s16 s16 s16 k s k4 | k s k s c2',
    },
  },
  play: 'A',
})
