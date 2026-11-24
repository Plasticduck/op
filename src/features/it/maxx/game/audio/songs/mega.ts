// MW08, the Mega Tunnel at night: the title theme turned to C minor, and won
// back to C major by the end of every loop.
//
// Shape: A opens with the Maxx motif in the minor (E flat, E flat, G, C) and
// drives on over a bass in three, three and two; A2 is the same tune in thirds;
// B is the machinery, a broken-chord figure handed down a circle of fifths; C is
// the long climb in half notes over A flat and B flat, the way every hero in a
// minor key gets home; D is home: the title tune itself in C major with the
// lead voice changed from the thin pulse to the full one. T is a victory tag
// that stays major to the last bar, where the dominant lets the minor back in.
import { defineSong } from '../format'

export default defineSong({
  id: 'mega',
  title: 'The Mega Tunnel',
  key: 'C minor',
  tempo: 160,
  loop: true,
  quotes: ['title'],
  setup: { p1: '@bright o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l8', noise: 'l8' },
  parts: {
    I: {
      chords: 'Cm | G',
      p1: 'r1 | r1',
      p2: 'r1 | o4 r g r b r >d <r b',
      tri: 'o3 c c >c <c c >c <c c | o2 g g >g <g g >g <g b',
      noise: 'k4 k4 k4 k k | k k k k s16 s16 s16 s16 t t',
    },
    A: {
      chords: 'Cm | Cm | Ab | Bb | Cm | Cm | Ab | G',
      p1: `e-8 e-16 g16 >c2 <g8 b-8 | >c4. <b-8 g4 e-8 g8 | a-8 a-16 >c16 e-2 d8 c8 | d4. <b-8 f4 r4 |
           e-8 e-16 g16 >c2 <g8 b-8 | >c4. d8 e-4 d8 c8 | <a-4 >c8 e-4. d8 c8 | d4 <b4 g2`,
      p2: `[r e- r g]2 | [r e- r g]2 | [r e- r a-]2 | [r d r f]2 |
           [r e- r g]2 | [r e- r g]2 | [r e- r a-]2 | r d r g r b r g`,
      tri: `o3 c c >c <c c >c <c c | o3 c c >c <c c >c <c <b- | o2 a- a- >a- <a- a- >a- <a- a- | o2 b- b- >b- <b- b- >b- <b- b |
            o3 c c >c <c c >c <c c | o3 c c >c <c c >c <c <b- | o2 a- a- >a- <a- a- >a- <a- a- | o2 g g >g <g g >g <g b`,
      // The kit follows the bass in three, three and two: a kick starts each group, a snare ends it.
      noise: `c h s k h s k s | [k h s k h s k s]2 | k h s k h s s16 s16 s |
              [k h s k h s k s]3 | k h s k h s16 s16 t t16 t16`,
    },
    // The tune again with the second pulse a third or a sixth below, marching up to the dominant.
    A2: {
      chords: 'Cm | Cm | Ab | Bb | Cm | Cm | Ab Bb | G',
      p1: `e-8 e-16 g16 >c2 <g8 b-8 | >c4. <b-8 g4 e-8 g8 | a-8 a-16 >c16 e-2 d8 c8 | d4. <b-8 f4 r4 |
           e-8 e-16 g16 >c2 <g8 b-8 | >c4. d8 e-4 d8 c8 | <a-4 >c4 <b-4 >d4 | <g8 b8 >d8 <b8 >d2`,
      p2: `@soft v11 o5 c8 c16 e-16 g2 e-8 g8 | g4. g8 e-4 c8 e-8 | e-8 e-16 a-16 >c2 <b-8 a-8 | b-4. f8 d4 r4 |
           c8 c16 e-16 g2 e-8 g8 | g4. b-8 >c4 <b-8 g8 | e-4 a-4 f4 b-4 | d8 g8 b8 g8 b2`,
      tri: `o3 c c >c <c c >c <c c | o3 c c >c <c c >c <c <b- | o2 a- a- >a- <a- a- >a- <a- a- | o2 b- b- >b- <b- b- >b- <b- b |
            o3 c c >c <c c >c <c c | o3 c c >c <c c >c <c <b- | o2 a- a- >a- <a- b- b- >b- <b- | o2 g g >g <g g >g <g g`,
      noise: `c h s k h16 h16 s k s | [k h s k h16 h16 s k s]2 | k h s k h16 h16 s s16 s16 s |
              [k h s k h16 h16 s k s]2 | k4 s4 k4 s s16 s16 | k s k s s16 s16 s16 s16 t t`,
    },
    // The machinery: one figure, handed down the circle of fifths, the bass popping to the fifth.
    B: {
      chords: 'Fm | Bb | Eb | Ab | Fm | Dm7b5 | G | G7',
      p1: `>c8 <a-8 f8 a-8 >c4. <a-8 | >d8 <b-8 f8 b-8 >d4. <b-8 | b-8 g8 e-8 g8 b-4. g8 | >c8 <a-8 e-8 a-8 >c4. <a-8 |
           a-8 f8 c8 f8 a-4. f8 | a-8 f8 d8 f8 a-4. >d8 | d4. <b8 g4 b4 | g8 a8 b8 >c8 d8 e-8 d8 <b8`,
      p2: `[r a- r >c<]2 | [r b- r >d<]2 | [r g r b-]2 | [r a- r >c<]2 |
           [r a- r >c<]2 | [r f r a-]2 | [r g r b]2 | r g r >d <r b r >d`,
      tri: `o3 f f >c <f f >c <f f | o2 b- b- >f <b- b- >f <b- b- | o3 e- e- b- e- e- b- e- e- | o2 a- a- >e- <a- a- >e- <a- a- |
            o3 f f >c <f f >c <f f | o3 d d a- d d a- d d | o2 g g >d <g g >d <g g | o2 g g >d <g g g b b`,
      noise: `c x s k x s k s | [k x s k x s k s]2 | k x s k x s t t | [k x s k x s k s]3 | k s k s s16 s16 s16 s16 t16 t16 t16 t16`,
    },
    // The climb. Each bar starts a step higher; the bass waits, then pushes.
    C: {
      chords: 'Ab | Bb | Cm | G | Ab | Ab | Bb | Bb',
      p1: `c2 e-4 a-4 | d2 f4 b-4 | e-2 g4 >c4 | <b2. g4 | >c2 <a-4 >c4 | e-2. c4 | d2 <b-4 >d4 | ^1`,
      p2: `@pluck o4 l16 [e- a- >c <a-]4 | [f b- >d <b-]4 | [e- g >c <g]4 | [d g b g]4 |
           [e- a- >c <a-]4 | [a- >c e- c<]4 | [f b- >d <b-]4 | [b- >d f d<]4`,
      tri: `o2 a-2. a-8 a-8 | b-2. b-8 b-8 | >c2. c8 c8 | <g2. g8 b8 |
            o2 [a- a- >a- <a-]2 | [a- a- >a- <a-]2 | [b- b- >b- <b-]2 | [b- b- >b- <b-]2`,
      noise: `c4 h h s4 k k | [k4 h h s4 k k]3 | [k k s h k k s h]3 | [s16]12 [t16]4`,
    },
    // Home. The title tune in C major, harmonised, over the same driving bass.
    D: {
      chords: 'C | C Am | F6 | G | C | Am | Fmaj7 G | C',
      p1: `@lead e8 e16 g16 >c2 <g8 a8 | g4. e8 c4 d8 e8 | f8 f16 a16 >d2 c8 <a8 | b4. g8 d4 r4 |
           e8 e16 g16 >c2 <g8 a8 | >c4. <a8 e4 a8 >c8 | e4 d8 c8 d4 <b4 | >c2. r4`,
      p2: `@soft v11 o5 c8 c16 e16 g2 e8 f8 | e4. c8 <a4 b8 >c8 | d8 d16 f16 a2 a8 f8 | g4. d8 <b4 r4 |
           >c8 c16 e16 g2 e8 f8 | a4. e8 c4 e8 a8 | >c4 <b8 a8 b4 g4 | e2. r4`,
      tri: `o3 c c >c <c c >c <c c | o3 c c >c <c <a a >a <a | o3 f f >c <f f >c <f f | o2 g g >g <g g >g <g g |
            o3 c c >c <c c >c <c c | o2 a a >a <a a >a <a a | o3 f f >c <f <g g >g <g | o3 c c >c <c c >c <c c`,
      noise: `c h s k h s k s | [k h s k h s k s]2 | k h s k h s16 s16 s s | c h s k h s k s | [k h s k h s k s]2 | k s s16 s16 s t t c4`,
    },
    // The victory tag: a flat-six flat-seven one cadence in C major, held. Only the second pulse's
    // E flat in the last bar hints at the minor that the loop goes back into.
    T: {
      chords: 'C | Ab Bb | C | G7',
      p1: `@lead g4. e8 g4 >c4 | c4 <a-8 >c8 d4 <b-8 >d8 | e2. r4 | @bright <b4 >d8 c8 <b4 g4`,
      p2: `@soft o5 e4. c8 e4 g4 | a-4 e-8 a-8 b-4 f8 b-8 | g2. r4 | d4 f8 e-8 d4 <b4`,
      tri: `o3 c c >c <c c >c <c c | o2 a- a- >a- <a- b- b- >b- <b- | o3 c c >c <c c c <g g | o2 g g >g <g g >g <g b`,
      noise: `c h s k h s k s | k h s k h s s16 s16 s | c4 k k s4 k k | k s k s s16 s16 s16 s16 t16 t16 t16 t16`,
    },
  },
  intro: 'I',
  play: 'A A2 B C D T',
})
