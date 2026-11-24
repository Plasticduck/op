// The world map's geography, read once from the 'map' atlas (scripts/maxx/art-map.mjs writes
// it into atlas.meta): where the sites stand, the roads between them as point lists, the props
// and how fast each animation runs. Everything here is fixed for the life of the page.
import type { Sprites } from '../../contract'

/** What art-map.mjs ships in atlas.meta. */
interface MapMeta {
  map: { w: number; h: number }
  order: string[]
  nodes: Record<string, [number, number]>
  roads: { id: string; a: string; b: string; secret: boolean; box: [number, number, number, number]; pts: number[] }[]
  sites: Record<string, { at: [number, number]; node: [number, number]; label: [number, number]; look: Look }>
  /** [anim, x, y, phase, flip] */
  props: [string, number, number, number, number][]
  timing: Record<string, number[]>
  cars: string[]
  river: number[]
  track: number[]
  crossings: [number, number][]
  zones: { k: number; dusk: number; night: number; storm: [number, number, number, number] }
  shadows: Record<string, number[]>
  snow: [number, number, number, number]
  /** Where Rival Row's four stand, from the site's anchor (feet). */
  rivalSpots?: [number, number][]
}

/** The four lights a sprite can be seen in. */
export type Look = 'day' | 'dusk' | 'night' | 'storm'
export const LOOKS: readonly Look[] = ['day', 'dusk', 'night', 'storm']
const SUFFIX: Record<Look, string> = { day: '', dusk: '_dusk', night: '_night', storm: '_storm' }

export interface MapRoad {
  id: string
  /** From and to, in the order the road was drawn (a is nearer HQ). */
  a: string
  b: string
  secret: boolean
  /** Where its frame goes on the map: x, y, w, h. */
  box: readonly [number, number, number, number]
  frame: string
  xs: Float32Array
  ys: Float32Array
  /** Distance along the road at each point. */
  cum: Float32Array
  len: number
}

export interface RoadEnd {
  road: MapRoad
  /** True when leaving this node walks the road from a to b. */
  forward: boolean
  /** Unit vector of the road's first stretch out of this node. */
  dx: number
  dy: number
  /** Unit vector to the point 40 px along: where the road is heading once it is under way. */
  fx: number
  fy: number
  /** Unit vector straight at the node at the far end. */
  tx: number
  ty: number
  to: string
}

export interface MapNode {
  id: string
  x: number
  y: number
  ends: RoadEnd[]
}

export interface Prop {
  /** Frame names, one per step of the animation. */
  frames: readonly string[]
  /** Ticks for each step; total is their sum. */
  ticks: readonly number[]
  total: number
  x: number
  y: number
  phase: number
  flip: boolean
  /** A railroad crossing signal: its lamps follow the train. */
  crossing: boolean
}

export interface Anim {
  frames: readonly string[]
  ticks: readonly number[]
  total: number
}

export interface MapLayout {
  w: number
  h: number
  order: readonly string[]
  nodes: Record<string, MapNode>
  roads: readonly MapRoad[]
  sites: MapMeta['sites']
  props: readonly Prop[]
  river: readonly number[]
  track: readonly number[]
  crossings: readonly (readonly [number, number])[]
  shadows: Record<string, readonly number[]>
  snow: readonly [number, number, number, number]
  cars: readonly string[]
  zones: MapMeta['zones']
  rivalSpots: readonly (readonly [number, number])[]
  anim(name: string): Anim
  /** The light at a map point, the way the art was lit. */
  lookAt(x: number, y: number): Look
  /** An animation's name in a given light. */
  lit(name: string, look: Look): string
  /** Frame of an animation at a tick. */
  frameAt(a: Anim, t: number): string
}

const EMPTY: Anim = { frames: [], ticks: [], total: 1 }

function animOf(sprites: Sprites, meta: MapMeta, name: string): Anim {
  const frames = sprites.anim('map', name)
  if (!frames.length) return EMPTY
  const ticks = meta.timing[name] ?? frames.map(() => 30)
  let total = 0
  for (const t of ticks) total += t
  return { frames, ticks, total: Math.max(1, total) }
}

/** Reads the layout from the atlas. Null when the map atlas is not there (the scene then draws a plain card). */
export function readLayout(sprites: Sprites): MapLayout | null {
  const def = sprites.atlas('map')
  const meta = def?.meta as unknown as MapMeta | undefined
  if (!meta || !meta.roads || !meta.nodes) return null

  const roads: MapRoad[] = meta.roads.map((r) => {
    const n = r.pts.length >> 1
    const xs = new Float32Array(n)
    const ys = new Float32Array(n)
    const cum = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      xs[i] = r.pts[i * 2]
      ys[i] = r.pts[i * 2 + 1]
      if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1])
    }
    return { id: r.id, a: r.a, b: r.b, secret: r.secret, box: r.box, frame: `map/road_${r.id}`, xs, ys, cum, len: cum[n - 1] }
  })

  const nodes: Record<string, MapNode> = {}
  for (const [id, [x, y]] of Object.entries(meta.nodes)) nodes[id] = { id, x, y, ends: [] }
  const unit = (dx: number, dy: number): [number, number] => {
    const l = Math.hypot(dx, dy) || 1
    return [dx / l, dy / l]
  }
  for (const road of roads) {
    for (const forward of [true, false]) {
      const from = nodes[forward ? road.a : road.b]
      const to = nodes[forward ? road.b : road.a]
      if (!from || !to) continue
      // The first 18 px of the road out of this node: which way it sets off.
      const at = pointAt(road, forward ? Math.min(18, road.len) : Math.max(0, road.len - 18))
      const [dx, dy] = unit(at[0] - from.x, at[1] - from.y)
      const on = pointAt(road, forward ? Math.min(40, road.len) : Math.max(0, road.len - 40))
      const [fx, fy] = unit(on[0] - from.x, on[1] - from.y)
      const [tx, ty] = unit(to.x - from.x, to.y - from.y)
      from.ends.push({ road, forward, dx, dy, fx, fy, tx, ty, to: to.id })
    }
  }

  const anims = new Map<string, Anim>()
  const anim = (name: string): Anim => {
    let a = anims.get(name)
    if (!a) {
      a = animOf(sprites, meta, name)
      anims.set(name, a)
    }
    return a
  }

  const props: Prop[] = meta.props.map(([name, x, y, phase, flip]) => {
    const a = anim(name)
    return { frames: a.frames, ticks: a.ticks, total: a.total, x, y, phase, flip: !!flip, crossing: name.startsWith('xing') }
  })

  const z = meta.zones
  const lookAt = (x: number, y: number): Look => {
    const sx = (x - z.storm[0]) / z.storm[2]
    const sy = (y - z.storm[1]) / z.storm[3]
    if (sx * sx + sy * sy < 1) return 'storm'
    const s = x + z.k * y
    return s < z.dusk ? 'day' : s < z.night ? 'dusk' : 'night'
  }

  return {
    w: meta.map.w,
    h: meta.map.h,
    order: meta.order,
    nodes,
    roads,
    sites: meta.sites,
    props,
    river: meta.river,
    track: meta.track,
    crossings: meta.crossings,
    shadows: meta.shadows,
    snow: meta.snow,
    cars: meta.cars,
    zones: z,
    rivalSpots: meta.rivalSpots ?? [[-30, -3], [-19, -5], [22, -4], [34, -2]],
    anim,
    lookAt,
    lit: (name, look) => name + SUFFIX[look],
    frameAt(a, t) {
      if (a.frames.length <= 1) return a.frames[0] ?? ''
      let k = ((t % a.total) + a.total) % a.total
      for (let i = 0; i < a.ticks.length; i++) {
        k -= a.ticks[i]
        if (k < 0) return a.frames[i]
      }
      return a.frames[a.frames.length - 1]
    },
  }
}

const OUT: [number, number] = [0, 0]

/** The point `d` px along a road from its a end (clamped). Returns a shared pair: copy it if you keep it. */
export function pointAt(road: MapRoad, d: number, out: [number, number] = OUT): [number, number] {
  const { xs, ys, cum } = road
  const n = cum.length
  if (d <= 0) {
    out[0] = xs[0]
    out[1] = ys[0]
    return out
  }
  if (d >= road.len) {
    out[0] = xs[n - 1]
    out[1] = ys[n - 1]
    return out
  }
  // Points are about 2 px apart, so the guess is close.
  let i = Math.min(n - 2, Math.max(0, Math.floor(d / 2)))
  while (i > 0 && cum[i] > d) i--
  while (i < n - 2 && cum[i + 1] < d) i++
  const seg = cum[i + 1] - cum[i] || 1
  const k = (d - cum[i]) / seg
  out[0] = xs[i] + (xs[i + 1] - xs[i]) * k
  out[1] = ys[i] + (ys[i + 1] - ys[i]) * k
  return out
}

/** The railroad's height at x (it runs right across the map). */
export function trackYAt(track: readonly number[], x: number): number {
  const n = track.length >> 1
  if (n < 2) return 0
  if (x <= track[0]) return track[1]
  for (let i = 1; i < n; i++) {
    const x1 = track[i * 2]
    if (x1 >= x) {
      const x0 = track[i * 2 - 2]
      const k = (x - x0) / (x1 - x0 || 1)
      return track[i * 2 - 1] + (track[i * 2 + 1] - track[i * 2 - 1]) * k
    }
  }
  return track[n * 2 - 1]
}
