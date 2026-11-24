// Drawing secret rivals 1 and 2 (sim/entities/rival_bill.ts, rival_streaks.ts) from the
// 'rivals_a' atlas (scripts/maxx/art-rivals-a.mjs). The art faces right; everything is
// mirrored when the entity faces left. Each rival wears his dirt stage (0 filthy, 1, 2) from
// his bar, and the telegraphs get a mark of their own: Bill's landing ring, a drip ring under
// each sponge, chevrons at the height Sir Streaks is about to dash at. The slick streak draws
// the floor back over the slick tiles and lays a wet film on it (see streaks_slick).
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'
import { drawTileAs } from '../tiles'

const ATLAS = 'rivals_a'

const BILL_POSES = ['idle', 'taunt', 'hopTell', 'hop', 'land', 'lobTell', 'lob', 'sloshTell', 'slosh', 'dizzy', 'washed', 'recover', 'flinch', 'bonk'] as const
const SK_POSES = ['stand', 'pace', 'salute', 'throwTell', 'throw', 'catch', 'lowTell', 'highTell', 'lowDash', 'highDash', 'skid', 'stuck', 'stuckHit', 'recover', 'flinch', 'bonk'] as const
type BillPose = (typeof BILL_POSES)[number]
type SkPose = (typeof SK_POSES)[number]

interface Tables {
  bill: Record<BillPose, string[][]>
  billBeaten: string[]
  sk: Record<SkPose, string[][]>
  skBeaten: string[]
  sponge: string[]
  wave: string[]
  blade: string[]
  shadow: string[]
  drip: string[]
  chevron: string
  star: string
  glint: string[]
  sweat: string
  slick: string[]
}

let tables: Tables | null = null

/** Every frame list, looked up once: nothing is built while drawing. */
function frames(rc: RenderCtx): Tables {
  if (tables) return tables
  const s = rc.sprites
  const a = (name: string): string[] => s.anim(ATLAS, name)
  const byStage = <P extends string>(who: string, poses: readonly P[]): Record<P, string[][]> => {
    const out = {} as Record<P, string[][]>
    for (const p of poses) out[p] = [a(`${who}_${p}_0`), a(`${who}_${p}_1`), a(`${who}_${p}_2`)]
    return out
  }
  const t: Tables = {
    bill: byStage('bill', BILL_POSES),
    billBeaten: a('bill_beaten_s'),
    sk: byStage('streaks', SK_POSES),
    skBeaten: a('streaks_beaten_s'),
    sponge: a('bill_sponge'),
    wave: a('bill_wave'),
    blade: a('streaks_blade'),
    shadow: a('mark_shadow'),
    drip: a('mark_drip'),
    chevron: a('mark_chevron')[0] ?? '',
    star: a('mark_star')[0] ?? '',
    glint: a('mark_glint'),
    sweat: a('mark_sweat')[0] ?? '',
    slick: a('mark_slick'),
  }
  // Only keep the tables once the atlas is really there (the first frame may come before it loads).
  if (t.billBeaten.length) tables = t
  return t
}

/** The dirt stage from the bar: 0 while more than two thirds is left, then 1, then 2. */
function stageOf(e: Entity): number {
  return e.hp * 3 > e.maxHp * 2 ? 0 : e.hp * 3 > e.maxHp ? 1 : 2
}

function pick(list: string[], i: number): string {
  return list.length ? list[((i % list.length) + list.length) % list.length] : ''
}

/** Three little stars going round a point. */
function stars(rc: RenderCtx, name: string, x: number, y: number, rx: number): void {
  for (let k = 0; k < 3; k++) {
    const a = rc.tick * 0.11 + k * 2.094
    rc.draw(name, x + Math.cos(a) * rx, y + Math.sin(a) * 4)
  }
}

/** Spotless: a glint comes and goes at one spot, then the other. */
function twinkle(rc: RenderCtx, T: Tables, x0: number, y0: number, x1: number, y1: number): void {
  const k = (rc.tick >> 3) % 12
  if (k < 3) rc.draw(pick(T.glint, k === 1 ? 1 : 0), x0, y0)
  else if (k >= 6 && k < 9) rc.draw(pick(T.glint, k === 7 ? 1 : 0), x1, y1)
}

/** Two beads of sweat flung off as a third of him washes away (rattle counts 40 down to 0). */
function sweat(rc: RenderCtx, name: string, x: number, y: number, rattle: number): void {
  if (rattle <= 0) return
  const k = 40 - rattle
  rc.draw(name, x - 6 - k * 0.5, y - 4 - k * 0.6 + k * k * 0.03)
  rc.draw(name, x + 6 + k * 0.6, y - 2 - k * 0.5 + k * k * 0.03)
}

/* ------------------------------------------------------------------ */
/* Bucket Bill                                                         */
/* ------------------------------------------------------------------ */

registerRenderer('bill', (_g, e, rc) => {
  const T = frames(rc)
  const v = e.vars
  const t = e.stateT
  const flip = e.facing < 0
  const cx = e.x + e.w / 2
  const feet = e.y + e.h
  if (e.state === 'beaten') {
    rc.draw(pick(T.billBeaten, rc.tick >> 4), cx, feet, { flipX: flip })
    twinkle(rc, T, cx - 9, feet - 30, cx + 11, feet - 14)
    return
  }
  const st = stageOf(e)
  let pose: BillPose = 'idle'
  let f = 0
  let dx = 0
  switch (e.state) {
    case 'wait':
    case 'idle':
      // A breath every half second, a blink now and then.
      f = (rc.tick + e.id * 13) % 150 < 6 ? 2 : (rc.tick >> 5) & 1
      if (v.flinch > 0) pose = 'flinch'
      break
    case 'intro':
      pose = 'taunt'
      f = t >> 3
      break
    case 'hopTell':
      pose = 'hopTell'
      f = t * 2 > v.tellT ? 1 : 0
      // Trembling as the spring winds up.
      if (t * 3 > v.tellT * 2) dx = rc.tick & 2 ? 1 : -1
      break
    case 'hop':
      pose = 'hop'
      f = t * 2 < v.hopT ? 0 : 1
      break
    case 'land':
      pose = 'land'
      f = t < 7 ? 0 : 1
      break
    case 'lobTell':
      pose = 'lobTell'
      f = t >> 3
      break
    case 'lob':
      // Arm forward just after each throw, back with the next sponge before it.
      pose = 'lob'
      f = v.throwT < 10 ? 1 : 0
      if (v.n === 0 && v.throwT >= 10) {
        pose = 'idle'
        f = 0
      }
      break
    case 'sloshTell':
      pose = 'sloshTell'
      f = t >> (t * 3 > v.tellT * 2 ? 2 : 3)
      break
    case 'slosh':
      pose = 'slosh'
      f = t >> 2
      break
    case 'dizzy':
      pose = v.flinch > 0 ? 'washed' : 'dizzy'
      f = v.flinch > 0 ? t >> 2 : t >> 3
      break
    case 'recover':
      pose = 'recover'
      f = t >> 2
      break
  }
  if (v.bonk > 0 && (pose === 'idle' || pose === 'flinch')) pose = 'bonk'
  if (v.rattle > 0) dx = rc.tick & 2 ? 1 : -1

  // The landing shadow: where he will come down, darkening as he does.
  if (e.state === 'hopTell' || e.state === 'hop') {
    const p = e.state === 'hop' ? 0.5 + (0.5 * t) / Math.max(1, v.hopT) : (0.5 * t) / Math.max(1, v.tellT)
    rc.draw(pick(T.shadow, p > 0.75 ? 0 : p > 0.4 ? 1 : 2), v.tx, v.floor)
  }
  rc.draw(pick(T.bill[pose][st], f), cx + dx, feet, { flipX: flip })
  if (e.state === 'dizzy') stars(rc, T.star, cx, e.y - 10, 15)
  sweat(rc, T.sweat, cx, e.y - 8, v.rattle)
}, {
  // Beaten, a happy sigh now and then (on the cosmetic clock: the world may stand still).
  tick(e, rc) {
    if (e.state === 'beaten' && (rc.tick + e.id * 7) % 100 === 40) rc.fx('bubble', e.x + e.w / 2 + e.facing * 4, e.y + e.h - 22, 2)
  },
})

registerRenderer('bill_sponge', (_g, e, rc) => {
  const T = frames(rc)
  // Where it will come down: a dark drip mark on the floor, from the moment it is thrown.
  if (e.vars.n > 0) rc.draw(pick(T.drip, e.stateT > e.vars.n - 14 ? 0 : 1), e.vars.tx, e.vars.fy)
  rc.draw(pick(T.sponge, e.stateT >> 2), e.x + e.w / 2, e.y + e.h / 2, { flipX: e.facing < 0 })
})

registerRenderer('bill_wave', (_g, e, rc) => {
  const T = frames(rc)
  rc.draw(pick(T.wave, e.stateT >> 3), e.x + e.w / 2, e.y + e.h, { flipX: e.facing < 0 })
})

/* ------------------------------------------------------------------ */
/* Sir Streaks                                                         */
/* ------------------------------------------------------------------ */

registerRenderer('streaks', (_g, e, rc) => {
  const T = frames(rc)
  const v = e.vars
  const t = e.stateT
  const flip = e.facing < 0
  const cx = e.x + e.w / 2
  const feet = e.y + e.h
  if (e.state === 'beaten') {
    // Glides out upright, then a long, deep, very gracious bow.
    const since = v.arrive > 0 ? t - v.arrive : -1
    rc.draw(pick(T.skBeaten, since < 12 ? 0 : since < 24 ? 1 : 2), cx, feet, { flipX: flip })
    twinkle(rc, T, cx - e.facing * 6, feet - 50, cx + e.facing * 2, feet - 30)
    return
  }
  const st = stageOf(e)
  let pose: SkPose = 'stand'
  let f = 0
  let dx = 0
  switch (e.state) {
    case 'wait':
      f = (rc.tick + e.id * 7) % 170 < 6 ? 2 : (rc.tick >> 5) & 1
      break
    case 'pace':
      pose = 'pace'
      f = t >> 3
      break
    case 'intro':
      pose = 'salute'
      f = t < 50 ? 0 : 1
      break
    case 'throwTell':
      pose = 'throwTell'
      f = t * 2 > v.tellT ? 1 : 0
      break
    case 'throw':
      pose = 'throw'
      f = t < 10 ? 0 : 1
      break
    case 'catch':
      pose = 'catch'
      break
    case 'dashTell':
      pose = v.high === 1 ? 'highTell' : 'lowTell'
      f = t >> 2
      if (t * 3 > v.tellT * 2) dx = rc.tick & 2 ? 1 : -1
      break
    case 'dash':
      pose = v.high === 1 ? 'highDash' : 'lowDash'
      f = t >> 2
      break
    case 'skid':
      pose = 'skid'
      break
    case 'turn':
      pose = 'stand'
      break
    case 'stuck':
      pose = v.flinch > 0 ? 'stuckHit' : 'stuck'
      f = v.flinch > 0 ? t >> 2 : t >> 3
      // Wobbling where he is stuck.
      dx = (t >> 3) & 1 ? 1 : 0
      break
    case 'recover':
      pose = 'recover'
      f = t < 14 ? 0 : 1
      break
  }
  if (v.flinch > 0 && (pose === 'stand' || pose === 'pace')) pose = 'flinch'
  if (v.bonk > 0 && (pose === 'stand' || pose === 'pace' || pose === 'flinch')) pose = 'bonk'
  if (v.rattle > 0) dx = rc.tick & 2 ? 1 : -1

  // The dash telegraph: chevrons at the height he will come through, one more every few ticks.
  if (e.state === 'dashTell') {
    const y = v.high === 1 ? v.floor - 64 - 22 : v.floor - 18
    const n = Math.min(3, 1 + Math.floor((3 * t) / Math.max(1, v.tellT)))
    for (let k = 0; k < n; k++) rc.draw(T.chevron, cx + e.facing * (34 + k * 12), y, { flipX: flip })
  }
  rc.draw(pick(T.sk[pose][st], f), cx + dx, feet, { flipX: flip })
  if (e.state === 'stuck') stars(rc, T.star, cx + e.facing * 6, e.y + 4, 12)
  sweat(rc, T.sweat, cx, e.y - 4, v.rattle)
})

registerRenderer('streaks_blade', (_g, e, rc) => {
  const T = frames(rc)
  // Its speed lines trail behind it, whichever way it is going.
  const going = e.vars.back === 1 ? -e.vars.dir : e.vars.dir
  rc.draw(pick(T.blade, e.stateT >> 1), e.x + e.w / 2, e.y + e.h / 2, { flipX: going < 0 })
})

/* ---- the slick streak ---- */

// The simulation makes the streak's tiles slick ('I'), and the tile layer would draw them as
// that theme's slick floor (foam in a tunnel). What a player should see is the alley floor it
// was, wet: so this draws those tiles as the floor ('#'; the floor round them already counts
// slick as ground) and lays the wet film on top.
const C_SLICK = 73 // 'I'

registerRenderer('streaks_slick', (g, e, rc) => {
  const T = frames(rc)
  const v = e.vars
  if (v.tx1 < v.tx0) return
  const grid = rc.world.grid
  for (let tx = v.tx0; tx <= v.tx1; tx++) if (grid.t[v.ty * grid.w + tx] === C_SLICK) drawTileAs(g, rc.sprites, rc.world, tx, v.ty, '#', rc.camX, rc.camY)
  // About to dry: the film flickers, so the grip coming back is no surprise.
  if (v.ttl < 60 && rc.tick & 4) return
  const top = v.ty * 32
  for (let tx = v.tx0; tx <= v.tx1; tx++) {
    if (grid.t[v.ty * grid.w + tx] !== C_SLICK) continue
    const part = v.tx0 === v.tx1 ? tx % 3 : tx === v.tx0 ? 3 : tx === v.tx1 ? 4 : tx % 3
    rc.draw(pick(T.slick, part), tx * 32, top)
    const k = (tx * 7 + (rc.tick >> 3)) % 9
    if (k < 3) rc.draw(pick(T.glint, k), tx * 32 + 6 + ((tx * 11) % 20), top + 1)
  }
})
