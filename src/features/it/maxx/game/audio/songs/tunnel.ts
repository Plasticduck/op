// MW03, the first wash tunnel. The bass and drums are the conveyor: straight
// eighths on the root that drop to the fifth where the kick lands off the beat
// and again under the snare on four (3 + 3 + 2), and a metallic clank between.
// Over the machine the lead is the hero, in long notes: up a fourth from the
// pickup, a turn round the minor third that holds across the bar line, then
// down to the tonic; the same reach a step higher, and a run up the dominant
// chord to hand back.
//
// Shape: A is the tune over off-beat stabs and ends on the dominant; A2 is the
// tune as a duet in sixths and comes home; B is the machine room, the Maxx
// motif climbing VI, VII, i up to the high E over spinning gears while the
// bass strides; A3 runs the gears under the tune in a hitched three-three-two,
// and its answer climbs to the high E before the dominant run hands back.
import { defineSong } from '../format'

export default defineSong({
  id: 'tunnel',
  title: 'Tunnel Vision',
  key: 'E minor',
  tempo: 150,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l8', noise: 'l8' },
  // z: the clank of the belt, a short metallic tick lower than the rim click.
  drums: { z: { rate: [5, 6], short: true, vol: 0.26, len: 0.045, curve: 1.5 } },
  parts: {
    // The belt starts up, then the gears catch and run up to the first note.
    I: {
      chords: 'Em | B7',
      p1: 'r1 | r2 r4 r8 <b8',
      p2: 'r1 | @pluck o4 l16 b >d+ f+ b <b >d+ f+ b <b >d+ f+ b r4',
      tri: 'e e e <b >e e <b >e | <b b >d+ d+ f+ f+ a a',
      noise: 'k z z k z z k z | k z s k s16 s16 s t t',
    },
    A: {
      chords: 'Em | Cmaj7 | D | B7 | Em | C | Am | B7',
      p1: `e4 g4 ^8 f+8 g8 b8 | ^4 a8 g8 e2 | f+4 a4 ^8 >d8 c8 <a8 | b2. r8 <b8 |
           >e4 g4 ^8 f+8 g8 b8 | ^4 >c8 <b8 a8 g8 e4 | a8 b8 >c8 <b8 a4 f+4 | d+4 f+4 b4 r8 <b8`,
      p2: `[r g r b]2 | [r g r >c<]2 | [r f+ r a]2 | [r f+ r a]2 |
           [r g r b]2 | [r g r >c<]2 | [r a r >c<]2 | r f+ r a r d+ r f+`,
      tri: `o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o3 d d d <a >d d <a >d | o2 b b >d+ d+ f+ f+ a a |
            o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o2 a a a >e <a a >e <a | o2 b b >d+ d+ f+ f+ a a`,
      noise: `c z s k z k s z | [k z s k z k s z]2 | k z s k s s16 s16 t t |
              [k z s k z k s z]3 | k z s k s16 s16 s t t`,
    },
    // The tune again, the second pulse a sixth under it, and this time it comes home.
    A2: {
      chords: 'Em | Cmaj7 | D | B7 | Em | C | Am B7 | Em',
      p1: `e4 g4 ^8 f+8 g8 b8 | ^4 a8 g8 e2 | f+4 a4 ^8 >d8 c8 <a8 | b2. r8 <b8 |
           >e4 g4 ^8 f+8 g8 b8 | ^4 >c8 <b8 a8 g8 e4 | a8 b8 >c8 <a8 f+4 d+4 | e2. r4`,
      p2: `@soft o4 g4 b4 ^8 a8 b8 >e8 | ^4 c8 <b8 g2 | o5 d4 f+4 ^8 a8 a8 f+8 | d+2. r4 |
           o4 g4 b4 ^8 a8 b8 >e8 | ^4 e8 d8 c8 <b8 g4 | >c8 d8 e8 c8 <a4 f+4 | g2. r4`,
      tri: `o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o3 d d d <a >d d <a >d | o2 b b >d+ d+ f+ f+ a a |
            o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o2 a a a >e <b b >f+ <b | o3 e e e <b >e4 <b4`,
      noise: `c z s k z k s z | [k z16 z16 s k z k s z16 z16]2 | k z s k s s16 s16 t t |
              [k z16 z16 s k z k s z16 z16]3 | k s k s s16 s16 s16 s16 t t`,
    },
    // The machine room: the Maxx motif on VI, VII and i, up to the high E, over gears in sixteenths;
    // then a long line down to the dominant while the bass strides in quarters.
    B: {
      chords: 'C | D | Em | Cmaj7 | Am | F#m7b5 | B7 | B7',
      p1: `e8 e16 g16 >c2 <b8 a8 | f+8 f+16 a16 >d2 c8 <a8 | g8 g16 b16 >e2. | ^4 d8 <b8 ^4 g4 |
           a4. >c8 <b4 a4 | f+4. a8 >c4 <a4 | b4. a8 g4 f+4 | d+2 r4 r8 <b8`,
      p2: `@pluck l16 [c e g e]4 | [d f+ a f+]4 | [e g b g]4 | [g b >e <b]4 |
           [c e a e]4 | [c f+ a f+]4 | [d+ f+ b f+]2 [d+ a b a]2 | [d+ f+ a f+]4`,
      tri: `o3 c4 g4 >c4 <g4 | d4 a4 >d4 <a4 | e4 b4 e4 d4 | c4 <b4 a4 b4 |
            a4 >e4 c4 e4 | f+4 >c4 <a4 f+4 | o2 b4 >f+4 d+4 <b4 | >d+4 f+4 a4 f+4`,
      noise: `c h k h s h k h | [k h k h s h k h]2 | k h k h s s16 s16 t t |
              [k h k h s h k h]3 | k s16 s16 k s16 s16 s s16 s16 t t`,
    },
    // The gears keep running under the tune, hitched three, three, two like the belt, and the answer
    // climbs to the high E, then falls through the minor chord onto the dominant run.
    A3: {
      chords: 'Em | Cmaj7 | D | B7 | Em | C | Am B7 | B7',
      p1: `e4 g4 ^8 f+8 g8 b8 | ^4 a8 g8 e2 | f+4 a4 ^8 >d8 c8 <a8 | b2. r8 <b8 |
           >e4 g4 ^8 f+8 g8 b8 | ^4 >c8 d8 e4. d8 | c8 <b8 a8 g8 f+2 | d+4 f+4 b4 r8 <b8`,
      p2: `@pluck l16 [e g b e g b e g]2 | [e g >c <e g >c <e g]2 | [d f+ a d f+ a d f+]2 | [d+ f+ a d+ f+ a d+ f+]2 |
           [e g b e g b e g]2 | [e g >c <e g >c <e g]2 | c e a c e a c e d+ f+ a d+ f+ a d+ f+ | [d+ f+ a d+ f+ a d+ f+]2`,
      tri: `o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o3 d d d <a >d d <a >d | o2 b b >d+ d+ f+ f+ a a |
            o3 e e e <b >e e <b >e | o3 c c c <g >c c <g >c | o2 a a a >e <b b >f+ <b | o2 b b >d+ d+ f+ f+ a a`,
      noise: `c z16 z16 s k z k s z16 z16 | [k z16 z16 s k z k s z16 z16]2 | k z s k s s16 s16 t t |
              [k z16 z16 s k z k s z16 z16]2 | k z s k s z s16 s16 s16 s16 | k s k s s16 s16 s16 s16 t t`,
    },
  },
  intro: 'I',
  play: 'A A2 B A3',
})
