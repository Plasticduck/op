// Draws MUDZILLA and what it throws (sim/entities/mudzilla.ts), from the 'mudzilla' atlas
// (scripts/maxx/art-mudzilla.mjs). The truck is five sprites, back to front: chassis, rear tyre,
// front tyre, body, face; its pose (pitch, sink, tyre turn) and phase come from e.vars, its face
// from its state. Everything faces right in the atlas and is mirrored when e.facing is -1.
import { MZ } from '../../sim/entities/mudzilla'
import type { Entity } from '../../sim/types'
import { registerRenderer } from '../registry'
import type { RenderCtx } from '../registry'

const A = 'mudzilla/'
const PITCH = [-8, 0, 12, 26, 44]
const FACES = ['mean', 'blink', 'grit', 'roar', 'flinch', 'pant0', 'pant1', 'nervous'] as const
type Face = (typeof FACES)[number]
const F_MEAN = 0
const F_BLINK = 1
const F_GRIT = 2
const F_ROAR = 3
const F_FLINCH = 4
const F_PANT0 = 5
const F_PANT1 = 6
const F_NERVOUS = 7

// Every frame name, built once: [stage 1..3][pitch].
const CHASSIS: string[][] = []
const BODY: string[][] = []
const FACE: string[][][] = []
const TYRE: string[][] = []
const BLUR: string[][] = []
for (let s = 0; s <= 3; s++) {
  CHASSIS.push(PITCH.map((_, p) => `${A}chassis${Math.max(1, s)}_${p}`))
  BODY.push(PITCH.map((_, p) => `${A}body${Math.max(1, s)}_${p}`))
  FACE.push(FACES.map((f: Face) => PITCH.map((_, p) => `${A}face${Math.max(1, s)}_${f}_${p}`)))
  TYRE.push([0, 1, 2, 3].map((i) => `${A}tyre${Math.max(1, s)}${i}`))
  BLUR.push([0, 1].map((i) => `${A}tyre${Math.max(1, s)}Blur${i}`))
}
const DAZED = [`${A}finDazed0`, `${A}finDazed1`]
const SHRINK = [`${A}finShrink0`, `${A}finShrink1`, `${A}finShrink2`]
const SHEEP = `${A}smallSheep0`
const HAPPY = [`${A}smallHappy0`, `${A}smallHappy1`]
const CLOD = [`${A}clod0`, `${A}clod1`]
const GLOB = [`${A}glob0`, `${A}glob1`]
const WAVE = [`${A}wave0`, `${A}wave1`, `${A}wave2`]
const SPRAY = [`${A}spray0`, `${A}spray1`, `${A}spray2`]
const FLECKS = [`${A}flecks0`, `${A}flecks1`]
const SHUTTER = `${A}shutter0`

// Hubs per pitch frame, relative to the feet, facing right (from the atlas meta; these are the
// generator's numbers, used until the meta is read).
let axles: { rear: number[]; front: number[] }[] = [
  { rear: [-54, -33], front: [55, -25] },
  { rear: [-54, -33], front: [56, -33] },
  { rear: [-54, -33], front: [55, -45] },
  { rear: [-54, -33], front: [53, -59] },
  { rear: [-54, -33], front: [47, -77] },
]
let tyreTurn = 3.7
let metaRead = false

function readMeta(rc: RenderCtx): void {
  metaRead = true
  const meta = rc.sprites.atlas('mudzilla')?.meta
  if (!meta) return
  const ax = meta.axles as { rear: number[]; front: number[] }[] | undefined
  if (Array.isArray(ax) && ax.length === PITCH.length) axles = ax
  if (typeof meta.tyreTurnPx === 'number' && meta.tyreTurnPx > 0) tyreTurn = meta.tyreTurnPx
}

// The beats of the fight the pictures follow.
const SLAM = MZ.slam
const WAKE_ROAR = MZ.wakeRoar
const SHRINK_AT = MZ.fin.shrinkAt
const SHRINK_STEP = MZ.fin.step
const SHEEP_AT = MZ.fin.sheepAt
const HAPPY_AT = MZ.fin.happyAt
const VOLLEYS = MZ.volleys
const VOLLEY_GAP = MZ.volleyGap
const STOMP_TELL = MZ.stompTell
const STOMP_AGAIN = MZ.stompAgain
const HITCH = MZ.hitch

function pitchIndex(pitch: number): number {
  let best = 0
  for (let i = 1; i < PITCH.length; i++) if (Math.abs(PITCH[i] - pitch) < Math.abs(PITCH[best] - pitch)) best = i
  return best
}

/** Which face goes with what it is doing. */
function faceOf(e: Entity, tick: number): number {
  const v = e.vars
  const t = e.stateT
  const stage = v.phase
  const calm = stage >= 3 ? F_NERVOUS : F_MEAN
  // Water in the face makes it splutter, unless it is busy winding up an attack.
  const wet = v.hitT < 5
  switch (e.state) {
    case 'sleep':
      return F_BLINK
    case 'wake':
      // stateT 0 is the tick the fight starts on, the picture the versus card shows: roaring.
      return t === 0 ? F_ROAR : t < 12 ? F_BLINK : t < WAKE_ROAR ? F_MEAN : F_ROAR
    case 'stompTell':
      // The hitch before the slam: mouth wide open.
      return t > (v.n === 0 ? STOMP_TELL : STOMP_AGAIN)[Math.max(1, Math.min(3, stage)) - 1] - HITCH ? F_ROAR : F_GRIT
    case 'rainTell':
    case 'blobTell':
    case 'spinTell':
    case 'hopTell':
    case 'hopLand':
      return F_GRIT
    case 'stomp':
      return t >= SLAM && t < SLAM + 14 ? F_ROAR : F_GRIT
    case 'rain':
    case 'hop':
    case 'roar':
      return F_ROAR
    case 'spin':
      return t < 50 ? F_ROAR : F_GRIT
    case 'blobs':
      return t < 18 ? F_ROAR : wet ? F_FLINCH : calm
    case 'winded':
      if (wet && (tick >> 3) % 2 === 0) return F_FLINCH
      return (t >> 4) % 2 === 0 ? F_PANT0 : F_PANT1
    case 'recover':
    case 'idle':
      if (wet) return F_FLINCH
      // A blink every few seconds.
      return (tick + e.id * 37) % 170 < 7 ? F_BLINK : calm
  }
  return calm
}

function drawTruck(e: Entity, rc: RenderCtx): void {
  const v = e.vars
  const flip = e.facing < 0
  const s = v.phase >= 3 ? 3 : v.phase <= 1 ? 1 : 2
  const p = pitchIndex(v.pitch)
  const st = e.state
  // Straining (spinning tyres, roaring) is a pixel of rattle; shaking blobs loose like a wet dog
  // is two, since that shake is the whole tell.
  const shaking = st === 'blobTell' || st === 'spinTell' || (st === 'roar' && e.stateT < 60) || (st === 'wake' && e.stateT >= WAKE_ROAR)
  const rattle = shaking ? (((rc.tick >> 1) & 1) * 2 - 1) * (st === 'blobTell' ? 2 : 1) : 0
  const x = e.x + e.w / 2 + rattle
  const y = e.y + e.h
  const sink = Math.round(v.sink)
  const ax = axles[p]
  const dir = flip ? -1 : 1
  const spinning = st === 'spinTell' || st === 'spin' || st === 'rainTell'
  const tyre = spinning ? BLUR[s][(rc.tick >> 1) & 1] : TYRE[s][((Math.floor(v.spin / tyreTurn) % 4) + 4) % 4]
  const o = flip ? FLIP : PLAIN
  rc.draw(CHASSIS[s][p], x, y + sink, o)
  rc.draw(tyre, x + dir * ax.rear[0], y + ax.rear[1], o)
  rc.draw(tyre, x + dir * ax.front[0], y + ax.front[1], o)
  rc.draw(BODY[s][p], x, y + sink, o)
  rc.draw(FACE[s][faceOf(e, rc.tick)][p], x, y + sink, o)
}

/** Cosmetic puffs and drips of the truck, once a tick (the renderer's tick hook). */
function truckFx(e: Entity, rc: RenderCtx): void {
  const v = e.vars
  const s = v.phase >= 3 ? 3 : v.phase <= 1 ? 1 : 2
  const st = e.state
  const sink = Math.round(v.sink)
  const dir = e.facing < 0 ? -1 : 1
  const front = dir < 0 ? e.x : e.x + e.w
  if (st === 'winded' && rc.tick % 14 === 0) rc.fx('steam', front - dir * 30, e.y + 50 + sink, 1)
  if (st === 'sleep' && rc.tick % 50 === 0) rc.fx('smoke', e.x + e.w / 2 - dir * 33, e.y - 4 + sink, 1, -dir)
  // Flinging the rain: mud goes up off the bed with each volley.
  if (st === 'rain') {
    const ix = s - 1
    const k = e.stateT % VOLLEY_GAP[ix]
    if (k < 12 && e.stateT < VOLLEYS[ix] * VOLLEY_GAP[ix] && rc.tick % 2 === 0) rc.fx('mud', e.x + e.w / 2 - dir * 50, e.y + 20, 2, -dir)
  }
  // Mud falls off it while it is washed, and drips off a wet body.
  if (v.hitT < 4 && rc.tick % 5 === 0) rc.fx(s === 1 ? 'mud' : 'drip', e.x + 30 + ((rc.tick * 37) % (e.w - 60)), e.y + e.h - 58 + sink, 1)
  if (s === 1 && st === 'idle' && rc.tick % 40 === 0) rc.fx('mud', e.x + 20 + ((rc.tick * 53) % (e.w - 40)), e.y + e.h - 56, 1)
}

const PLAIN = { flipX: false }
const FLIP = { flipX: true }

/** The finish: dazed and foamy, shrinking in pops, sheepish, then delighted. */
function drawWashed(e: Entity, rc: RenderCtx): void {
  const v = e.vars
  const t = e.stateT
  const o = e.facing < 0 ? FLIP : PLAIN
  const x = e.x + e.w / 2
  const y = e.y + e.h
  let name: string
  if (v.size <= 0) name = DAZED[(rc.tick >> 3) & 1]
  else if (v.size <= 3) name = SHRINK[v.size - 1]
  else if (t < HAPPY_AT) name = SHEEP
  else {
    // A hop of joy with each honk.
    const k = t - HAPPY_AT
    name = HAPPY[(k < 14 || (k >= 36 && k < 50)) ? 1 : 0]
  }
  // Each shrink is a pop: a squash for a few ticks.
  const pop = v.size > 0 && t < SHEEP_AT && (t - SHRINK_AT) % SHRINK_STEP < 3 ? 2 : 0
  const hop = t >= HAPPY_AT && ((t - HAPPY_AT) % 36 < 10) && t < HAPPY_AT + 60 ? -4 : 0
  rc.draw(name, x, y + pop + hop, o)
}

/** Sparkles and drips of the washed truck, once a tick (the renderer's tick hook). */
function washedFx(e: Entity, rc: RenderCtx): void {
  const t = e.stateT
  if (t >= SHEEP_AT && rc.tick % 18 === 0) rc.fx('sparkle', e.x + ((rc.tick * 29) % Math.max(1, e.w)), e.y + ((rc.tick * 13) % Math.max(1, e.h - 20)), 1)
  if (t < SHRINK_AT && rc.tick % 6 === 0) rc.fx('drip', e.x + 20 + ((rc.tick * 41) % (e.w - 40)), e.y + e.h - 58, 1)
}

registerRenderer(
  'mudzilla',
  (_g, e, rc) => {
    if (!metaRead) readMeta(rc)
    if (e.state === 'washed') drawWashed(e, rc)
    else drawTruck(e, rc)
  },
  { tick: (e, rc) => (e.state === 'washed' ? washedFx(e, rc) : truckFx(e, rc)) },
)

/* ------------------------------------------------------------------ */
/* What it throws                                                      */
/* ------------------------------------------------------------------ */

const SHADOW = '#1e0d06'
const RIM = '#f97316'
const RIM_HOT = '#ffe866'
const CATWALK = 61

/**
 * A shadow lying on a surface at y: a flat pixel ellipse `w` wide with a warm rim, so it reads as
 * danger on any floor. k 0..1 is how close the landing is; near the end the rim flashes.
 */
function shadow(g: CanvasRenderingContext2D, rc: RenderCtx, cx: number, y: number, w: number, k: number): void {
  const x = rc.sx(cx)
  const sy = rc.sy(y)
  const half = Math.max(4, Math.round(w / 2))
  const cap = Math.min(5, half - 2)
  // The rim warms up as the landing nears: orange, then flashing yellow, then yellow.
  g.fillStyle = k > 0.92 || (k > 0.7 && (rc.tick >> 2) % 2 === 0) ? RIM_HOT : RIM
  g.fillRect(x - half + cap, sy - 5, half * 2 - cap * 2, 1)
  g.fillRect(x - half + 2, sy - 4, half * 2 - 4, 1)
  g.fillRect(x - half, sy - 3, half * 2, 5)
  g.fillRect(x - half + 2, sy + 2, half * 2 - 4, 1)
  g.fillRect(x - half + cap, sy + 3, half * 2 - cap * 2, 1)
  g.fillStyle = SHADOW
  g.fillRect(x - half + cap + 1, sy - 4, half * 2 - cap * 2 - 2, 1)
  g.fillRect(x - half + 2, sy - 3, half * 2 - 4, 5)
  g.fillRect(x - half + cap + 1, sy + 2, half * 2 - cap * 2 - 2, 1)
}

registerRenderer('mz_mark', (g, e, rc) => {
  const v = e.vars
  const k = Math.max(0, Math.min(1, e.stateT / Math.max(1, v.life)))
  const cx = e.x + e.w / 2
  const w = v.w * (0.45 + 0.55 * k)
  shadow(g, rc, cx, v.floor, w, k)
  // A clod falls through catwalks: its shadow shows on each one in the way too.
  if (v.kind === 0) {
    const gr = rc.world.grid
    const tx = Math.floor(cx / 32)
    const top = Math.max(0, Math.floor(v.top / 32))
    for (let ty = Math.floor(v.floor / 32) - 1; ty >= top; ty--) {
      if (tx >= 0 && tx < gr.w && gr.t[ty * gr.w + tx] === CATWALK) shadow(g, rc, cx, ty * 32, w, k)
    }
  }
})

registerRenderer('mz_clod', (_g, e, rc) => {
  rc.draw(CLOD[(rc.tick >> 2) & 1], e.x + e.w / 2, e.y + e.h + 2)
})

registerRenderer('mz_glob', (_g, e, rc) => {
  rc.draw(GLOB[(rc.tick >> 2) & 1], e.x + e.w / 2, e.y + e.h + 1)
})

registerRenderer('mz_wave', (_g, e, rc) => {
  rc.draw(WAVE[((rc.tick >> 2) % 3 + 3) % 3], e.x + e.w / 2, e.y + e.h, e.facing < 0 ? FLIP : PLAIN)
})

registerRenderer('mz_fan', (g, e, rc) => {
  const x = rc.sx(e.x)
  const y = rc.sy(e.y + e.h)
  const w = Math.round(e.w)
  g.save()
  g.beginPath()
  g.rect(x, y - 40, w, 44)
  g.clip()
  const flip = e.facing < 0
  if (e.state === 'warn') {
    // Chevrons creeping along the stretch it is about to spray, pointing the way the mud will fly,
    // blinking faster as the spray comes.
    const left = e.vars.warn - e.stateT
    const f = FLECKS[(rc.tick >> (left < 18 ? 1 : 3)) & 1]
    const creep = (rc.tick >> 1) % 32
    for (let i = -32; i < w + 32; i += 32) {
      if (flip) rc.draw(f, e.x + e.w - i - creep, e.y + e.h, FLIP)
      else rc.draw(f, e.x + i + creep, e.y + e.h)
    }
  } else {
    // Scrolls away from the truck: the spray flies forward. Neighbouring stretches show different
    // frames, so the repeat does not read as a fence.
    const base = (rc.tick >> 1) % 3
    const shift = (rc.tick * 6) % 32
    for (let i = -32, j = 0; i < w + 32; i += 32, j++) {
      const f = SPRAY[(base + j) % 3]
      if (flip) rc.draw(f, e.x + e.w - i - shift, e.y + e.h, FLIP)
      else rc.draw(f, e.x + i + shift, e.y + e.h)
    }
    // Taller where it leaves the tyre: a plume over the first stretch.
    const g2 = SPRAY[((rc.tick >> 1) + 1) % 3]
    for (let i = 0; i < 64; i += 32) {
      const lift = i === 0 ? 14 : 7
      if (flip) rc.draw(g2, e.x + e.w - i, e.y + e.h - lift, FLIP)
      else rc.draw(g2, e.x + i, e.y + e.h - lift)
    }
  }
  g.restore()
})

registerRenderer('mz_shutter', (g, e, rc) => {
  // It slides down out of the wall over the first 10 ticks.
  const k = Math.min(1, e.stateT / 10)
  const x = rc.sx(e.x)
  const y = rc.sy(e.y)
  g.save()
  g.beginPath()
  g.rect(x, y, e.w, e.h)
  g.clip()
  rc.draw(SHUTTER, e.x, e.y - Math.round((1 - k) * e.h))
  g.restore()
})
