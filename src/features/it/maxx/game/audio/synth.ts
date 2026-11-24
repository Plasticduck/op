// The chip synth. Pure maths: no DOM and no Web Audio in here, so the same
// code renders in the browser (index.ts plays the finished buffers) and in
// Node (scripts/maxx/audio-render.mjs writes WAV files and checks them).
//
// Everything is built from Tones: one oscillator burst with its own volume
// envelope and pitch movement. A song is a list of tones that never overlap
// inside a voice (each chip voice is monophonic, like the real thing) and
// every tone has faded to nothing by its own end. That is what makes loops
// seamless: there are no tails to carry across the seam.
import type { SfxId } from '../contract'
import { songTones } from './format'
import type { Song } from './format'
import { SFX } from './sfx'

export type Wave = 'pulse' | 'tri' | 'noise'

export interface Tone {
  /** Start, seconds from the start of the sound. */
  t: number
  /** Length in seconds. The tone is silent again by t + len. */
  len: number
  wave: Wave
  /** MIDI note, fractions allowed (60 = middle C). For noise: rate index 0 (brightest hiss) to 15 (lowest rumble). */
  pitch: number
  /** Peak level, 0..1. */
  vol: number
  /** Pulse width 0.125, 0.25 or 0.5. Default 0.5. */
  duty?: number
  /** Pulse width per step from the start of the tone, last one held. */
  dutySeq?: number[]
  /** Seconds per dutySeq step. Default 1/60. */
  dutyStep?: number
  /** Noise only: the short, metallic shift-register mode. */
  short?: boolean
  /** Envelope: attack seconds, decay seconds down to `s` (a fraction of vol), release seconds at the end. */
  a?: number
  d?: number
  s?: number
  r?: number
  /** Decay shape: 1 is a straight line, higher drops faster at first. */
  curve?: number
  /** Start this many semitones off pitch and glide onto it over fromTime seconds. */
  from?: number
  fromTime?: number
  /** Glide by this many semitones, starting at bendDelay and taking bendTime (default: the rest of the tone). */
  bend?: number
  bendDelay?: number
  bendTime?: number
  /** Vibrato depth in semitones, rate in Hz, delay in seconds. */
  vib?: number
  vibRate?: number
  vibDelay?: number
  /** Semitone offsets stepped through every arpStep seconds (the fast chip chord). */
  arp?: number[]
  arpStep?: number
  /** Stop on the last arp step instead of cycling. */
  arpHold?: boolean
}

export interface Sound {
  /** Mono samples, -1..1. */
  samples: Float32Array<ArrayBuffer>
  sampleRate: number
  /** Loop region in samples. loopEnd 0 means it plays once. */
  loopStart: number
  loopEnd: number
  /** Loudest sample before the limiter. Above LIMIT_KNEE the limiter was working. */
  prePeak: number
}

/** Where the samples go. The browser hands over an AudioBuffer's own memory, so a finished song is never copied. */
export type Alloc = (samples: number) => Float32Array<ArrayBuffer>

/** A render that can be done a bit at a time, so the browser never stalls on it. */
export interface RenderJob {
  /** Render about `budget` more samples of oscillator work. True once the sound is complete. */
  step(budget: number): boolean
  readonly done: boolean
  readonly sound: Sound
}

/** Below the knee the mix is untouched; above it peaks are bent smoothly under the ceiling. */
export const LIMIT_KNEE = 0.6
export const LIMIT_CEIL = 0.89

const SONG_GAIN = 0.5
const SFX_GAIN = 1
const CTRL = 16
const TAU = Math.PI * 2

/** The 2A03's sixteen noise clock rates, in Hz. */
const NOISE_HZ = [447443, 223722, 111861, 55930, 27965, 18643, 13983, 11186, 8860, 7046, 4710, 3523, 2349, 1762, 880, 440]

interface Table {
  n: number
  seq: Float64Array
  /** Running sum of seq, so any stretch of the wave can be averaged in one step (a box filter: no harsh aliasing). */
  cum: Float64Array
}

function table(values: number[]): Table {
  const n = values.length
  let mean = 0
  for (const v of values) mean += v
  mean /= n
  const seq = new Float64Array(n)
  const cum = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    seq[i] = values[i] - mean
    cum[i + 1] = cum[i] + seq[i]
  }
  return { n, seq, cum }
}

function shiftRegister(short: boolean): Table {
  const out: number[] = []
  let reg = 1
  do {
    const bit = (reg ^ (reg >> (short ? 6 : 1))) & 1
    reg = (reg >> 1) | (bit << 14)
    out.push(reg & 1 ? -0.5 : 0.5)
  } while (reg !== 1 && out.length < 32767)
  return table(out)
}

// The 2A03 triangle is a 4-bit staircase: 15 down to 0, then back up.
const TRI = table(Array.from({ length: 32 }, (_, i) => (i < 16 ? 15 - i : i - 16) / 15 - 0.5))
let noiseLong: Table | null = null
let noiseShort: Table | null = null

function noiseTable(short: boolean): Table {
  if (short) return (noiseShort ??= shiftRegister(true))
  return (noiseLong ??= shiftRegister(false))
}

function noiseRate(index: number): number {
  const i = Math.min(15, Math.max(0, index))
  const k = Math.min(14, Math.floor(i))
  return NOISE_HZ[k] * Math.pow(NOISE_HZ[k + 1] / NOISE_HZ[k], i - k)
}

interface Voice {
  tone: Tone
  start: number
  n: number
  i: number
  /** Oscillator phase 0..1, or the position in the shift-register sequence. */
  phase: number
  amp: number
  att: number
  dec: number
  rel: number
  sus: number
  curve: number
  tab: Table | null
}

function openTone(tone: Tone, sr: number, total: number, gain: number): Voice | null {
  const start = Math.max(0, Math.round(tone.t * sr))
  const n = Math.min(Math.round(tone.len * sr), total - start)
  if (n < 2 || tone.vol <= 0) return null
  // Never start or stop on a hard edge: a millisecond in, a few out.
  let att = Math.max(0.001, tone.a ?? 0.001) * sr
  let rel = Math.max(0.004, tone.r ?? 0.004) * sr
  if (att + rel > n) {
    const k = n / (att + rel)
    att *= k
    rel *= k
  }
  const tab = tone.wave === 'noise' ? noiseTable(!!tone.short) : tone.wave === 'tri' ? TRI : null
  let phase = 0
  // Start the triangle on its rising zero crossing (step 24 of 32): no thump, and in step with a pulse
  // playing the same note, so a doubled note gets louder instead of cancelling.
  if (tone.wave === 'tri') phase = 24
  else if (tab && !tone.short) phase = (Math.imul(start + 1, 2654435761) >>> 0) % tab.n
  return {
    tone,
    start,
    n,
    i: 0,
    phase,
    amp: tone.vol * gain,
    att,
    dec: Math.max(0, tone.d ?? 0) * sr,
    rel,
    sus: tone.s ?? 1,
    curve: tone.curve ?? 1,
    tab,
  }
}

function envAt(v: Voice, i: number): number {
  let e: number
  if (i < v.att) e = i / v.att
  else if (i < v.att + v.dec) {
    const x = 1 - (i - v.att) / v.dec
    e = v.sus + (1 - v.sus) * (v.curve === 1 ? x : Math.pow(x, v.curve))
  } else e = v.sus
  const left = v.n - i
  return left < v.rel ? (e * left) / v.rel : e
}

/** Render up to `budget` samples of one tone into `out`. Works in whole control blocks, so the result does not depend on how the work was sliced. */
function runTone(v: Voice, out: Float32Array, sr: number, budget: number): number {
  const tn = v.tone
  const from = tn.from ?? 0
  const fromTime = tn.fromTime ?? 0.04
  const bend = tn.bend ?? 0
  const bendDelay = tn.bendDelay ?? 0
  const bendTime = tn.bendTime ?? Math.max(0.001, tn.len - bendDelay)
  const vib = tn.vib ?? 0
  const vibRate = tn.vibRate ?? 6
  const vibDelay = tn.vibDelay ?? 0
  const arp = tn.arp
  const arpStep = tn.arpStep ?? 1 / 60
  const dutySeq = tn.dutySeq
  const dutyStep = tn.dutyStep ?? 1 / 60
  const tab = v.tab
  const begin = v.i
  let ph = v.phase
  while (v.i < v.n && v.i - begin < budget) {
    const i0 = v.i
    const i1 = Math.min(v.n, i0 + CTRL)
    const sec = i0 / sr
    let p = tn.pitch
    if (from !== 0 && sec < fromTime) p += from * (1 - sec / fromTime)
    if (bend !== 0 && sec > bendDelay) p += bend * Math.min(1, (sec - bendDelay) / bendTime)
    if (vib !== 0 && sec > vibDelay) {
      const u = sec - vibDelay
      p += vib * Math.min(1, u / 0.12) * Math.sin(TAU * vibRate * u)
    }
    if (arp && arp.length) {
      const k = Math.floor(sec / arpStep)
      p += arp[tn.arpHold ? Math.min(k, arp.length - 1) : k % arp.length]
    }
    let a = envAt(v, i0) * v.amp
    const da = (envAt(v, i1) * v.amp - a) / (i1 - i0)
    const o = v.start
    if (tn.wave === 'pulse') {
      const inc = Math.min(0.45, (440 * Math.pow(2, (p - 69) / 12)) / sr)
      let duty = tn.duty ?? 0.5
      if (dutySeq && dutySeq.length) duty = dutySeq[Math.min(dutySeq.length - 1, Math.floor(sec / dutyStep))]
      const hi = 1 - duty
      const lo = -duty
      for (let i = i0; i < i1; i++) {
        let s = ph < duty ? hi : lo
        // polyBLEP: round off both edges of the pulse so it does not alias.
        if (ph < inc) {
          const x = ph / inc
          s += 0.5 * (x + x - x * x - 1)
        } else if (ph > 1 - inc) {
          const x = (ph - 1) / inc
          s += 0.5 * (x * x + x + x + 1)
        }
        let q = ph - duty
        if (q < 0) q += 1
        if (q < inc) {
          const x = q / inc
          s -= 0.5 * (x + x - x * x - 1)
        } else if (q > 1 - inc) {
          const x = (q - 1) / inc
          s -= 0.5 * (x * x + x + x + 1)
        }
        out[o + i] += s * a
        a += da
        ph += inc
        if (ph >= 1) ph -= 1
      }
    } else if (tab) {
      // Triangle and noise: average the stepped wave over each sample.
      const n = tab.n
      const seq = tab.seq
      const cum = tab.cum
      const inc =
        tn.wave === 'tri'
          ? Math.min(0.45, (440 * Math.pow(2, (p - 69) / 12)) / sr) * n
          : Math.min(n / 2, noiseRate(p) / sr)
      let k = Math.floor(ph)
      let f0 = cum[k] + (ph - k) * seq[k]
      for (let i = i0; i < i1; i++) {
        ph += inc
        // The table sums to zero, so a step that wraps needs no correction.
        if (ph >= n) ph -= n
        k = Math.floor(ph)
        const f1 = cum[k] + (ph - k) * seq[k]
        out[o + i] += ((f1 - f0) / inc) * a
        a += da
        f0 = f1
      }
    }
    v.i = i1
  }
  v.phase = ph
  return v.i - begin
}

/** Render a list of tones into one buffer `seconds` long. `loopStartSec` below 0 means the sound plays once. */
export function tonesJob(tones: readonly Tone[], seconds: number, sampleRate: number, gain: number, loopStartSec = -1, alloc?: Alloc): RenderJob {
  const total = Math.max(1, Math.round(seconds * sampleRate))
  const out = alloc ? alloc(total) : new Float32Array(total)
  const loops = loopStartSec >= 0
  const sound: Sound = {
    samples: out,
    sampleRate,
    loopStart: loops ? Math.min(total - 1, Math.round(loopStartSec * sampleRate)) : 0,
    loopEnd: loops ? total : 0,
    prePeak: 0,
  }
  let ti = 0
  let cur: Voice | null = null
  let lim = 0
  let peak = 0
  let done = false
  const span = LIMIT_CEIL - LIMIT_KNEE
  return {
    get done() {
      return done
    },
    sound,
    step(budget: number): boolean {
      if (done) return true
      let left = Math.max(CTRL, budget)
      while (left > 0 && ti < tones.length) {
        if (!cur) {
          cur = openTone(tones[ti], sampleRate, total, gain)
          if (!cur) {
            ti++
            continue
          }
        }
        left -= runTone(cur, out, sampleRate, left)
        if (cur.i >= cur.n) {
          cur = null
          ti++
        }
      }
      if (ti >= tones.length && left > 0) {
        const end = Math.min(total, lim + left * 4)
        for (let i = lim; i < end; i++) {
          const x = out[i]
          const m = x < 0 ? -x : x
          if (m > peak) peak = m
          if (m > LIMIT_KNEE) {
            const y = LIMIT_KNEE + span * Math.tanh((m - LIMIT_KNEE) / span)
            out[i] = x < 0 ? -y : y
          }
        }
        lim = end
        if (lim >= total) {
          sound.prePeak = peak
          done = true
        }
      }
      return done
    },
  }
}

function finish(job: RenderJob): Sound {
  while (!job.step(1 << 20)) {
    /* run to the end */
  }
  return job.sound
}

/** A song or jingle, rendered a slice at a time. tempoScale above 1 plays it faster at the same pitch. */
export function songJob(song: Song, sampleRate: number, tempoScale = 1, alloc?: Alloc): RenderJob {
  const { tones, seconds, loopStart } = songTones(song, tempoScale)
  return tonesJob(tones, seconds, sampleRate, SONG_GAIN, loopStart, alloc)
}

export function renderSong(song: Song, sampleRate: number, tempoScale = 1): Sound {
  return finish(songJob(song, sampleRate, tempoScale))
}

export function sfxSeconds(id: SfxId): number {
  let end = 0
  for (const t of SFX[id].tones) end = Math.max(end, t.t + t.len)
  return end + 0.005
}

export function sfxJob(id: SfxId, sampleRate: number, alloc?: Alloc): RenderJob {
  return tonesJob(SFX[id].tones, sfxSeconds(id), sampleRate, SFX_GAIN, -1, alloc)
}

export function renderSfx(id: SfxId, sampleRate: number): Sound {
  return finish(sfxJob(id, sampleRate))
}

/**
 * The prep gun's hiss: about a second and a half of band-limited noise that
 * loops with no seam. The filters are run round the loop twice so their state
 * at the end equals their state at the start.
 */
export function sprayJob(sampleRate: number, alloc?: Alloc): RenderJob {
  const n = Math.round(sampleRate * 1.6)
  const out = alloc ? alloc(n) : new Float32Array(n)
  const sound: Sound = { samples: out, sampleRate, loopStart: 0, loopEnd: n, prePeak: 0 }
  // High-pass at 1.3 kHz (no rumble), then two gentle low-passes at 4.2 kHz. It is held for most of a
  // level, so it is a "shhh", not an "ssss": at 6.5 kHz two fifths of it sat above 6 kHz, on top of the hi-hats.
  const hp = Math.exp((-TAU * 1300) / sampleRate)
  const lp = 1 - Math.exp((-TAU * 4200) / sampleRate)
  const seed0 = 0x2f6e2b1
  let seed = seed0
  let h = 0
  let px = 0
  let l1 = 0
  let l2 = 0
  let sum = 0
  let peak = 0
  let pass = 0
  let i = 0
  let done = false
  return {
    get done() {
      return done
    },
    sound,
    step(budget: number): boolean {
      if (done) return true
      const end = Math.min(n, i + Math.max(64, budget))
      if (pass < 2) {
        for (; i < end; i++) {
          seed ^= seed << 13
          seed ^= seed >>> 17
          seed ^= seed << 5
          const x = ((seed >>> 0) / 4294967296) * 2 - 1
          h = hp * (h + x - px)
          px = x
          l1 += lp * (h - l1)
          l2 += lp * (l1 - l2)
          if (pass === 1) {
            // A slow, shallow swell, a whole number of times per loop: water pressure, not static.
            const y = l2 * (1 + 0.1 * Math.sin((TAU * 3 * i) / n) + 0.06 * Math.sin((TAU * 17 * i) / n))
            out[i] = y
            sum += y * y
          }
        }
      } else {
        const k = 0.1 / Math.sqrt(sum / n)
        for (; i < end; i++) {
          out[i] *= k
          peak = Math.max(peak, Math.abs(out[i]))
        }
      }
      if (i >= n) {
        i = 0
        pass++
        // The same noise again on the second lap, so the filters meet their own tail.
        seed = seed0
        if (pass === 3) {
          sound.prePeak = peak
          done = true
        }
      }
      return done
    },
  }
}

export function renderSpray(sampleRate: number): Sound {
  return finish(sprayJob(sampleRate))
}
