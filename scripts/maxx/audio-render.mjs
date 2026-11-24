// Renders every song, jingle and sound effect of Super Mighty Maxx with the
// game's own synth and checks the result by numbers, since a script cannot listen.
//
//   node scripts/maxx/audio-render.mjs --out <folder>     write WAV files and print the report
//   node scripts/maxx/audio-render.mjs                    report only
//     --only title,coin    just these ids          --rate 44100    sample rate (default 48000)
//     --brief              leave out the bar by bar harmony listing (flags are still printed)
//     --roll               print each song as a piano roll in text: one column per sixteenth, the
//                          note name where a note starts, - while it is held, . for silence
//   node scripts/maxx/audio-render.mjs --compare [--only id,id] [--with draft.ts,...] [--near]
//                          instead: render nothing and compare how the songs are written (--with: song
//                          files from elsewhere, compared in place of the game's song of their id). Each
//                          phrase head of the tune (a part's first note, any note after a rest of an
//                          eighth or more) against about 95 well-known tunes and against every other
//                          song; drum and bass bars shared across songs (a shape in two or more bars
//                          of each song is a groove, once is a fill); and the two pulses against each
//                          other (parallel octaves or fifths as both move, p2 above p1). LOOK marks
//                          what wants an ear; a song's `quotes` (format.ts) marks a quote as meant;
//                          --near also lists four-interval likenesses in the middle of a tune.
//                          These are judgements, so they never fail the run; the full report prints
//                          a one-line summary of them.
//   node scripts/maxx/audio-render.mjs --browser          instead: load game/audio in headless Chrome and
//                                                         drive the real AudioApi (every effect, song and
//                                                         jingle, pause, stopJingle, tempo, a pile of calls
//                                                         in one tick, destroy). Serves the repo on --port
//                                                         (default 5483) while it runs.
//
// Per sound: length, peak, RMS, DC offset, clipped samples, how hard the limiter
// worked, the loop seam, notes per voice, how loud each voice is to the ear, and a
// harmony report (each bar's notes against the declared key and chords, out-of-key
// notes on strong beats, voices a semitone apart, the bass shadowing the tune in
// octaves or fifths). Exits 1 on clipping, silence, a song the loader complains about
// (voices of different lengths, bars that do not add up) or a loop seam that clicks.
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { GAME_URL, REPO } from './paths.mjs'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const outDir = opt('--out') ? path.resolve(opt('--out')) : null
const rate = Number(opt('--rate') ?? 48000)
const only = opt('--only')?.split(',')
const brief = args.includes('--brief')
const roll = args.includes('--roll')

const failures = []
const fail = (id, msg) => failures.push(`${id}: ${msg}`)
const f3 = (x) => x.toFixed(3)
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf') + ' dB'
const pad = (s, n) => String(s).padEnd(n)
const lpad = (s, n) => String(s).padStart(n)

function stats(x, from = 0, to = x.length) {
  let peak = 0
  let sum = 0
  let sq = 0
  let clipped = 0
  let bad = 0
  for (let i = from; i < to; i++) {
    const v = x[i]
    if (!Number.isFinite(v)) bad++
    const m = Math.abs(v)
    if (m > peak) peak = m
    if (m >= 0.999) clipped++
    sum += v
    sq += v * v
  }
  const n = Math.max(1, to - from)
  return { peak, rms: Math.sqrt(sq / n), dc: sum / n, clipped, bad }
}

function writeWav(file, chunks, sampleRate) {
  const n = chunks.reduce((a, c) => a + c.length, 0)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  let o = 44
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, c[i])) * 32767), o)
      o += 2
    }
  }
  fs.writeFileSync(file, buf)
}

/** Render through the sliced job the browser uses, timing each slice. */
function timed(job) {
  const t0 = performance.now()
  let worst = 0
  let slices = 0
  for (;;) {
    const s0 = performance.now()
    const done = job.step(4096)
    worst = Math.max(worst, performance.now() - s0)
    slices++
    if (done) break
  }
  return { sound: job.sound, ms: performance.now() - t0, worst, slices }
}

function levelLine(id, s, sound, limits) {
  const over = sound.prePeak > limits.knee
  if (s.bad) fail(id, `${s.bad} samples are not numbers`)
  if (s.clipped) fail(id, `${s.clipped} clipped samples`)
  if (s.rms < 0.004 || s.peak < 0.02) fail(id, 'silent')
  return `peak ${f3(s.peak)}  rms ${f3(s.rms)} (${db(s.rms)})  dc ${s.dc >= 0 ? '+' : ''}${s.dc.toFixed(4)}  clipped ${s.clipped}  pre-limiter peak ${f3(sound.prePeak)}${over ? ' (limiter working)' : ''}`
}

/* ------------------------------------------------------------------ */
/* Loudness of each voice, as the ear weighs it                        */
/* ------------------------------------------------------------------ */

function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const vr = re[b] * cr - im[b] * ci
        const vi = re[b] * ci + im[b] * cr
        re[b] = re[a] - vr
        im[b] = im[a] - vi
        re[a] += vr
        im[a] += vi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** The A curve: how much the ear makes of each frequency at moderate volume (1 at 1 kHz, about a third at 200 Hz). */
function aWeight(f) {
  const f2 = f * f
  return (1.2589 * (12194 ** 2 * f2 * f2)) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
}

/** A-weighted level of a voice over the stretches where it is sounding, and the share of the time it sounds. */
function earLevel(x, sampleRate) {
  const N = 4096
  let pow = 0
  let frames = 0
  let active = 0
  for (let s = 0; s + N <= x.length; s += N / 2) {
    const re = new Float64Array(N)
    const im = new Float64Array(N)
    let e = 0
    for (let i = 0; i < N; i++) {
      re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
      e += x[s + i] * x[s + i]
    }
    frames++
    if (e / N < 1e-7) continue
    active++
    fft(re, im)
    for (let k = 1; k < N / 2; k++) {
      const a = aWeight((k * sampleRate) / N)
      pow += (re[k] * re[k] + im[k] * im[k]) * a * a
    }
  }
  return { level: active ? Math.sqrt((pow / active) * (2 / (N * N * 0.375))) : 0, share: frames ? active / frames : 0 }
}

/** Each voice rendered on its own. The kick's triangle thump belongs to the bass voice, as it does in the mix. */
function stems(song, synth, fmt, sampleRate) {
  const out = {}
  const only = (voices) => ({ ...song, events: song.events.filter((e) => voices.includes(e.voice)) })
  const render = (tones, seconds) => {
    // Half gain keeps every voice clear of the limiter; only the levels relative to each other are used.
    const job = synth.tonesJob(tones, seconds, sampleRate, 0.5)
    while (!job.step(1 << 20)) {
      /* to the end */
    }
    return job.sound.samples
  }
  for (const v of ['p1', 'p2']) {
    const { tones, seconds } = fmt.songTones(only([v]))
    if (tones.length) out[v] = render(tones, seconds)
  }
  const low = fmt.songTones(only(['tri', 'noise']))
  for (const [v, wave] of [
    ['tri', 'tri'],
    ['noise', 'noise'],
  ]) {
    const tones = low.tones.filter((t) => t.wave === wave)
    if (tones.length) out[v] = render(tones, low.seconds)
  }
  return out
}

function balanceLine(song, synth, fmt, sampleRate) {
  const st = stems(song, synth, fmt, sampleRate)
  const lv = Object.fromEntries(Object.entries(st).map(([v, x]) => [v, earLevel(x, sampleRate)]))
  const ref = lv.p1?.level || Math.max(...Object.values(lv).map((l) => l.level))
  const rel = (l) => (l.level > 0 ? 20 * Math.log10(l.level / ref) : -99)
  const parts = Object.entries(lv).map(([v, l]) => `${v} ${rel(l) >= 0 ? '+' : ''}${rel(l).toFixed(1)} dB (sounding ${Math.round(l.share * 100)}%)`)
  const over = Object.entries(lv).filter(([v, l]) => v !== 'p1' && lv.p1 && rel(l) > -1)
  return { text: parts.join(', '), over: over.map(([v]) => v) }
}

/* ------------------------------------------------------------------ */
/* Note names                                                          */
/* ------------------------------------------------------------------ */

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Names for notes the way the song's key spells them (G sharp in E major, A flat in E flat major), so the report reads like the score. */
function speller(song, fmt) {
  const scale = (song.key?.pcs ?? []).slice(0, 7)
  const fits = (table) => scale.length === 7 && new Set(scale.map((pc) => table[pc][0])).size === 7
  const table = fits(SHARP_NAMES) && !fits(FLAT_NAMES) ? SHARP_NAMES : fits(FLAT_NAMES) && !fits(SHARP_NAMES) ? FLAT_NAMES : null
  if (!table) return { pcName: fmt.pcName, noteName: fmt.noteName }
  const pcName = (pc) => table[((pc % 12) + 12) % 12]
  return { pcName, noteName: (midi) => pcName(midi) + (Math.floor(midi / 12) - 1) }
}

/* ------------------------------------------------------------------ */
/* Piano roll                                                          */
/* ------------------------------------------------------------------ */

function pianoRoll(song, fmt) {
  const { noteName } = speller(song, fmt)
  const meter = song.meter
  const bars = Math.round(song.beats / meter)
  const cell = 5
  const by = {}
  for (const v of fmt.VOICES) by[v] = song.events.filter((e) => e.voice === v)
  const lines = ["   (one column per sixteenth: a note's name where it starts, - while it sounds, . silence, ~ a bend, * a start between columns)"]
  for (let b = 0; b < bars; b++) {
    const b0 = b * meter
    const part = song.layout.find((l) => Math.abs(l.beat - b0) < 1e-6)
    const chords = song.chords.filter((c) => c.beat >= b0 - 1e-6 && c.beat < b0 + meter - 1e-6).map((c) => c.chord.name)
    lines.push(`   ${part ? `[${part.part}] ` : ''}bar ${b + 1}${chords.length ? '   ' + chords.join(' ') : ''}`)
    let head = '           '
    for (let k = 0; k < meter * 4; k++) head += pad(k % 4 === 0 ? k / 4 + 1 : k % 2 === 0 ? '+' : '', cell)
    lines.push(head)
    for (const v of fmt.VOICES) {
      if (!by[v].length) continue
      let line = `     ${pad(v, 6)}`
      for (let k = 0; k < meter * 4; k++) {
        const t0 = b0 + k / 4
        const starts = by[v].filter((e) => e.beat >= t0 - 1e-6 && e.beat < t0 + 0.25 - 1e-6)
        let txt = '.'
        if (starts.length) {
          txt = starts
            .map((e) => {
              const off = Math.abs(e.beat - t0) > 1e-6 ? '*' : ''
              if (e.drum) return e.drum + off
              return (e.pitches.length > 1 ? `{${e.pitches.map(noteName).join('')}}` : noteName(e.pitches[0])) + (e.bend ? '~' : '') + off
            })
            .join(',')
        } else if (by[v].some((e) => e.beat < t0 - 1e-6 && e.beat + (e.drum ? Math.min(e.sounds, 0.25) : e.sounds) > t0 + 0.02)) txt = '-'
        line += pad(txt, cell)
      }
      lines.push(line.trimEnd())
    }
  }
  return lines
}

/* ------------------------------------------------------------------ */
/* Harmony                                                             */
/* ------------------------------------------------------------------ */

function harmony(song, fmt) {
  const { pcName, noteName } = speller(song, fmt)
  const meter = song.meter
  const bars = Math.round(song.beats / meter)
  const notes = song.events.filter((e) => e.voice !== 'noise')
  const voices = ['p1', 'p2', 'tri']
  const by = Object.fromEntries(voices.map((v) => [v, notes.filter((e) => e.voice === v)]))
  const chordAt = (beat) => song.chords.find((c) => beat >= c.beat - 1e-6 && beat < c.beat + c.beats - 1e-6)?.chord
  const inKey = (pc) => !song.key || song.key.pcs.includes(pc)
  const strong = meter === 4 ? [0, 2] : meter === 6 ? [0, 3] : [0]
  const where = (beat) => `bar ${Math.floor(beat / meter + 1e-6) + 1} beat ${Math.round((beat % meter) * 100) / 100 + 1}`
  const lines = []
  const flags = []
  const infos = []

  for (let b = 0; b < bars; b++) {
    const b0 = b * meter
    const b1 = b0 + meter
    const cells = voices.map((v) => {
      const seen = []
      for (const e of by[v]) {
        if (e.beat + e.sounds <= b0 + 1e-6 || e.beat >= b1 - 1e-6) continue
        for (const p of e.pitches) if (!seen.includes(pcName(p))) seen.push(pcName(p))
      }
      return `${v}: ${seen.join(' ') || '-'}`
    })
    const names = song.chords.filter((c) => c.beat >= b0 - 1e-6 && c.beat < b1 - 1e-6).map((c) => c.chord.name)
    const part = song.layout.find((l) => Math.abs(l.beat - b0) < 1e-6)
    lines.push(`${part ? pad(part.part, 4) : '    '}bar ${lpad(b + 1, 2)} [${pad(names.join(' '), 9)}] ${pad(cells[0], 26)} ${pad(cells[1], 24)} ${cells[2]}`)

    for (const sb of strong) {
      const T = b0 + sb
      const chord = chordAt(T)
      for (const v of voices) {
        const e = by[v].find((n) => n.beat <= T + 1e-6 && n.beat + n.sounds > T + 1e-6)
        if (!e) continue
        for (const p of e.pitches) {
          const pc = p % 12
          const inChord = !!chord && chord.pcs.includes(pc)
          const i = by[v].indexOf(e)
          const next = by[v][i + 1]
          const nextChord = next && chordAt(next.beat)
          // A note outside the chord on a strong beat is fine when it steps straight onto a chord note:
          // struck on the beat it is a leaning note, held over from before the beat it is a suspension.
          const resolves = e.pitches.length === 1 && next && next.beat < e.beat + e.beats + 1e-6 && Math.abs(next.pitches[0] - p) <= 2 && !!nextChord?.pcs.includes(next.pitches[0] % 12)
          const held = e.beat < T - 1e-6
          const then = resolves ? ` (it steps to ${noteName(next.pitches[0])})` : ''
          if (!inKey(pc) && !inChord) {
            flags.push(`${where(T)}: ${v} ${noteName(p)} is outside ${song.key.name}${chord?.pcs.length ? ` and not in ${chord.name}` : ''}, on a strong beat${then}`)
          } else if (chord?.pcs.length && !inChord && song.key?.mode === 'wholetone') {
            // No note of a whole-tone scale pulls toward any other: chord membership means nothing there.
            infos.push(`${where(T)}: ${v} ${noteName(p)} is not in ${chord.name} but belongs to the whole-tone scale`)
          } else if (chord?.pcs.length && !inChord) {
            if (resolves) infos.push(`${where(T)}: ${v} ${noteName(p)} ${held ? 'is held over' : 'leans on'} ${chord.name} and resolves by step to ${noteName(next.pitches[0])}`)
            else flags.push(`${where(T)}: ${v} ${noteName(p)} is not in ${chord.name}`)
          } else if (!inKey(pc)) {
            infos.push(`${where(T)}: ${v} ${noteName(p)} is outside the key but belongs to ${chord.name}`)
          }
        }
      }
    }
  }

  for (const c of song.chords) {
    if (!c.chord.pcs.length) continue
    const e = by.tri.find((n) => n.beat <= c.beat + 1e-6 && n.beat + n.sounds > c.beat + 1e-6)
    if (!e) continue
    const pc = e.pitches[0] % 12
    if (!c.chord.pcs.includes(pc)) flags.push(`${where(c.beat)}: bass ${noteName(e.pitches[0])} is not in ${c.chord.name}`)
    else if (pc !== c.chord.bass) infos.push(`${where(c.beat)}: bass on ${pcName(pc)} under ${c.chord.name}`)
  }

  const pairs = [
    ['p1', 'p2'],
    ['p1', 'tri'],
    ['p2', 'tri'],
  ]
  for (const [va, vb] of pairs) {
    let j0 = 0
    for (const a of by[va]) {
      while (j0 < by[vb].length && by[vb][j0].beat + by[vb][j0].sounds <= a.beat) j0++
      for (let j = j0; j < by[vb].length && by[vb][j].beat < a.beat + a.sounds; j++) {
        const b = by[vb][j]
        const start = Math.max(a.beat, b.beat)
        const overlap = Math.min(a.beat + a.sounds, b.beat + b.sounds) - start
        if (overlap < 0.12) continue
        for (const pa of a.pitches) {
          for (const pb of b.pitches) {
            const d = Math.abs(pa - pb)
            const ic = d % 12
            if (d === 1 || ic === 1) flags.push(`${where(start)}: ${va} ${noteName(pa)} against ${vb} ${noteName(pb)}, a ${d === 1 ? 'minor second' : 'minor ninth'} for ${Math.round(overlap * 100) / 100} beats`)
            else if (ic === 11 && overlap >= 0.5) infos.push(`${where(start)}: ${va} ${noteName(pa)} against ${vb} ${noteName(pb)}, a major seventh for ${Math.round(overlap * 100) / 100} beats`)
          }
        }
      }
    }
  }

  // The bass moving with the tune in octaves or fifths, the same way, from one half beat to the next. In four
  // thin voices that sounds like one voice short, most of all at a cadence. (A deliberate unison riff
  // trips this too: it is a flag to look at, not an error.)
  const sounding = (v, t) => by[v].find((n) => n.beat <= t + 1e-6 && n.beat + n.sounds > t + 1e-6)?.pitches[0]
  let prev = null
  for (let t = 0; t < song.beats - 1e-6; t += 0.5) {
    const cur = { m: sounding('p1', t), b: sounding('tri', t) }
    if (prev && cur.m != null && cur.b != null && prev.m != null && prev.b != null && cur.m !== prev.m && cur.b !== prev.b) {
      const i0 = (((prev.m - prev.b) % 12) + 12) % 12
      const i1 = (((cur.m - cur.b) % 12) + 12) % 12
      if (i0 === i1 && (i1 === 0 || i1 === 7) && Math.sign(cur.m - prev.m) === Math.sign(cur.b - prev.b)) {
        flags.push(`${where(t)}: the bass shadows the tune in ${i1 === 0 ? 'octaves' : 'fifths'} (${noteName(prev.m)} over ${noteName(prev.b)}, then ${noteName(cur.m)} over ${noteName(cur.b)})`)
      }
    }
    prev = cur
  }

  const ranges = voices
    .filter((v) => by[v].length)
    .map((v) => {
      const ps = by[v].flatMap((e) => e.pitches)
      return `${v} ${noteName(Math.min(...ps))}-${noteName(Math.max(...ps))}`
    })
  return { lines, flags, infos, ranges }
}

/* ------------------------------------------------------------------ */
/* --compare: originality, sameness, and pulse against pulse           */
/* ------------------------------------------------------------------ */

// Well-known tunes as intervals in semitones, from memory (transposition does not matter). A
// phrase of ours that runs four intervals the same as any stretch of one of these is listed.
// Built from the two composers' review scripts of round 2, plus a few more.
const FAMOUS = {
  'Korobeiniki (Tetris)': [-5, 1, 2, -2, -1, -2, 0, 3, 4, -2, -2, -1, 1, 2, 2, -4, -3, 0],
  'Mario overworld': [0, 0, -4, 4, 3, -12],
  'Mario overworld B': [-1, -1, -2, 1, -8, 1, 3, -3, 3, 2],
  'Mario underground': [12, -15, 12, -11, 12],
  'Mario 1-up': [3, 9, -4, 2, 5],
  'Zelda overworld': [-5, 5, 0, 2, 2, 1, 2],
  'Zelda secret': [-1, -3, -6, -1, 8, 4, 4],
  'Zelda lullaby': [3, -5, -2, 2, 2],
  'FF main theme': [5, 2, 2, 3, -2, -1],
  'FF victory': [0, 0, 0, -4, 2, 2],
  'Dragon Quest march': [5, -5, 5, 2, 2, 1],
  Megalovania: [0, 12, -5, -1, -1, -2],
  'Pac-Man start': [12, -5, -3, 8, -5, -3],
  'Star Wars': [5, 7, -2, -1, -2, 10, -5],
  'Imperial March': [0, 0, -4, 7, -3],
  'Beethoven 5': [0, 0, -4, 2, 0, 0, -3],
  'Ode to Joy': [0, 1, 2, 0, -2, -1, -2, -2, 0, 2, 2, 0, -2, 0],
  'Fur Elise': [-1, 1, -1, 1, -5, 3, -2, -3],
  'Mountain King': [2, 1, 2, 2, -4, 4],
  Toccata: [-2, 2, -2, -2, -1, -2],
  Entertainer: [1, 1, 8, -8, 8, -8, 8],
  'Can-can': [0, 2, 3, -1, -2, 5, 0, 0, 2, -5, 1, -3],
  'William Tell': [0, 0, 0, 0, 0, 0, 0, 5, 2, 2],
  'Sabre Dance': [0, 0, 0, 0, 0, -1, 1, 1, -1, -1, -1],
  'Flight of the Bumblebee': [-1, -1, -1, 1, -1, -1, -1],
  Habanera: [-1, -1, -1, -1, -1, -1],
  'Carol of the Bells': [-1, 1, -3, 3, -1, 1, -3],
  Greensleeves: [3, 2, 2, 1, -1, -2, -3, -4, 2, 2, 1, -3, 0, -1, 1, 2, -3, -4],
  Godfather: [5, 3, -1, -2, 3, -1, -2, 2, -2, -4, 2, -3],
  Pirates: [3, 2, 0, 0, 2, 1, 0, 0, 2, -3, 0, -2, -2, 2],
  'Mission Impossible': [0, 3, 2, -5, 0, -2, 1],
  'Pink Panther': [1, 2, 1, -4, 1, 2, 1, 5, -1, -7, 3, 4, -1],
  'James Bond': [2, 0, 0, 0, -2],
  'Bond vamp': [1, 1, -1, -1, 1, 1, -1],
  'Peter Gunn': [0, 2, -2, 3, -3, 5, -2],
  Halloween: [5, -5, 0, 5, -5],
  Jaws: [1, -1, 1],
  'Raiders March': [1, 2, 5, -10, 2, 1],
  Simpsons: [4, 2, 3, -2, -3],
  'Final Countdown': [-2, 2, -7, 8, -1, 1, -1, -2],
  'Seven Nation Army': [0, 3, -3, -2, -2, -1],
  'Smoke on the Water': [3, 2, -5, 3, 3, -1],
  'Axel F': [3, -3, 0, 5, -5, -2],
  Popcorn: [-2, 2, -5, -4, 4, -7],
  'Take On Me': [0, -4, -3, 0, 5, 0, 0, 4, 0, 1, 2, -2, 0, 0, -5],
  'Jeopardy think': [5, -5, -7, 7, 5, -5],
  'Here Comes the Bride': [5, 0, 0, -5, 7, -3, 1],
  'Shave and a Haircut': [-5, 0, 2, -2, 4, 1],
  Charge: [5, 4, 3, -3, 3],
  'Pop Goes the Weasel': [0, 2, 0, 2, 3, -3, -4],
  'Itsy Bitsy Spider': [5, 0, 0, 2, 2, 0, 0, -2, -2, 2, 2, -4],
  'Old MacDonald': [0, 0, -5, 2, 0, -2],
  'London Bridge': [2, -2, -2, -1, 1, 2],
  'Mary Had a Little Lamb': [-2, -2, 2, 2, 0, 0],
  Twinkle: [0, 7, 0, 2, 0, -2],
  'Happy Birthday': [0, 2, -2, 5, -1],
  'Frere Jacques': [2, 2, -4, 0, 2, 2],
  'Yankee Doodle': [0, 2, 2, -4, 4, -2, -7],
  'Auld Lang Syne': [5, 0, 0, 4, -2, -2],
  'My Bonnie': [9, -2, -2, 2, -2, -3, -2, -3],
  Camptown: [0, -3, 3, 2, -2, -3],
  'Oh Susanna': [2, 2, 3, 0, 2, -2, -3, -4],
  'Home on the Range': [0, 5, 2, 2, -4, -1, -2, 8, 0, 0],
  'Red River Valley': [5, 4, 0, 0, -2, 2, -2, -2],
  'Coming Round the Mountain': [2, 3, 0, 0, 0, -3, -2, -3, 3, 5],
  Clementine: [0, 0, -5, 9, 0, 0, -4],
  'When the Saints': [4, 1, 2, -7, 4, 1, 2],
  'Swanee River': [-2, -2, 4, -2, -2, 12, -3, 3, -5],
  'Yellow Rose of Texas': [0, 5, 0, 0, 2, 2, 0],
  Dixie: [-3, -4, 0, 0, 2, 2, 1, 2, 0, 0, -3],
  'La Cucaracha': [0, 0, 5, 4, -9, 0, 0, 5, 4],
  'Scarborough Fair': [0, 7, 0, -5, 1, -1, -2],
  'God Rest Ye': [0, 7, 0, -2, -2, -1, -2, -2, 2, 2, 1, 2, 2],
  'Country Roads': [2, 2, 0, -2, 2, 3, 0],
  'Jingle Bells': [0, 0, 0, 0, 0, 0, 3, -7, 2, 2],
  'Deck the Halls': [-2, -1, -2, -2, 2, 2, 1, -3],
  'Joy to the World': [-1, -2, -2, -2, -1, -2],
  'We Wish You': [5, 0, 2, -2, -1, -2],
  'O Christmas Tree': [5, 0, 0, 2, 2, 0],
  'Away in a Manger': [5, 0, 2, 2, -4],
  'Silent Night': [2, -2, -3, 3, 2, -2],
  Frosty: [-3, 1, 2, 5, -1],
  Rudolph: [2, -2, -3, 8, -3],
  Westminster: [-4, 2, -7, 0, 7, 2, -4],
  Edelweiss: [3, 7, -2, -5, -2],
  'Blue Danube': [0, 4, 3, 0],
  'Brahms Lullaby': [0, 3, -3, 0, 3],
  'Amazing Grace': [5, 4, -4, 4, -2],
  Pachelbel: [-2, -2, -1, -2, -2, 2],
  Taps: [0, 5, -5, 5, 4],
  Reveille: [5, 4, -4, -5, 9],
  'Hava Nagila': [-1, 3, -2, -1, 1],
  'Take Me Out to the Ball Game': [12, -3, -2, -3, 3],
}

/** Phrase heads of a song's tune: the first note of each part, and every note after a rest of an eighth or more. Each distinct one once. */
function phraseHeads(song) {
  const p1 = song.events.filter((e) => e.voice === 'p1' && e.pitches.length).sort((a, b) => a.beat - b.beat)
  const starts = song.layout.map((l) => l.beat)
  const heads = []
  const seen = new Set()
  for (let i = 0; i < p1.length; i++) {
    const gap = i ? p1[i].beat - (p1[i - 1].beat + p1[i - 1].beats) : 1
    if (gap < 0.5 - 1e-6 && !starts.some((b) => Math.abs(b - p1[i].beat) < 1e-6)) continue
    const seq = p1.slice(i, i + 12)
    const pitches = seq.map((e) => Math.max(...e.pitches))
    const ivs = pitches.slice(1).map((p, j) => p - pitches[j])
    const rhythm = seq.map((e) => +e.beats.toFixed(3))
    const key = ivs.join(' ') + '|' + rhythm.join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    heads.push({ id: song.id, bar: p1[i].bar, part: p1[i].part, ivs, rhythm })
  }
  return heads
}

/** The longest run of equal intervals anywhere in the first twelve notes of our phrase and anywhere in theirs. */
function sameShape(ours, theirs) {
  let best = { n: 0, i: 0, j: 0 }
  for (let i = 0; i < ours.length; i++) {
    for (let j = 0; j < theirs.length; j++) {
      let n = 0
      while (i + n < ours.length && j + n < theirs.length && ours[i + n] === theirs[j + n]) n++
      if (n > best.n) best = { n, i, j }
    }
  }
  return best
}

/** Each bar of one voice as text, by its rhythm and shape (bass: steps from the bar's first note; drums: the kit letters). */
function barShapes(song, voice) {
  const per = new Map()
  for (const e of song.events) {
    if (e.voice !== voice) continue
    const at = Math.round((e.beat - (e.bar - 1) * song.meter) * 4)
    if (!per.has(e.bar)) per.set(e.bar, [])
    per.get(e.bar).push(voice === 'noise' ? [at, e.drum] : [at, e.pitches[0], Math.round(e.beats * 4)])
  }
  const out = new Map()
  for (const [bar, ns] of per) {
    if (voice === 'noise') {
      if (ns.length < 5) continue
      const grid = Array(Math.round(song.meter * 4)).fill('.')
      for (const [at, d] of ns) if (at < grid.length) grid[at] = d
      out.set(bar, `${song.meter}|${grid.join('')}`)
    } else {
      // Four quarter notes on chord tones are anybody's bass: five notes or more make a riff.
      if (ns.length < 5) continue
      out.set(bar, `${song.meter}|${ns.map(([at, p, len]) => `${at}:${p - ns[0][1]}:${len}`).join(' ')}`)
    }
  }
  return out
}

/**
 * Pulse against pulse. Parallel octaves or fifths as both pulses move the same way: four or more
 * in a row are a doubling (one line, meant: the tune thickened an octave down), fewer are the
 * harmony voice falling into the tune for a moment. And p2 sounding above p1. Notes that bend
 * (a rev, a scoop) are left out, and so are sixteenth figures (an arpeggio or an echo brushing
 * the tune), which are counted apart as texture.
 */
function pulses(song, fmt) {
  const { noteName } = speller(song, fmt)
  const notes = (v) => song.events.filter((e) => e.voice === v && e.pitches.length === 1).sort((a, b) => a.beat - b.beat)
  const p1 = notes('p1')
  const p2 = notes('p2')
  const at = (list, beat) => list.find((e) => e.beat <= beat + 1e-6 && beat < e.beat + e.sounds - 1e-6)
  const times = [...new Set([...p1, ...p2].map((e) => +e.beat.toFixed(4)))].sort((a, b) => a - b)
  const where = (e, t) => `bar ${e.bar} beat ${+((t % song.meter) + 1).toFixed(2)}`
  const quick = (...es) => Math.min(...es.map((e) => e.beats)) <= 0.25 + 1e-6
  const out = { parallels: [], doublings: [], texture: 0, above: [], aboveQuick: 0 }
  let run = []
  const close = () => {
    if (run.length >= 4) out.doublings.push(`${run[0].where} to ${run[run.length - 1].where}: doubled in ${run[0].kind} for ${run.length + 1} notes`)
    else out.parallels.push(...run.map((r) => r.text))
    run = []
  }
  let prev = null
  for (const t of times) {
    const a = at(p1, t)
    const b = at(p2, t)
    if (!a || !b || a.bend || b.bend) {
      close()
      prev = null
      continue
    }
    const hi = a.pitches[0]
    const lo = b.pitches[0]
    const struck = Math.abs(a.beat - t) < 1e-6 || Math.abs(b.beat - t) < 1e-6
    if (lo > hi && struck) {
      if (quick(a, b)) out.aboveQuick++
      else out.above.push(`${where(a, t)}: p2 ${noteName(lo)} above p1 ${noteName(hi)}`)
    }
    if (prev && prev.a !== a && prev.b !== b) {
      const i0 = Math.abs(prev.hi - prev.lo) % 12
      const i1 = Math.abs(hi - lo) % 12
      const d1 = Math.sign(hi - prev.hi)
      const same = d1 !== 0 && d1 === Math.sign(lo - prev.lo) && i0 === i1 && (i1 === 0 || i1 === 7)
      if (same && quick(a, b, prev.a, prev.b)) {
        close()
        out.texture++
      } else if (same) {
        const kind = i1 === 0 ? 'octaves' : 'fifths'
        if (run.length && run[0].kind !== kind) close()
        run.push({ kind, where: where(a, t), text: `${where(a, t)}: parallel ${kind} ${noteName(prev.hi)}/${noteName(prev.lo)} to ${noteName(hi)}/${noteName(lo)}` })
      } else if (!(hi === prev.hi && lo === prev.lo)) {
        // Both striking the same two notes again keeps a doubling going; anything else ends it.
        close()
      }
    } else if (prev && (prev.a !== a || prev.b !== b)) {
      // One voice held while the other moved: not a doubling any more.
      close()
    }
    prev = { a, b, hi, lo }
  }
  close()
  return out
}

/**
 * Compares the writing of every song (rendering nothing). `mine` limits the report to those ids,
 * still compared against all. Returns the counts of things to look at, for the summary line.
 */
function compareSongs(SONGS, fmt, mine, print, near = false) {
  const all = Object.values(SONGS).filter((s) => s.ok)
  const ours = all.filter((s) => !mine || mine.includes(s.id))
  const quotesOf = (id) => SONGS[id]?.def.quotes ?? []
  // One quotes the other, or both quote a song that has the same thing (the ending and Mega both reprise the title's tune).
  const quoted = (a, b, group) => quotesOf(a).includes(b) || quotesOf(b).includes(a) || quotesOf(a).some((c) => quotesOf(b).includes(c) && group.has(c))
  const heads = new Map(all.map((s) => [s.id, phraseHeads(s)]))
  const count = { famous: 0, near: 0, heads: 0, quotes: 0, grooves: 0, bass: 0, parallels: 0, doublings: 0, texture: 0, above: 0 }

  print('== originality: phrase heads that run four or more intervals like a well-known tune')
  print('   (LOOK: five or more, or four from the start of both tunes, where a tune is known by. near: four')
  print(`   in the middle of one, which is usually a common turn of melody${near ? '' : '; --near lists them'})`)
  const famousRows = []
  for (const s of ours) {
    for (const h of heads.get(s.id)) {
      for (const [name, f] of Object.entries(FAMOUS)) {
        const m = sameShape(h.ivs, f)
        const run = h.ivs.slice(m.i, m.i + m.n)
        // Repeated notes or a plain scale run are no tune's own: three or more moves, of three or more sizes, are.
        if ((m.n < 4 && !(m.n === f.length && m.n >= 3)) || new Set(run).size < 3 || run.filter((d) => d !== 0).length < 3) continue
        const look = m.n >= 5 || (m.i === 0 && m.j === 0)
        count[look ? 'famous' : 'near']++
        famousRows.push({ look, text: `   ${look ? 'LOOK ' : 'near '} ${s.id} bar ${h.bar} (${h.part}), from its note ${m.i + 1}: ${m.n} intervals [${run.join(' ')}] as in ${name}${m.j ? ` (from its note ${m.j + 1})` : ''}` })
      }
    }
  }
  famousRows.sort((a, b) => Number(b.look) - Number(a.look))
  for (const r of famousRows) if (r.look || near) print(r.text)
  if (!count.famous) print(`   none${count.near ? `, and ${count.near} near` : ''}`)

  print('\n== sameness: phrase heads shared with another song (five intervals and six lengths alike)')
  const told = new Set()
  for (const s of ours) {
    for (const a of heads.get(s.id)) {
      const others = []
      for (const t of all) {
        if (t.id === s.id) continue
        for (const b of heads.get(t.id)) {
          if (a.ivs.length < 5 || b.ivs.length < 5 || a.ivs.slice(0, 5).join() !== b.ivs.slice(0, 5).join() || a.rhythm.slice(0, 6).join() !== b.rhythm.slice(0, 6).join()) continue
          others.push({ id: t.id, bar: b.bar, part: b.part })
        }
      }
      if (!others.length) continue
      const key = [s.id, ...others.map((o) => o.id)].sort().join() + '|' + a.ivs.slice(0, 5).join()
      if (told.has(key)) continue
      told.add(key)
      const group = new Set([s.id, ...others.map((o) => o.id)])
      const deliberate = others.every((o) => quoted(s.id, o.id, group))
      count[deliberate ? 'quotes' : 'heads']++
      print(`   ${deliberate ? 'quote  ' : 'LOOK   '} ${s.id} bar ${a.bar} (${a.part}) [${a.ivs.slice(0, 5).join(' ')}] = ${others.map((o) => `${o.id} bar ${o.bar} (${o.part})`).join(', ')}`)
    }
  }
  if (!count.heads && !count.quotes) print('   none')

  for (const [voice, label] of [
    ['noise', 'drum bars'],
    ['tri', 'bass bars'],
  ]) {
    print(`\n== sameness: ${label} shared between songs (a shape in two or more bars of each song is a groove; once is a fill or a passing bar)`)
    const shapes = new Map(all.map((s) => [s.id, barShapes(s, voice)]))
    const by = new Map()
    for (const [id, m] of shapes) {
      for (const [bar, shape] of m) {
        if (!by.has(shape)) by.set(shape, new Map())
        const b = by.get(shape)
        b.set(id, (b.get(id) ?? []).concat(bar))
      }
    }
    let n = 0
    const rows = []
    for (const [shape, songs] of by) {
      if (songs.size < 2 || ![...songs.keys()].some((id) => ours.some((s) => s.id === id))) continue
      const ids = [...songs.keys()]
      const group = new Set(ids)
      const often = ids.filter((id) => songs.get(id).length >= 2)
      const groove = often.some((a) => often.some((b) => a !== b && !quoted(a, b, group)))
      const deliberate = ids.every((a) => ids.every((b) => a === b || quoted(a, b, group)))
      if (groove) {
        n++
        count[voice === 'noise' ? 'grooves' : 'bass']++
      }
      rows.push({ groove, text: `   ${groove ? 'LOOK   ' : deliberate ? 'quote  ' : 'fill   '} ${shape.slice(shape.indexOf('|') + 1)}  ${ids.map((id) => `${id} (${songs.get(id).length})`).join(', ')}` })
    }
    rows.sort((a, b) => Number(b.groove) - Number(a.groove))
    for (const r of rows) print(r.text)
    if (!rows.length) print('   none')
    else if (!n) print('   (no shared groove)')
  }

  print('\n== pulse against pulse: parallel octaves or fifths between p1 and p2, and p2 above p1')
  print('   (four or more parallels in a row are a doubling, which is meant; sixteenth figures and bends are left out)')
  for (const s of ours) {
    const v = pulses(s, fmt)
    count.parallels += v.parallels.length
    count.doublings += v.doublings.length
    count.texture += v.texture + v.aboveQuick
    count.above += v.above.length
    if (!v.parallels.length && !v.doublings.length && !v.above.length) continue
    const extra = v.texture + v.aboveQuick ? `; ${v.texture + v.aboveQuick} in sixteenth figures` : ''
    print(`   ${s.id}: ${v.parallels.length} parallels, ${v.doublings.length} doublings, p2 above p1 at ${v.above.length} note starts${extra}`)
    for (const l of v.parallels) print(`      LOOK   ${l}`)
    for (const l of v.doublings) print(`      meant  ${l}`)
    for (const l of v.above.slice(0, 8)) print(`      LOOK   ${l}`)
    if (v.above.length > 8) print(`      ... and ${v.above.length - 8} more`)
  }
  return count
}

function compareSummary(c) {
  return `to look at: ${c.famous} famous-tune shapes (${c.near} near), ${c.heads} shared phrase heads (+${c.quotes} declared quotes), ${c.grooves} shared drum grooves, ${c.bass} shared bass riffs, ${c.parallels} pulse parallels (+${c.doublings} doublings), p2 above p1 ${c.above}`
}

/* ------------------------------------------------------------------ */
/* --browser: the Web Audio path, end to end, in headless Chrome       */
/* ------------------------------------------------------------------ */

/** Runs inside the page. Everything it needs is on window.maxx. */
async function pageScenario() {
  const { createAudio, SFX_IDS, SONGS } = window.maxx
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      if (fn()) return Math.round(performance.now() - t0)
      await sleep(5)
    }
    return -1
  }
  const checks = []
  const ok = (name, pass, detail = '') => checks.push([name, !!pass, String(detail)])
  const a = createAudio()
  // The loudest of a few readings 50 ms apart: one alone can land in the gap between two notes.
  const loudest = async (at, n) => {
    let level = 0
    for (let i = 0; i < n; i++) {
      await sleep(50)
      level = Math.max(level, a.meter(at).rms)
    }
    return level
  }
  ok('no AudioContext until it is needed', a.debug().state === 'none' && a.locked)
  const t0 = performance.now()
  a.unlock()
  const made = Math.round(performance.now() - t0)
  const running = await until(() => !a.locked)
  ok('unlock() starts the context', running >= 0, `${a.debug().state}, ${a.debug().sampleRate} Hz, context made in ${made} ms`)
  for (const at of ['music', 'sfx', 'out']) a.meter(at)
  const sfxMs = await until(() => a.debug().sfxReady === SFX_IDS.length)
  ok('effects are rendered at start-up', sfxMs >= 0, `${SFX_IDS.length} ready ${sfxMs + running} ms after unlock`)

  const silent = []
  for (const id of SFX_IDS) {
    a.sfx(id)
    let peak = 0
    for (let i = 0; i < 6; i++) {
      await sleep(12)
      peak = Math.max(peak, a.meter('sfx').peak)
    }
    if (peak < 0.01) silent.push(id)
    await until(() => a.debug().voices === 0, 2500)
    await sleep(35)
  }
  ok('every effect plays', silent.length === 0, silent.length ? `silent: ${silent.join(' ')}` : `${SFX_IDS.length} effects`)

  const loops = Object.keys(SONGS).filter((id) => SONGS[id].ok && SONGS[id].loop)
  const jingles = Object.keys(SONGS).filter((id) => SONGS[id].ok && !SONGS[id].loop)
  for (const id of loops) {
    a.music(id)
    const ms = await until(() => a.debug().song?.id === id)
    const level = await loudest('music', 7)
    ok(`song ${id} plays`, ms >= 0 && level > 0.01 && (a.debug().song?.pos ?? 0) > 0.2, `sounding ${ms} ms after music(), level ${level.toFixed(3)}`)
  }

  if (loops.length) {
    a.spray(true)
    await sleep(200)
    const hiss = a.meter('sfx').rms
    const before = a.debug().song.pos
    a.setPaused(true)
    await sleep(250)
    const held = a.meter('music').rms + a.meter('sfx').rms
    a.sfx('jump')
    const blocked = a.debug().voices === 0
    a.sfx('menuMove')
    const menu = a.debug().voices === 1
    a.setPaused(false)
    await sleep(250)
    const after = a.debug().song?.pos ?? -1
    const back = await loudest('music', 4)
    a.spray(false)
    ok('spray hisses; pause holds music and spray and blocks game effects', hiss > 0.012 && held < 0.002 && blocked && menu, `spray level ${hiss.toFixed(3)}, level while paused ${held.toFixed(5)}`)
    ok('resume picks the song up where it stopped', back > 0.01 && after - before > 0.15 && after - before < 0.45, `position ${before.toFixed(2)} s then ${after.toFixed(2)} s`)
    await sleep(100)

    const pos0 = a.debug().song.pos
    const tj = performance.now()
    let last = false
    let cuts = 0
    for (const [i, id] of jingles.entries()) {
      let done = false
      a.jingle(id, { onDone: () => (done = true) })
      await sleep(100)
      const level = await loudest('music', 4)
      const quietSong = a.debug().song === null && a.debug().jingle === id
      if (i + 1 < jingles.length) {
        a.jingle(jingles[i + 1], {})
        if (done) cuts++
      } else {
        await until(() => done, 20000)
        last = done
      }
      ok(`jingle ${id} plays over a silenced song`, level > 0.01 && quietSong, `level ${level.toFixed(3)}`)
    }
    await sleep(150)
    const pos1 = a.debug().song?.pos ?? -1
    ok('a jingle cut by another still calls onDone; the last one calls it at its end', cuts === jingles.length - 1 && last)
    ok('the song resumes after the jingles where it was', a.debug().song?.id === loops[loops.length - 1] && pos1 - pos0 > 0 && pos1 - pos0 < 0.6, `position ${pos0.toFixed(2)} s then ${pos1.toFixed(2)} s, ${Math.round(performance.now() - tj)} ms later`)

    // stopJingle: the way out of a scene in the middle of a jingle.
    const home = loops[loops.length - 1]
    let stoppedDone = false
    a.jingle(jingles[0], { onDone: () => (stoppedDone = true) })
    await sleep(150)
    a.stopJingle()
    await sleep(120)
    const cutLevel = await loudest('music', 3)
    const sd = a.debug()
    ok('stopJingle() cuts the jingle at once, with no onDone, and the song stays off', sd.jingle === null && sd.song === null && sd.want === null && cutLevel < 0.002, `jingle ${sd.jingle}, song ${sd.song?.id}, want ${sd.want}, level ${cutLevel.toFixed(4)}`)
    await sleep(Math.ceil(SONGS[jingles[0]].beats * 60000 / SONGS[jingles[0]].tempo))
    ok('and its onDone never comes, even after the time it would have ended', !stoppedDone)
    a.music(home)
    await until(() => a.debug().song?.id === home)
    const fresh = a.debug().song?.pos ?? -1
    ok('the next music() starts from the top, even the song the jingle silenced', fresh >= 0 && fresh < 0.25, `at ${fresh.toFixed(2)} s`)
    a.stopJingle()
    ok('stopJingle() with no jingle playing changes nothing', a.debug().want === home && a.debug().song?.id === home)

    await sleep(400)
    const before2 = a.debug().song.pos
    a.jingle(jingles[0], { thenMusic: null, onDone: () => (stoppedDone = true) })
    await sleep(150)
    a.stopJingle({ resume: true })
    await until(() => a.debug().song?.id === home)
    const back2 = a.debug().song?.pos ?? -1
    // Picked up at its place (it may read the very same position: the audio clock moves in steps), not from the top.
    ok('stopJingle({ resume: true }) brings the silenced song back where it was; the thenMusic is dropped', a.debug().want === home && before2 > 0.2 && back2 - before2 > -0.01 && back2 - before2 < 0.35 && !stoppedDone, `position ${before2.toFixed(2)} s then ${back2.toFixed(2)} s`)

    const other = loops.find((id) => id !== home) ?? home
    a.jingle(jingles[0], {})
    a.music(other)
    await sleep(100)
    a.stopJingle({ resume: true })
    const ms2 = await until(() => a.debug().song?.id === other)
    ok('a song asked for during the jingle plays at once on stopJingle({ resume: true })', ms2 >= 0 && a.debug().jingle === null, `sounding ${ms2} ms later`)

    a.jingle(jingles[0], {})
    a.setPaused(true)
    a.stopJingle()
    a.setPaused(false)
    await sleep(120)
    ok('a jingle held by a pause and stopped stays gone when the pause ends', a.debug().jingle === null && a.debug().song === null && (await loudest('music', 3)) < 0.002)
    a.music(home)
    await until(() => a.debug().song?.id === home)

    a.setTempoScale(1.25)
    const sw = await until(() => a.debug().song?.scale === 1.25)
    ok('hurry-up tempo re-renders and switches in place', sw >= 0 && (await loudest('music', 5)) > 0.01, `switched ${sw} ms after setTempoScale`)
    a.setTempoScale(1)

    a.music('no-such-song')
    await sleep(150)
    ok('a song that does not exist yet is silence, not an error', a.debug().want === null && a.debug().song === null && a.meter('music').rms < 0.002)
    a.music(loops[0])
    await until(() => a.debug().song !== null)

    // A scene that restarts its song on every call must not stack twenty copies of it.
    const peakFor = async (ms) => {
      let p = 0
      for (let t = 0; t < ms; t += 15) {
        await sleep(15)
        p = Math.max(p, a.meter('music').peak)
      }
      return p
    }
    await sleep(500)
    const one = await peakFor(900)
    for (let i = 0; i < 20; i++) a.music(loops[0], { restart: true })
    const twenty = await peakFor(300)
    for (let i = 0; i < 20; i++) {
      a.music(null)
      a.music(loops[i % loops.length])
    }
    const flapped = await peakFor(300)
    ok('twenty restarts or song changes in one tick sound like one song', twenty < one * 1.5 + 0.05 && flapped < one * 1.5 + 0.05, `peak ${twenty.toFixed(3)} and ${flapped.toFixed(3)}, against ${one.toFixed(3)} for one copy`)
    a.music(loops[0])

    let odd = ''
    try {
      a.setVolumes(NaN, 2)
      a.setVolumes(1, 1)
      a.setTempoScale(NaN)
      a.sfx('no-such-effect')
      a.jingle('no-such-jingle')
    } catch (e) {
      odd = String(e)
    }
    ok('nonsense arguments do nothing and do not throw', odd === '', odd)
  }

  let most = 0
  let peak = 0
  for (let k = 0; k < 4; k++) {
    for (const id of SFX_IDS) a.sfx(id)
    for (let i = 0; i < 8; i++) {
      await sleep(15)
      most = Math.max(most, a.debug().voices)
      peak = Math.max(peak, a.meter('out').peak * 2)
    }
  }
  ok('every effect at once: voices are capped and the mix stays under the soft clip ceiling', most <= 10 && peak < 1.7, `${most} voices, peak into the soft clip ${peak.toFixed(2)} (it is straight below 0.7)`)

  const d = a.debug()
  a.destroy()
  a.destroy()
  let threw = ''
  try {
    a.sfx('coin')
    a.music(loops[0] ?? null)
    a.jingle(jingles[0] ?? 'clear', {})
    a.spray(true)
    a.setPaused(true)
    a.setTempoScale(1.5)
    a.setVolumes(1, 1)
    a.stopJingle({ resume: true })
    a.unlock()
  } catch (e) {
    threw = String(e)
  }
  ok('destroy() closes the context, twice is fine, and calls after it do nothing', a.debug().state === 'none' && a.locked && !threw, threw)
  return { checks, slices: d.slices, worst: d.worstSliceMs, work: d.workMs, ready: d.readyMs }
}

async function browserCheck() {
  const { default: puppeteer } = await import('puppeteer-core')
  const port = Number(opt('--port') ?? 5483)
  const chrome = opt('--chrome') ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const html = `<!doctype html><meta charset="utf-8"><title>maxx audio check</title><script type="module">
import { createAudio } from '${GAME_URL}/game/audio/index.ts'
import { SFX_IDS } from '${GAME_URL}/game/audio/sfx.ts'
import { SONGS } from '${GAME_URL}/game/audio/library.ts'
window.maxx = { createAudio, SFX_IDS, SONGS }
</script>`
  const web = await createServer({
    configFile: false,
    root: REPO,
    logLevel: 'error',
    server: { port, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: 'maxx-audio-check-page',
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (!req.url?.startsWith('/__maxx_audio.html')) return next()
            res.setHeader('content-type', 'text/html')
            res.end(html)
          })
        },
      },
    ],
  })
  await web.listen()
  let browser
  try {
    // Headless Chrome has no user to click: let the context start without a gesture. Sound goes nowhere.
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run'] })
    const page = await browser.newPage()
    const logs = []
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`))
    page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`))
    await page.goto(`http://localhost:${port}/__maxx_audio.html`)
    await page.waitForFunction('window.maxx', { timeout: 30000 })
    const r = await page.evaluate(pageScenario)
    const noise = logs.filter((l) => !l.startsWith('debug: [maxx audio] no song'))
    r.checks.push(['no exceptions, errors or warnings in the page', noise.length === 0, noise.join(' | ').slice(0, 500)])
    console.log('Super Mighty Maxx audio, Web Audio path in headless Chrome\n')
    for (const [name, pass, detail] of r.checks) {
      console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
      if (!pass) fail('browser', name)
    }
    console.log(`\n  rendering took ${r.slices} slices on the main thread, ${r.work.toFixed(0)} ms in all, the longest ${r.worst.toFixed(1)} ms`)
    console.log(`  ready after being asked for (ms): ${Object.entries(r.ready).filter(([k]) => k.startsWith('song:')).map(([k, v]) => `${k.slice(5)} ${v}`).join(', ')}`)
  } finally {
    await browser?.close()
    await web.close()
  }
  console.log(failures.length ? `\nFAILED (${failures.length}):\n  ${failures.join('\n  ')}` : '\nOK: the Web Audio path works end to end.')
  process.exit(failures.length ? 1 : 0)
}

if (args.includes('--browser')) await browserCheck()

/* ------------------------------------------------------------------ */

const server = await createServer({
  configFile: false,
  root: REPO,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
})

try {
  const base = `${GAME_URL}/game/audio`
  const synth = await server.ssrLoadModule(`${base}/synth.ts`)
  const fmt = await server.ssrLoadModule(`${base}/format.ts`)
  const { SONGS, SONG_PROBLEMS } = await server.ssrLoadModule(`${base}/library.ts`)
  const { SFX, SFX_IDS } = await server.ssrLoadModule(`${base}/sfx.ts`)
  const limits = { knee: synth.LIMIT_KNEE }
  if (outDir) fs.mkdirSync(outDir, { recursive: true })
  const want = (id) => !only || only.includes(id)

  if (args.includes('--compare')) {
    // A draft or an old version, in place of the game's song with its id. Its import of defineSong must resolve from where it is.
    for (const file of opt('--with')?.split(',') ?? []) {
      const def = (await server.ssrLoadModule(path.resolve(file))).default
      if (!def?.parts) throw new Error(`${file}: no default export made with defineSong()`)
      SONGS[def.id] = fmt.compileSong(def)
      console.log(`(${def.id} from ${file})`)
    }
    console.log(`Super Mighty Maxx songs compared${only ? ` (${only.join(', ')} against all)` : ''}\n`)
    const c = compareSongs(SONGS, fmt, only, (l) => console.log(l), args.includes('--near'))
    console.log(`\n${compareSummary(c)}`)
    process.exit(0)
  }

  console.log(`Super Mighty Maxx audio check, ${rate} Hz${outDir ? `, WAV files in ${outDir}` : ''}\n`)
  for (const p of SONG_PROBLEMS) fail('songs', p)

  const ids = Object.keys(SONGS).sort((a, b) => Number(SONGS[b].loop) - Number(SONGS[a].loop) || a.localeCompare(b))
  const summary = []
  for (const id of ids) {
    if (!want(id)) continue
    const song = SONGS[id]
    const bars = song.beats / song.meter
    const introBars = song.introBeats / song.meter
    console.log(`== ${id}  "${song.def.title}"  ${song.def.key}, ${song.tempo} bpm, ${song.meter}/4, ${song.loop ? 'loops' : 'jingle'}`)
    for (const p of song.problems) console.log(`   PROBLEM: ${p}`)
    if (!song.ok) {
      console.log('   nothing playable\n')
      continue
    }
    const { sound, ms, worst, slices } = timed(synth.songJob(song, rate))
    const secs = sound.samples.length / rate
    const s = stats(sound.samples)
    console.log(`   length ${secs.toFixed(2)} s: ${introBars ? `intro ${introBars} bars + ` : ''}${bars - introBars} bars (${song.layout.map((l) => l.part).join(' ')})`)
    console.log(`   render ${ms.toFixed(0)} ms (${(secs / (ms / 1000)).toFixed(0)}x real time), ${slices} slices of 4096 samples, slowest ${worst.toFixed(2)} ms`)
    console.log(`   ${levelLine(id, s, sound, limits)}`)
    // The render is the song before its playback gain; say what the player hears.
    if (song.level !== 1) console.log(`   played at x${song.level.toFixed(3)} (gainDb ${song.def.gainDb > 0 ? '+' : ''}${song.def.gainDb}): peak ${f3(s.peak * song.level)} where it plays`)
    if (Math.abs(s.dc) > 0.01) fail(id, `DC offset ${s.dc.toFixed(4)}`)
    const x = sound.samples
    if (song.loop) {
      const jump = Math.abs(x[sound.loopStart] - x[sound.loopEnd - 1])
      let near = 0
      for (let i = 1; i <= 24; i++) near = Math.max(near, Math.abs(x[sound.loopEnd - i]), Math.abs(x[sound.loopStart + i - 1]))
      const bad = jump > 0.02
      console.log(`   loop ${sound.loopStart}..${sound.loopEnd} samples: seam step ${jump.toFixed(5)}, loudest sample within 0.5 ms of it ${near.toFixed(4)} ${bad ? 'BAD SEAM' : '(clean)'}`)
      if (bad) fail(id, `loop seam steps by ${jump.toFixed(4)}`)
      const fast = synth.renderSong(song, rate, 1.25)
      const fj = Math.abs(fast.samples[fast.loopStart] - fast.samples[fast.loopEnd - 1])
      console.log(`   hurry-up x1.25: ${(fast.samples.length / rate).toFixed(2)} s, seam step ${fj.toFixed(5)}, peak ${f3(stats(fast.samples).peak)}`)
      if (fj > 0.02) fail(id, `loop seam at x1.25 steps by ${fj.toFixed(4)}`)
    } else {
      const edge = Math.max(Math.abs(x[0]), Math.abs(x[x.length - 1]))
      console.log(`   ends: first and last sample within ${edge.toFixed(5)} of zero`)
      if (edge > 0.02) fail(id, 'starts or ends on a step')
    }
    const counts = fmt.VOICES.map((v) => `${v} ${song.events.filter((e) => e.voice === v).length}`)
    const h = harmony(song, fmt)
    console.log(`   notes: ${counts.join(', ')}   range: ${h.ranges.join(', ')}`)
    const bal = balanceLine(song, synth, fmt, rate)
    console.log(`   to the ear, against the melody: ${bal.text}`)
    if (bal.over.length) console.log(`   note: ${bal.over.join(' and ')} ${bal.over.length > 1 ? 'are' : 'is'} as loud as the melody or louder. Fine if meant (a drum hit as the punch line), otherwise lower its v.`)
    if (roll) for (const l of pianoRoll(song, fmt)) console.log(l)
    if (!song.chords.length) console.log('   (no `chords` declared: notes are checked against the key only)')
    if (!brief) for (const l of h.lines) console.log(`     ${l}`)
    console.log(`   harmony flags: ${h.flags.length || 'none'}`)
    for (const l of h.flags) console.log(`     ! ${l}`)
    if (!brief && h.infos.length) {
      console.log('   harmony notes (fine, listed so you can see them):')
      for (const l of h.infos) console.log(`     . ${l}`)
    }
    console.log('')
    summary.push({ id, key: song.def.key, tempo: song.tempo, bars: bars - introBars, introBars, secs, ms, flags: h.flags.length, loop: song.loop })
    if (outDir) {
      writeWav(path.join(outDir, `${id}.wav`), [x], rate)
      if (song.loop) {
        const intro = x.subarray(0, sound.loopStart)
        const body = x.subarray(sound.loopStart, sound.loopEnd)
        writeWav(path.join(outDir, `${id}.looped.wav`), [intro, body, body], rate)
      }
    }
  }

  const sfxIds = SFX_IDS.filter(want)
  if (sfxIds.length) {
    console.log('== sound effects')
    console.log(`   ${pad('id', 11)} ${lpad('ms', 5)} ${lpad('peak', 6)} ${lpad('rms', 6)} ${lpad('rms dB', 9)} ${lpad('dc', 8)} ${lpad('clip', 4)} ${lpad('tones', 5)} ${lpad('render', 8)}`)
    let total = 0
    let slowest = ['', 0]
    for (const id of sfxIds) {
      const { sound, ms } = timed(synth.sfxJob(id, rate))
      total += ms
      if (ms > slowest[1]) slowest = [id, ms]
      const s = stats(sound.samples)
      const x = sound.samples
      if (s.bad) fail(id, 'not a number in the output')
      if (s.clipped) fail(id, `${s.clipped} clipped samples`)
      if (s.rms < 0.004 || s.peak < 0.02) fail(id, 'silent')
      if (Math.abs(x[0]) > 0.02 || Math.abs(x[x.length - 1]) > 0.02) fail(id, 'starts or ends on a step')
      console.log(
        `   ${pad(id, 11)} ${lpad(Math.round((x.length / rate) * 1000), 5)} ${lpad(f3(s.peak), 6)} ${lpad(f3(s.rms), 6)} ${lpad(db(s.rms), 9)} ${lpad(s.dc.toFixed(4), 8)} ${lpad(s.clipped, 4)} ${lpad(SFX[id].tones.length, 5)} ${lpad(ms.toFixed(2) + ' ms', 8)}`,
      )
      if (outDir) writeWav(path.join(outDir, `sfx-${id}.wav`), [x], rate)
    }
    console.log(`   all ${sfxIds.length} effects render in ${total.toFixed(1)} ms; slowest ${slowest[0]} ${slowest[1].toFixed(2)} ms\n`)
  }

  if (want('spray')) {
    const t0 = performance.now()
    const sp = synth.renderSpray(rate)
    const ms = performance.now() - t0
    const x = sp.samples
    const s = stats(x)
    let dsum = 0
    for (let i = 1; i < x.length; i++) dsum += (x[i] - x[i - 1]) ** 2
    const typical = Math.sqrt(dsum / (x.length - 1))
    const seam = Math.abs(x[0] - x[x.length - 1])
    const z = seam / typical
    console.log('== spray loop')
    console.log(`   length ${(x.length / rate).toFixed(2)} s, render ${ms.toFixed(1)} ms, peak ${f3(s.peak)}, rms ${f3(s.rms)} (${db(s.rms)}), dc ${s.dc.toFixed(5)}, clipped ${s.clipped}`)
    console.log(`   seam step ${seam.toFixed(5)}, ${z.toFixed(2)} times the usual step between samples ${z > 5 ? 'BAD SEAM' : '(clean)'}\n`)
    if (z > 5) fail('spray', 'loop seam stands out')
    if (s.clipped) fail('spray', 'clipped')
    if (s.rms < 0.004) fail('spray', 'silent')
    if (outDir) writeWav(path.join(outDir, 'spray.looped.wav'), [x, x, x], rate)
  }

  if (summary.length) {
    console.log('== songs')
    for (const s of summary) {
      console.log(`   ${pad(s.id, 10)} ${pad(s.key, 10)} ${lpad(s.tempo, 3)} bpm  ${lpad(s.bars, 3)} bars${s.introBars ? ` +${s.introBars} intro` : '         '}  ${lpad(s.secs.toFixed(1), 5)} s  ${s.loop ? 'loop  ' : 'jingle'}  render ${lpad(s.ms.toFixed(0), 4)} ms  harmony flags ${s.flags}`)
    }
    const c = compareSongs(SONGS, fmt, summary.map((s) => s.id), () => {})
    console.log(`   compared (--compare for the detail): ${compareSummary(c)}`)
    console.log('')
  }

  if (failures.length) {
    console.log(`FAILED (${failures.length}):`)
    for (const f of failures) console.log(`  ${f}`)
    process.exitCode = 1
  } else {
    console.log('OK: no clipping, no silence, no loader problems, clean seams.')
  }
} finally {
  await server.close()
}
