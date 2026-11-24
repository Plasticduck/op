// Every sound effect, as a handful of chip tones each. Pitches are MIDI notes
// (60 = middle C, 72 = C5, 84 = C6); noise "pitch" is the rate index, 0 the
// brightest hiss and 15 the lowest rumble. Times are seconds.
//
// The ones heard all the time (jump, sprayHit, coin, tally, menuMove) are kept
// quiet, short and hollow so they never tire the ear. Check levels with
// `node scripts/maxx/audio-render.mjs`.
import type { SfxId } from '../contract'
import type { Tone } from './synth'

export interface SfxDef {
  tones: Tone[]
  /** How many copies may sound at once; a new one fades the oldest out. Default 2. */
  max?: number
  /** Seconds before it may be triggered again. Default 0.03. */
  gap?: number
  /** Still plays while the game is paused (menu sounds). */
  ui?: boolean
}

type Opt = Partial<Tone>

const pulse = (t: number, len: number, pitch: number, vol: number, o: Opt = {}): Tone => ({ wave: 'pulse', duty: 0.25, t, len, pitch, vol, ...o })
const tri = (t: number, len: number, pitch: number, vol: number, o: Opt = {}): Tone => ({ wave: 'tri', t, len, pitch, vol, ...o })
const noise = (t: number, len: number, rate: number, vol: number, o: Opt = {}): Tone => ({ wave: 'noise', t, len, pitch: rate, vol, ...o })
/** Dies away over its whole length. */
const fade = (len: number, curve = 1.2): Opt => ({ d: len, s: 0, curve })
/** Equal notes one after another. */
const run = (t: number, step: number, len: number, pitches: number[], vol: number, o: Opt = {}): Tone[] =>
  pitches.map((p, i) => pulse(t + i * step, len, p, vol, o))

export const SFX: Record<SfxId, SfxDef> = {
  // Rising blip, hollow and quiet: it is the most played sound in the game.
  jump: {
    max: 1,
    gap: 0.05,
    tones: [pulse(0, 0.14, 67, 0.24, { duty: 0.5, bend: 9, bendTime: 0.1, d: 0.14, s: 0.3 })],
  },
  land: {
    max: 1,
    gap: 0.06,
    tones: [tri(0, 0.07, 48, 0.45, { bend: -10, ...fade(0.07) }), noise(0, 0.04, 12, 0.18, fade(0.04))],
  },
  // Boot squeak over a short scrape.
  skid: {
    max: 1,
    gap: 0.12,
    tones: [
      noise(0, 0.18, 3, 0.13, { bend: 2.5, d: 0.18, s: 0.25 }),
      pulse(0, 0.16, 90, 0.06, { duty: 0.125, bend: -3, vib: 0.5, vibRate: 34, d: 0.16, s: 0.3 }),
    ],
  },
  bump: {
    gap: 0.06,
    tones: [tri(0, 0.08, 55, 0.6, { bend: -9, ...fade(0.08) }), pulse(0, 0.035, 50, 0.16, fade(0.035))],
  },
  // A cinder block coming apart: crack, then rubble.
  brick: {
    tones: [
      noise(0, 0.07, 7, 0.5, { bend: 2, d: 0.07, s: 0.1 }),
      noise(0.02, 0.05, 6, 0.26, { short: true, ...fade(0.05) }),
      noise(0.05, 0.2, 9, 0.42, { bend: 4, ...fade(0.2, 1.5) }),
      tri(0, 0.1, 43, 0.5, { bend: -12, ...fade(0.1) }),
    ],
  },
  // Two-note ding, a fifth apart, with a faint glint an octave up.
  coin: {
    gap: 0.04,
    tones: [
      pulse(0, 0.05, 88, 0.22, { duty: 0.5 }),
      pulse(0.05, 0.26, 95, 0.22, { duty: 0.5, ...fade(0.26, 1.3) }),
      pulse(0.08, 0.14, 107, 0.05, { duty: 0.125, ...fade(0.14) }),
    ],
  },
  // A gold token: an E major run that hangs in the air.
  token: {
    max: 1,
    tones: [
      ...run(0, 0.055, 0.06, [76, 80, 83, 88], 0.3),
      pulse(0.22, 0.42, 92, 0.3, { vib: 0.3, vibRate: 9, vibDelay: 0.1, ...fade(0.42) }),
      pulse(0.22, 0.42, 88, 0.15, { duty: 0.5, ...fade(0.42) }),
    ],
  },
  // Something pops out of a wash crate.
  prize: {
    tones: [...run(0, 0.03, 0.035, [60, 64, 67, 72, 76, 79], 0.26), pulse(0.18, 0.13, 84, 0.26, fade(0.13))],
  },
  // The turbo nozzle: three arpeggios, each a step higher.
  powerup: {
    max: 1,
    tones: [
      ...run(0, 0.045, 0.05, [60, 64, 67, 72], 0.3),
      ...run(0.18, 0.045, 0.05, [62, 66, 69, 74], 0.3),
      ...run(0.36, 0.045, 0.05, [64, 68, 71, 76], 0.3),
      pulse(0.54, 0.28, 88, 0.3, { vib: 0.3, vibRate: 8, vibDelay: 0.08, ...fade(0.28) }),
      tri(0, 0.17, 48, 0.5),
      tri(0.18, 0.17, 50, 0.5),
      tri(0.36, 0.17, 52, 0.5),
      tri(0.54, 0.26, 52, 0.5, fade(0.26)),
    ],
  },
  // A bubble restores a shine pip: three soft notes, each scooped from below.
  heal: {
    max: 1,
    tones: [
      pulse(0, 0.09, 79, 0.22, { duty: 0.5, from: -3, fromTime: 0.05 }),
      pulse(0.09, 0.09, 84, 0.22, { duty: 0.5, from: -3, fromTime: 0.05 }),
      pulse(0.18, 0.24, 88, 0.22, { duty: 0.5, from: -3, fromTime: 0.05, ...fade(0.24) }),
    ],
  },
  oneUp: {
    max: 1,
    tones: [
      ...run(0, 0.07, 0.075, [81, 85, 88, 93], 0.32),
      pulse(0.28, 0.1, 90, 0.32),
      pulse(0.38, 0.32, 95, 0.32, { vib: 0.25, vibRate: 8, vibDelay: 0.1, ...fade(0.32) }),
      pulse(0.28, 0.1, 78, 0.14, { duty: 0.5 }),
      pulse(0.38, 0.32, 83, 0.14, { duty: 0.5, ...fade(0.32) }),
    ],
  },
  // Water on metal: a tick you stop noticing. Heard many times a second.
  sprayHit: {
    gap: 0.05,
    tones: [noise(0, 0.03, 2, 0.14, fade(0.03)), pulse(0, 0.02, 96, 0.05, { duty: 0.5, bend: -5, ...fade(0.02) })],
  },
  // A car comes clean: bright run up two octaves, then it twinkles.
  carClean: {
    gap: 0.08,
    tones: [
      ...run(0, 0.04, 0.05, [72, 76, 79, 84, 88, 91, 96], 0.32),
      pulse(0.28, 0.3, 84, 0.15, { duty: 0.5, arp: [0, 4, 7, 12], ...fade(0.3) }),
      pulse(0.3, 0.07, 103, 0.18, { duty: 0.125, ...fade(0.07) }),
      pulse(0.39, 0.07, 100, 0.16, { duty: 0.125, ...fade(0.07) }),
      pulse(0.48, 0.16, 103, 0.16, { duty: 0.125, ...fade(0.16) }),
      noise(0.3, 0.03, 0, 0.09, { short: true, ...fade(0.03) }),
      noise(0.39, 0.03, 0, 0.08, { short: true, ...fade(0.03) }),
      noise(0.48, 0.04, 0, 0.08, { short: true, ...fade(0.04) }),
    ],
  },
  // Beep-beep: two notes a major third apart sounding together, like a dual-tone horn.
  honk: {
    gap: 0.1,
    tones: [
      pulse(0, 0.1, 69, 0.24, { a: 0.004, r: 0.02 }),
      pulse(0, 0.1, 73, 0.24, { a: 0.004, r: 0.02 }),
      pulse(0.16, 0.2, 69, 0.24, { a: 0.004, r: 0.03 }),
      pulse(0.16, 0.2, 73, 0.24, { a: 0.004, r: 0.03 }),
    ],
  },
  // A sports car off screen: two revs, the second bigger.
  rev: {
    max: 1,
    gap: 0.3,
    tones: [
      pulse(0, 0.22, 40, 0.28, { bend: 12, bendTime: 0.18, vib: 0.7, vibRate: 30, r: 0.03 }),
      tri(0, 0.22, 28, 0.5, { bend: 12, bendTime: 0.18, r: 0.03 }),
      pulse(0.26, 0.5, 43, 0.3, { bend: 16, bendTime: 0.26, vib: 0.8, vibRate: 34, d: 0.5, s: 0.35 }),
      tri(0.26, 0.5, 31, 0.5, { bend: 16, bendTime: 0.26, d: 0.5, s: 0.35 }),
      noise(0.26, 0.5, 13, 0.1, { bend: -2, ...fade(0.5) }),
    ],
  },
  stomp: {
    tones: [
      pulse(0, 0.09, 74, 0.32, { duty: 0.5, bend: -16, bendTime: 0.08, d: 0.09, s: 0.2 }),
      noise(0, 0.05, 8, 0.28, fade(0.05)),
      tri(0, 0.06, 50, 0.4, { bend: -8, ...fade(0.06) }),
    ],
  },
  pop: {
    gap: 0.04,
    tones: [pulse(0, 0.045, 81, 0.28, { duty: 0.5, bend: 14, bendTime: 0.03, ...fade(0.045) }), noise(0, 0.02, 3, 0.14, fade(0.02))],
  },
  splat: {
    tones: [noise(0, 0.14, 8, 0.4, { bend: 5, ...fade(0.14, 1.3) }), tri(0, 0.09, 52, 0.5, { bend: -14, ...fade(0.09) })],
  },
  mudThrow: {
    tones: [noise(0, 0.16, 11, 0.28, { bend: -6, a: 0.03, ...fade(0.13) }), tri(0, 0.12, 43, 0.4, { bend: 12, ...fade(0.12) })],
  },
  // Losing a shine pip: a buzzing fall.
  hurt: {
    max: 1,
    tones: [
      pulse(0, 0.34, 74, 0.38, { bend: -15, vib: 1.2, vibRate: 19, d: 0.34, s: 0.3 }),
      pulse(0, 0.34, 67, 0.16, { duty: 0.125, bend: -15, vib: 1.2, vibRate: 19, d: 0.34, s: 0.3 }),
      noise(0, 0.07, 6, 0.32, fade(0.07)),
    ],
  },
  // Tire-stack boing.
  spring: {
    max: 1,
    tones: [
      pulse(0, 0.3, 52, 0.3, { duty: 0.5, bend: 22, bendTime: 0.2, vib: 1.4, vibRate: 15, d: 0.3, s: 0.2 }),
      tri(0, 0.3, 52, 0.4, { bend: 22, bendTime: 0.2, vib: 1.4, vibRate: 15, d: 0.3, s: 0.2 }),
    ],
  },
  // Down the drain: a gurgle that sinks two octaves.
  pipe: {
    max: 1,
    tones: [
      tri(0, 0.5, 62, 0.6, { bend: -24, vib: 2.2, vibRate: 11, d: 0.5, s: 0.3 }),
      pulse(0, 0.5, 74, 0.13, { duty: 0.5, bend: -24, vib: 2.2, vibRate: 11, d: 0.5, s: 0.2 }),
    ],
  },
  door: {
    max: 1,
    tones: [
      noise(0, 0.03, 11, 0.28, fade(0.03)),
      pulse(0.04, 0.07, 55, 0.2, { duty: 0.5 }),
      pulse(0.12, 0.12, 62, 0.2, { duty: 0.5, d: 0.12, s: 0.2 }),
    ],
  },
  checkpoint: {
    max: 1,
    tones: [
      ...run(0, 0.07, 0.08, [79, 83, 86], 0.3),
      pulse(0.21, 0.34, 91, 0.3, fade(0.34)),
      ...run(0, 0.07, 0.08, [71, 74, 79], 0.14, { duty: 0.5 }),
      pulse(0.21, 0.34, 83, 0.14, { duty: 0.5, ...fade(0.34) }),
    ],
  },
  // The clock is running out: three double beeps, each a notch higher.
  timeWarn: {
    max: 1,
    tones: [0, 1, 2].flatMap((k) => [
      pulse(k * 0.2, 0.05, 81 + k, 0.3, { duty: 0.125 }),
      pulse(k * 0.2 + 0.07, 0.08, 81 + k, 0.3, { duty: 0.125 }),
    ]),
  },
  // One tick of the score counting up. Played in a fast stream.
  tally: {
    max: 1,
    gap: 0.03,
    ui: true,
    tones: [pulse(0, 0.022, 93, 0.15, { duty: 0.5, d: 0.022, s: 0.3 })],
  },
  tallyEnd: {
    max: 1,
    ui: true,
    tones: [
      noise(0, 0.03, 1, 0.16, fade(0.03)),
      pulse(0, 0.07, 84, 0.26),
      pulse(0, 0.07, 88, 0.18, { duty: 0.5 }),
      pulse(0.08, 0.3, 91, 0.26, fade(0.3)),
      pulse(0.08, 0.3, 96, 0.18, { duty: 0.5, ...fade(0.3) }),
    ],
  },
  bossHit: {
    gap: 0.06,
    tones: [
      noise(0, 0.1, 7, 0.46, { bend: 3, ...fade(0.1) }),
      pulse(0, 0.14, 57, 0.34, { bend: -12, d: 0.14, s: 0.2 }),
      pulse(0, 0.06, 81, 0.18, { duty: 0.125, arp: [0, 6], ...fade(0.06) }),
    ],
  },
  // A boss goes down: five falling bursts, then the rumble.
  bossDown: {
    max: 1,
    tones: [
      ...[0, 1, 2, 3, 4].flatMap((k) => [
        noise(k * 0.16, 0.14, 6 + k, 0.5 - k * 0.04, { bend: 3, ...fade(0.14) }),
        pulse(k * 0.16, 0.14, 64 - 5 * k, 0.28, { bend: -7, arp: [0, 3, 7], d: 0.14, s: 0.3 }),
      ]),
      noise(0.8, 0.6, 12, 0.5, { bend: 3, ...fade(0.6, 1.4) }),
      tri(0.8, 0.5, 40, 0.7, { bend: -16, ...fade(0.5) }),
    ],
  },
  // A crack, then a rumble that rolls away.
  thunder: {
    max: 1,
    gap: 0.5,
    tones: [
      noise(0, 0.12, 5, 0.55, { bend: 6, d: 0.12, s: 0.3 }),
      noise(0.1, 0.6, 12, 0.46, { bend: 2, d: 0.6, s: 0.1 }),
      noise(0.45, 1, 14, 0.4, { bend: 1, a: 0.08, ...fade(0.9, 1.4) }),
      tri(0.05, 1.2, 31, 0.5, { bend: -6, vib: 3, vibRate: 7, ...fade(1.2) }),
    ],
  },
  // Ice forming: glassy high notes over a metallic shiver.
  freeze: {
    tones: [
      ...run(0, 0.035, 0.04, [91, 96, 100, 96], 0.2, { duty: 0.125 }),
      pulse(0.14, 0.2, 103, 0.2, { duty: 0.125, ...fade(0.2) }),
      noise(0, 0.25, 2, 0.09, { short: true, ...fade(0.25) }),
    ],
  },
  crumble: {
    tones: [
      ...[0, 1, 2, 3, 4].map((k) => noise(k * 0.05, 0.06, 8 + k, 0.38 - k * 0.05, fade(0.06))),
      tri(0, 0.2, 45, 0.3, { bend: -10, vib: 2, vibRate: 25, ...fade(0.2) }),
    ],
  },
  // The gun points down and holds him up: a soft rising whoosh.
  hover: {
    max: 1,
    gap: 0.15,
    tones: [noise(0, 0.2, 6, 0.12, { bend: -4, a: 0.03, ...fade(0.17) }), tri(0, 0.2, 62, 0.22, { bend: 6, a: 0.02, ...fade(0.18) })],
  },
  // Mighty Wax: a shimmer up a major seventh chord into a sparkling held chord.
  waxStart: {
    max: 1,
    tones: [
      ...run(0, 0.03, 0.04, [72, 76, 79, 83, 84, 88, 91, 95, 96], 0.28),
      pulse(0.27, 0.42, 84, 0.24, { arp: [0, 4, 7, 12], ...fade(0.42) }),
      pulse(0.27, 0.42, 96, 0.1, { duty: 0.125, vib: 0.4, vibRate: 10, ...fade(0.42) }),
    ],
  },
  menuMove: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.035, 79, 0.18, { duty: 0.5, d: 0.035, s: 0.3 })],
  },
  menuSelect: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.045, 79, 0.24), pulse(0.045, 0.13, 86, 0.24, fade(0.13))],
  },
  menuBack: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.045, 79, 0.22), pulse(0.045, 0.11, 72, 0.22, fade(0.11))],
  },
  pause: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.06, 81, 0.26), pulse(0.06, 0.06, 76, 0.26), pulse(0.15, 0.15, 69, 0.26, fade(0.15))],
  },
  unpause: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.05, 69, 0.24), pulse(0.05, 0.05, 76, 0.24), pulse(0.1, 0.13, 81, 0.24, fade(0.13))],
  },
  mapMove: {
    max: 1,
    ui: true,
    tones: [tri(0, 0.045, 60, 0.45, { bend: 5, ...fade(0.045) }), pulse(0, 0.03, 72, 0.1, { duty: 0.5, ...fade(0.03) })],
  },
  mapEnter: {
    max: 1,
    ui: true,
    tones: [
      ...run(0, 0.04, 0.05, [67, 72, 76, 79, 84], 0.28),
      pulse(0.2, 0.26, 88, 0.26, fade(0.26)),
      pulse(0.2, 0.26, 84, 0.18, { duty: 0.5, ...fade(0.26) }),
      noise(0, 0.2, 8, 0.1, { bend: -6, a: 0.05, ...fade(0.15) }),
    ],
  },
  // Not allowed: two flat buzzes.
  locked: {
    max: 1,
    ui: true,
    tones: [pulse(0, 0.08, 46, 0.28), pulse(0.12, 0.11, 45, 0.28), noise(0, 0.08, 13, 0.1), noise(0.12, 0.11, 13, 0.1)],
  },
  // The grackle: a rusty "chk-KREE" that says look up. Two thin pulses a semitone apart make the
  // rasp. Short: it comes 20 ticks before the splat leaves, and twice as it flees.
  squawk: {
    max: 1,
    gap: 0.1,
    tones: [
      noise(0, 0.03, 3, 0.22, { short: true, ...fade(0.03) }),
      pulse(0, 0.035, 80, 0.16, { duty: 0.125, bend: -5, ...fade(0.035) }),
      pulse(0.05, 0.17, 89, 0.3, { duty: 0.125, from: -6, fromTime: 0.035, bend: -7, bendDelay: 0.07, vib: 0.8, vibRate: 38, d: 0.17, s: 0.35 }),
      pulse(0.05, 0.17, 90, 0.13, { duty: 0.25, from: -6, fromTime: 0.035, bend: -7, bendDelay: 0.07, d: 0.17, s: 0.3 }),
      noise(0.05, 0.12, 1, 0.07, { short: true, ...fade(0.12) }),
    ],
  },
  // A roll-up shutter going up: its slats clatter faster as the motor gets going, then it clunks
  // home at the top. Paced to the gate's 48-tick roll.
  gate: {
    max: 1,
    gap: 0.3,
    tones: [
      ...[0, 0.07, 0.135, 0.195, 0.25, 0.3, 0.345, 0.39, 0.43, 0.47, 0.51, 0.55, 0.59, 0.63, 0.67].map((t, k) =>
        noise(t, 0.028, k % 2 ? 5 : 4, 0.34 - k * 0.006, { short: true, ...fade(0.028) }),
      ),
      tri(0, 0.74, 31, 0.32, { bend: 7, bendTime: 0.5, vib: 0.35, vibRate: 24, a: 0.06, r: 0.04 }),
      pulse(0, 0.74, 43, 0.05, { duty: 0.125, bend: 7, bendTime: 0.5, vib: 0.35, vibRate: 24, a: 0.06, r: 0.04 }),
      noise(0.74, 0.1, 10, 0.4, fade(0.1, 1.4)),
      tri(0.74, 0.1, 40, 0.55, { bend: -10, ...fade(0.1) }),
    ],
  },
  // A floor button going down: a snap, the thunk of it seating, and a small bright blip because
  // something somewhere just changed.
  click: {
    max: 1,
    gap: 0.08,
    tones: [
      noise(0, 0.015, 2, 0.3, { short: true, ...fade(0.015) }),
      pulse(0, 0.02, 86, 0.16, { duty: 0.125, ...fade(0.02) }),
      tri(0.015, 0.07, 45, 0.5, { bend: -7, ...fade(0.07) }),
      pulse(0.07, 0.03, 84, 0.16, { duty: 0.5 }),
      pulse(0.1, 0.08, 91, 0.16, { duty: 0.5, ...fade(0.08) }),
    ],
  },
  // A barred door coming free (its 30-tick unlock): the key turns twice, the bars slide back,
  // the padlock drops with a thunk, and a bright fourth says the way is open.
  unlock: {
    max: 1,
    tones: [
      noise(0, 0.025, 4, 0.3, { short: true, ...fade(0.025) }),
      noise(0.07, 0.03, 3, 0.32, { short: true, ...fade(0.03) }),
      tri(0.07, 0.05, 52, 0.4, { bend: -5, ...fade(0.05) }),
      noise(0.12, 0.17, 7, 0.16, { bend: -3, a: 0.02, ...fade(0.15) }),
      pulse(0.12, 0.17, 55, 0.05, { duty: 0.125, bend: 5, vib: 0.6, vibRate: 30, ...fade(0.17) }),
      tri(0.3, 0.07, 43, 0.55, { bend: -8, ...fade(0.07) }),
      noise(0.3, 0.05, 9, 0.26, fade(0.05)),
      pulse(0.33, 0.07, 79, 0.24, { duty: 0.5 }),
      pulse(0.4, 0.24, 84, 0.24, { duty: 0.5, ...fade(0.24) }),
      pulse(0.4, 0.24, 91, 0.08, { duty: 0.125, vib: 0.3, vibRate: 9, vibDelay: 0.08, ...fade(0.24) }),
    ],
  },
  // A wash brush swinging round or a dryer blower kicking in: a motor spinning up and away, with
  // the flutter of the blades in it. Effects do not loop, so it is one short sweep.
  whir: {
    max: 1,
    gap: 0.2,
    tones: [
      tri(0, 0.42, 38, 0.5, { bend: 10, bendTime: 0.2, vib: 1.4, vibRate: 28, a: 0.04, d: 0.38, s: 0.15 }),
      pulse(0, 0.42, 62, 0.08, { duty: 0.125, bend: 10, bendTime: 0.2, vib: 1.4, vibRate: 28, a: 0.04, d: 0.38, s: 0.15 }),
      noise(0, 0.42, 6, 0.17, { bend: -3, bendTime: 0.2, a: 0.07, d: 0.35, s: 0.1 }),
    ],
  },
  // Hot wax hitting the air: a bright hiss with crackles in it. Short, because a sputtering jet
  // asks for one every 8 ticks and they string together.
  sizzle: {
    max: 2,
    gap: 0.06,
    tones: [
      noise(0, 0.16, 0, 0.26, { a: 0.008, d: 0.15, s: 0.15, curve: 1.6 }),
      noise(0.012, 0.012, 4, 0.28, { short: true }),
      noise(0.055, 0.012, 3, 0.24, { short: true }),
      noise(0.1, 0.012, 5, 0.2, { short: true }),
    ],
  },
  // A dump bed tipping: a hiss of air, the ram groaning up, then a clunk as it locks, before the
  // first clod leaves.
  hydraulic: {
    max: 1,
    tones: [
      noise(0, 0.22, 2, 0.27, { a: 0.01, d: 0.2, s: 0.15, curve: 1.5 }),
      tri(0.04, 0.42, 31, 0.5, { bend: 5, vib: 0.3, vibRate: 18, a: 0.05, r: 0.03 }),
      pulse(0.04, 0.42, 43, 0.09, { duty: 0.125, bend: 5, vib: 0.3, vibRate: 18, a: 0.06, r: 0.03 }),
      noise(0.46, 0.08, 10, 0.42, fade(0.08)),
      tri(0.46, 0.1, 40, 0.6, { bend: -10, ...fade(0.1) }),
      noise(0.48, 0.03, 4, 0.2, { short: true, ...fade(0.03) }),
    ],
  },
}

export const SFX_IDS = Object.keys(SFX) as SfxId[]
