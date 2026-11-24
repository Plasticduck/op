// MW04, Mud Season: rain, mud and Mudslinger at the end. Twelve to the bar:
// the bass rolls in triplets, down the chord and back up like a wave, and the
// rain ticks along with it. The tune climbs the chord in a triplet and hangs on
// the top note, the same figure a step lower, then sighs down a half step onto
// the dominant: easy to whistle, never settled.
//
// Shape: A is the tune over a wailing wind and ends on the dominant; A2 is the
// tune as a duet in thirds and comes home; B breaks into straight time, the
// Maxx motif in D minor, the same gallop upside down, then the title's own
// motif in C peeking through the clouds, before E7 and a falling A7 run drag
// it back; A3 is the
// tune doubled an octave down, and its answer touches the high F once.
import { defineSong } from '../format'

export default defineSong({
  id: 'storm',
  title: 'Mud Season',
  key: 'D minor',
  tempo: 132,
  loop: true,
  setup: { p1: '@lead o5 l12', p2: '@wail o4 l12', tri: '@bass o3 l12', noise: 'l12' },
  instruments: {
    // The wind: a hollow pulse that swells in and wavers.
    wail: { duty: 50, vol: 0.34, a: 0.15, d: 0, s: 1, r: 0.1, gate: 1, vib: 0.3, vibRate: 4.5, vibDelay: 0.1 },
  },
  parts: {
    // Thunder, then the rain and the rolling bass, the wind rising to the dominant.
    I: {
      chords: 'Dm | A7',
      p1: 'r1 | r1',
      p2: 'a1 | g2 c+2',
      tri: `o4 d <a f d f a >d <a f d f a | o3 a e c+ <a >c+ e g e c+ <a >c+ e`,
      noise: 'c4 n n n n n n n n n | t n n t n n m m m t t t',
    },
    A: {
      chords: 'Dm | Bb | C | A7 | Dm | Gm | Bb | A7',
      p1: `d f a >d4 ^6 c <a4 | b-4 ^6 a f2 | c e g >c4 ^6 <b- g4 | a4 ^6 g e2 |
           d f a >d2 ^6 c | <b-4 ^6 a g4 ^6 a | f4 ^6 g a4 ^6 b- | a2. r4`,
      p2: `a1 | b-1 | g1 | a2 g2 | a1 | b-1 | f1 | e2 c+2`,
      tri: `o4 d <a f d f a >d <a f d f a | o3 b- f d <b- >d f b- f d <b- >d f |
            o4 c <g e c e g >c <g e c e g | o3 a e c+ <a >c+ e g e c+ <a >c+ e |
            o4 d <a f d f a >d <a f d f a | o3 g d <b- g b- >d g d <b- g b- >d |
            o3 b- f d <b- >d f b- f d <b- >d f | o3 a e c+ <a >c+ e g e c+ <a >c+ e`,
      noise: `c n n s n n k n n s n n | k n n s n k k n n s n n | k n n s n n k n n s n n | k n n s n n m m m t t t |
              k n n s n n k n n s n n | k n n s n k k n n s n n | k n n s n n k n n s n n | k n s k n s m m m t t t`,
    },
    // The tune again with the second pulse a third under it, and home this time.
    A2: {
      chords: 'Dm | Bb | C | A7 | Dm | Gm | Gm A7 | Dm',
      p1: `d f a >d4 ^6 c <a4 | b-4 ^6 a f2 | c e g >c4 ^6 <b- g4 | a4 ^6 g e2 |
           d f a >d2 ^6 c | <b-4 ^6 a g4 ^6 a | b-6 a g6 f e4 c+4 | d2. r4`,
      p2: `@soft o4 a >d f a4 ^6 a f4 | d4 ^6 c <b-2 | g >c e g4 ^6 g e4 | e4 ^6 e c+2 |
           <a >d f a2 ^6 a | g4 ^6 f d4 ^6 f | g6 f e6 d c+4 <a4 | f2. r4`,
      tri: `o4 d <a f d f a >d <a f d f a | o3 b- f d <b- >d f b- f d <b- >d f |
            o4 c <g e c e g >c <g e c e g | o3 a e c+ <a >c+ e g e c+ <a >c+ e |
            o4 d <a f d f a >d <a f d f a | o3 g d <b- g b- >d g d <b- g b- >d |
            o3 g d <b- g b- >d a e c+ <a >e c+ | o3 d4 a4 d4 r4`,
      noise: `c h h s h h k h h s h h | k h h s h k k h h s h h | k h h s h h k h h s h h | k h h s h h m m m t t t |
              k h h s h h k h h s h h | k h h s h k k h h s h h | k h h s h h k h k s s s | k4 s4 k4 m t t`,
    },
    // Straight time: the Maxx motif in D minor, then upside down falling from the high D, then the
    // title's own motif in C; E7 and a falling A7 run (its flat ninth on a weak beat) bring the storm back.
    B: {
      chords: 'Dm | Bb | C | F | Gm | Dm | E7 | A7',
      p1: `l8 f f16 a16 >d2 c <a | >d d16 <b-16 f2 g a | e e16 g16 >c2 <b- g | a4. g f2 |
           g4 b-4 >d4. c | <a4. g f4 d4 | g+4. a b4 >d4 | c+4 <b- a g e c+ e`,
      p2: `@stab l8 [f a]4 | [f b-]4 | [e g]4 | [f a]4 | [g b-]4 | [f a]4 | [b >d<]4 | [g >c+<]4`,
      tri: `l8 o3 d >d <d >d <d >d <d >d | o2 b- >b- <b- >b- <b- >b- <b- >b- | o3 c >c <c >c <c >c <c >c | o3 f >c <f >c <f >c <a >c |
            o2 g >g <g >g <g >g <g >g | o3 d >d <d >d <d >d <d >d | o3 e b e b g+ b d b | o2 a4 >c+4 e4 g4`,
      noise: `l8 c h s h k k16 k16 s h | [k h s h k k16 k16 s h]2 | k h s h k s s16 s16 t |
              [k h s h k k16 k16 s h]3 | k s16 s16 k s16 s16 s16 s16 s16 s16 t t`,
    },
    // The tune doubled an octave down, and the answer reaches up to the high F.
    A3: {
      chords: 'Dm | Bb | C | A7 | Dm | Bb | Gm | A7',
      p1: `d f a >d4 ^6 c <a4 | b-4 ^6 a f2 | c e g >c4 ^6 <b- g4 | a4 ^6 g e2 |
           d f a >d4 ^6 e f4 | d4 ^6 c <b-4 ^6 a | g4 ^6 f g4 ^6 b- | a2. r4`,
      p2: `@soft o4 d f a >d4 ^6 c <a4 | b-4 ^6 a f2 | c e g >c4 ^6 <b- g4 | a4 ^6 g e2 |
           d f a >d4 ^6 e f4 | d4 ^6 c <b-4 ^6 a | g4 ^6 f g4 ^6 b- | a2. r4`,
      tri: `o4 d <a f d f a >d <a f d f a | o3 b- f d <b- >d f b- f d <b- >d f |
            o4 c <g e c e g >c <g e c e g | o3 a e c+ <a >c+ e g e c+ <a >c+ e |
            o4 d <a f d f a >d <a f d f a | o3 b- f d <b- >d f b- f d <b- >d f |
            o3 g d <b- g b- >d g d <b- g b- >d | o3 a e c+ <a >c+ e g e c+ <a >c+ e`,
      noise: `c h h s h h k h h s h h | k h h s h k k h h s h h | k h h s h h k h h s h h | k h h s h h m m m t t t |
              c h h s h h k h h s h h | k h h s h k k h h s h h | k h h s h h k h h s h h | k s s k s s m m m t t t`,
    },
  },
  intro: 'I',
  play: 'A A2 B A3',
})
