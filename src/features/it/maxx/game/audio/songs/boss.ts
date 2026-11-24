// The two boss fights (Mudslinger, Mudzilla). It follows the 'versus' jingle,
// so the intro is only two bars: the engine idling, then a tremolo climbing the
// dominant seventh.
//
// The riff: up a fifth, a flick round the top (the gallop's two sixteenths),
// back to the tonic and a sting a half step up that drags into the next bar
// (the bass steps down to F under it, so the sting bites the melody, not the
// bass). A states it twice, each time followed by the same figure moved onto
// C minor and D, over a bass that chugs the gallop backwards; A2 harmonises it a
// tenth below while the bass turns the gallop the right way round; in B the
// hero answers with the Maxx motif, minor on C, major on E flat, before the
// dominant winds the fight back up to the riff.
import { defineSong } from '../format'

export default defineSong({
  id: 'boss',
  title: 'The Big Dirty',
  key: 'G minor',
  tempo: 176,
  loop: true,
  setup: { p1: '@bright o5 l8', p2: '@stab o4 l8', tri: '@bass o2 l8', noise: 'l8' },
  parts: {
    I: {
      chords: 'Gm | D7',
      p1: 'r1 | r1',
      p2: 'r1 | @soft l16 v8 d d d d v9 f+ f+ f+ f+ v10 a a a a v11 >c c c c',
      tri: 'o2 g >g <g >g <g >g <g >g | o3 d >d <d >d <d c <b- a',
      noise: 'k h h h k h h h | [s16]8 s s t t',
    },
    A: {
      chords: 'Gm | Gm | Cm | D | Gm | Gm | Eb | D',
      p1: `g8 >d8 e-16 d16 c8 d4 <g8 a-8 | g8 >d8 e-16 d16 c8 <b-4 a8 f+8 |
           g8 >c8 d16 c16 <b-8 >c4 <g8 a-8 | f+8 >d8 e16 d16 c8 <a4 f+8 a8 |
           g8 >d8 e-16 d16 c8 d4 <g8 a-8 | g8 >d8 e-16 d16 c8 <b-4 a8 f+8 |
           g8 b-8 >c16 <b-16 a-8 b-4 g8 e-8 | d8 f+8 a8 >c8 d2`,
      p2: `[r b- r >d<]2 | [r b- r >d<]2 | [r g r >c<]2 | [r f+ r a]2 |
           [r b- r >d<]2 | [r b- r >d<]2 | [r g r b-]2 | r f+ r a r >c <r a`,
      // The bass chugs the gallop backwards (two sixteenths, then the octave): the mud's own rhythm.
      tri: `o2 [g16 g16 >g8 <]3 g16 g16 >f8 | o2 [g16 g16 >g8 <]4 | o3 [c16 c16 >c8 <]4 | o3 [d16 d16 >d8 <]4 |
            o2 [g16 g16 >g8 <]3 g16 g16 >f8 | o2 [g16 g16 >g8 <]4 | o3 [e-16 e-16 b-8]4 | o3 d16 d16 >d8 <d16 d16 >d8 <d8 c8 <b-8 a8`,
      // Kicks on one, the and of two and three: they land with the riff's C and its held D.
      noise: `c h s k k h s h | [k h s k k h s h]2 | k h s k k h s s16 s16 |
              [k h s k k h s h]3 | k s k s s16 s16 s16 s16 t t`,
    },
    // The riff again, a tenth below it in the second pulse, the bass in a gallop; it climbs to the top at the end.
    A2: {
      chords: 'Gm | Gm | Cm | D | Gm | Gm | Eb Cm7 | D',
      p1: `g8 >d8 e-16 d16 c8 d4 <g8 a-8 | g8 >d8 e-16 d16 c8 <b-4 a8 f+8 |
           g8 >c8 d16 c16 <b-8 >c4 <g8 a-8 | f+8 >d8 e16 d16 c8 <a4 f+8 a8 |
           g8 >d8 e-16 d16 c8 d4 <g8 a-8 | g8 >d8 e-16 d16 c8 <b-4 a8 f+8 |
           g8 b-8 >e-4 ^8 d8 c8 <b-8 | a8 b-8 >c8 c+8 d4 r4`,
      p2: `@soft v10 o4 d8 b-8 >c16 <b-16 a8 b-4 d8 f8 | d8 b-8 >c16 <b-16 a8 g4 f+8 d8 |
           e-8 g8 b-16 a-16 g8 g4 e-8 f8 | d8 a8 >c16 <a16 a8 f+4 d8 f+8 |
           d8 b-8 >c16 <b-16 a8 b-4 d8 f8 | d8 b-8 >c16 <b-16 a8 g4 f+8 d8 |
           e-8 g8 b-4 ^8 b-8 g8 g8 | f+8 g8 a8 a8 a4 r4`,
      tri: `o2 g8 g16 g16 >g8 <g8 g8 g16 g16 >g8 f8 | o2 [g8 g16 g16 >g8 <g8]2 | o3 [c8 c16 c16 >c8 <c8]2 | o3 [d8 d16 d16 <a8 >d8]2 |
            o2 g8 g16 g16 >g8 <g8 g8 g16 g16 >g8 f8 | o2 [g8 g16 g16 >g8 <g8]2 | o3 e-8 e-16 e-16 b-8 e-8 c8 c16 c16 g8 c8 | o3 d d d d d4 <a4`,
      noise: `c h s k k h16 h16 s h | [k h s k k h16 h16 s h]2 | k h s k k h s s16 s16 |
              [k h s k k h16 h16 s h]2 | k h s k k h s h | k s k s c4 s16 s16 s16 s16`,
    },
    // The hero's answer: the Maxx motif on C minor, then on E flat major and up to the top, then the
    // dominant: a chromatic climb over a pedal and a drum roll back into the riff.
    B: {
      chords: 'Cm | Cm7 | Eb | Eb | D7 | D7',
      p1: `@lead e-8 e-16 g16 >c2 <b-8 >c8 | d4. c8 <b-4 g4 |
           g8 g16 b-16 >e-2 d8 c8 | <b-4. g8 e-4 g4 |
           @bright a8 b-8 a8 b-8 >c8 <b-8 >c8 c+8 | d4 c+8 d8 <a4 f+4`,
      p2: `@pluck l16 [c e- g e-]4 | [c e- g e-]4 | [e- g b- g]4 | [e- g b- g]4 |
           [d]16 | [d]8 [f+]8`,
      tri: `o3 c4 c8 c8 <g4 g8 b-8 | >c4 c8 c8 <g4 a-8 b-8 | o3 e-4 e-8 e-8 <b-4 b-8 >d8 | e-4 e-8 e-8 <b-4 a-8 g8 |
            o3 d d >d <d d d >d <d | o3 d <a >d <a >d c <b- a`,
      noise: `c h s h h k s h | k h s h h k s s16 s16 | c h s h h k s h | k h s h h k s s16 s16 |
              k s k s k s k s | [s16]8 [t16]4 s16 s16 s16 s16`,
    },
  },
  intro: 'I',
  play: 'A A2 B',
})
