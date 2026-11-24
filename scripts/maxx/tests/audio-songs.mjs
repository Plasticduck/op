// The songs and the mix by numbers: what audio-render.mjs prints for a person to read, held here as
// rules so a slip cannot come back unheard. Loudness is BS.1770 (K-weighted and gated), the way the ear
// weighs it: plain RMS undercounts anything bright (the spray hiss was 8 dB under the music by RMS and
// only 5.5 to the ear).
//
//   node scripts/maxx/tests/audio-songs.mjs [--only <text>]
import { suite } from '../lib/testkit.mjs'

const t = await suite('audio-songs')
const fmt = await t.loadModule('audio/format.ts')
const synth = await t.loadModule('audio/synth.ts')
const { SONGS } = await t.loadModule('audio/library.ts')
const mix = await t.loadModule('audio/index.ts')
const { defaultSettings } = await t.loadModule('engine/save.ts')

/** The game always asks for 48 kHz, and the K-weighting coefficients below are for that rate. */
const RATE = 48000
/** o6 e: format.ts says a pulse above it is piercing, to be touched for a climax, not lived in. */
const MELODY_TOP = 88
/** How far a looping song may sit from the median loop, as played, before a change of song is a jump. */
const LOOP_SPREAD_LU = 2

function biquad(x, b, a) {
  const y = new Float64Array(x.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1
    x1 = x[i]
    y2 = y1
    y1 = v
    y[i] = v
  }
  return y
}

/** Integrated loudness in LUFS: the BS.1770 shelf and high-pass, 400 ms blocks every 100 ms, absolute and relative gates. */
function loudness(samples) {
  const shelf = biquad(samples, [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585])
  const k = biquad(shelf, [1, -2, 1], [1, -1.99004745483398, 0.99007225036621])
  const sq = new Float64Array(k.length + 1)
  for (let i = 0; i < k.length; i++) sq[i + 1] = sq[i] + k[i] * k[i]
  const blk = Math.round(0.4 * RATE)
  const hop = Math.round(0.1 * RATE)
  const blocks = []
  for (let s = 0; s + blk <= k.length; s += hop) blocks.push((sq[s + blk] - sq[s]) / blk)
  const lufs = (m) => -0.691 + 10 * Math.log10(m)
  const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length
  const loud = blocks.filter((m) => lufs(m) > -70)
  const rel = lufs(mean(loud)) - 10
  return lufs(mean(loud.filter((m) => lufs(m) > rel)))
}

const dB = (gain) => 20 * Math.log10(gain)
const signed = (x) => (x >= 0 ? '+' : '') + x.toFixed(1)

const rendered = new Map()
function render(id) {
  if (!rendered.has(id)) rendered.set(id, synth.renderSong(SONGS[id], RATE))
  return rendered.get(id)
}
const loops = Object.keys(SONGS).filter((id) => SONGS[id].ok && SONGS[id].loop).sort()

let loopRows = null
/** Each looping song's loop body as the game plays it (with its gainDb), and the median of them. */
function loopLoudness() {
  if (!loopRows) {
    const rows = loops.map((id) => {
      const s = render(id)
      return { id, lu: loudness(Float64Array.from(s.samples.subarray(s.loopStart, s.loopEnd))) + dB(SONGS[id].level) }
    })
    const sorted = rows.map((r) => r.lu).sort((a, b) => a - b)
    loopRows = { rows, median: sorted[Math.floor(sorted.length / 2)] }
  }
  return loopRows
}

/** The longest run of p1 notes above o6 e, and p1's time up there as a share of all its sounding time. */
function highMelody(song) {
  let run = 0
  let longest = 0
  let high = 0
  let all = 0
  for (const e of song.events) {
    if (e.voice !== 'p1') continue
    const up = Math.max(...e.pitches) > MELODY_TOP
    run = up ? run + 1 : 0
    longest = Math.max(longest, run)
    all += e.sounds
    if (up) high += e.sounds
  }
  return { longest, share: all ? high / all : 0 }
}
const touchesOnly = (h) => h.longest <= 2 && h.share <= 0.03

t.test('the melody rule catches an octave carried over from the line before', () => {
  // lube's slip in miniature: the third bar's > lands on o7 because the second bar already went up to o6.
  const song = (third) =>
    fmt.compileSong({
      id: 'lube',
      title: 'Carried',
      key: 'A minor',
      tempo: 104,
      loop: true,
      setup: { p1: 'o5 l8' },
      parts: { A: { p1: `r >e r d16 c16 r <b r g | a r r4 >c4 r4 | r ${third} r d16 c16 r <b r g | a r e r a4 r4` } },
      play: 'A',
    })
  const carried = song('>e')
  const meant = song('e')
  t.eq(carried.problems.length + meant.problems.length, 0, 'the two drafts compile cleanly')
  t.ok(!touchesOnly(highMelody(carried)), `the carried octave passed: ${JSON.stringify(highMelody(carried))}`)
  t.ok(touchesOnly(highMelody(meant)), `the meant line failed: ${JSON.stringify(highMelody(meant))}`)
})

t.test('every looping song only touches its melody above o6 e', () => {
  const bad = loops.map((id) => ({ id, ...highMelody(SONGS[id]) })).filter((h) => !touchesOnly(h))
  t.ok(
    !bad.length,
    bad.map((h) => `${h.id}: ${h.longest} notes in a row above E6, ${(h.share * 100).toFixed(1)}% of its melody up there`).join('; ') +
      ' (check the octave marks with audio-render.mjs --roll)',
  )
})

t.test(`every looping song, as played, is within ${LOOP_SPREAD_LU} LU of the median loop`, () => {
  const { rows, median } = loopLoudness()
  t.notes.push(`loops as played, LU against the median (${median.toFixed(1)} LUFS): ${rows.map((r) => `${r.id} ${signed(r.lu - median)}`).join(', ')}`)
  const off = rows.filter((r) => Math.abs(r.lu - median) > LOOP_SPREAD_LU)
  t.ok(!off.length, `${off.map((r) => `${r.id} ${signed(r.lu - median)} LU`).join(', ')}: set the song's gainDb (format.ts) to about the opposite`)
})

t.test('a song lifted by gainDb still peaks under the limiter ceiling where it is played', () => {
  for (const id of Object.keys(SONGS)) {
    if (!SONGS[id].ok || SONGS[id].level === 1) continue
    let peak = 0
    for (const v of render(id).samples) peak = Math.max(peak, Math.abs(v))
    t.ok(peak * SONGS[id].level <= synth.LIMIT_CEIL, `${id}: peak ${peak.toFixed(3)} x ${SONGS[id].level.toFixed(3)} is over ${synth.LIMIT_CEIL}`)
  }
})

t.test('gainDb is a playback level, and a wrong one is a loader problem, not a throw', () => {
  const base = { id: 'bonus', title: 'Gain', key: 'C', tempo: 120, loop: true, parts: { A: { p1: 'c1' } }, play: 'A' }
  t.eq(fmt.compileSong(base).level, 1, 'no gainDb plays at 1')
  const lifted = fmt.compileSong({ ...base, gainDb: 2.8 })
  t.near(lifted.level, 1.38, 0.01, 'gainDb 2.8 as a factor')
  t.eq(lifted.problems.length, 0, 'a good gainDb is no problem')
  for (const wrong of [9, -7, Number.NaN, '3']) {
    const s = fmt.compileSong({ ...base, gainDb: wrong })
    t.eq(s.level, 1, `gainDb ${String(wrong)} plays at 1`)
    t.ok(s.problems.some((p) => p.includes('gainDb')), `gainDb ${String(wrong)} is reported`)
  }
})

t.test('the spray hiss sits about 8 LU under the music at the default settings', () => {
  const { music, sfx } = defaultSettings()
  // index.ts squares the 0..10 sliders.
  const musicGain = mix.MUSIC_LEVEL * (music / 10) ** 2
  const sprayGain = mix.SFX_LEVEL * (sfx / 10) ** 2 * mix.SPRAY_LEVEL
  const spray = loudness(Float64Array.from(synth.renderSpray(RATE).samples)) + dB(sprayGain)
  const { rows, median } = loopLoudness()
  const quietest = Math.min(...rows.map((r) => r.lu))
  t.near(median + dB(musicGain) - spray, 8, 1, 'LU under the median song')
  t.ok(quietest + dB(musicGain) - spray >= 6, `only ${(quietest + dB(musicGain) - spray).toFixed(1)} LU under the quietest song`)
})

await t.finish()
