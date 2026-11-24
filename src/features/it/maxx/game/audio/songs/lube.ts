// MW05, the underground lube pit. The bass leads: a low A that keeps ducking
// out of sight while the line above it creeps down a half step at a time (A,
// G sharp, G, F sharp, F, E), every three eighths, so it leans across the bar.
// The tune tiptoes in short notes with rests between, finger snaps on two and
// four, and now and then a note sags on the comic trombone.
//
// Shape: A is the riff and the tiptoe tune, which ends on the leading note;
// A2 doubles the creeping line in the second pulse and the tune answers with a
// new line, stepping down from the high E and then creeping up by half steps
// against the bass; B walks: the bass goes round a circle of fifths in quarters under
// off-beat chip chords, and when it reaches C the title's own Maxx motif
// sneaks in, plainly, as if nobody would notice.
import { defineSong } from '../format'

export default defineSong({
  id: 'lube',
  title: 'Lube Pit',
  key: 'A minor',
  tempo: 104,
  loop: true,
  // The tiptoe tune sounds half the time and the second pulse mostly rests: without this the song is
  // 2.8 LU under the others, and MW05's own token room and clear jingle jump out of it.
  gainDb: 2.8,
  setup: { p1: '@sneak o5 l8', p2: '@pluck o4 l8', tri: '@bass o2 l8', noise: 'l8' },
  instruments: {
    // Tiptoe: the thin pulse, cut short.
    sneak: { duty: 12, vol: 0.62, a: 0.002, d: 0.07, s: 0.55, r: 0.02, gate: 0.55, vib: 0.15, vibRate: 6, vibDelay: 0.3 },
  },
  // p: a finger snap.
  drums: { p: { rate: [1, 2], vol: 0.34, len: 0.05, curve: 1.6 } },
  parts: {
    // The riff alone, with tiptoes.
    I: {
      chords: 'Am E7 | Am6 F',
      p1: 'r1 | r1',
      p2: 'r1 | r1',
      tri: 'a >a r <a >g+ r <a >g | r <a >f+ r <a >f e r',
      noise: 'x r x r x r x r | x r x r x r x16 x16 x',
    },
    A: {
      chords: 'Am E7 | Am6 F | Am E7 | Am6 F | Am E7 | Am6 F | Am E7 | Am6 F',
      p1: `r e r a r16 g+16 b >d <b | >c r <a r @wah >c4~-2 @sneak r4 |
           r <e r a r16 g+16 b >d <b | >e r c r <a4 r4 |
           r c r e r16 f16 f+ g+ r | a r r4 @wah a4~-12 @sneak r4 |
           r e r a r16 g+16 b >d <b | >c r <a r q7 a4 g+4`,
      p2: 'r1 | r1 | r1 | r1 | r1 | r1 | r1 | r1',
      tri: `[o2 a >a r <a >g+ r <a >g | o3 r <a >f+ r <a >f e r]4`,
      noise: `[k n p n k n p n]7 | k n p n k p p16 p16 t`,
    },
    // The second pulse doubles the creeping line, and the tune answers: it tiptoes down from the
    // high E with the bass, sags, tries again, then creeps up by half steps while the bass creeps down.
    A2: {
      chords: 'Am E7 | Am6 F | Am E7 | Am6 F | Am E7 | Am6 F | Am E7 | Am6 F',
      p1: `r >e r d16 c16 r <b r g | a r r4 @wah f4~-1 @sneak r4 |
           r >e r d16 c16 r <b r >d | c r <a r @wah >c4~-3 @sneak r4 |
           r <c r d r d+ e r | a r g+ r @wah >c4~-12 @sneak r4 |
           r e r d16 c16 r <b r g | a r e r a4 r4`,
      p2: `[r a r4 g+ r4 g | r4 f+ r4 f e r]4`,
      tri: `[o2 a >a r <a >g+ r <a >g | o3 r <a >f+ r <a >f e r]4`,
      noise: `[k n p n16 n16 k n p n]3 | k n p n k p p16 p16 t |
              [k n p n16 n16 k n p n]3 | k p p16 p16 k p t m m`,
    },
    // The walk round the circle of fifths. On C the Maxx motif, plainly, on the lead.
    B: {
      chords: 'Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am | E7',
      p1: `r d f a >c4 <a f | @wah g2~-1 @sneak r4 d d+ | @lead e e16 g16 >c2 <b4 | a4. g f4 @wah e4~-3 |
           @sneak r <b >d f a4 f d | e r g+ r @wah b4~-1 @sneak r4 | a r >c r e4 c <a | b r g+ r e r d+ r`,
      p2: `@stab r4 r {f a >c} r4 r {f a >c} | r4 r {f g b} r4 r {f g b} | r4 r {c e g} r4 r {c e g} | r4 r {a >c e} r4 r {a >c e} |
           r4 r {d f a} r4 r {d f a} | r4 r {d g+ b} r4 r {d g+ b} | r4 r {e a >c} r4 r {e a >c} | r4 r {d g+ b} r4 r {d g+ b}`,
      tri: `o3 d4 a4 f4 f+4 | g4 d4 f4 <b4 | >c4 e4 g4 e4 | f4 a4 c4 e4 |
            <b4 >f4 d4 f4 | e4 g+4 b4 g+4 | a4 e4 c4 e4 | e4 g+4 b4 g+4`,
      noise: `k h p h k h p h | [k h p h k h p h16 h16]2 | k h p h k p p16 p16 t |
              [k h p h k h p h]3 | k p p16 p16 k p t m m`,
    },
  },
  intro: 'I',
  play: 'A A2 B',
})
