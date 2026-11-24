// The world map: a lazy West Texas shuffle. Every beat is a long and a short
// (written 6 12, a triplet quarter and a triplet eighth), the bass plays a
// two-step (root, fifth, a pickup before each), and the long notes of the
// tune are bent up into from a semitone below, the steel-guitar twang.
//
// A is the tune: down the pentatonic and back up, "la-sol mi, sol-la do".
// B opens with the Maxx motif as a swung triplet into a held C, then says it
// again reaching only the flat seventh, which tips the harmony over to F. From
// there the second pulse holds a slow chromatic line (F, F sharp, G ... F
// sharp, F, E) under the tune, the way a steel guitar would.
import { defineSong } from '../format'

export default defineSong({
  id: 'map',
  title: 'West Texas Two-Step',
  key: 'C major',
  tempo: 120,
  loop: true,
  setup: { p1: '@pick o5 l4', p2: '@stab o4 l4', tri: '@bass o3 l4', noise: 'l12' },
  instruments: {
    // A picked string: a thin click that rounds out and sags a little.
    pick: { duty: 25, dutySeq: [12, 25], vol: 0.62, a: 0.002, d: 0.22, s: 0.62, r: 0.03, gate: 0.92, vib: 0.2, vibRate: 5.5, vibDelay: 0.25 },
    // The same string bent up into the note.
    twang: { duty: 25, dutySeq: [12, 25], vol: 0.62, a: 0.002, d: 0.22, s: 0.62, r: 0.03, gate: 0.92, vib: 0.25, vibRate: 5.5, vibDelay: 0.25, scoop: -1, scoopTime: 0.075 },
  },
  drums: {
    // b: a brushed snare, softer and shorter than s. u: the lower half of a clip-clop (x is the upper).
    b: { rate: [4, 6, 7], vol: 0.36, len: 0.1, curve: 1.4 },
    u: { rate: [7], short: true, vol: 0.3, len: 0.04, curve: 1.4 },
  },
  parts: {
    A: {
      chords: 'C6 | C6 | F | C | C6 | Am | D7 | G7',
      p1: `a6 g12 @twang e4 @pick g6 a12 >c4 | d6 c12^4 <a4 g4 | a6 >c12 d4 c6 <a12 f4 | g6 a12 g4 @twang e2 |
           @pick a6 g12 @twang e4 @pick g6 a12 >c4 | @twang e6 @pick d12^4 c4 <a4 | >d6 c12 <a4 f+6 a12 >c4 | <b6 @twang >d12^2 r4`,
      p2: `[r4 g6 e12]2 | [r4 g6 e12]2 | [r4 a6 f12]2 | [r4 g6 e12]2 |
           [r4 g6 e12]2 | [r4 a6 e12]2 | [r4 a6 f+12]2 | r4 b6 g12 r4 f6 d12`,
      tri: `c4 r6 c12 <g4 r6 g12 | >c4 r4 c6 d12 e4 | f4 r6 f12 c4 r6 c12 | c4 r6 c12 <g4 a6 b12 |
            >c4 r6 c12 <g4 r6 g12 | a4 r6 a12 >e4 r6 e12 | d4 r6 d12 <a4 r6 a12 | g4 b4 >d4 <g4`,
      noise: `k6 h b6 k k6 h b6 k | k6 h b6 h k6 k b6 h | [k6 h b6 k k6 h b6 k]2 |
              [k6 h b6 k k6 h b6 k]3 | k6 h b6 h b b b t6 t`,
    },
    B: {
      chords: 'C | C7 | F | F#dim7 | C/G | A7 | D7 G7 | C G7',
      p1: `e12 e12 g12 >c2 r4 | <e12 e12 g12 @twang b-2 r4 | @pick a6 >c12 d4 c6 <a12 f4 | a6 >c12 e-4 c6 <a12 f+4 |
           g6 a12 >c4 @twang e2 | @pick e6 d12 c+4 <a2 | >d6 c12 <a4 b6 >d12 <b4 | >c2 r2`,
      p2: `@soft r2 g12 a12 >c12 e4 | r2 <g12 b-12 >c12 e4 | <f2 a2 | f+2 a2 |
           g2 >c2 | <g2 e2 | f+2 f2 | e2 >d6 <b12 g4`,
      tri: `c4 e4 g4 a4 | >c4 <b-4 g4 e4 | f4 a4 >c4 <a4 | f+4 a4 >c4 <a4 |
            g4 e4 c4 e4 | <a4 >e4 <a4 >c+4 | d4 f+4 g4 f4 | e4 c4 <g4 b4`,
      noise: `[x6 u x6 u x6 u x6 u]4 |
              [k6 h b6 h k6 h b6 h]3 | k6 h b6 h b b b t t m`,
    },
  },
  play: 'A B',
})
