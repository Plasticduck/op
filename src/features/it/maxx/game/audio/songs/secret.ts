// A secret found: augmented chords climbing a whole-tone scale, each note
// chased by its own echo in the second pulse, and no resolution at the top.
import { defineSong } from '../format'

export default defineSong({
  id: 'secret',
  title: 'The Hidden Road',
  key: 'C wholetone',
  tempo: 116,
  loop: false,
  setup: { p1: '@bell o5 l16', p2: '@bell o5 l16 v6', tri: '@sub o3 l1', noise: 'l4' },
  // The last note hangs: a slower bell with a shimmer.
  instruments: { ring: { duty: 25, vol: 0.5, a: 0.001, d: 1.5, s: 0, curve: 1.5, gate: 1, vib: 0.25, vibRate: 6, vibDelay: 0.25 } },
  parts: {
    A: {
      chords: 'Caug | Caug',
      p1: 'c e g+ >c <d f+ a+ >d <e g+ >c e <f+ a+ >d f+ | @ring g+2. r4',
      p2: 'r16 c e g+ >c <d f+ a+ >d <e g+ >c e <f+ a+ >d | f+16 @ring e2 r8. r4',
      tri: 'c | c2. r4',
      noise: 'v5 n n n n | v7 c2. r4',
    },
  },
  play: 'A',
})
