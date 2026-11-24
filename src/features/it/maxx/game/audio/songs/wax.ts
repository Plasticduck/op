// Mighty Wax: ten seconds of invincibility, one loop per power-up (8 bars at
// 192 is exactly the 600 ticks a wax lasts, so the run up to the dominant ends
// as the level song comes back). The Maxx motif itself, then its repeated-note
// shape fired off on A minor, F and G, over a bass that runs up and down the
// scale in eighths and bell-like broken chords in sixteenths. The second half
// stutters up the scale three notes at a time to the high E, back down, and
// spins round the dominant into the top again.
import { defineSong } from '../format'

export default defineSong({
  id: 'wax',
  title: 'Mighty Wax',
  key: 'C major',
  tempo: 192,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@bell o4 l16 v9', tri: '@bass o3 l8', noise: 'l16' },
  parts: {
    A: {
      chords: 'C | Am | F | G',
      p1: `e e16 g16 >c4 <g >c e c | <c c16 e16 a4 e a >c <a |
           c c16 f16 a4 f a >c <a | d d16 g16 b4 >d16 c16 <b16 a16 g f`,
      p2: '[c e g >c<]4 | [c e a >c<]4 | [c f a >c<]4 | [d g >d <g]4',
      tri: `o3 c d e g >c <g e d | o2 a >c e g a g e d |
            o3 f g a >c <a g f e | o2 g a b >d g d <b a`,
      noise: `c h h h s h h k k h h h s h s h | [k h h h s h h k k h h h s h s h]2 |
              k h h h s h h k k h k s s s s s`,
    },
    // Up the scale in stutters, down again, and round the dominant.
    B: {
      chords: 'Cmaj7 | Am | F G | G7',
      p1: `g16 g16 g a16 a16 a b16 b16 b >c16 c16 c | e16 e16 e d16 d16 d c16 c16 c <b16 b16 b |
           a >c <a f g b >d <b | [g16 f16 d16 <b16 >]3 f d`,
      p2: '[c e g >c<]4 | [c e a >c<]4 | [c f a >c<]2 [d g b >d<]2 | [d f g b]4',
      tri: `o3 c d e g >c <g e d | o2 a >c e a e c d e |
            o3 f a >c <a o2 g >d <b >d | o2 g b >d f g f d <b`,
      noise: `c h h h s h h k k h h h s h s h | [k h h h s h h k k h h h s h s h]2 |
              s s s s s s s s s8 s8 t8 t8`,
    },
  },
  play: 'A B',
})
