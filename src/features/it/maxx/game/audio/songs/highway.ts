// MW06, the sunset highway. The bass gallops (an eighth and two sixteenths, the
// rhythm of the Maxx motif) from the first bar to the last; the kick gallops with
// it on one and three, with snares on the back beat and open hats after them; the
// tune rides on top in long notes.
//
// Shape: A is the road theme (a zigzag up to a held note, three times, each from a
// different step) ending on a question; A2 is the same tune as a duet and comes
// home; B is the long climb, one broad note a bar over shimmering sixteenths, up
// to the top E; C is the pay-off, the Maxx motif itself on I, IV and V, then a
// falling sequence as the sun goes down; T hands the road to the bass for four
// bars (two honks and an engine rev) before the tune comes round again.
import { defineSong } from '../format'

export default defineSong({
  id: 'highway',
  title: 'Bug Season Boulevard',
  key: 'A major',
  tempo: 168,
  loop: true,
  setup: { p1: '@lead o5 l8', p2: '@pluck o4 l8', tri: '@bass o2 l8', noise: 'l8' },
  parts: {
    // The engine turns over: gallop alone, then the rev slides up into the tune's first note.
    I: {
      chords: 'A | A',
      p1: 'r1 | v9 o4 e1~+12',
      p2: 'r1 | o4 a >c+ e <a >c+ e <a >c+',
      tri: 'o2 [a8 a16 a16]4 | o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 >a8 <a16 a16',
      noise: 'k h16 h16 h h16 h16 k h16 h16 h h16 h16 | k h16 h16 s h16 h16 k s16 s16 s16 s16 t16 t16',
    },
    A: {
      chords: 'A | A | D | E | F#m7 | D | Bm7 | E',
      p1: `r8 e8 a8 f+8 >c+4. <a8 | >e2 ^8 c+8 <b8 a8 | r8 f+8 b8 f+8 >d4. <a8 | b2 ^8 g+8 e8 g+8 |
           r8 a8 >c+8 <a8 >e4. c+8 | d4. <a8 ^4 f+8 a8 | b4. >d8 ^4 c+8 <b8 | >c+4 <b8 g+8 e4 r4`,
      // Broken chords grouped three, three and two against the gallop.
      p2: `o4 a >c+ e <a >c+ e <a >c+ | o4 a >c+ e <a >c+ e <a >c+ | o4 a >d f+ <a >d f+ <a >d | o4 g+ b >e <g+ b >e <g+ b |
           o4 a >c+ e <a >c+ e <a >c+ | o4 a >d f+ <a >d f+ <a >d | o4 f+ b >d <f+ b >d <f+ b | o4 g+ b >e <g+ b >e <g+ b`,
      tri: `o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 >a8 <a16 a16 | o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 b8 >c+8 |
            o3 d8 d16 d16 >d8 <d16 d16 d8 d16 d16 >d8 <f+8 | o3 e8 e16 e16 b8 e16 e16 e8 e16 e16 b8 g+8 |
            o3 f+8 f+16 f+16 >c+8 <f+16 f+16 f+8 f+16 f+16 >c+8 <f+16 f+16 | o3 d8 d16 d16 >d8 <d16 d16 d8 d16 d16 >d8 <d8 |
            o2 b8 b16 b16 >f+8 <b16 b16 b8 b16 b16 >f+8 <b16 b16 | o3 e8 e16 e16 b8 e16 e16 e8 e16 e16 e8 <b8`,
      noise: `c k16 k16 s o k k16 k16 s o | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k o s o | k k16 k16 s o k k16 k16 s s16 s16 |
              k k16 k16 s o k k16 k16 s o | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k o s o | k k16 k16 s o k s16 s16 s t16 t16`,
    },
    // The tune again with the second pulse a third or a sixth under it, and this time it comes home.
    A2: {
      chords: 'A | A | D | E | F#m7 | D | Bm7 E7 | A',
      p1: `r8 e8 a8 f+8 >c+4. <a8 | >e2 ^8 c+8 <b8 a8 | r8 f+8 b8 f+8 >d4. <a8 | b2 ^8 g+8 e8 g+8 |
           r8 a8 >c+8 <a8 >e4. c+8 | d4. <a8 ^4 f+8 a8 | b8 >c+8 d4 e4. <g+8 | a2. r4`,
      p2: `@soft o5 r8 c+8 e8 d8 a4. e8 | a2 ^8 a8 g+8 e8 | r8 d8 f+8 d8 a4. f+8 | g+2 ^8 e8 <b8 >e8 |
           r8 f+8 a8 f+8 >c+4. <a8 | a4. f+8 ^4 d8 f+8 | d8 e8 f+4 g+4. e8 | e2. r4`,
      tri: `o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 >a8 <a16 a16 | o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 b8 >c+8 |
            o3 d8 d16 d16 >d8 <d16 d16 d8 d16 d16 >d8 <f+8 | o3 e8 e16 e16 b8 e16 e16 e8 e16 e16 b8 g+8 |
            o3 f+8 f+16 f+16 >c+8 <f+16 f+16 f+8 f+16 f+16 >c+8 <f+16 f+16 | o3 d8 d16 d16 >d8 <d16 d16 d8 d16 d16 >d8 <d8 |
            o2 b8 b16 b16 >f+8 <b16 b16 >e8 e16 e16 e8 <b8 | o2 a8 a16 a16 >a8 <a16 a16 a8 a8 b8 >c+8`,
      noise: `c k16 k16 s o k k16 k16 s o | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k o s o | k k16 k16 s o k k16 k16 s s16 s16 |
              k k16 k16 s o k k16 k16 s o | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k k16 k16 s s16 s16 | k k16 k16 s o k s16 s16 t t`,
    },
    // The climb. The gallop stays on one note a bar and the second pulse shimmers in sixteenths.
    B: {
      chords: 'D | E | C#m7 | F#m | D | E | E | E7',
      p1: `f+4. a8 ^2 | g+4. b8 ^2 | e4. g+8 ^2 | a4. >c+8 ^2 |
           d4. <a8 ^4 f+8 a8 | >e4. <b8 ^4 g+8 b8 | >e2 ^8 d8 c+8 <b8 | g+4. e8 ^4 d4`,
      p2: `o4 l16 [d f+ a f+]4 | [e g+ b g+]4 | [e g+ b g+]4 | [f+ a >c+ <a]4 |
           [f+ a >d <a]4 | [g+ b >e <b]4 | [g+ b >e <b]4 | [g+ b >d <b]4`,
      tri: `o3 [d8 d16 d16]4 | [e8 e16 e16]4 | [c+8 c+16 c+16]4 | [f+8 f+16 f+16]4 |
            [d8 d16 d16]4 | [e8 e16 e16]4 | [e8 e16 e16]4 | [e8 e16 e16]2 e8 e16 e16 g+8 b8`,
      // Half time while the tune spreads out, then the galloping kick comes back for the last four bars.
      noise: `c h o h s h o h | [k h o h s h o h]3 | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k o s o | k k16 k16 s o k k16 k16 s s16 s16 | k s k s s16 s16 s16 s16 t t`,
    },
    // The Maxx motif on I, IV and V, the second pulse chasing it up the chord; then the long way down.
    C: {
      chords: 'A | D | E | A | F#m | D | Bm7 | E7',
      p1: `c+8 c+16 e16 a2 e8 a8 | f+8 f+16 a16 >d2 <a8 >d8 | <g+8 g+16 b16 >e2 d8 c+8 | <b4. a8 ^2 |
           >c+4. <a8 ^4 f+4 | a4. f+8 ^4 d4 | f+4. d8 ^4 <b4 | >e2 ^8 e8 g+8 b8`,
      p2: `@soft o4 r4 e8 e16 a16 >c+4 r4 | o4 r4 a8 a16 >d16 f+4 r4 | o4 r4 b8 b16 >e16 g+4 r4 | @pluck o4 a >c+ e <a >c+ e <a >c+ |
           o4 a >c+ f+ <a >c+ f+ <a >c+ | o4 f+ a >d <f+ a >d <f+ a | o4 f+ b >d <f+ b >d <f+ b | o4 g+ b >d <g+ b >d <g+ b`,
      tri: `o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 >a8 <a16 a16 | o3 d8 d16 d16 >d8 <d16 d16 d8 d16 d16 >d8 <d16 d16 |
            o3 e8 e16 e16 b8 e16 e16 e8 e16 e16 b8 e16 e16 | o2 a8 a16 a16 >a8 <a16 a16 a8 a16 a16 >e8 <a8 |
            o3 f+4. f+8 ^4 c+4 | d4. d8 ^4 <a4 | b4. b8 ^4 >f+4 | o3 e8 e16 e16 e8 e16 e16 e8 e16 e16 b8 e8`,
      noise: `c k16 k16 s h k k s h | [k k16 k16 s h k k s h]2 | k k16 k16 s h k k s s16 s16 |
              c4 h h s4 h h | [k4 h h s4 h h]2 | k s16 s16 k s16 s16 s16 s16 s16 s16 t t`,
    },
    // Four bars for the bass, which climbs each chord at a gallop. Two honks and the rev.
    T: {
      chords: 'A | F#m | D | E7',
      p1: `r2 r4 {a >c+}16 {a >c+}16 r8 | r2 r4 {a >c+}16 {a >c+}16 r8 | r1 | v9 o4 e1~+12`,
      p2: `o4 a >c+ e <a >c+ e <a >c+ | o4 a >c+ f+ <a >c+ f+ <a >c+ | o4 a >d f+ <a >d f+ <a >d | o4 g+ b >d <g+ b >d <g+ b`,
      tri: `o2 a8 a16 a16 >c+8 c+16 c+16 e8 e16 e16 a8 e8 | o3 f+8 f+16 f+16 e8 e16 e16 c+8 c+16 c+16 <a8 >c+8 |
            o3 d8 d16 d16 f+8 f+16 f+16 a8 a16 a16 >d8 <a8 | o3 e8 e16 e16 g+8 g+16 g+16 b8 b16 b16 >d8 <b8`,
      noise: `c k16 k16 s o k k16 k16 s o | k k16 k16 s o k o s o | k k16 k16 s o k k16 k16 s o | k k16 k16 s o k s16 s16 s16 s16 t16 t16`,
    },
  },
  intro: 'I',
  play: 'A A2 B C T',
})
