// The song format. READ THIS before writing a song.
//
// A song is one file in audio/songs/<id>.ts whose default export is
// defineSong({...}). The file name is the id (a MusicId or JingleId from the
// contract). Dropping a file in the folder adds the song: nothing to register.
// A jingle is a song with loop: false.
//
// Four voices, as on the NES. Each plays one note at a time:
//   p1     pulse wave, usually the melody
//   p2     pulse wave, usually harmony or a countermelody
//   tri    triangle wave, the bass (it has one loudness: full)
//   noise  the drum kit
//
// The music is written as text, one string per voice per part (a part is a
// few bars: a verse, a chorus, an ending). `play` strings the parts together.
//
//   import { defineSong } from '../format'
//
//   export default defineSong({
//     id: 'bonus',                 // must match the file name
//     title: 'Token Room',
//     key: 'F major',              // 'C', 'F major', 'E minor', 'D dorian', 'G mixolydian', 'C wholetone'
//     tempo: 160,                  // quarter notes per minute
//     loop: true,                  // false for a jingle
//     // Prepended to that voice in every part: pick the instrument, octave, default length.
//     setup: { p1: '@lead o5 l8', p2: '@stab o4 l8', tri: '@bass o3 l4', noise: 'l8' },
//     parts: {
//       A: {
//         chords: 'F | Bb | C7 | F',          // one bar each; 'F C' = two chords sharing a bar
//         p1:    'f a >c4 <a g f4 | d f b-4 >d <b- f4 | e g b-4 g e c4 | f2. r4',
//         p2:    'r a r a r a r a | r b- r b- r b- r b- | r b- r b- r g r g | r a r a a4 r4',
//         tri:   'f a >c <a | b- >d <b- >d | <c e g e | f c <f r',
//         noise: '[k h s h k k s h]3 | k h s h k s16 s16 s s',
//       },
//     },
//     intro: '',                   // parts played once before the loop (optional)
//     play: 'A',                   // the loop: 'A A B A'
//   })
//
// Reading the first bar of each voice: p1 plays F5 and A5 as eighths (l8 is the default length),
// steps up an octave for a quarter-note C6, comes back for A5 and G5 and ends on a quarter-note F5:
// four beats. p2 rests on every beat and stabs A4 after it. The bass walks F3 A3 C4 A3 in quarters.
// The drums go kick, hat, snare, hat, kick, kick, snare, hat in eighths, three bars running.
//
// Notes
//   c d e f g a b     a note. + or # after it is a sharp, - a flat:  f+  b-
//                     `key` does NOT add sharps or flats for you: in G major write f+ every time.
//   r                 a rest
//   4 8 16 2 1        after a note or rest: its length (1 whole note, 2 half, 4 quarter, 8 eighth,
//                     16 sixteenth). A dot adds half:  c4.   No number: the default length.
//                     Triplets: 6 is a triplet quarter (three fill a half note), 12 a triplet eighth
//                     (three fill a quarter), 24 a triplet sixteenth.
//   ^                 tie more length on:  c2^8   c1^1 . It may come after a space or a bar line, which
//                     is how a note is held across the bar:   e4 f4 g4. a8 | ^2 g2 |
//                     After a rest it lengthens the rest.
//   o4                octave 4. Octaves run from c up to b: o4 c is middle C (262 Hz), o4 b is the B
//                     above it, o5 c the C above that.   >  up an octave   <  down an octave
//   l8                default length from here on
//   v12               loudness 0 to 15. Leave the triangle at v12: the real chip could not turn it down.
//   q6                how much of each note sounds, in eighths: q8 legato, q4 half length.
//                     Without q the instrument decides.
//   @lead             switch instrument (see INSTRUMENTS below, or define your own in `instruments`)
//   {c e g}4          a chip chord: the notes are cycled very fast for the length given
//   c4~-2             bend: glide down 2 semitones over the note (~+12 glides up an octave)
//   [ ... ]3          play the bracket three times (default 2)
//   |                 bar line. Optional, but USE THEM: each bar is counted, and one that does not
//                     add up is reported by number ("bar 6 has 3.5 beats, not 4").
//   ; text            comment to the end of the line
//
// Drums (the noise voice has letters of its own, see DRUMS below)
//   k kick   s snare   h closed hat   o open hat   c crash   t low tom   m mid tom   x rim click   n shaker
//   Lengths, r, l, v, [ ] and | work as above. A hit rings for its own length and is cut by the next hit.
//   A kick fuses with the bass: a triangle note starting on the same beat drops onto its pitch from
//   an octave above, and in a bass rest the triangle gives a short thump. So put kicks where the
//   bass moves.
//
// Where to write each voice (higher and lower notes play, but stop sounding good)
//   p1 melody    o5 c to o6 e. Above o6 e a pulse is piercing: touch it for a climax, do not live there.
//   p2 harmony   o4 c to o5 b, under the melody. Crossing above the melody hides the tune.
//   tri bass     o2 g to o4 d. Below o2 g small speakers lose it; above o4 d it stops being a bass.
//   Allowed at all: p1 and p2 o1 a to o8 c, tri o1 c to o7 c.
//
// Loudness. v12 with the built-in instruments is the house mix: melody on top, harmony instruments
// (soft, pluck, stab, pad) already quieter, drums under the melody. Change v for accents and echoes
// (an echo voice is v6 or so), not to remix the song. The report prints each voice's level and a
// "pre-limiter peak": well above 0.6 means the mix is being squeezed, so thin it out or lower v.
// A song that is sparse by design (the tune sounding half the time) comes out quieter to the ear than
// the rest, and raising v cannot fix that without squeezing it: `gainDb` lifts it where it is played,
// after the render and its limiter. scripts/maxx/tests/audio-songs.mjs measures every loop against the others.
//
// Rules the loader checks (problems go to the console in dev, nothing throws):
//   every voice in a part is the same length and a whole number of bars; every part named in
//   `intro` and `play` exists; notes are inside the range the voice can play; `chords` has one
//   entry per bar. A voice left out of a part is silent for that part.
//
// Each part starts every voice fresh at o4 l8 v12 with the voice's default instrument, then runs
// `setup`, so parts can be reordered freely.
//
// Loops. With loop: true the parts in `play` repeat for ever; `intro` is heard once. The last bar of
// the last part runs straight into the first bar of the first part in `play`, so end on the chord
// that leads home (usually the dominant) and give the drums a fill there. No note may ring past the
// end of a part: that is what keeps the seam silent. Hurry-up plays the same song faster; nothing to
// write for it.
//
// meter is quarter notes per bar (default 4; 3 for a waltz). tempo is quarter notes per minute.
// chords understands: C Cm C5 C6 Cm6 C7 Cmaj7 Cm7 C9 Cadd9 Cdim Cdim7 Cm7b5 Caug Csus2 Csus4 C7sus4,
// any root (F#, Bb), a slash bass (C/E), and N for no chord. Two or more in a bar share it equally.
//
// Checking your work (a script cannot listen, so it reads the music back to you):
//   node scripts/maxx/audio-render.mjs --only bonus --out <folder>    WAV files, levels, loop seam and a
//       bar by bar harmony report: notes against `key` and `chords`, clashes between voices, the bass
//       doubling the melody in octaves. Declare `chords`: the report is much sharper with them.
//   node scripts/maxx/audio-render.mjs --only bonus --roll            a piano roll in text, a sixteenth
//       per column, to proof-read every note and rest.
//   node scripts/maxx/audio-render.mjs --compare --only bonus         the song against well-known tunes
//       and every other song (phrase heads, bass and drum bars), and its two pulses against each
//       other (parallel octaves or fifths, p2 above p1). A deliberate quote goes in `quotes`.
//
// The Maxx motif, to quote or answer in other songs: scale degrees 3 3 5 8 in a gallop
// (eighth, two sixteenths, a held note):  in C,  e8 e16 g16 >c2 .
import type { JingleId, MusicId } from '../contract'
import type { Tone } from './synth'

export type VoiceId = 'p1' | 'p2' | 'tri' | 'noise'
export const VOICES: readonly VoiceId[] = ['p1', 'p2', 'tri', 'noise']

/** Pulse width in percent: 12 is thin and nasal (12.5%), 25 is the classic lead, 50 is hollow and soft. */
export type Duty = 12 | 25 | 50

export interface Instrument {
  duty?: Duty
  /** Pulse width for each 1/60 s from the start of the note, the last one held. [12, 25, 50] opens like a wah. */
  dutySeq?: Duty[]
  /** Level 0..1 at v15. */
  vol?: number
  /** Envelope: attack seconds, decay seconds down to `s` (a fraction of the level), release seconds. */
  a?: number
  d?: number
  s?: number
  r?: number
  /** Decay shape: 1 is a straight line, higher drops faster at first. */
  curve?: number
  /** Part of the written length that sounds: 1 legato, 0.5 staccato. The q command overrides it. */
  gate?: number
  /** Vibrato: depth in semitones, rate in Hz, seconds before it starts. */
  vib?: number
  vibRate?: number
  vibDelay?: number
  /** Start each note this many semitones off and glide onto it over scoopTime seconds. */
  scoop?: number
  scoopTime?: number
  /** Seconds per step of a {chip chord}. Default 1/60. */
  arpStep?: number
}

export interface Drum {
  /** Noise rate for each 1/60 s of the hit, the last one held: 0 is the brightest hiss, 15 the lowest rumble. */
  rate: number[]
  /** The short, metallic shift-register mode. */
  short?: boolean
  /** Level 0..1 at v15. */
  vol: number
  /** Seconds it rings (a later hit cuts it off). */
  len: number
  /** Decay shape: 1 is a straight line, higher is snappier. */
  curve?: number
  /**
   * Kick body. When a bass note starts with the hit, the triangle drops onto it from this many
   * semitones above, the way NES tunes fused kick and bass; in a bass rest the triangle plays a short thump.
   */
  thump?: number
}

export const INSTRUMENTS: Record<string, Instrument> = {
  /** The melody voice: classic 25% pulse, a touch of vibrato on held notes. */
  lead: { duty: 25, vol: 0.62, a: 0.002, d: 0.1, s: 0.7, r: 0.025, gate: 0.92, vib: 0.22, vibRate: 5.8, vibDelay: 0.22 },
  /** Thinner and more cutting. */
  bright: { duty: 12, vol: 0.64, a: 0.002, d: 0.08, s: 0.72, r: 0.025, gate: 0.9, vib: 0.2, vibRate: 6, vibDelay: 0.2 },
  /** Hollow square for harmony lines under the lead. */
  soft: { duty: 50, vol: 0.4, a: 0.004, d: 0.12, s: 0.75, r: 0.03, gate: 0.92 },
  /** Plucked: a thin click that rounds out and dies away. Good for broken chords. */
  pluck: { duty: 25, dutySeq: [12, 25], vol: 0.42, a: 0.001, d: 0.2, s: 0.18, r: 0.02, gate: 1, curve: 2 },
  /** Short off-beat chord stabs. */
  stab: { duty: 12, vol: 0.36, a: 0.001, d: 0.09, s: 0.3, r: 0.015, gate: 0.5 },
  /** Quiet held notes. */
  pad: { duty: 50, vol: 0.3, a: 0.03, d: 0, s: 1, r: 0.05, gate: 1 },
  /** A bell or chime: rings down to nothing. */
  bell: { duty: 25, dutySeq: [12, 12, 25], vol: 0.5, a: 0.001, d: 0.6, s: 0, r: 0.02, gate: 1, curve: 1.8 },
  /** The comic trombone: the pulse opens up as the note sounds, with a wide wobble. */
  wah: { dutySeq: [12, 12, 12, 12, 25, 25, 25, 25, 50], vol: 0.6, a: 0.012, d: 0.4, s: 0.6, r: 0.06, gate: 0.96, vib: 0.45, vibRate: 5, vibDelay: 0.18 },
  /** Triangle bass, slightly detached so a walking line bounces. */
  bass: { vol: 1, a: 0.001, d: 0, s: 1, r: 0.012, gate: 0.86 },
  /** Triangle held for its whole length. */
  sub: { vol: 1, a: 0.001, d: 0, s: 1, r: 0.02, gate: 1 },
}

// Levels follow the real chip, where noise at full volume is about two thirds as strong as a pulse
// at full volume: a snare sits just under the lead (lead 0.62), and the kick gets its weight from
// the triangle thump, not from more noise.
export const DRUMS: Record<string, Drum> = {
  k: { rate: [9, 12, 14, 15], vol: 0.62, len: 0.1, curve: 1.5, thump: 12 },
  s: { rate: [5, 8, 8, 9], vol: 0.52, len: 0.15, curve: 1.6 },
  h: { rate: [1], vol: 0.24, len: 0.035, curve: 1.4 },
  o: { rate: [1], vol: 0.24, len: 0.2, curve: 1.2 },
  c: { rate: [3, 4], vol: 0.42, len: 0.65, curve: 2 },
  t: { rate: [10, 11, 12, 13], vol: 0.56, len: 0.14, curve: 1.3 },
  m: { rate: [8, 9, 10, 11], vol: 0.52, len: 0.12, curve: 1.3 },
  x: { rate: [4], short: true, vol: 0.3, len: 0.03, curve: 1.4 },
  n: { rate: [0], vol: 0.16, len: 0.05, curve: 1.2 },
}

const DEFAULT_INST: Record<VoiceId, string> = { p1: 'lead', p2: 'soft', tri: 'bass', noise: '' }

export type PartDef = Partial<Record<VoiceId, string>> & {
  /** Chord symbols, bars split by '|': 'C | Am7 | F G | C'. Used by the harmony report only. */
  chords?: string
}

export interface SongDef {
  id: MusicId | JingleId
  title: string
  /** 'C', 'F major', 'E minor', 'D dorian' ... */
  key: string
  /** Quarter notes per minute. */
  tempo: number
  /** Beats per bar. Default 4. */
  meter?: number
  /** False for a jingle. */
  loop: boolean
  /** Text prepended to that voice in every part. */
  setup?: Partial<Record<VoiceId, string>>
  parts: Record<string, PartDef>
  /** Part names played once before the loop, separated by spaces. */
  intro?: string
  /** Part names in order, separated by spaces. This is what loops. */
  play: string
  instruments?: Record<string, Instrument>
  /** Extra or replacement drums. Letters r, l, v and q are taken. */
  drums?: Record<string, Drum>
  /** Playback gain in dB, -6 to 6, for a song that is quieter to the ear than the others (see Loudness above). */
  gainDb?: number
  /**
   * Songs this one quotes on purpose (the ending reprising the title). The comparison pass
   * (audio-render.mjs --compare) then lists what they share as a quote, not as something to look at.
   */
  quotes?: (MusicId | JingleId)[]
}

export function defineSong(def: SongDef): SongDef {
  return def
}

/* ------------------------------------------------------------------ */
/* Keys and chords (for validation and the harmony report)             */
/* ------------------------------------------------------------------ */

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const PC_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

const MODES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  // Natural minor plus the raised seventh, which minor-key tunes use all the time.
  minor: [0, 2, 3, 5, 7, 8, 10, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  wholetone: [0, 2, 4, 6, 8, 10],
}

const CHORD_SHAPES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '9': [0, 4, 7, 10, 2],
  add9: [0, 4, 7, 2],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
}

export interface KeyInfo {
  name: string
  tonic: number
  mode: string
  /** Pitch classes (0 = C) in the key. */
  pcs: number[]
}

export interface ChordInfo {
  name: string
  root: number
  bass: number
  /** Pitch classes in the chord. Empty for 'N' (no chord). */
  pcs: number[]
}

function readRoot(s: string): { pc: number; rest: string } | null {
  const base = LETTER_PC[s[0]?.toUpperCase() ?? '']
  if (base === undefined) return null
  let pc = base
  let i = 1
  while (s[i] === '#' || s[i] === 'b') {
    pc += s[i] === '#' ? 1 : -1
    i++
  }
  return { pc: ((pc % 12) + 12) % 12, rest: s.slice(i) }
}

export function parseKey(key: string): KeyInfo | null {
  const r = readRoot(key.trim())
  if (!r) return null
  let mode = r.rest.trim().toLowerCase()
  if (mode === '' || mode === 'maj') mode = 'major'
  if (mode === 'm' || mode === 'min') mode = 'minor'
  const steps = MODES[mode]
  if (!steps) return null
  return { name: key, tonic: r.pc, mode, pcs: steps.map((s) => (r.pc + s) % 12) }
}

export function parseChord(sym: string): ChordInfo | null {
  if (sym === 'N' || sym === '-') return { name: sym, root: -1, bass: -1, pcs: [] }
  const [main, slash] = sym.split('/')
  const r = readRoot(main)
  if (!r) return null
  const shape = CHORD_SHAPES[r.rest]
  if (!shape) return null
  let bass = r.pc
  if (slash !== undefined) {
    const b = readRoot(slash)
    if (!b || b.rest) return null
    bass = b.pc
  }
  return { name: sym, root: r.pc, bass, pcs: shape.map((s) => (r.pc + s) % 12) }
}

export function pcName(pc: number): string {
  return PC_NAMES[((pc % 12) + 12) % 12]
}

export function noteName(midi: number): string {
  return pcName(midi) + (Math.floor(midi / 12) - 1)
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Ticks per quarter note. Whole numbers keep bar arithmetic exact, triplets included. */
const TPB = 960
const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const RANGE: Record<string, [number, number]> = { p1: [33, 108], p2: [33, 108], tri: [24, 96] }
const MAX_PROBLEMS = 40

interface RawNote {
  at: number
  ticks: number
  pitches: number[]
  drum: string
  inst: string
  vol: number
  /** 0..1, or -1 to use the instrument's own. */
  gate: number
  bend: number
}

interface Parsed {
  notes: RawNote[]
  ticks: number
}

function beatsText(ticks: number): string {
  return String(Math.round((ticks / TPB) * 1000) / 1000)
}

function parseVoice(
  src: string,
  voice: VoiceId,
  barTicks: number,
  insts: Record<string, Instrument>,
  drums: Record<string, Drum>,
  where: string,
  problems: string[],
): Parsed {
  const notes: RawNote[] = []
  const isDrum = voice === 'noise'
  const range = RANGE[voice]
  let pos = 0
  let oct = 4
  let len = TPB / 2
  let vol = 12
  let gate = -1
  let inst = DEFAULT_INST[voice]
  let depth = 0
  /** Where the bar being written began, and its number in the part. Each bar is judged on its own, so one wrong bar gives one message. */
  let barStart = 0
  let barNo = 1
  /** What a ^ after a space or a bar line lengthens. */
  let last: RawNote | 'rest' | null = null
  // Every message says which bar of the part it is in and shows the text around the spot.
  const fail = (msg: string, s = '', at = -1, bar = barNo + Math.floor((pos - barStart) / barTicks)) => {
    if (problems.length >= MAX_PROBLEMS) return
    const near = at >= 0 ? ` (near "${s.slice(Math.max(0, at - 14), at + 14).replace(/\s+/g, ' ').trim()}")` : ''
    problems.push(`${where}, bar ${bar}: ${msg}${near}`)
  }
  const checkBar = (s: string, at: number, end: boolean): void => {
    const got = pos - barStart
    if (got % barTicks !== 0) fail(`${end ? 'the last bar' : 'this bar'} has ${beatsText(got)} beats, not ${beatsText(barTicks)}`, s, at, barNo)
    // A long note or rest may span several bars between two bar lines.
    if (got > 0) barNo += Math.max(1, Math.round(got / barTicks))
    barStart = pos
  }

  const run = (s: string): void => {
    let i = 0
    const digits = (): number => {
      let j = i
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j++
      if (j === i) return NaN
      const v = Number(s.slice(i, j))
      i = j
      return v
    }
    const oneLen = (): number => {
      const from = i
      const n = digits()
      let t = len
      if (!Number.isNaN(n)) {
        if (n <= 0 || (4 * TPB) % n !== 0) fail(`${n} is not a note length (use 1 2 4 8 16 32, or 6 12 24 for triplets)`, s, from)
        else t = (4 * TPB) / n
      }
      let add = t
      while (s[i] === '.') {
        add /= 2
        t += add
        i++
      }
      return t
    }
    const fullLen = (): number => {
      let t = oneLen()
      while (s[i] === '^') {
        i++
        t += oneLen()
      }
      return t
    }
    const bendAfter = (): number => {
      if (s[i] !== '~') return 0
      const m = /^~([+-]?\d+(?:\.\d+)?)/.exec(s.slice(i, i + 12))
      if (!m) {
        fail('~ needs a number of semitones, like ~-2', s, i)
        i++
        return 0
      }
      i += m[0].length
      return Number(m[1])
    }
    const pitchAt = (o: number): number => {
      const from = i
      let semi = SEMI[s[i]]
      i++
      while (s[i] === '+' || s[i] === '#') {
        semi++
        i++
      }
      while (s[i] === '-') {
        semi--
        i++
      }
      const p = (o + 1) * 12 + semi
      if (range && (p < range[0] || p > range[1])) fail(`${noteName(p)} is outside what this voice can play (${noteName(range[0])} to ${noteName(range[1])}): check the octave`, s, from)
      return p
    }
    const push = (pitches: number[], drum: string): void => {
      const ticks = fullLen()
      const bend = isDrum ? 0 : bendAfter()
      const note: RawNote = { at: pos, ticks, pitches, drum, inst, vol, gate, bend }
      notes.push(note)
      last = note
      pos += ticks
    }

    while (i < s.length) {
      const c = s[i]
      if (c === ' ' || c === '\n' || c === '\t' || c === '\r') {
        i++
      } else if (c === ';') {
        while (i < s.length && s[i] !== '\n') i++
      } else if (c === '|') {
        checkBar(s, i, false)
        i++
      } else if (c === '[') {
        let j = i + 1
        let open = 1
        while (j < s.length && open > 0) {
          if (s[j] === '[') open++
          else if (s[j] === ']') open--
          j++
        }
        if (open > 0) {
          fail('[ without ]', s, i)
          i++
          continue
        }
        const inner = s.slice(i + 1, j - 1)
        const from = i
        i = j
        let times = digits()
        if (Number.isNaN(times)) times = 2
        if (depth > 6 || times > 64) fail('repeat is too deep or too long', s, from)
        else {
          depth++
          for (let k = 0; k < times; k++) run(inner)
          depth--
        }
      } else if (c === ']') {
        fail('] without [', s, i)
        i++
      } else if (c === 'r') {
        i++
        pos += fullLen()
        last = 'rest'
      } else if (c === '^') {
        // A tie written after a space or a bar line: the way to hold a note across the bar.
        const from = i
        i++
        const t = fullLen()
        const onto: RawNote | 'rest' | null = last
        if (onto === null) fail('^ has no note before it to tie onto', s, from)
        else if (onto !== 'rest') onto.ticks += t
        pos += t
      } else if (c === 'l') {
        i++
        len = oneLen()
      } else if (c === 'v') {
        const from = i
        i++
        const n = digits()
        if (n >= 0 && n <= 15) vol = n
        else fail('v takes 0 to 15', s, from)
      } else if (c === 'q') {
        const from = i
        i++
        const n = digits()
        if (n >= 1 && n <= 8) gate = n / 8
        else fail('q takes 1 to 8', s, from)
      } else if (c === '@') {
        const m = /^@([A-Za-z0-9_]+)/.exec(s.slice(i, i + 40))
        const from = i
        i += m ? m[0].length : 1
        if (isDrum) fail('the noise voice has no instruments', s, from)
        else if (!m || !(m[1] in insts)) fail(`no instrument "${m ? m[1] : ''}" (there are: ${Object.keys(insts).join(', ')})`, s, from)
        else {
          inst = m[1]
          gate = -1
        }
      } else if (isDrum && c in drums) {
        i++
        push([], c)
      } else if (!isDrum && c === 'o') {
        const from = i
        i++
        const n = digits()
        if (n >= 0 && n <= 8) oct = n
        else fail('o takes 0 to 8', s, from)
      } else if (!isDrum && c === '>') {
        oct++
        i++
      } else if (!isDrum && c === '<') {
        oct--
        i++
      } else if (!isDrum && c in SEMI) {
        push([pitchAt(oct)], '')
      } else if (!isDrum && c === '{') {
        const from = i
        i++
        let o = oct
        const ps: number[] = []
        while (i < s.length && s[i] !== '}') {
          const ch = s[i]
          if (ch === '>') o++
          else if (ch === '<') o--
          else if (ch in SEMI) {
            ps.push(pitchAt(o))
            continue
          } else if (ch !== ' ') fail(`did not understand "${ch}" inside { }`, s, i)
          i++
        }
        i++
        if (ps.length) push(ps, '')
        else {
          fail('empty { }', s, from)
          // Its length still counts, as a rest, so the bar adds up and there is one message, not three.
          pos += fullLen()
          last = 'rest'
        }
      } else {
        const from = i
        i++
        if (/[A-Za-z]/.test(c)) {
          // A stray letter is counted as a rest of its length: one slip, one message, and the bars still add up.
          const t = fullLen()
          const hint = isDrum ? `the drums are ${Object.keys(drums).join(' ')}` : 'notes are c d e f g a b'
          fail(`did not understand "${s.slice(from, i)}" (${hint}); it is played as a rest`, s, from)
          pos += t
          last = 'rest'
        } else {
          while (i < s.length && /[0-9.]/.test(s[i])) i++
          fail(`did not understand "${s.slice(from, i)}"`, s, from)
        }
      }
    }
  }

  run(src)
  checkBar('', -1, true)
  return { notes, ticks: pos }
}

/* ------------------------------------------------------------------ */
/* Compiling                                                           */
/* ------------------------------------------------------------------ */

export interface NoteEvent {
  voice: VoiceId
  /** Start, in beats from the start of the song (intro included). */
  beat: number
  /** Written length in beats. */
  beats: number
  /** How long it actually sounds, in beats (drums: until the next hit at most). */
  sounds: number
  /** MIDI notes: one, or several for a chip chord. Empty for a drum. */
  pitches: number[]
  /** Drum letter, '' for a note. */
  drum: string
  inst: Instrument
  /** 0..15 */
  vol: number
  bend: number
  part: string
  /** Bar number in the song, from 1. */
  bar: number
}

export interface ChordSpan {
  beat: number
  beats: number
  chord: ChordInfo
}

/** A song laid out on one timeline and checked. */
export interface Song {
  id: string
  def: SongDef
  loop: boolean
  tempo: number
  meter: number
  key: KeyInfo | null
  events: NoteEvent[]
  chords: ChordSpan[]
  /** Where each part of intro + play landed. */
  layout: { part: string; beat: number; beats: number }[]
  introBeats: number
  /** Total length, intro included. */
  beats: number
  /** Everything the checks found, in plain words. Empty means clean. */
  problems: string[]
  /** False when there is nothing playable at all. */
  ok: boolean
  /** Gain to play the rendered song at: def.gainDb as a factor, 1 without one. */
  level: number
}

interface PartData {
  voices: Partial<Record<VoiceId, RawNote[]>>
  ticks: number
  chords: { at: number; ticks: number; chord: ChordInfo }[]
}

function words(s: string | undefined): string[] {
  return typeof s === 'string' ? s.split(/\s+/).filter(Boolean) : []
}

export function compileSong(def: SongDef): Song {
  const problems: string[] = []
  const note = (msg: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push(msg)
  }
  // A song file is written by hand: whatever is missing or mistyped becomes a message, never a throw.
  const meter = Number.isInteger(def.meter) && (def.meter as number) > 0 && (def.meter as number) <= 12 ? (def.meter as number) : 4
  if (def.meter !== undefined && def.meter !== meter) note(`meter ${def.meter} is not understood (quarter notes per bar, 1 to 12); using 4`)
  const barTicks = meter * TPB
  const insts = { ...INSTRUMENTS, ...def.instruments }
  const drums = { ...DRUMS, ...def.drums }
  for (const letter of Object.keys(def.drums ?? {})) {
    if (letter.length !== 1 || 'rlvq'.includes(letter)) note(`drum "${letter}": use one letter other than r, l, v, q`)
  }
  const key = typeof def.key === 'string' ? parseKey(def.key) : null
  if (!key) note(`key "${def.key}" is not understood (try "C", "E minor", "D dorian")`)
  if (!(def.tempo >= 40 && def.tempo <= 300)) note(`tempo ${def.tempo} is outside 40 to 300`)
  // Web Audio throws on a gain that is not a number, and much more than 6 dB would push a song past the limiter's ceiling.
  let level = 1
  if (def.gainDb !== undefined) {
    if (typeof def.gainDb === 'number' && def.gainDb >= -6 && def.gainDb <= 6) level = 10 ** (def.gainDb / 20)
    else note(`gainDb ${def.gainDb} is outside -6 to 6; the song plays without it`)
  }
  const allParts = def.parts ?? {}

  const cache = new Map<string, PartData | null>()
  const part = (name: string): PartData | null => {
    if (cache.has(name)) return cache.get(name) ?? null
    const p = Object.prototype.hasOwnProperty.call(allParts, name) ? allParts[name] : undefined
    let data: PartData | null = null
    if (!p) note(`no part called "${name}" (the parts are: ${Object.keys(allParts).join(', ') || 'none'})`)
    else {
      data = { voices: {}, ticks: 0, chords: [] }
      const lens: [VoiceId, number][] = []
      for (const v of VOICES) {
        const text = p[v]
        if (text === undefined) continue
        if (typeof text !== 'string') {
          note(`part ${name}, ${v}: the music must be text in quotes`)
          continue
        }
        const parsed = parseVoice(`${def.setup?.[v] ?? ''}\n${text}`, v, barTicks, insts, drums, `part ${name}, ${v}`, problems)
        data.voices[v] = parsed.notes
        lens.push([v, parsed.ticks])
        data.ticks = Math.max(data.ticks, parsed.ticks)
      }
      for (const [v, t] of lens) {
        if (t !== data.ticks) note(`part ${name}: ${v} is ${beatsText(t)} beats long but the longest voice is ${beatsText(data.ticks)}`)
      }
      if (typeof p.chords === 'string') {
        const bars = p.chords.split('|').map((b) => words(b))
        // A bar line after the last chord is not one more, empty, bar.
        if (bars.length > 1 && bars[bars.length - 1].length === 0) bars.pop()
        if (bars.length * barTicks !== data.ticks) note(`part ${name}: chords cover ${bars.length} bars, the music is ${beatsText(data.ticks / meter)} bars`)
        bars.forEach((syms, b) => {
          syms.forEach((sym, k) => {
            const chord = parseChord(sym)
            if (!chord) note(`part ${name}: chord "${sym}" is not understood`)
            else data?.chords.push({ at: b * barTicks + (k * barTicks) / syms.length, ticks: barTicks / syms.length, chord })
          })
        })
      }
    }
    cache.set(name, data)
    return data
  }

  const intro = words(def.intro)
  const order = [...intro, ...words(def.play)]
  if (order.length === intro.length) note('`play` is empty')
  const events: NoteEvent[] = []
  const chords: ChordSpan[] = []
  const layout: Song['layout'] = []
  let at = 0
  let introTicks = 0
  order.forEach((name, idx) => {
    if (idx === intro.length) introTicks = at
    const data = part(name)
    if (!data) return
    layout.push({ part: name, beat: at / TPB, beats: data.ticks / TPB })
    for (const v of VOICES) {
      for (const n of data.voices[v] ?? []) {
        const inst = insts[n.inst] ?? {}
        const gate = n.drum ? 1 : n.gate >= 0 ? n.gate : (inst.gate ?? 0.9)
        const bar = Math.floor((at + n.at) / barTicks) + 1
        events.push({
          voice: v,
          beat: (at + n.at) / TPB,
          beats: n.ticks / TPB,
          sounds: (n.ticks / TPB) * gate,
          pitches: n.pitches,
          drum: n.drum,
          inst,
          vol: n.vol,
          bend: n.bend,
          part: name,
          bar,
        })
      }
    }
    for (const c of data.chords) chords.push({ beat: (at + c.at) / TPB, beats: c.ticks / TPB, chord: c.chord })
    at += data.ticks
  })
  if (intro.length && !def.loop) note('a jingle has no use for `intro`: put everything in `play`')

  const introBeats = introTicks / TPB
  const beats = at / TPB
  // A drum rings until the next hit, but never across the loop point or the end.
  const hits = events.filter((e) => e.voice === 'noise').sort((a, b) => a.beat - b.beat)
  hits.forEach((e, i) => {
    const wall = e.beat < introBeats ? introBeats : beats
    const next = i + 1 < hits.length ? hits[i + 1].beat : wall
    e.sounds = Math.min(next, wall) - e.beat
  })
  events.sort((a, b) => a.beat - b.beat || VOICES.indexOf(a.voice) - VOICES.indexOf(b.voice))

  return {
    id: String(def.id),
    def,
    loop: !!def.loop,
    tempo: def.tempo,
    meter,
    key,
    events,
    chords,
    layout,
    introBeats,
    beats,
    problems,
    ok: beats > 0 && events.length > 0 && def.tempo > 0,
    level,
  }
}

const DUTY: Record<number, number> = { 12: 0.125, 25: 0.25, 50: 0.5 }

/** Turn a song into synth tones. tempoScale above 1 plays faster; envelopes keep their real-time lengths. */
export function songTones(song: Song, tempoScale = 1): { tones: Tone[]; seconds: number; loopStart: number } {
  const spb = 60 / (song.tempo * tempoScale)
  const drums = { ...DRUMS, ...song.def.drums }
  const tones: Tone[] = []
  const bassAt = new Map<number, Tone>()
  const bass: NoteEvent[] = []
  for (const e of song.events) {
    if (e.voice === 'noise') continue
    const i = e.inst
    const len = e.sounds * spb
    const tone: Tone = {
      t: e.beat * spb,
      len,
      wave: e.voice === 'tri' ? 'tri' : 'pulse',
      pitch: e.pitches[0],
      vol: ((i.vol ?? 0.5) * e.vol) / 15,
      duty: DUTY[i.duty ?? 50],
      a: i.a,
      d: i.d,
      s: i.s,
      r: i.r,
      curve: i.curve,
    }
    if (i.dutySeq) tone.dutySeq = i.dutySeq.map((d) => DUTY[d])
    if (e.pitches.length > 1) {
      tone.arp = e.pitches.map((p) => p - e.pitches[0])
      tone.arpStep = i.arpStep
    }
    if (i.scoop) {
      tone.from = i.scoop
      tone.fromTime = i.scoopTime
    }
    if (i.vib) {
      tone.vib = i.vib
      tone.vibRate = i.vibRate
      tone.vibDelay = i.vibDelay
    }
    if (e.bend) tone.bend = e.bend
    if (e.voice === 'tri') {
      bassAt.set(e.beat, tone)
      bass.push(e)
    }
    tones.push(tone)
  }
  for (const e of song.events) {
    if (e.voice !== 'noise') continue
    const d = drums[e.drum]
    if (!d) continue
    const t = e.beat * spb
    tones.push({
      t,
      len: Math.min(d.len, e.sounds * spb),
      wave: 'noise',
      pitch: d.rate[0],
      arp: d.rate.length > 1 ? d.rate.map((r) => r - d.rate[0]) : undefined,
      arpHold: true,
      short: d.short,
      vol: (d.vol * e.vol) / 15,
      a: 0.0005,
      d: d.len,
      s: 0,
      curve: d.curve ?? 1.4,
    })
    if (d.thump) {
      const on = bassAt.get(e.beat)
      if (on) {
        if (!on.from) {
          on.from = d.thump
          on.fromTime = 0.03
        }
      } else if (!bass.some((b) => b.beat < e.beat + 0.08 / spb && b.beat + b.sounds > e.beat)) {
        const wall = (e.beat < song.introBeats ? song.introBeats : song.beats) * spb
        tones.push({ t, len: Math.min(0.07, wall - t), wave: 'tri', pitch: 43, vol: (0.9 * e.vol) / 15, from: d.thump, fromTime: 0.045, d: 0.07, s: 0 })
      }
    }
  }
  return { tones, seconds: song.beats * spb, loopStart: song.loop ? song.introBeats * spb : -1 }
}

/** Length of a song in seconds, without rendering it. */
export function songSeconds(song: Song, tempoScale = 1): number {
  return (song.beats * 60) / (song.tempo * tempoScale)
}
