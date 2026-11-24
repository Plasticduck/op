// MW01 and the other sunny lots. The bridge (part B) answers the title theme:
// its first two bars are the Maxx motif on the subdominant, then a step up.
//
// It is heard for minutes at a time, so the three parts are dressed differently:
// A has the tune over broken chords, A2 turns it into a duet in thirds and climbs
// to the one high E, B drops the accompaniment an octave and lets the bass and
// kick push off the beat. The tune sits around G sharp and B above middle C on
// purpose: an earlier version a third higher was all top notes.
import { defineSong } from '../format'

export default defineSong({
  id: 'sunny',
  title: 'Grand Opening',
  key: 'E major',
  tempo: 160,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@pluck o4 l8', tri: '@bass o3 l4', noise: 'l8' },
  parts: {
    // Two bars of groove before the tune comes in.
    I: {
      chords: 'E | B7',
      p1: 'r1 | r2 r4 <b8 >f+8',
      p2: '[e g+ b g+]2 | [d+ f+ a f+]2',
      tri: 'e b e8 e8 <b4 | b >f+ a b',
      noise: 'k h s h16 h16 k k s h | k h s h s16 s16 s16 s16 t t',
    },
    // The tune: a skipping figure with a breath on beat two. Four bars out, four bars home.
    A: {
      chords: 'E | C#m | A | B7 | E | C#m | F#m B7 | E',
      p1: `g+8 b8 r8 g+8 b4 g+8 e8 | g+8 f+8 r8 e8 c+4 <b4 | >c+8 e8 r8 c+8 e4 a4 | a8 g+8 r8 f+8 d+4 r4 |
           g+8 b8 r8 g+8 b4 g+8 e8 | g+8 b8 r8 >c+4. <b8 g+8 | a4 f+8 a8 f+4 d+4 | e4. <b8 >e4 r4`,
      p2: `[e g+ b g+]2 | [c+ e g+ e]2 | [c+ e a e]2 | [d+ f+ a f+]2 |
           [e g+ b g+]2 | [c+ e g+ e]2 | c+ f+ a f+ d+ f+ a f+ | [e g+ b g+]2`,
      tri: `e b e8 e8 <b4 | >c+ g+ e8 e8 <b4 | a >e a8 a8 >c+ | <b a f+ d+ |
            e b e8 e8 <b4 | >c+ g+ e8 e8 c+ | f+ c+ <b8 b8 >b4 | e g+ b8 b8 <b4`,
      noise: `c h s h16 h16 k k s h | [k h s h16 h16 k k s h]2 | k h s h k s s16 s16 s16 s16 |
              [k h s h16 h16 k k s h]3 | k h s h k s t t`,
    },
    // The tune again as a duet, the second pulse a third or a sixth under it, climbing to a high finish.
    A2: {
      chords: 'E | C#m | A | B7 | E | C#m | F#m B7 | E',
      p1: `g+8 b8 r8 g+8 b4 g+8 e8 | g+8 f+8 r8 e8 c+4 <b4 | >c+8 e8 r8 c+8 e4 a4 | a8 g+8 r8 f+8 d+4 r4 |
           g+8 b8 r8 g+8 b4 g+8 e8 | g+8 b8 r8 >c+4. <b8 g+8 | a4 f+8 a8 b4 >d+4 | e4. <b8 >e4 r4`,
      p2: `@soft o5 e8 g+8 r8 e8 g+4 e8 <b8 | >e8 d+8 r8 c+8 <g+4 g+4 | a8 >c+8 r8 <a8 >c+4 e4 | f+8 e8 r8 d+8 <b4 r4 |
           >e8 g+8 r8 e8 g+4 e8 <b8 | >e8 g+8 r8 e4. g+8 e8 | c+4 <a8 >c+8 d+4 f+4 | g+4. g+8 g+4 r4`,
      tri: `e b e8 e8 <b4 | >c+ g+ e8 e8 <b4 | a >e a8 a8 >c+ | <b a f+ d+ |
            e b e8 e8 <b4 | >c+ g+ e8 e8 c+ | f+ c+ <b8 b8 >b4 | e g+ e8 e8 <b4`,
      noise: `c h s h16 h16 k k s h | [k h s h16 h16 k k s h]2 | k h s h k s s16 s16 s16 s16 |
              [k h s h16 h16 k k s h]3 | k s s16 s16 s t t s16 s16 s16 s16`,
    },
    // The bridge: the Maxx motif twice, then long notes stepping down a chord at a time. The broken chords
    // sit an octave lower here and the bass plays with the kick: on one, and off the beat on two and three.
    B: {
      chords: 'A | B | G#m | C#m | A | B | E | B7',
      p1: `c+8 c+16 e16 a2 e8 c+8 | d+8 d+16 f+16 b2 f+8 d+8 | g+4. b8 >d+4 <b4 | >c+4. <g+8 e4 g+4 |
           a4. e8 c+4 e4 | f+4. d+8 <b4 >d+8 f+8 | g+4 e8 g+8 b4 g+4 | f+4. d+8 <b8 >d+8 f+8 a8`,
      p2: `[<a >c+ e c+]2 | [<b >d+ f+ d+]2 | [<g+ b >d+ <b >]2 | [<g+ >c+ e c+]2 |
           [<a >c+ e c+]2 | [<b >d+ f+ d+]2 | [e g+ b g+]2 | [d+ f+ a f+]2`,
      tri: `<a4. >e4 <a8 >e4 | <b4. >f+4 <b8 >a4 | g+4. d+4 g+8 d+4 | c+4. g+4 c+8 <b4 |
            a4. >e4 <a8 >e4 | <b4. >f+4 <b8 >f+4 | e4. <b4 >e8 e4 | <b >f+ b <b`,
      noise: `c h s k h k s h | [k h s k h k s h]6 | k s k s s16 s16 s16 s16 t t`,
    },
  },
  intro: 'I',
  play: 'A A2 B',
})
