// Everything on the map that lives on its own: washed cars on the open highway, the freight
// train and the crossing lamps, clouds and their shadows, the storm over MW04, snow round MW07,
// the river's glints, buzzards, a dust devil, a tumbleweed, an armadillo, a roadrunner.
//
// Cosmetic only, and repeatable: one seeded generator, reset when the scene starts, and every
// timer counts the scene's ticks. Nothing here allocates per frame: the movers are made once
// (or when the open road changes) and the sprite names are looked up ahead.
import type { Sprites } from '../../contract'
import { pointAt, trackYAt } from './layout'
import type { Anim, Look, MapLayout, MapRoad } from './layout'

type G = CanvasRenderingContext2D

/** One sprite to draw in y order with the props and the sites. */
export interface Dyn {
  name: string
  x: number
  /** Sorted by this. */
  y: number
  flip: boolean
  /** Drawn this far below (or above) y. */
  dy: number
}

/** A fixed pool of Dyn entries, filled every frame. */
export class DynList {
  readonly items: Dyn[] = []
  n = 0
  constructor(cap: number) {
    for (let i = 0; i < cap; i++) this.items.push({ name: '', x: 0, y: 0, flip: false, dy: 0 })
  }
  push(name: string, x: number, y: number, flip: boolean, dy = 0): void {
    if (this.n >= this.items.length || !name) return
    const d = this.items[this.n++]
    d.name = name
    d.x = x
    d.y = y
    d.flip = flip
    d.dy = dy
  }
  /** Insertion sort by y: the list is short and nearly sorted from frame to frame. */
  sort(): void {
    const a = this.items
    for (let i = 1; i < this.n; i++) {
      const d = a[i]
      let j = i - 1
      while (j >= 0 && a[j].y > d.y) {
        a[j + 1] = a[j]
        j--
      }
      a[j + 1] = d
    }
  }
}

/** Small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type ByLook = Record<Look, Anim>

interface Car {
  u: number
  v: number
  wait: number
  anims: ByLook
  x: number
  y: number
  flip: boolean
  shown: boolean
}

const TRAIN_KINDS = ['loco', 'hopper', 'tanker', 'boxcar', 'hopper', 'hopper', 'tanker', 'boxcar']
const CAR_GAP = 25
const TRAIN_SPEED = 0.8
const RAIN = 40
const SNOW = 56
const GLINTS = 14

export interface Ambient {
  /** The open main highway, HQ first. Cars drive it; call again when a road opens. */
  setHighway(roads: readonly MapRoad[]): void
  update(t: number): void
  /** Push the movers that stand on the ground into the y-sorted list. */
  collect(list: DynList, t: number): void
  /** Glints on the river (under the bridges, so before the roads). */
  drawWater(g: G, t: number): void
  /** Cloud shadows, on the bare ground. */
  drawShadows(g: G): void
  /** Rain, snow, the storm cell, clouds, birds: over everything on the ground. */
  drawSky(g: G, t: number): void
  /** The lamps of crossing signals: 0 dark, 1 or 2 while a train is near. */
  crossingFrame(x: number, t: number): number
  /** Lightning just struck (for a thunderclap). */
  readonly struck: boolean
  /** For scripts: where the train is, or null. */
  trainAt(): number | null
  /** The game has been finished: fireworks over the Mega Tunnel. */
  setFinished(on: boolean): void
  /** Lightning over MW04 in about this many ticks (Maxx has just arrived under it). */
  strikeIn(ticks: number): void
}

export function createAmbient(sprites: Sprites, layout: MapLayout, seed = 7): Ambient {
  const rand = rng(seed)
  const byLook = (name: string): ByLook => ({
    day: layout.anim(layout.lit(name, 'day')),
    dusk: layout.anim(layout.lit(name, 'dusk')),
    night: layout.anim(layout.lit(name, 'night')),
    storm: layout.anim(layout.lit(name, 'storm')),
  })
  const W = layout.w
  const H = layout.h
  const shade = sprites.source('map/shade')

  /* Cars on the highway */
  let chain: MapRoad[] = []
  let chainLen = 0
  const cars: Car[] = []
  const carLooks = layout.cars.map((c) => byLook(`car_${c}`))
  const pt: [number, number] = [0, 0]
  const pt2: [number, number] = [0, 0]

  function chainPoint(u: number, out: [number, number]): [number, number] {
    let d = u
    for (const r of chain) {
      if (d <= r.len) return pointAt(r, d, out)
      d -= r.len
    }
    const last = chain[chain.length - 1]
    return pointAt(last, last.len, out)
  }

  /* The train */
  const trainLooks = TRAIN_KINDS.map((k) => byLook(k))
  let trainOn = false
  let trainHead = 0
  let trainDir = 1
  let trainCars = 5
  let nextTrain = 200

  /* Clouds */
  const clouds = [
    { kind: 'cloud', x: 60, y: 70, v: 0.12 },
    { kind: 'cloudS', x: 250, y: 150, v: 0.16 },
    { kind: 'cloud', x: 380, y: 236, v: 0.1 },
  ]
  const cloudFrame = { cloud: layout.anim('cloud').frames[0] ?? '', cloudS: layout.anim('cloudS').frames[0] ?? '' } as Record<string, string>
  const CLOUD_MIN = -70
  const CLOUD_MAX = 520

  /* Storm cell */
  const stormAnim = layout.anim('storm')
  const boltAnim = layout.anim('bolt')
  const stormSite = layout.sites.mw04?.at ?? [222, 138]
  const sx = stormSite[0]
  const sy = stormSite[1] - 34
  let strikeT = -100
  let nextStrike = 150
  let lastT = 0
  let boltX = sx
  let boltFrame = 0
  let struck = false
  const rainX = new Float32Array(RAIN)
  const rainP = new Float32Array(RAIN)
  for (let i = 0; i < RAIN; i++) {
    rainX[i] = sx - 34 + Math.floor(rand() * 68)
    rainP[i] = Math.floor(rand() * 56)
  }

  /* Snow */
  const [scx, scy, srx, sry] = layout.snow
  const snowX = new Float32Array(SNOW)
  const snowP = new Float32Array(SNOW)
  const snowV = new Float32Array(SNOW)
  for (let i = 0; i < SNOW; i++) {
    snowX[i] = scx - srx + rand() * srx * 2
    snowP[i] = rand() * 200
    snowV[i] = 0.22 + rand() * 0.22
  }

  /* River glints */
  const riverN = layout.river.length >> 1
  const glintP = new Float32Array(GLINTS)
  for (let i = 0; i < GLINTS; i++) glintP[i] = rand() * riverN

  /* Critters on their rounds */
  const devil = layout.anim('devil')
  const weed = layout.anim('weed')
  const dillo = layout.anim('dillo')
  const runner = layout.anim('roadrunner')
  const buzz = layout.anim('buzzard')

  // A newly opened road gets new cars; the ones already driving stay where they are.
  function placeCars(): void {
    if (!chain.length) {
      cars.length = 0
      return
    }
    for (const c of cars) c.u = Math.min(c.u, chainLen)
    const n = Math.min(6, Math.max(1, chain.length))
    const had = cars.length
    for (let i = had; i < n; i++) {
      cars.push({
        u: had ? chainLen - ((n - i) / (n - had + 1)) * Math.min(chainLen, 240) : ((i + 0.5) / n) * chainLen,
        v: (i % 2 ? -1 : 1) * (0.42 + rand() * 0.22),
        wait: 0,
        anims: carLooks[(i * 3 + 1) % carLooks.length],
        x: 0,
        y: 0,
        flip: false,
        shown: true,
      })
    }
  }

  // The train's extent, west and east ends.
  let spanA = 0
  let spanB = 0
  function trainSpan(): void {
    const tail = trainHead - trainDir * (trainCars - 1) * CAR_GAP
    spanA = Math.min(tail, trainHead) - 14
    spanB = Math.max(tail, trainHead) + 14
  }

  function trainNear(x: number, r: number): boolean {
    if (!trainOn) return false
    trainSpan()
    return x > spanA - r && x < spanB + r
  }

  /* Fireworks over the Mega Tunnel, once the game has been finished. */
  let finished = false
  const megaAt = layout.sites.mw08?.at ?? [540, 234]
  const BURSTS = 3
  const burstX = new Float32Array(BURSTS)
  const burstY = new Float32Array(BURSTS)
  const burstT = new Float32Array(BURSTS).fill(99)
  const FIRE = ['#f51924', '#5cc8ff', '#ffe866', '#f7f4f8', '#e85aa0']

  const api: Ambient = {
    get struck() {
      return struck
    },
    setHighway(roads) {
      chain = roads.slice()
      chainLen = 0
      for (const r of chain) chainLen += r.len
      placeCars()
    },
    update(t) {
      lastT = t
      // cars: drive, wait inside the wash at either end, and stop for a passing train
      for (const c of cars) {
        if (c.wait > 0) {
          c.wait--
          c.shown = false
          continue
        }
        c.shown = true
        let v = c.v
        chainPoint(c.u, pt)
        for (let k = 0; k < layout.crossings.length; k++) {
          const cx = layout.crossings[k][0]
          const cy = layout.crossings[k][1]
          const d = Math.hypot(pt[0] - cx, pt[1] - cy)
          if (d < 16 && d > 7 && trainNear(cx, 40)) {
            chainPoint(c.u + v * 4, pt2)
            if (Math.hypot(pt2[0] - cx, pt2[1] - cy) < d) v = 0
          }
        }
        c.u += v
        if (c.u <= 0 || c.u >= chainLen) {
          c.u = Math.max(0, Math.min(chainLen, c.u))
          c.v = -c.v
          c.wait = 90 + Math.floor(rand() * 200)
        }
        chainPoint(c.u, pt)
        chainPoint(c.u + (c.v > 0 ? 2 : -2), pt2)
        const dx = pt2[0] - pt[0]
        const dy = pt2[1] - pt[1]
        const l = Math.hypot(dx, dy) || 1
        // Keep to the right-hand lane.
        c.x = pt[0] - (dy / l) * 2.5
        c.y = pt[1] + (dx / l) * 2.5 + 3
        if (Math.abs(dx) > 0.3) c.flip = dx < 0
      }

      // train
      if (!trainOn && t >= nextTrain) {
        trainOn = true
        trainDir = rand() < 0.5 ? 1 : -1
        trainCars = 4 + Math.floor(rand() * 4)
        trainHead = trainDir > 0 ? -20 : W + 20
      }
      if (trainOn) {
        trainHead += trainDir * TRAIN_SPEED
        trainSpan()
        if (spanA > W + 20 || spanB < -20) {
          trainOn = false
          nextTrain = t + 1300 + Math.floor(rand() * 900)
        }
      }

      for (const c of clouds) {
        c.x += c.v
        if (c.x > CLOUD_MAX) c.x = CLOUD_MIN
      }

      if (finished) {
        for (let i = 0; i < BURSTS; i++) {
          burstT[i]++
          if (burstT[i] > 64 + i * 19) {
            burstT[i] = 0
            burstX[i] = megaAt[0] - 40 + Math.floor(rand() * 80)
            burstY[i] = megaAt[1] - 70 - Math.floor(rand() * 30)
          }
        }
      }

      struck = false
      if (t >= nextStrike) {
        strikeT = t
        struck = true
        boltX = sx - 24 + Math.floor(rand() * 48)
        boltFrame = rand() < 0.5 ? 0 : 1
        nextStrike = t + 180 + Math.floor(rand() * 260)
      }
    },
    collect(list, t) {
      for (const c of cars) {
        if (!c.shown) continue
        list.push(layout.frameAt(c.anims[layout.lookAt(c.x, c.y)], t), c.x, c.y, c.flip)
      }
      if (trainOn) {
        for (let i = 0; i < trainCars; i++) {
          const x = trainHead - trainDir * i * CAR_GAP
          if (x < -20 || x > W + 20) continue
          const y = trackYAt(layout.track, x) + 3
          const anims = trainLooks[i % trainLooks.length]
          list.push(layout.frameAt(anims[layout.lookAt(x, y)], t), x, y, trainDir < 0)
        }
      }
      // A dust devil wanders the plains for a while, then dies away.
      const dt = t % 1700
      if (dt < 640) {
        const k = dt / 640
        list.push(layout.frameAt(devil, t), 158 + k * 190, 126 - k * 50 + Math.sin(dt / 30) * 6, false)
      }
      // A tumbleweed bowls across the sandhills.
      const wt = (t + 500) % 1100
      if (wt < 260) {
        const x = 252 + wt * 0.55
        list.push(layout.frameAt(weed, t), x, 306 - Math.abs(Math.sin(wt / 9)) * 5, false)
      }
      // An armadillo takes its time over the road between MW01 and MW02.
      const at = (t + 900) % 2600
      if (at < 760) list.push(layout.frameAt(dillo, at), 196 + at * 0.03, 316 - at * 0.075, true)
      // A roadrunner, flat out.
      const rt = (t + 200) % 1300
      if (rt < 110) list.push(layout.frameAt(runner, t), 392 - rt * 1.2, 316 - rt * 0.08, false)
    },
    drawWater(g, t) {
      if (riverN < 2) return
      g.fillStyle = '#b9ecff'
      for (let i = 0; i < GLINTS; i++) {
        const p = (glintP[i] + t * 0.12) % riverN
        const k = Math.floor(p)
        const life = (t + i * 37) % 90
        if (life > 50) continue
        const x = layout.river[k * 2] + ((i * 5) % 5) - 2
        const y = layout.river[k * 2 + 1]
        g.fillRect(Math.round(x), Math.round(y), life < 10 || life > 40 ? 1 : 2, 1)
      }
    },
    drawShadows(g) {
      if (!shade) return
      const { image, frame } = shade
      for (const c of clouds) {
        const spans = layout.shadows[c.kind]
        if (!spans) continue
        const ox = Math.round(c.x) + 20
        const oy = Math.round(c.y) + 34
        for (let i = 0; i < spans.length; i += 3) {
          const y = oy + spans[i]
          if (y < 0 || y >= H) continue
          let x = ox + spans[i + 1]
          let len = spans[i + 2]
          if (x < 0) {
            len += x
            x = 0
          }
          if (x + len > W) len = W - x
          if (len <= 0) continue
          g.drawImage(image, frame.x + x, frame.y + y, len, 1, x, y, len, 1)
        }
      }
    },
    drawSky(g, t) {
      // rain under the storm cell
      g.fillStyle = '#a8d8f0'
      for (let i = 0; i < RAIN; i++) {
        const y = sy - 4 + ((t * 3 + rainP[i]) % 56)
        g.fillRect(rainX[i] - Math.floor((y - sy) / 12), y, 1, 3)
      }
      const flash = t - strikeT
      if (flash >= 0 && flash < 9) sprites.draw(g, boltAnim.frames[boltFrame] ?? '', boltX, sy + 42)
      const lit = flash >= 0 && (flash < 3 || (flash > 5 && flash < 8))
      const sf = stormAnim.frames
      if (sf.length >= 3) sprites.draw(g, lit ? sf[2] : sf[Math.floor(t / 40) % 2], sx, sy + Math.round(Math.sin(t / 50)))

      // snow round MW07
      g.fillStyle = '#f7f4f8'
      for (let i = 0; i < SNOW; i++) {
        const y = ((t * snowV[i] + snowP[i]) % (sry * 1.4)) - 4
        const x = snowX[i] + Math.sin((t + snowP[i] * 7) / 45) * 3
        const ex = (x - scx) / srx
        const ey = (y - scy) / sry
        if (ex * ex + ey * ey > 1 || x >= W) continue
        const s = i % 5 === 0 ? 2 : 1
        g.fillRect(Math.round(x), Math.round(y), s, s)
      }

      for (const c of clouds) sprites.draw(g, cloudFrame[c.kind], c.x, c.y)

      if (finished) {
        for (let i = 0; i < BURSTS; i++) {
          const k = burstT[i]
          if (k < 12) {
            // the shell going up
            g.fillStyle = FIRE[2]
            g.fillRect(Math.round(burstX[i]), Math.round(burstY[i] + (12 - k) * 3), 1, 2)
            continue
          }
          const age = k - 12
          if (age > 40) continue
          if (age < 3) {
            g.fillStyle = FIRE[3]
            g.fillRect(Math.round(burstX[i]) - 2, Math.round(burstY[i]) - 2, 5, 5)
            continue
          }
          // Two rings, the outer in the shell's colour, fading to white sparks as they fall.
          const r = Math.min(age, 16) * 1.5
          const drop = age * age * 0.008
          for (let ring = 0; ring < 2; ring++) {
            g.fillStyle = age > 30 ? FIRE[3] : FIRE[(i + ring * 2) % FIRE.length]
            const rr = ring ? r * 0.55 : r
            const size = age > 32 ? 1 : 2
            for (let s = 0; s < 14; s++) {
              const a = (s / 14) * Math.PI * 2 + i + ring * 0.2
              if (age > 30 && (s + age) % 3 === 0) continue
              g.fillRect(Math.round(burstX[i] + Math.cos(a) * rr), Math.round(burstY[i] + Math.sin(a) * rr * 0.85 + drop), size, size)
            }
          }
        }
      }

      // buzzards circling over the badlands
      for (let i = 0; i < 3; i++) {
        const a = t / (90 + i * 13) + i * 2.1
        const r = 16 + i * 6
        sprites.draw(g, layout.frameAt(buzz, t + i * 11), 446 + Math.cos(a) * r, 222 + Math.sin(a) * r * 0.45 - i * 4)
      }
    },
    crossingFrame(x, t) {
      return trainNear(x, 70) ? 1 + (Math.floor(t / 14) % 2) : 0
    },
    trainAt() {
      return trainOn ? Math.round(trainHead) : null
    },
    setFinished(on) {
      finished = on
    },
    strikeIn(ticks) {
      nextStrike = Math.min(nextStrike, lastT + ticks)
    },
  }
  return api
}
