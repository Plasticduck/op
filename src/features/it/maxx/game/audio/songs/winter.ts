// MW07, snow and ice. Six eighths to the bar in two lilting steps (a long and
// a short, a long and a short), written as bars of three quarters. The tune is
// a peal of bells: a chime (C, F, A, G), then one leap up a sixth that hangs in the
// air, then falling thirds.
//
// Shape: A is the tune over a careful step-and-two-taps accompaniment and ends
// on a question; A2 sets a music box running under it and comes home; B is the
// wistful turn to D minor, almost still, the bass in long notes and only the
// shaker left of the drums; C is the Maxx motif on IV and then, darker, on vi,
// with the second pulse chasing it; A3 is the tune as a duet of bells in thirds.
import { defineSong } from '../format'

export default defineSong({
  id: 'winter',
  title: 'Salt Storm',
  key: 'F major',
  tempo: 132,
  meter: 3,
  loop: true,
  // chime: a bell that keeps a little of its ring, so a long note of the tune does not die away.
  // j: sleigh bells, a shaker with more ring than the house one.
  drums: { j: { rate: [0], vol: 0.56, len: 0.05, curve: 1.2 } },
  instruments: { chime: { duty: 25, dutySeq: [12, 12, 25], vol: 0.55, a: 0.001, d: 0.5, s: 0.35, r: 0.04, gate: 0.96, curve: 1.6, vib: 0.12, vibRate: 5, vibDelay: 0.35 } },
  setup: { p1: '@chime o5 l8', p2: '@pluck o4 l8', tri: '@bass o3 l8', noise: 'l8 v15' },
  parts: {
    // Snow coming down: two falling chords.
    I: {
      chords: 'F | C7',
      p1: 'v8 o6 c <a f c <a f | o5 b- g e c4.',
      p2: 'o4 r4. r4. | o4 r g b- r g b-',
      tri: 'o3 f2. | o3 c4 r8 c4 e8',
      noise: 'r j j r j j | k j j x j j',
    },
    A: {
      chords: 'F | Dm | Bb | C7 | F/A | Bbmaj7 | Gm7 | C7',
      p1: `>c4 <f8 a4 g8 | a4 f8 >d4. | d4 <b-8 >c4 <a8 | b-4 g8 >c4. |
           c4 <f8 a4 g8 | a4 f8 >d4 c8 | <b-4 g8 a4 f8 | g4. e4 r8`,
      // A step in the bass, two taps above it.
      p2: `o4 r a >c <r >c f | o4 r a >d <r a >d | o4 r b- >d <r b- >d | o4 r b- >e <r b- >e |
           o4 r >c f <r >c f | o4 r b- >d <r b- >d | o4 r b- >d <r b- >d | o4 r b- >e <r g b-`,
      tri: `o3 f4 r8 c4 r8 | o3 d4 r8 <a4 r8 | o2 b-4 r8 >f4 r8 | o3 c4 r8 e4 r8 |
            o2 a4 r8 >c4 r8 | o2 b-4 r8 >d4 r8 | o2 g4 r8 >d4 r8 | o3 c4 r8 c4 e8`,
      noise: `[k j j x j j]7 | k j j x x16 x16 x`,
    },
    // The music box: the same tune over running broken chords, and the bass starts to rock.
    A2: {
      chords: 'F | Dm | Bb | C7 | F/A | Bbmaj7 | Gm7 C7 | F',
      p1: `>c4 <f8 a4 g8 | a4 f8 >d4. | d4 <b-8 >c4 <a8 | b-4 g8 >c4. |
           c4 <f8 a4 g8 | a4 f8 >d4 c8 | <b-4 g8 a4 e8 | f2.`,
      p2: `o4 f a >c f c <a | o4 f a >d f d <a | o4 f b- >d f d <b- | o4 e g b- >e <b- g |
           o4 f a >c f c <a | o4 f a >d f d <a | o4 g b- >d <g b- >e | o4 f a >c f c <a`,
      tri: `o3 f4 >c8 <f4 >c8 | o3 d4 a8 d4 a8 | o2 b-4 >f8 <b-4 >f8 | o3 c4 g8 c4 e8 |
            o2 a4 >c8 f4 c8 | o2 b-4 >f8 <b-4 >d8 | o2 g4 >d8 c4 g8 | o3 f4 c8 f4 r8`,
      noise: `[k j h x j h]7 | k j h x x x16 x16`,
    },
    // D minor, and everything holds its breath.
    B: {
      chords: 'Dm | A7 | Dm | Bb | Gm | F/C | Gm7 | C7',
      p1: `d4 f8 a4. | g4 e8 c+4. | d4 f8 a4 >d8 | d4. <b-4. |
           b-4 a8 g4 b-8 | a4 g8 f4 a8 | g4 f8 d4 g8 | e4. c4 r8`,
      p2: `@soft v10 o4 f2. | g2. | f2. | f2. | >d2. | c2. | <b-2. | b-4. g4.`,
      tri: `@sub o3 d2. | o2 a2. | o3 d2. | o2 b-2. | o2 g2. | o3 c2. | o2 g2. | o3 c4. c4 e8`,
      noise: `[r j j r j j]7 | r j j x j j`,
    },
    // The Maxx motif on IV, answered; then on vi, where it turns minor. The second pulse chases it up the chord.
    C: {
      chords: 'Bb | F/A | Dm | C7 | Bb | F/A | Gm7 | C7',
      p1: `d8 d16 f16 b-2 | a4 g8 f4 c8 | f8 f16 a16 >d2 | c4 <b-8 g4 e8 |
           d8 d16 f16 b-4. >d8 | c4 <a8 f4 a8 | g4 b-8 >d4 <b-8 | >c4. <g4 e8`,
      p2: `@soft o4 r4 f8 f16 b-16 >d4 | @pluck o4 r >c f <r f a | @soft o4 r4 a8 a16 >d16 f4 | @pluck o4 r b- >e <r g b- |
           @soft o4 r4 f8 f16 b-16 >d4 | @pluck o4 r >c f <r >c f | o4 r b- >d <r b- >d | o4 r b- >e <r g b-`,
      tri: `o2 b-4 r8 >f4 r8 | o2 a4 r8 >c4 r8 | o3 d4 r8 <a4 r8 | o3 c4 r8 e4 r8 |
            o2 b-4 r8 >d4 r8 | o2 a4 r8 >c4 r8 | o2 g4 r8 >d4 r8 | o3 c4 r8 c4 e8`,
      noise: `[k j j x j j]7 | k j j x x16 x16 x`,
    },
    // The tune as two bells a third apart.
    A3: {
      chords: 'F | Dm | Bb | C7 | F/A | Bbmaj7 | Gm7 | C7',
      p1: `>c4 <f8 a4 g8 | a4 f8 >d4. | d4 <b-8 >c4 <a8 | b-4 g8 >c4. |
           c4 <f8 a4 g8 | a4 f8 >d4 c8 | <b-4 g8 a4 f8 | g4. e4 r8`,
      p2: `@bell v10 o5 a4 c8 f4 e8 | f4 d8 f4. | b-4 g8 a4 f8 | g4 e8 e4. |
           a4 c8 f4 e8 | f4 d8 f4 a8 | g4 d8 f4 d8 | e4. c4 r8`,
      tri: `o3 f4 >c8 <f4 >c8 | o3 d4 a8 d4 a8 | o2 b-4 >f8 <b-4 >f8 | o3 c4 g8 c4 e8 |
            o2 a4 >c8 f4 c8 | o2 b-4 >f8 <b-4 >d8 | o2 g4 >d8 <g4 >d8 | o3 c4 g8 c4 e8`,
      noise: `[k j h x j h]7 | k j h x x16 x16 x`,
    },
  },
  intro: 'I',
  play: 'A A2 B C A3',
})
