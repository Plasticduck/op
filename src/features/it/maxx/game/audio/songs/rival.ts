// Rival Row: the four showdowns, and the walk between them. A call and
// response: the villain struts on the comic trombone (dotted rhythms, a line
// sliding down the minor chord, a laugh that slides off its last note) and
// Maxx answers every time on the lead with the gallop of his own motif.
//
// Shape: A trades two bars each way; B trades bar by bar and the duel heats up,
// until the villain swaggers onto C (the flat second) and Maxx answers with
// his motif in the title's own key; A2 has the villains in sixths and the hero
// in thirds, and a higher last word. Everything ends on F sharp, which the
// 'versus' jingle also stops on.
import { defineSong } from '../format'

export default defineSong({
  id: 'rival',
  title: 'Rival Row',
  key: 'B minor',
  tempo: 156,
  loop: true,
  quotes: ['title'],
  setup: { p1: '@wah o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l8', noise: 'l8' },
  parts: {
    // The strut walks in alone, finger snaps on two and four, and a pickup.
    I: {
      chords: 'Bm7 | F#7',
      p1: 'r1 | r2 r4 o5 f+8. f+16',
      p2: 'r1 | r1',
      tri: 'o2 b4 >d8. f+16 b4 a8. f+16 | o3 f+4 e8. c+16 <a+4 >c+8. e16',
      noise: 'k4 x4 k8. k16 x4 | k4 x4 k8. k16 x8 x16 x16',
    },
    A: {
      chords: 'Bm7 | F#7 | D | A | Bm7 | F#7 | Em | F#7',
      p1: `o5 b8. a+16 a8. g+16 f+4 r4 | o6 c+16 c+16 c+8 c+16 c+16 c+8 c+2~-7 |
           @lead o5 f+8 f+16 a16 >d2 <a8 >d8 | e4. d8 c+4 r4 |
           @wah o5 b8. a+16 a8. g+16 f+4 r4 | o6 c+16 c+16 c+8 e16 e16 e8 c+2~-12 |
           @lead o5 g8 g16 b16 >e2 d8 c+8 | c+4. <a+8 f+4 r4`,
      p2: `r4 {d f+ a}8 r8 r4 {d f+ a}8 r8 | r4 {c+ e a+}8 r8 r4 {c+ e a+}8 r8 |
           @pluck [d f+ a f+]2 | [c+ e a e]2 |
           @stab r4 {d f+ a}8 r8 r4 {d f+ a}8 r8 | r4 {c+ e a+}8 r8 r4 {c+ e a+}8 r8 |
           @pluck [e g b g]2 | [c+ e a+ e]2`,
      tri: `o2 b4 >d8. f+16 b4 a8. f+16 | o3 f+4 e8. c+16 <a+4 >c+8. e16 |
            o3 d8 d16 d16 a8 d8 d8 d16 d16 a8 f+8 | o2 a8 a16 a16 >e8 <a8 a8 a16 a16 >e8 c+8 |
            o2 b4 >d8. f+16 b4 a8. f+16 | o3 f+4 e8. c+16 <a+4 >c+8. e16 |
            o3 e8 e16 e16 b8 e8 e8 e16 e16 b8 g8 | o3 f+8 f+16 f+16 c+8 f+8 e8 e16 e16 c+8 <a+8`,
      noise: `c8. h16 s8. k16 k8. h16 s8. h16 | k8. h16 s8. k16 k8. h16 s s16 s16 |
              k h16 h16 s h k h16 h16 s h | k h16 h16 s h k s16 s16 s t |
              k8. h16 s8. k16 k8. h16 s8. h16 | k8. h16 s8. k16 k8. h16 s s16 s16 |
              k h16 h16 s h k h16 h16 s h | k h16 h16 s h k s16 s16 t t`,
    },
    // Bar by bar now. The villain's line climbs to the top, then lands on C, the flat second, and Maxx
    // answers with his motif exactly as the title has it; over the dominant the villain laughs under him.
    B: {
      chords: 'Em7 | Em7 | Bm7 | Bm7 | C7 | C7 | F#7 | F#7',
      p1: `o6 e8. d+16 d8. c+16 <b4 r4 | @lead o5 g8 g16 b16 >e4 d8 <b8 g4 |
           @wah o5 b8. a+16 a8. g+16 f+4 r4 | @lead o5 d8 d16 f+16 b4 a8 f+8 d4 |
           @wah o6 c8. <b16 b-8. a16 g4 r4 | @lead o5 e8 e16 g16 >c2 <g8 a8 |
           @bright o5 f+8 f+16 a+16 >c+2 <a+8 >c+8 | e4 c+4 <a+4 f+4`,
      p2: `r4 {e g b}8 r8 r4 {e g b}8 r8 | @pluck [e g b g]2 |
           @stab r4 {d f+ b}8 r8 r4 {d f+ b}8 r8 | @pluck [d f+ b f+]2 |
           @stab r4 {e g b-}8 r8 r4 {e g b-}8 r8 | @pluck c e g b- c e g e |
           @wah v8 o5 c+16 c+16 c+8 c+16 c+16 c+8 c+2~-7 | @stab o4 [r {c+ e a+}]4`,
      tri: `o3 e4 <b8. >e16 g4 e8. <b16 | o3 e8 e16 e16 b8 e8 e8 e16 e16 b8 g8 |
            o2 b4 >d8. f+16 b4 a8. f+16 | o2 b8 b16 b16 >f+8 <b8 b8 b16 b16 >f+8 d8 |
            o3 c4 g8. >c16 <e4 g8. b-16 | o3 c8 c16 c16 g8 c8 c8 c16 c16 e8 g8 |
            o3 f+8 f+16 f+16 c+8 f+8 f+8 f+16 f+16 c+8 f+8 | o3 f+ f+ e e c+ c+ <a+ a+`,
      noise: `c8. h16 s8. k16 k8. h16 s8. h16 | k h16 h16 s h k h16 h16 s h |
              k8. h16 s8. k16 k8. h16 s8. h16 | k h16 h16 s h k h16 h16 s h |
              k8. h16 s8. k16 k8. h16 s8. h16 | k h16 h16 s h k h16 h16 s h |
              c h16 h16 s h k h16 h16 s h | k s k s s16 s16 s16 s16 t t`,
    },
    // The villains strut in sixths, the hero answers in thirds, and gets a higher last word.
    A2: {
      chords: 'Bm7 | F#7 | D | A | Bm7 | F#7 | Em | F#7',
      p1: `o5 b8. a+16 a8. g+16 f+4 r4 | o6 c+16 c+16 c+8 c+16 c+16 c+8 c+2~-7 |
           @lead o5 f+8 f+16 a16 >d2 <a8 >d8 | e4. d8 c+4 r4 |
           @wah o5 b8. a+16 a8. g+16 f+4 r4 | o6 c+16 c+16 c+8 e16 e16 e8 c+2~-12 |
           @lead o5 g8 g16 b16 >e2 d8 c+8 | e4 c+8 <b8 a+4 f+4`,
      p2: `@wah v9 o5 d8. c+16 c8. <b16 a4 r4 | o5 e16 e16 e8 e16 e16 e8 e2~-7 |
           @soft o5 d8 d16 f+16 a2 f+8 a8 | a4. f+8 e4 r4 |
           @wah v9 o5 d8. c+16 c8. <b16 a4 r4 | o5 e16 e16 e8 g16 g16 g8 e2~-12 |
           @soft o5 e8 e16 g16 b2 a8 g8 | c+4 <a+8 g8 f+4 c+4`,
      tri: `o2 b4 >d8. f+16 b4 a8. f+16 | o3 f+4 e8. c+16 <a+4 >c+8. e16 |
            o3 d8 d16 d16 a8 d8 d8 d16 d16 a8 f+8 | o2 a8 a16 a16 >e8 <a8 a8 a16 a16 >e8 c+8 |
            o2 b4 >d8. f+16 b4 a8. f+16 | o3 f+4 e8. c+16 <a+4 >c+8. e16 |
            o3 e8 e16 e16 b8 e8 e8 e16 e16 b8 g8 | o3 f+ f+ e e c+ c+ <a+ a+`,
      noise: `c8. h16 s8. k16 k8. h16 s8. h16 | k8. h16 s8. k16 k8. h16 s s16 s16 |
              k h16 h16 s h k h16 h16 s h | k h16 h16 s h k s16 s16 s t |
              k8. h16 s8. k16 k8. h16 s8. h16 | k8. h16 s8. k16 k8. h16 s s16 s16 |
              k h16 h16 s h k h16 h16 s h | k s k s s16 s16 s16 s16 t16 t16 t16 t16`,
    },
  },
  intro: 'I',
  play: 'A B A2',
})
