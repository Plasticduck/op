// GRIMED: three sagging wahs down a diminished chord, then one long one that
// slides off the bottom and lands with a splat. The pulse opens up on every
// note (the wah) and each note droops. Chromatic on purpose.
import { defineSong } from '../format'

export default defineSong({
  id: 'grimed',
  title: 'Grimed',
  key: 'C minor',
  tempo: 120,
  loop: false,
  setup: { p1: '@wah o4 l4', p2: '@wah o4 l4 v8', tri: '@sub o3 l4', noise: 'l8' },
  // z: the splat, a burst of noise that falls from a hiss to a rumble.
  drums: { z: { rate: [6, 8, 10, 12, 13, 14], vol: 0.8, len: 0.3, curve: 1.2, thump: 12 } },
  parts: {
    A: {
      chords: 'Edim7 | N',
      p1: 'g~-1 e~-1 c+~-1 r | <b-2.~-7 r4',
      p2: 'e~-1 c+~-1 <b-~-1 r | g2.~-7 r4',
      tri: 'q4 e c+ <b- r | q8 c2.~-5 r4',
      noise: 't4 t4 t4 r4 | r2 r8 t z4',
    },
  },
  play: 'A',
})
