// The game's sound: createAudio() is the contract (AudioApi).
//
// The synth (synth.ts) is plain maths that renders whole songs and effects
// into sample buffers; Web Audio here only plays finished buffers. Rendering
// is done in slices of a few milliseconds between frames, so it never stalls
// the game, and nothing is scheduled note by note in real time.
//
// What callers can rely on, beyond the comments in the contract:
//   unlock()   Call it from every input, controller included. It does nothing until the
//              browser has seen a gesture it accepts, then makes the AudioContext (once).
//   music()    A song asked for early starts as soon as sound is allowed and it is rendered.
//              An id with no song file yet is silence and one console.debug.
//   jingle()   onDone is called exactly once: when the jingle ends, at once if another
//              jingle replaces it, or on the next tick if the jingle does not exist. It
//              still comes on time while the browser blocks sound. music() during a jingle
//              sets what plays after it.
//   stopJingle()  Cuts the jingle with no onDone. Without resume the music stays off until
//              the next music() call, which starts from the top whatever it names. With resume
//              the music goes on as if the jingle had ended now, except that its thenMusic is
//              dropped: a music() call made during the jingle still counts (a boss song asked
//              for under the versus jingle), otherwise the silenced song picks up where it was.
//   setTempoScale()  Re-renders the current song faster at the same pitch and swaps it in
//              at the same place (0.5 to 2, in steps of 0.05). Call it after music():
//              starting or restarting a song puts the tempo back to 1.
//   setPaused()  Holds song, jingle (and its onDone) and spray. Game effects asked for
//              while paused are dropped; menu effects (SfxDef.ui) still play.
//   sfx()      Dropped while the browser blocks sound, so nothing piles up to blare later.
//              At most ten sound at once; past that the oldest gives way.
//   Any call may be made any number of times in one tick. Twenty restarts of a song, or sixty
//   effects, in one tick cost twenty or sixty cheap calls and sound like one song and ten effects:
//   whatever is started and stopped in the same instant never reaches the speakers.
//   Arguments that make no sense (an unknown id, a volume that is not a number) are ignored.
import type { AudioApi, JingleId, MusicId, SfxId } from '../contract'
import { songSeconds } from './format'
import { SONGS } from './library'
import { SFX, SFX_IDS } from './sfx'
import { sfxJob, songJob, sprayJob } from './synth'
import type { Alloc, RenderJob, Sound } from './synth'

const RATE = 48000
/** Main-thread time one render slice may take. */
const SLICE_MS = 3
/** Samples of synth work between looks at the clock. */
const STEP = 2048
// Exported for scripts/maxx/tests/audio-songs.mjs, which holds the spray to its place under the music.
export const MUSIC_LEVEL = 0.6
export const SFX_LEVEL = 0.8
/**
 * The hiss is on for most of a level: about 8 dB under the music, to the ear. That is K-weighted loudness
 * (BS.1770), not RMS: the hiss sits where the ear is keenest, so 0.32, 8 dB down by RMS, was only 5.5 down.
 */
export const SPRAY_LEVEL = 0.24
/** Effects sounding at once, all kinds together. */
const MAX_VOICES = 10
/**
 * Seconds. A source stopped this soon after it started has barely sounded: it gets a very short
 * fade, and one stopped in the same instant is simply unplugged. Without this, twenty restarts
 * in one tick are twenty copies of a song fading out together.
 */
const YOUNG = 0.004
/** Rendered songs kept ready, by total length. A song is about 10 MB a minute. */
const CACHE_SECONDS = 170

export interface AudioDebug {
  /** 'none' until the AudioContext exists. */
  state: string
  sampleRate: number
  want: string | null
  song: { id: string; scale: number; pos: number } | null
  jingle: string | null
  paused: boolean
  spray: boolean
  voices: number
  sfxReady: number
  clips: string[]
  queued: number
  /** Render slices so far: how many, the longest and the total, in milliseconds. */
  slices: number
  worstSliceMs: number
  workMs: number
  /** Milliseconds from asking for a song to having it, by clip. */
  readyMs: Record<string, number>
}

/** What createAudio() returns: the contract, plus debug() and meter() for the dev page and the checks. */
export interface MaxxAudio extends AudioApi {
  /** Render these songs in the background so music() starts them at once. */
  preload(ids: (MusicId | JingleId)[]): void
  debug(): AudioDebug
  /** Dev and tests: the level over the last 40 ms or so at a point in the mix ('out' is before the final soft clip). */
  meter(at: 'music' | 'sfx' | 'out'): { rms: number; peak: number }
}

interface Clip {
  buf: AudioBuffer
  /** Seconds. loopEnd 0: plays once. */
  loopStart: number
  loopEnd: number
  dur: number
  /** Jingles are short and stay; songs are dropped oldest first. */
  keep: boolean
  /** The song's playback gain (Song.level). */
  level: number
}

interface Playing {
  clip: Clip
  src: AudioBufferSourceNode
  gain: GainNode
  /** Context time it started, and where in the clip. */
  t0: number
  off: number
}

interface Task {
  key: string
  pri: number
  make: () => RenderJob
  job: RenderJob | null
  done: (sound: Sound) => void
  asked: number
}

interface Voice {
  id: SfxId
  src: AudioBufferSourceNode
  gain: GainNode
  /** Context time it started. */
  t0: number
}

/** Stop a source without a click: a fade, or no sound at all if it was started in this same instant. */
function fadeOut(ctx: AudioContext, src: AudioBufferSourceNode, gain: GainNode, t0: number, fade: number): void {
  const now = ctx.currentTime
  if (now <= t0) {
    src.onended = null
    try {
      src.stop()
    } catch {
      /* never started */
    }
    src.disconnect()
    gain.disconnect()
    return
  }
  if (now - t0 < YOUNG) fade = Math.min(fade, 0.003)
  hold(gain.gain, now)
  gain.gain.linearRampToValueAtTime(0, now + fade)
  try {
    src.stop(now + fade + 0.004)
  } catch {
    /* already stopped */
  }
}

function hold(p: AudioParam, now: number): void {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(now)
  else {
    const v = p.value
    p.cancelScheduledValues(now)
    p.setValueAtTime(v, now)
  }
}

/** Straight through up to 0.7, then bent under 1 so a pile of effects cannot hard-clip. Input is pre-halved. */
function softClip(): Float32Array<ArrayBuffer> {
  const n = 4097
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2
    const m = Math.abs(x)
    const y = m <= 0.7 ? m : 0.7 + 0.28 * Math.tanh((m - 0.7) / 0.28)
    curve[i] = x < 0 ? -y : y
  }
  return curve
}

export function createAudio(): MaxxAudio {
  let ctx: AudioContext | null = null
  let dead = false
  let musicBus: GainNode | null = null
  let duck: GainNode | null = null
  let sfxBus: GainNode | null = null
  let outBus: GainNode | null = null
  let sprayGain: GainNode | null = null
  let sprayBuf: AudioBuffer | null = null
  let sprayRunning = false
  let resuming = false
  let musicVol = 1
  let sfxVol = 1
  let paused = false
  let sprayOn = false
  let ducked = false

  /** The song that should be playing, and how fast. */
  let want: MusicId | null = null
  let scale = 1
  /** The song that is sounding. */
  let song: (Playing & { id: MusicId; scale: number }) | null = null
  /** Where a silenced song stopped, in seconds at normal tempo, so it can pick up there. */
  let memo: { id: MusicId; at: number } | null = null
  let jing: {
    id: JingleId
    onDone?: () => void
    dur: number
    /** Milliseconds still to play. */
    left: number
    timer: number
    since: number
    play: Playing | null
    /** What was wanted before the jingle's thenMusic replaced it: stopJingle({ resume }) goes back to it. Gone once music() is called. */
    prior?: { want: MusicId | null; memo: { id: MusicId; at: number } | null }
  } | null = null

  const clips = new Map<string, Clip>()
  const sfxBufs = new Map<SfxId, AudioBuffer>()
  const voices: Voice[] = []
  const lastAt: Partial<Record<SfxId, number>> = {}
  const tasks: Task[] = []
  const missing = new Set<string>()
  const preloads = new Set<string>()
  const meters: Partial<Record<string, AnalyserNode>> = {}
  const stats = { slices: 0, worst: 0, work: 0, ready: {} as Record<string, number> }
  let chan: MessageChannel | null = null
  let scheduled = false

  const clipKey = (id: string, s: number) => (s === 1 ? id : `${id}@${s}`)
  const playable = (id: string) => !!SONGS[id]?.ok
  const complain = (id: string) => {
    if (missing.has(id)) return
    missing.add(id)
    console.debug(`[maxx audio] no song "${id}" yet`)
  }

  /* ---------------- rendering, a slice at a time ---------------- */

  function pump(): void {
    scheduled = false
    if (dead) return
    const t0 = performance.now()
    while (tasks.length) {
      let task = tasks[0]
      for (const t of tasks) if (t.pri < task.pri) task = t
      task.job ??= task.make()
      let done: boolean
      do done = task.job.step(STEP)
      while (!done && performance.now() - t0 < SLICE_MS)
      if (done) {
        tasks.splice(tasks.indexOf(task), 1)
        stats.ready[task.key] = Math.round(performance.now() - task.asked)
        task.done(task.job.sound)
      }
      if (performance.now() - t0 >= SLICE_MS) break
    }
    const took = performance.now() - t0
    stats.slices++
    stats.work += took
    if (took > stats.worst) stats.worst = took
    if (tasks.length) kick()
  }

  function kick(): void {
    if (scheduled || dead) return
    scheduled = true
    // A message, not a timer: nested timers are held to 4 ms apiece, which would triple the wait for a song.
    if (typeof MessageChannel !== 'undefined') {
      if (!chan) {
        chan = new MessageChannel()
        chan.port1.onmessage = pump
      }
      chan.port2.postMessage(0)
    } else setTimeout(pump, 0)
  }

  function enqueue(key: string, pri: number, make: () => RenderJob, done: (sound: Sound) => void): void {
    const t = tasks.find((x) => x.key === key)
    if (t) t.pri = Math.min(t.pri, pri)
    else tasks.push({ key, pri, make, job: null, done, asked: performance.now() })
    kick()
  }

  // The synth renders straight into the AudioBuffer it will be played from: no copy of a 10 MB song at the end.
  const rendered = new WeakMap<Float32Array, AudioBuffer>()
  const alloc: Alloc = (n) => {
    const buf = ctx!.createBuffer(1, n, ctx!.sampleRate)
    const data = buf.getChannelData(0)
    rendered.set(data, buf)
    return data
  }

  function toBuffer(sound: Sound): AudioBuffer {
    const made = rendered.get(sound.samples)
    if (made) return made
    const buf = ctx!.createBuffer(1, sound.samples.length, sound.sampleRate)
    buf.copyToChannel(sound.samples, 0)
    return buf
  }

  function requestSong(id: string, s: number, pri: number): void {
    const c = ctx
    const data = SONGS[id]
    const key = clipKey(id, s)
    if (!c || !data?.ok || clips.has(key)) return
    // The song wanted now goes ahead of songs asked for a moment ago and no longer wanted (a player
    // flicking along the map): those finish afterwards, for the cache.
    if (pri === 2) for (const t of tasks) if (t.pri === 2 && t.key !== `song:${key}`) t.pri = 2.5
    enqueue(
      `song:${key}`,
      pri,
      () => songJob(data, c.sampleRate, s, alloc),
      (sound) => {
        if (dead || !ctx) return
        const sr = sound.sampleRate
        clips.set(key, {
          buf: toBuffer(sound),
          loopStart: sound.loopStart / sr,
          loopEnd: sound.loopEnd / sr,
          dur: sound.samples.length / sr,
          keep: !data.loop,
          level: data.level,
        })
        trim()
        if (jing && !jing.play && !jing.timer) runJingle()
        sync()
      },
    )
  }

  /** Forget the songs used longest ago once the cache is over its size. */
  function trim(): void {
    let total = 0
    for (const c of clips.values()) if (!c.keep) total += c.dur
    for (const [key, c] of clips) {
      if (total <= CACHE_SECONDS) break
      if (c.keep || c === song?.clip || (want && key === clipKey(want, scale))) continue
      clips.delete(key)
      total -= c.dur
    }
  }

  function sfxBuffer(id: SfxId): AudioBuffer | null {
    const ready = sfxBufs.get(id)
    if (ready || !ctx) return ready ?? null
    // Asked for before the background render reached it: an effect takes a millisecond or two, do it now.
    const i = tasks.findIndex((t) => t.key === `sfx:${id}`)
    const job = (i >= 0 && tasks[i].job) || sfxJob(id, ctx.sampleRate, alloc)
    if (i >= 0) tasks.splice(i, 1)
    while (!job.step(1 << 16)) {
      /* to the end */
    }
    const buf = toBuffer(job.sound)
    sfxBufs.set(id, buf)
    return buf
  }

  /* ---------------- the context and the mix ---------------- */

  function boot(): AudioContext | null {
    if (ctx || dead) return ctx
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    let c: AudioContext
    try {
      // Always 48 kHz: the same buffers on every machine, and a 192 kHz sound card does not cost four times the work and memory.
      c = new Ctor({ latencyHint: 'interactive', sampleRate: RATE })
    } catch {
      try {
        c = new Ctor()
      } catch {
        return null
      }
    }
    ctx = c
    // music -> duck -+
    //                +-> out (halved) -> soft clip -> speakers
    // effects, spray-+
    const shaper = c.createWaveShaper()
    shaper.curve = softClip()
    shaper.connect(c.destination)
    outBus = c.createGain()
    outBus.gain.value = 0.5
    outBus.connect(shaper)
    duck = c.createGain()
    duck.connect(outBus)
    musicBus = c.createGain()
    musicBus.connect(duck)
    sfxBus = c.createGain()
    sfxBus.connect(outBus)
    sprayGain = c.createGain()
    sprayGain.gain.value = 0
    sprayGain.connect(sfxBus)
    applyVolumes(0)
    c.onstatechange = () => {
      if (dead || c.state !== 'running') return
      // A jingle that began while the browser was still blocking sound picks up where its clock is.
      if (jing && !jing.play && !paused) {
        haltJingle()
        runJingle()
      }
      sync()
      startSpray()
    }

    enqueue(
      'spray',
      0,
      () => sprayJob(c.sampleRate, alloc),
      (sound) => {
        if (dead || !ctx) return
        sprayBuf = toBuffer(sound)
        startSpray()
      },
    )
    for (const id of SFX_IDS) {
      enqueue(
        `sfx:${id}`,
        1,
        () => sfxJob(id, c.sampleRate, alloc),
        (sound) => {
          if (!dead && ctx && !sfxBufs.has(id)) sfxBufs.set(id, toBuffer(sound))
        },
      )
    }
    // Jingles are short and must start on the beat of whatever happened: have them all ready.
    for (const id of Object.keys(SONGS)) if (!SONGS[id].loop) requestSong(id, 1, 3)
    for (const id of preloads) requestSong(id, 1, 4)
    return c
  }

  /**
   * Has the page had a gesture the browser accepts yet (a click, key or tap; which controller input
   * counts is up to the browser)? Until then it would only create a blocked context and log a warning,
   * so nothing is made. Browsers without the API cannot say: there only unlock(), which comes from
   * input, may go ahead.
   *
   * The gesture only has to have happened once, at any time: unlock() then works from the game loop,
   * outside any event handler, which is where controller buttons are read (checked in Chrome, six
   * seconds after a key press). A controller button with no click or key before it is the open case:
   * if the browser does not count it, `locked` stays true and the shell's prompt asks for a key.
   */
  function gestured(orAssume: boolean): boolean {
    return navigator.userActivation ? navigator.userActivation.hasBeenActive : orAssume
  }

  function wake(): void {
    if (!ctx && !dead && gestured(false)) boot()
  }

  function applyVolumes(ramp = 0.015): void {
    if (!ctx || !musicBus || !sfxBus) return
    const now = ctx.currentTime
    // Squared, so the middle of a 0..10 slider sounds like half.
    const m = MUSIC_LEVEL * musicVol * musicVol
    const s = SFX_LEVEL * sfxVol * sfxVol
    if (ramp > 0) {
      musicBus.gain.setTargetAtTime(m, now, ramp)
      sfxBus.gain.setTargetAtTime(s, now, ramp)
    } else {
      musicBus.gain.value = m
      sfxBus.gain.value = s
    }
  }

  /** The hiss loops for good at zero volume; spray() only moves its gain. Nothing is started while the browser blocks sound. */
  function startSpray(): void {
    if (sprayRunning || !ctx || !sprayGain || !sprayBuf || ctx.state !== 'running') return
    sprayRunning = true
    const src = ctx.createBufferSource()
    src.buffer = sprayBuf
    src.loop = true
    src.connect(sprayGain)
    src.start()
    applySpray()
  }

  function applySpray(): void {
    if (!ctx || !sprayGain) return
    const on = sprayOn && !paused && !dead
    const now = ctx.currentTime
    hold(sprayGain.gain, now)
    // In over about 12 ms, out over about 40: quick, but no click.
    sprayGain.gain.setTargetAtTime(on ? SPRAY_LEVEL : 0, now, on ? 0.004 : 0.013)
  }

  /* ---------------- playing clips ---------------- */

  function startClip(clip: Clip, offset: number, fadeIn: number): Playing | null {
    if (!ctx || !musicBus) return null
    if (!clip.loopEnd && offset >= clip.dur - 0.004) return null
    const src = ctx.createBufferSource()
    src.buffer = clip.buf
    if (clip.loopEnd) {
      src.loop = true
      src.loopStart = clip.loopStart
      src.loopEnd = clip.loopEnd
    }
    const gain = ctx.createGain()
    const now = ctx.currentTime
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(clip.level, now + fadeIn)
    } else gain.gain.value = clip.level
    src.connect(gain)
    gain.connect(musicBus)
    src.start(now, Math.max(0, offset))
    return { clip, src, gain, t0: now, off: Math.max(0, offset) }
  }

  function clipPos(p: Playing): number {
    if (!ctx) return 0
    const c = p.clip
    let pos = p.off + (ctx.currentTime - p.t0)
    if (c.loopEnd && pos >= c.loopEnd) pos = c.loopStart + ((pos - c.loopStart) % (c.loopEnd - c.loopStart))
    return pos
  }

  function stopClip(p: Playing, fade = 0.03): void {
    if (!ctx) return
    p.src.onended = () => {
      p.src.disconnect()
      p.gain.disconnect()
    }
    fadeOut(ctx, p.src, p.gain, p.t0, fade)
  }

  function silenceSong(keep: boolean): void {
    if (song) {
      if (keep) memo = { id: song.id, at: clipPos(song) * song.scale }
      stopClip(song)
      song = null
    }
    if (!keep) memo = null
  }

  /** Bring what is sounding in line with what should be: the one place songs start and stop. */
  function sync(): void {
    if (dead || !ctx) return
    if (paused || jing || want === null) {
      silenceSong(want !== null)
      return
    }
    // Still blocked by the browser: render ahead, start when it lets us (onstatechange comes back here).
    if (ctx.state !== 'running') {
      if (!clips.has(clipKey(want, scale))) requestSong(want, scale, 2)
      return
    }
    if (song && song.id !== want) silenceSong(false)
    const key = clipKey(want, scale)
    const clip = clips.get(key)
    if (!clip) {
      // Not rendered yet: sync() runs again when it is. A song changing tempo keeps its old one until then.
      requestSong(want, scale, 2)
      return
    }
    clips.delete(key)
    clips.set(key, clip)
    if (song && song.scale === scale) return
    let at = 0
    let fadeIn = 0
    if (song) {
      at = clipPos(song) * song.scale
      fadeIn = 0.03
      stopClip(song)
      song = null
    } else if (memo && memo.id === want) {
      at = memo.at
      fadeIn = 0.01
    }
    memo = null
    let off = at / scale
    if (clip.loopEnd && off >= clip.loopEnd) off = clip.loopStart
    const p = startClip(clip, off, fadeIn)
    if (p) song = { ...p, id: want, scale }
  }

  function setWant(id: MusicId | null, restart: boolean): void {
    if (id !== null && !playable(id)) {
      complain(id)
      id = null
    }
    if (id === want && !restart) return
    want = id
    scale = 1
    if (restart || memo?.id !== id) memo = null
    if (song && (restart || song.id !== id)) {
      stopClip(song)
      song = null
    }
  }

  /* ---------------- jingles ---------------- */

  /** Start (or pick up) the jingle's sound and its clock. The clock runs even when the browser is still blocking sound, so onDone always comes. */
  function runJingle(): void {
    const j = jing
    if (!j || paused || dead) return
    if (ctx && ctx.state === 'running') {
      const clip = clips.get(j.id)
      if (!clip) {
        requestSong(j.id, 1, 0)
        return
      }
      j.play = startClip(clip, j.dur - j.left / 1000, 0.004)
    }
    j.since = performance.now()
    j.timer = window.setTimeout(endJingle, j.left)
  }

  function haltJingle(): void {
    const j = jing
    if (!j) return
    if (j.timer) {
      clearTimeout(j.timer)
      j.timer = 0
      j.left = Math.max(0, j.left - (performance.now() - j.since))
    }
    if (j.play) {
      stopClip(j.play)
      j.play = null
    }
  }

  /** Take the jingle off without touching the song. Returns its onDone, still owed. */
  function clearJingle(fade = 0.02): (() => void) | undefined {
    const j = jing
    if (!j) return undefined
    jing = null
    if (j.timer) clearTimeout(j.timer)
    if (j.play) stopClip(j.play, fade)
    return j.onDone
  }

  function endJingle(): void {
    if (!jing) return
    const cb = clearJingle()
    sync()
    if (!dead) cb?.()
  }

  /* ---------------- effects ---------------- */

  function drop(v: Voice): void {
    const i = voices.indexOf(v)
    if (i >= 0) voices.splice(i, 1)
    if (ctx) fadeOut(ctx, v.src, v.gain, v.t0, 0.008)
  }

  /** With three or more effects going, the music steps back a little to leave them room. */
  function duckMusic(): void {
    if (!ctx || !duck) return
    const busy = voices.length >= 3
    if (busy === ducked) return
    ducked = busy
    duck.gain.setTargetAtTime(busy ? 0.75 : 1, ctx.currentTime, 0.06)
  }

  function meter(at: 'music' | 'sfx' | 'out'): { rms: number; peak: number } {
    const node = at === 'music' ? duck : at === 'sfx' ? sfxBus : outBus
    if (!ctx || !node) return { rms: 0, peak: 0 }
    let an = meters[at]
    if (!an) {
      an = ctx.createAnalyser()
      an.fftSize = 2048
      node.connect(an)
      meters[at] = an
    }
    const data = new Float32Array(an.fftSize)
    an.getFloatTimeDomainData(data)
    let sq = 0
    let peak = 0
    for (const v of data) {
      sq += v * v
      if (Math.abs(v) > peak) peak = Math.abs(v)
    }
    return { rms: Math.sqrt(sq / data.length), peak }
  }

  return {
    unlock() {
      if (dead || (ctx && ctx.state === 'running') || !gestured(true)) return
      const c = boot()
      if (!c || c.state === 'running' || c.state === 'closed' || resuming) return
      // One resume in flight at a time, and never stuck: a browser may leave the promise hanging.
      resuming = true
      const settle = () => {
        resuming = false
      }
      c.resume().then(settle, settle)
      setTimeout(settle, 250)
    },

    get locked() {
      return !ctx || ctx.state !== 'running'
    },

    sfx(id) {
      if (dead) return
      wake()
      const def = SFX[id]
      if (!ctx || !sfxBus || !def || ctx.state !== 'running') return
      if (paused && !def.ui) return
      const now = ctx.currentTime
      const last = lastAt[id]
      if (last !== undefined && now - last < (def.gap ?? 0.03)) return
      const buf = sfxBuffer(id)
      if (!buf) return
      lastAt[id] = now
      const same = voices.filter((v) => v.id === id)
      if (same.length >= (def.max ?? 2)) drop(same[0])
      if (voices.length >= MAX_VOICES) drop(voices[0])
      const src = ctx.createBufferSource()
      src.buffer = buf
      const gain = ctx.createGain()
      // Each effect already sounding takes a little off the next one, so a burst does not pile up.
      gain.gain.value = 1 / (1 + 0.2 * voices.length)
      src.connect(gain)
      gain.connect(sfxBus)
      const v: Voice = { id, src, gain, t0: now }
      src.onended = () => {
        const i = voices.indexOf(v)
        if (i >= 0) voices.splice(i, 1)
        src.disconnect()
        gain.disconnect()
        duckMusic()
      }
      voices.push(v)
      src.start(now)
      duckMusic()
    },

    spray(on) {
      if (dead || on === sprayOn) return
      sprayOn = on
      if (on) wake()
      applySpray()
    },

    music(id, opts) {
      if (dead) return
      // Asked for during a jingle: this is what plays after it, a stopJingle({ resume }) included.
      if (jing) jing.prior = undefined
      setWant(id, !!opts?.restart)
      wake()
      sync()
    },

    jingle(id, opts = {}) {
      if (dead) return
      let prior = jing?.prior
      // A jingle cut short by another still reports done, once the new one is in place.
      const cut = clearJingle()
      if (opts.thenMusic !== undefined) {
        // A jingle cutting one that had a thenMusic too: the song silenced first is still the one to go back to.
        prior ??= { want, memo: song ? { id: song.id, at: clipPos(song) * song.scale } : memo }
        setWant(opts.thenMusic, false)
      }
      const data = SONGS[id]
      if (data?.ok) {
        wake()
        const dur = songSeconds(data)
        jing = { id, onDone: opts.onDone, dur, left: dur * 1000, timer: 0, since: 0, play: null, prior }
        sync()
        runJingle()
      } else {
        complain(id)
        sync()
        const cb = opts.onDone
        if (cb) {
          setTimeout(() => {
            if (!dead) cb()
          }, 0)
        }
      }
      cut?.()
    },

    stopJingle(opts) {
      if (dead || !jing) return
      const prior = jing.prior
      // A touch longer than a jingle cut by another: nothing takes its place at once.
      clearJingle(0.06)
      if (!opts?.resume) {
        // Forgotten, so the next music() starts its song from the top even if it is this one.
        want = null
        memo = null
      } else if (prior) {
        setWant(prior.want, false)
        memo = prior.memo
      }
      sync()
    },

    setTempoScale(s) {
      if (dead) return
      const next = Math.min(2, Math.max(0.5, Math.round(s * 20) / 20))
      if (!(next > 0) || next === scale) return
      scale = next
      sync()
    },

    setVolumes(music, sfx) {
      // Not a number would poison the gain for good (and Web Audio throws on it): keep the old value.
      if (Number.isFinite(music)) musicVol = Math.min(1, Math.max(0, music))
      if (Number.isFinite(sfx)) sfxVol = Math.min(1, Math.max(0, sfx))
      if (!dead) applyVolumes()
    },

    setPaused(p) {
      if (dead || p === paused) return
      paused = p
      if (p) haltJingle()
      else runJingle()
      sync()
      applySpray()
    },

    preload(ids) {
      if (dead) return
      wake()
      for (const id of ids) {
        if (ctx) requestSong(id, 1, 4)
        else preloads.add(id)
      }
    },

    debug() {
      return {
        state: ctx?.state ?? 'none',
        sampleRate: ctx?.sampleRate ?? 0,
        want,
        song: song ? { id: song.id, scale: song.scale, pos: clipPos(song) } : null,
        jingle: jing?.id ?? null,
        paused,
        spray: sprayOn,
        voices: voices.length,
        sfxReady: sfxBufs.size,
        clips: [...clips.keys()],
        queued: tasks.length,
        slices: stats.slices,
        worstSliceMs: stats.worst,
        workMs: stats.work,
        readyMs: { ...stats.ready },
      }
    },

    meter,

    destroy() {
      if (dead) return
      dead = true
      tasks.length = 0
      if (jing?.timer) clearTimeout(jing.timer)
      jing = null
      song = null
      voices.length = 0
      clips.clear()
      sfxBufs.clear()
      if (chan) {
        chan.port1.onmessage = null
        chan.port1.close()
        chan.port2.close()
        chan = null
      }
      const c = ctx
      ctx = null
      musicBus = duck = sfxBus = outBus = sprayGain = null
      if (c) {
        c.onstatechange = null
        // Closing stops every source and frees the audio thread.
        if (c.state !== 'closed') c.close().catch(() => {})
      }
    },
  }
}
