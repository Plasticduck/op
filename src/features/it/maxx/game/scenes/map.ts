// The world map: a West Texas road map between Mighty Wash HQ, the eight sites and, once found,
// Rival Row. Maxx walks the highway from site to site, and the map shows what the save says.
//
//   game.go('map')                               from the title or game over
//   game.go('map', { from: 'mw03', exit })      back from a level: exit 'goal' | 'secret' | 'quit'
//
// show   what the player has not seen yet comes in one piece at a time: each new road draws
//        itself in and the site at its end lights up (NOW OPEN); the hidden road comes last,
//        with the 'secret' jingle (A HIDDEN ROAD!). Back from Rival Row, rivals newly beaten
//        are unmasked one by one, and the crown drops onto its sign. Confirm finishes it all.
// idle   Maxx stands on a site. Stick or D-pad toward a neighbour walks there: the road whose
//        first stretch, or whose far end, is nearest the push wins, so a rough push is enough.
//        A fresh push waits one tick for the other half of a diagonal. Held, he walks on from
//        site to site, but never straight back the way he came. A road not paved yet stays
//        shut ('locked', CLEAR MW03 FIRST). Confirm plays the site (COMING SOON while its
//        level is not built); cancel goes back to the title. Back from a clear, neither counts
//        until the player has stopped pressing for half a second (ARRIVE_CALM).
// walk   along the road's own bends, then a hop on arrival. Confirm in the last moments of a
//        walk is kept and acted on when he gets there.
//
// The rules of what is open are in map/progress.ts, the geography in map/layout.ts (read from
// the 'map' atlas, made by scripts/maxx/art-map.mjs), the life around it in map/ambient.ts.
// What the map has shown is kept in save.data.map, so a flourish plays once, across reloads.
// For scripts the scene object has state() and forget() (the next visit is the map's first
// look at this save).
import { VIEW_H, VIEW_W } from '../contract'
import type { GameCtx, InputFrame, Scene, SceneParams } from '../contract'
import { drawText } from '../engine/text'
import { PAL } from '../engine/ui'
import { levelById } from '../levels'
import { LEVEL_META, RIVALS_META } from '../levels/meta'
import { DynList, createAmbient } from './map/ambient'
import type { Ambient } from './map/ambient'
import { drawBadge, drawBanner, drawBar, drawNote, scoreText } from './map/draw'
import type { Badge, BarInfo } from './map/draw'
import { pointAt, readLayout } from './map/layout'
import type { Anim, MapLayout, MapRoad, RoadEnd } from './map/layout'
import { HQ, RIVALS, RIVAL_COUNT, forgetSeen, has, lastNode, noteNode, noteShown, reach, recordOf, rivalsBeaten, siteState, takeNews, tokenTotals } from './map/progress'
import type { Reach, RoadNews } from './map/progress'
import { FOR_SOUND } from './title/kit'

export type MapPhase = 'show' | 'idle' | 'walk' | 'leave'

export interface MapState {
  phase: MapPhase
  /** Where Maxx stands, or the site he set out from. */
  node: string
  /** The road he is walking, '' when standing. */
  road: string
  /** Where he is heading ('' when standing): the site the status bar shows meanwhile. */
  target: string
  /** Where he is on the screen (his feet). */
  maxx: [number, number]
  /** Flourishes still to come, the one running included. */
  pending: number
  /** The road drawing in now ('' for none) and how far the running flourish is, 0..1. */
  drawing: string
  progress: number
  /** What the running flourish is: 'road', 'rival', 'crown' or ''. */
  showing: string
  note: string
  banner: string
  roads: string[]
  lit: string[]
  /** Rivals shown unmasked (beaten) on the lot, and whether the crown is on its sign. */
  beatenShown: number
  crown: boolean
  /** The bar's big line and its prompt line, as drawn, and its token pips (null: none shown). */
  bar: { sign: string; name: string; prompt: string; extra: string; tokens: boolean[] | null }
}

export type MapScene = Scene & { state(): MapState; forget(): void }

const SIGNS: Record<string, string> = { [HQ]: 'HQ', [RIVALS]: RIVALS_META.site }
const NAMES: Record<string, string> = { [HQ]: 'MIGHTY WASH HQ', [RIVALS]: RIVALS_META.name }
for (const m of LEVEL_META) {
  SIGNS[m.id] = m.site
  NAMES[m.id] = m.name
}
const MAIN_IDS = new Set(LEVEL_META.map((m) => m.id))
/** The sites that show their three gold tokens: the eight washes, and Rival Row, which has three too. */
const TOKEN_IDS = new Set([...MAIN_IDS, RIVALS])
const signOf = (id: string): string => (has(SIGNS, id) ? SIGNS[id] : id.toUpperCase())

const HOP_TICKS = 12
/** Once the hop is this far through, a held push walks on. */
const HOP_GO = 4
/** A fresh push is read on the next tick, so both halves of a diagonal count. */
const LATCH = 2
/** Confirm pressed this close to the end of a walk is kept for the arrival. */
const CONFIRM_EARLY = 14
const SHOW_WAIT = 34
const LIGHT_TICKS = 34
const NOTE_TICKS = 110
const RIVAL_TICKS = 46
const RIVAL_FLIP = 14
const CROWN_TICKS = 70
const CROWN_DROP = 26
const CROWN_FALL = 22
/** Thunder at most this often while Maxx stands under the storm: it is a long rumble. */
const THUNDER_GAP = 480
/**
 * Back from a clear, the player is often still pressing A to hurry the tally along, and Maxx
 * stands on the site he just left: confirm would put him straight back into it. So confirm and
 * cancel wait for this many uncovered ticks without either pressed, never longer than ARRIVE_MAX.
 */
const ARRIVE_CALM = 30
const ARRIVE_MAX = 120
/** The note that the browser is holding the sound back stays up a little longer than the rest. */
const SOUND_NOTE_TICKS = 200

type EvKind = 'road' | 'rival' | 'crown'
interface Ev {
  kind: EvKind
  news: RoadNews | null
  /** The rival being unmasked. */
  i: number
  t: number
  dur: number
  secret: boolean
}

interface Spark {
  x: number
  y: number
  t: number
}

const FLIP = { flipX: true }
const EMPTY_ANIM: Anim = { frames: [], ticks: [], total: 1 }

export function createMapScene(): MapScene {
  let layout: MapLayout | null = null
  let amb: Ambient | null = null
  let game: GameCtx | null = null
  let t = 0
  let phase: MapPhase = 'idle'
  let node = HQ
  let open: Reach = { sites: new Set([HQ]), roads: new Set() }

  // walking
  let road: MapRoad | null = null
  let forward = true
  let along = 0
  let speed = 2
  let target = ''
  let stepT = 0
  let stepTicks = 6
  let hop = 0
  let facing = 1
  const pos: [number, number] = [0, 0]
  const tmp: [number, number] = [0, 0]
  // pushing
  let latch = 0
  let pending = false
  // The directions gathered while a fresh push settles: bit 1 right / down, bit 2 left / up.
  let pushX = 0
  let pushY = 0
  /** The road he just came along, which a held push will not take him back down. */
  let cameBy: MapRoad | null = null
  let wantEnter = false
  let lastThunder = -THUNDER_GAP
  // Back from a clear: quiet ticks still wanted before confirm and cancel count, and ticks waited so far.
  let calm = 0
  let calmT = 0

  // what is on show
  const shown = new Set<string>()
  const lit = new Set<string>()
  // Per site: ticks since it lit up, and ticks left of a shake.
  const lightT: Record<string, number> = {}
  const shake: Record<string, number> = {}
  let siteIds: string[] = []
  const events: Ev[] = []
  let ev: Ev | null = null
  let showWait = 0
  let beatenShown = 0
  let crownShown = false
  let note = ''
  let noteT = 0
  let banner = ''
  let bannerT = 0
  const sparks: Spark[] = []
  for (let i = 0; i < 32; i++) sparks.push({ x: 0, y: 0, t: 99 })
  let sparkNext = 0

  const dyn = new DynList(48)
  const statics: { y: number; i: number; site: string }[] = []
  let flagFrames: readonly string[] = []
  let starFrames: readonly string[] = []
  let sparkFrames: readonly string[] = []
  let walkFrames: readonly string[] = []
  let idleAnim: Anim = EMPTY_ANIM
  let rivalUp: Anim[] = []
  let rivalDown: string[] = []
  // Per site, looked up once: its lit animation, its dark frame, how tall its building is.
  const siteAnims: Record<string, Anim> = {}
  const siteOff: Record<string, string> = {}
  const siteTall: Record<string, number> = {}
  const badges: Record<string, Badge> = {}
  const bar: BarInfo = { sign: '', name: '', line: '', tokens: null, spotless: false, extra: '', lives: '', score: '', gold: '', prompt: '' }
  let barKey = ''

  const save = () => game!.save

  function spark(x: number, y: number): void {
    const s = sparks[sparkNext]
    sparkNext = (sparkNext + 1) % sparks.length
    s.x = x
    s.y = y
    s.t = 0
  }

  function ring(x: number, y: number, rx: number, ry: number, n = 8): void {
    for (let i = 0; i < n; i++) spark(x + Math.cos((i * Math.PI * 2) / n) * rx, y + Math.sin((i * Math.PI * 2) / n) * ry)
  }

  function say(text: string): void {
    note = text
    noteT = NOTE_TICKS
  }

  function highway(): MapRoad[] {
    const out: MapRoad[] = []
    for (const r of layout!.roads) if (!r.secret && shown.has(r.id)) out.push(r)
    return out
  }

  function lightSite(id: string): void {
    if (lit.has(id)) return
    lit.add(id)
    lightT[id] = 0
    const at = layout!.sites[id]?.at
    if (at) ring(at[0], at[1] - 18, 22, 14)
    game!.audio.sfx('powerup')
  }

  function rivalSpot(i: number): [number, number] {
    const at = layout!.sites[RIVALS]?.at ?? [0, 0]
    const s = layout!.rivalSpots[i] ?? [0, 0]
    tmp[0] = at[0] + s[0]
    tmp[1] = at[1] + s[1]
    return tmp
  }

  /** What an event leaves behind, done at once, and remembered in the save as shown. */
  function complete(e: Ev): void {
    if (e.kind === 'road' && e.news) {
      shown.add(e.news.road.id)
      lightSite(e.news.reverse ? e.news.road.a : e.news.road.b)
      noteShown(save(), { road: e.news.road.id })
    } else if (e.kind === 'rival') {
      beatenShown = Math.max(beatenShown, e.i + 1)
      noteShown(save(), { beaten: e.i + 1 })
    } else if (e.kind === 'crown') {
      crownShown = true
      noteShown(save(), { champion: true })
    }
  }

  function endShow(): void {
    banner = ''
    phase = 'idle'
    amb?.setHighway(highway())
    refreshBar()
  }

  function finishShow(): void {
    // Skipping past the hidden road still gets its fanfare.
    if (!lit.has(RIVALS) && !ev?.secret && events.some((e) => e.secret)) game!.audio.jingle('secret')
    if (ev) complete(ev)
    for (const e of events) complete(e)
    ev = null
    events.length = 0
    endShow()
  }

  function startEvent(e: Ev): void {
    ev = e
    e.t = 0
    bannerT = 0
    if (e.kind === 'rival') {
      banner = `RIVALS BEATEN ${e.i + 1}/${RIVAL_COUNT}`
    } else if (e.kind === 'crown') {
      banner = 'CHAMPION OF RIVAL ROW!'
    } else if (e.secret) {
      if (!lit.has(RIVALS)) {
        game!.audio.jingle('secret')
        banner = 'A HIDDEN ROAD!'
      } else {
        banner = 'THE HIDDEN ROAD GOES ON!'
      }
    } else {
      banner = 'NOW OPEN: ' + signOf(e.news!.road.b)
    }
  }

  function stepShow(): void {
    if (showWait > 0) {
      showWait--
      return
    }
    if (!ev) {
      const next = events.shift()
      if (next) startEvent(next)
      else endShow()
      return
    }
    const e = ev
    e.t++
    if (e.kind === 'road' && e.news) {
      const r = e.news.road
      if (e.t % 10 === 1 && e.t < e.dur) game!.audio.sfx('menuMove')
      if (e.t % 3 === 0 && e.t <= e.dur) {
        const d = Math.min(1, e.t / e.dur) * r.len
        pointAt(r, e.news.reverse ? r.len - d : d, tmp)
        spark(tmp[0] + ((e.t * 7) % 9) - 4, tmp[1] + ((e.t * 5) % 7) - 3)
      }
      if (e.t === e.dur) {
        complete(e)
        amb?.setHighway(highway())
      }
      if (e.t >= e.dur + LIGHT_TICKS) {
        ev = null
        showWait = 10
      }
      return
    }
    if (e.kind === 'rival') {
      if (e.t === RIVAL_FLIP) {
        complete(e)
        rivalSpot(e.i)
        ring(tmp[0], tmp[1] - 8, 10, 8)
        game!.audio.sfx('powerup')
      }
    } else if (e.t === CROWN_FALL) {
      complete(e)
      const lb = layout!.sites[RIVALS]?.label
      if (lb) ring(lb[0], lb[1] - 8, 14, 7, 10)
      game!.audio.sfx('powerup')
    }
    if (e.t >= e.dur) {
      ev = null
      showWait = 8
    }
  }

  /* Walking */

  function chooseEnd(px: number, py: number, skip: MapRoad | null): { end: RoadEnd | null; open: boolean } {
    const here = layout!.nodes[node]
    const l = Math.hypot(px, py) || 1
    px /= l
    py /= l
    let best: RoadEnd | null = null
    let bestScore = -2
    let bestOpen: RoadEnd | null = null
    let bestOpenScore = -2
    for (const e of here.ends) {
      if (e.road === skip) continue
      const paved = shown.has(e.road.id)
      // A hidden road that is not open does not exist yet.
      if (e.road.secret && !paved) continue
      // Its first stretch, where it heads once under way, or (a little less) where it ends up.
      const s = Math.max(px * e.dx + py * e.dy, px * e.fx + py * e.fy, 0.75 * (px * e.tx + py * e.ty))
      if (s > bestScore) {
        bestScore = s
        best = e
      }
      if (paved && s > bestOpenScore) {
        bestOpenScore = s
        bestOpen = e
      }
    }
    // Roughly toward something: within about 78 degrees.
    if (!best || bestScore < 0.2) return { end: null, open: false }
    if (shown.has(best.road.id)) return { end: best, open: true }
    if (bestOpen && bestOpenScore > 0.5) return { end: bestOpen, open: true }
    return { end: best, open: false }
  }

  function startWalk(e: RoadEnd): void {
    road = e.road
    forward = e.forward
    along = 0
    pointAt(road, forward ? 0 : road.len, pos)
    target = e.to
    speed = Math.max(1.7, Math.min(4.2, road.len / 80))
    // The legs keep a walking pace: a little quicker on the long roads, never a blur.
    stepTicks = Math.max(4, Math.min(8, Math.round(14 / speed)))
    stepT = 0
    phase = 'walk'
    hop = 0
    note = ''
    wantEnter = false
    game!.audio.sfx('mapMove')
    refreshBar()
  }

  function stepWalk(confirmed: boolean): void {
    if (!road) return
    along = Math.min(road.len, along + speed)
    stepT++
    const before = pos[0]
    pointAt(road, forward ? along : road.len - along, pos)
    if (pos[0] < before - 0.2) facing = -1
    else if (pos[0] > before + 0.2) facing = 1
    if (confirmed && road.len - along < speed * CONFIRM_EARLY) wantEnter = true
    if (along < road.len) return
    node = target
    cameBy = road
    road = null
    target = ''
    phase = 'idle'
    hop = HOP_TICKS
    noteNode(save(), node)
    if (node === 'mw04') amb?.strikeIn(40)
    refreshBar()
    if (wantEnter) {
      wantEnter = false
      confirm()
    }
  }

  function tryMove(px: number, py: number, fresh: boolean): void {
    if (!px && !py) return
    const { end, open: paved } = chooseEnd(px, py, fresh ? null : cameBy)
    if (!end) return
    if (paved) {
      startWalk(end)
      return
    }
    if (!fresh) return
    game!.audio.sfx('locked')
    shake[end.to] = 24
    say('CLEAR ' + signOf(node) + ' FIRST')
  }

  function confirm(): void {
    const g = game!
    if (node === HQ) {
      g.audio.sfx('menuMove')
      // A new player's first press: tell them to walk, and where (the site the arrows beckon from).
      const s = save()
      const next = layout!.order.find((id) => id !== HQ && lit.has(id) && siteState(s, id, open.sites) === 'open')
      say(next ? `{move} WALK TO ${signOf(next)} AND WASH SOME CARS!` : 'HOME SWEET HQ. GO WASH SOME CARS!')
      return
    }
    if (!levelById(node)) {
      g.audio.sfx('locked')
      say('COMING SOON')
      return
    }
    g.audio.sfx('mapEnter')
    const n = layout!.nodes[node]
    g.irisAt(n.x, n.y - 14)
    phase = 'leave'
    noteNode(save(), node)
    g.go('play', { level: node }, 'iris')
  }

  /* The status bar */

  function refreshBar(): void {
    const g = game!
    const s = save()
    const here = phase === 'walk' && target ? target : node
    const rec = recordOf(s, here)
    const { got, of } = tokenTotals(s)
    const beaten = rivalsBeaten(s)
    const key = `${here}|${g.session.lives}|${g.session.score}|${got}|${rec?.bestScore}|${rec?.tokens.join()}|${rec?.spotless}|${beaten}|${s.data.champion}|${g.input.device}`
    if (key === barKey) return
    barKey = key
    const playable = here !== HQ && !!levelById(here)
    bar.sign = signOf(here)
    bar.name = has(NAMES, here) ? NAMES[here] : ''
    bar.tokens = TOKEN_IDS.has(here) ? (rec?.tokens ?? [false, false, false]) : null
    bar.spotless = !!rec?.spotless
    bar.line = here === HQ ? 'HOME OF MIGHTY MAXX' : 'BEST ' + (rec && rec.bestScore > 0 ? scoreText(rec.bestScore) : '-------')
    bar.extra = ''
    if (here === RIVALS) bar.extra = s.data.champion ? 'CHAMPION' : `RIVALS ${beaten}/${RIVAL_COUNT}`
    if (here !== HQ && !playable) bar.extra = bar.extra ? bar.extra + '  COMING SOON' : 'COMING SOON'
    bar.lives = 'X' + g.session.lives
    bar.score = scoreText(g.session.score)
    bar.gold = `${String(got).padStart(2, '0')}/${of}`
    // HQ is where a new game starts, and nothing else says how to get going from there.
    bar.prompt = playable ? '{confirm} PLAY  {cancel} TITLE' : here === HQ ? '{move} WALK  {cancel} TITLE' : '{cancel} TITLE'
    for (const id of siteIds) {
      const b = badges[id]
      b.state = siteState(s, id, open.sites)
      b.rec = recordOf(s, id)
      b.selected = id === here
    }
  }

  /* Drawing */

  function drawRoadPart(g: CanvasRenderingContext2D, r: MapRoad, from: number, to: number): void {
    const src = game!.sprites.source(r.frame)
    if (!src) return
    const { image, frame } = src
    const bx = r.box[0]
    const by = r.box[1]
    for (let d = from; d <= to; d += 2) {
      pointAt(r, d, tmp)
      const x = Math.round(tmp[0]) - 6
      const y = Math.round(tmp[1]) - 6
      g.drawImage(image, frame.x + x - bx, frame.y + y - by, 13, 13, x, y, 13, 13)
    }
  }

  function maxxXY(): [number, number] {
    if (phase === 'walk' && road) return pos
    const n = layout!.nodes[node]
    pos[0] = n.x
    pos[1] = n.y
    return pos
  }

  function drawWorld(g: CanvasRenderingContext2D): void {
    const L = layout!
    const sp = game!.sprites
    sp.draw(g, 'map/ground', 0, 0)
    amb!.drawWater(g, t)
    amb!.drawShadows(g)
    for (const r of L.roads) if (!r.secret && shown.has(r.id)) sp.draw(g, r.frame, r.box[0], r.box[1])
    for (const r of L.roads) if (r.secret && shown.has(r.id)) sp.draw(g, r.frame, r.box[0], r.box[1])
    const drawing = ev && ev.kind === 'road' && ev.news && ev.t > 0 ? ev.news : null
    if (drawing && ev) {
      const d = Math.min(1, ev.t / ev.dur) * drawing.road.len
      if (drawing.reverse) drawRoadPart(g, drawing.road, drawing.road.len - d, drawing.road.len)
      else drawRoadPart(g, drawing.road, 0, d)
    }

    // Movers and Maxx, merged in y order with the props and buildings.
    dyn.n = 0
    amb!.collect(dyn, t)
    maxxXY()
    const mx = pos[0]
    const my = pos[1]
    const hopY = hop > 0 ? Math.round(Math.sin((Math.PI * (HOP_TICKS - hop)) / HOP_TICKS) * 6) : 0
    const maxxFrame = phase === 'walk' ? walkFrames[Math.floor(stepT / stepTicks) % Math.max(1, walkFrames.length)] : L.frameAt(idleAnim, t)
    // Maxx's shadow: three rows of the darker ground under his feet.
    const shade = sp.source('map/shade')
    if (shade) {
      const sx = Math.round(mx)
      const sy = Math.round(my)
      for (let row = -1; row <= 1; row++) {
        const half = row === 0 ? 7 : 5
        g.drawImage(shade.image, shade.frame.x + sx - half, shade.frame.y + sy + row, half * 2, 1, sx - half, sy + row, half * 2, 1)
      }
    }
    dyn.push(maxxFrame, mx, my - hopY, facing < 0)
    if (lit.has(RIVALS)) {
      const at = L.sites[RIVALS]?.at
      if (at) {
        for (let i = 0; i < RIVAL_COUNT; i++) {
          rivalSpot(i)
          const name = i < beatenShown ? rivalDown[i] : L.frameAt(rivalUp[i], t + i * 40)
          // Sorted with the lot's own anchor, so they stand on it, in front of its fence.
          dyn.push(name, tmp[0], at[1] + 1, i >= 2, tmp[1] - at[1] - 1)
        }
      }
    }
    dyn.sort()

    let k = 0
    for (const s of statics) {
      while (k < dyn.n && dyn.items[k].y < s.y) drawDyn(g, dyn.items[k++])
      if (s.site) drawSite(g, s.site)
      else drawProp(g, s.i)
    }
    while (k < dyn.n) drawDyn(g, dyn.items[k++])

    amb!.drawSky(g, t)

    // Beckoning arrows over open sites not yet cleared.
    const s = save()
    for (const id of siteIds) {
      if (id === HQ || !lit.has(id) || siteState(s, id, open.sites) !== 'open' || (ev && (lightT[id] ?? 99) < LIGHT_TICKS)) continue
      const at = L.sites[id].at
      const bob = Math.floor(t / 8) % 4
      sp.draw(g, 'map/arrow', at[0], at[1] - siteTall[id] - 3 + (bob === 2 ? 1 : 0) - (bob === 0 ? 1 : 0))
    }
    for (const id of siteIds) {
      const b = badges[id]
      const label = L.sites[id].label
      b.lit = lit.has(id)
      b.shake = shake[id] ?? 0
      if (id === RIVALS) {
        if (!b.lit) continue
        const falling = ev && ev.kind === 'crown' ? ev : null
        b.champion = crownShown || !!falling
        b.crownLift = falling && falling.t < CROWN_FALL ? CROWN_DROP * (1 - (falling.t / CROWN_FALL) ** 2) : 0
      }
      drawBadge(sp, g, b, label[0], label[1], t, flagFrames, starFrames[Math.floor(t / 6) % 30 === 0 ? 1 : 0] ?? '')
    }

    for (const p of sparks) {
      if (p.t >= 16) continue
      sp.draw(g, sparkFrames[Math.min(3, p.t >> 2)] ?? '', p.x, p.y)
    }
    if (drawing && ev && ev.t < ev.dur) {
      const d = (ev.t / ev.dur) * drawing.road.len
      pointAt(drawing.road, drawing.reverse ? drawing.road.len - d : d, tmp)
      sp.draw(g, sparkFrames[(t >> 2) % 4] ?? '', tmp[0], tmp[1])
    }
    if (note && noteT > 0) drawNote(g, note, mx, my - 36)
    if (banner) drawBanner(g, banner, bannerT)
  }

  const propFrame = (i: number): string => {
    const p = layout!.props[i]
    if (p.crossing) return p.frames[amb!.crossingFrame(p.x + 9, t)] ?? ''
    return layout!.frameAt(p, t + p.phase)
  }

  function drawProp(g: CanvasRenderingContext2D, i: number): void {
    const p = layout!.props[i]
    game!.sprites.draw(g, propFrame(i), p.x, p.y, p.flip ? FLIP : undefined)
  }

  function drawSite(g: CanvasRenderingContext2D, id: string): void {
    const site = layout!.sites[id]
    const lt = lightT[id] ?? 99
    // Lighting up: a few flickers between dark and lit.
    const on = id === HQ || (lit.has(id) && (lt >= LIGHT_TICKS || Math.floor(lt / 4) % 2 === 1))
    if (on) game!.sprites.draw(g, layout!.frameAt(siteAnims[id], t), site.at[0], site.at[1])
    else game!.sprites.draw(g, siteOff[id], site.at[0], site.at[1])
  }

  function drawDyn(g: CanvasRenderingContext2D, d: { name: string; x: number; y: number; flip: boolean; dy: number }): void {
    game!.sprites.draw(g, d.name, d.x, d.y + d.dy, d.flip ? FLIP : undefined)
  }

  const anyDir = (a: InputFrame['held']): boolean => a.left || a.right || a.up || a.down

  const scene: MapScene = {
    enter(g, params: SceneParams) {
      game = g
      t = 0
      layout = readLayout(g.sprites)
      g.audio.music('map')
      g.audio.preload(['secret'])
      if (!layout) return
      const L = layout
      const s = g.save
      amb = createAmbient(g.sprites, L)
      amb.setFinished(s.data.finished)
      open = reach(s, L)

      flagFrames = g.sprites.anim('map', 'flag')
      starFrames = g.sprites.anim('map', 'star')
      sparkFrames = g.sprites.anim('map', 'spark')
      walkFrames = g.sprites.anim('maxx', 'mapWalk')
      idleAnim = { frames: g.sprites.anim('maxx', 'mapIdle'), ticks: [90, 6], total: 96 }
      rivalUp = []
      rivalDown = []
      for (let i = 0; i < RIVAL_COUNT; i++) {
        rivalUp.push(L.anim(`rival${i}`))
        rivalDown.push(`map/rival${i}_down`)
      }

      statics.length = 0
      L.props.forEach((p, i) => statics.push({ y: p.y, i, site: '' }))
      siteIds = Object.keys(L.sites)
      for (const id of siteIds) {
        shake[id] = 0
        lightT[id] = 99
        statics.push({ y: L.sites[id].at[1], i: -1, site: id })
        siteAnims[id] = L.anim(`site_${id}`)
        siteOff[id] = `map/site_${id}_off`
        siteTall[id] = g.sprites.frame(siteOff[id])?.h ?? 40
        badges[id] = { sign: signOf(id), state: 'locked', lit: false, rec: null, tokens: TOKEN_IDS.has(id), selected: false, shake: 0, champion: false, crownLift: 0 }
      }
      statics.sort((a, b) => a.y - b.y)

      const from = typeof params.from === 'string' ? params.from : null
      const exit = typeof params.exit === 'string' ? params.exit : null
      const news = takeNews(s, L, from, exit)

      shown.clear()
      lit.clear()
      for (const r of L.roads) if (open.roads.has(r.id) && !news.roads.some((n) => n.road === r)) shown.add(r.id)
      for (const id of siteIds) if (open.sites.has(id)) lit.add(id)
      // A site waits in the dark for the road that opens it: the far end of a new highway, or
      // Rival Row at the end of the hidden road. The other end of a hidden road was lit already.
      for (const n of news.roads) {
        const end = n.reverse ? n.road.a : n.road.b
        if (!n.road.secret || end === RIVALS) lit.delete(end)
      }
      lit.add(HQ)
      const beaten = rivalsBeaten(s)
      beatenShown = news.beatenFrom
      crownShown = s.data.champion && !news.champion

      // Where Maxx stands: the site he came back from, the one he left, or the furthest open.
      const usable = (id: string | null): id is string => !!id && has(L.nodes, id) && open.sites.has(id)
      let start: string | null = usable(from) ? from : lastNode(s)
      if (!usable(start)) {
        // A new save starts at HQ; after that, at the furthest open site, where the next level waits.
        start = HQ
        if (s.data.unlocked > 1 || L.order.some((id) => recordOf(s, id)?.cleared)) for (const id of L.order) if (open.sites.has(id)) start = id
      }
      node = start
      noteNode(s, node)
      // The iris opens on Maxx, wherever the level closed it.
      g.irisAt(L.nodes[node].x, L.nodes[node].y - 14)
      facing = 1
      road = null
      target = ''
      hop = 0
      latch = 0
      pending = false
      cameBy = null
      wantEnter = false

      events.length = 0
      for (const n of news.roads) {
        const secret = n.road.secret
        const dur = Math.round(Math.max(secret ? 90 : 50, Math.min(secret ? 200 : 120, n.road.len * (secret ? 0.9 : 0.55))))
        events.push({ kind: 'road', news: n, i: 0, t: 0, dur, secret })
      }
      if (open.sites.has(RIVALS)) {
        for (let i = news.beatenFrom; i < beaten; i++) events.push({ kind: 'rival', news: null, i, t: 0, dur: RIVAL_TICKS, secret: false })
        if (news.champion) events.push({ kind: 'crown', news: null, i: 0, t: 0, dur: CROWN_TICKS, secret: false })
      } else {
        beatenShown = beaten
        crownShown = s.data.champion
      }
      ev = null
      phase = events.length ? 'show' : 'idle'
      showWait = SHOW_WAIT
      amb.setHighway(highway())
      barKey = ''
      refreshBar()
      // Out of EXIT TO MAP the player chose YES once; out of a clear they may still be hurrying the tally.
      calm = from && (exit === 'goal' || exit === 'secret') ? ARRIVE_CALM : 0
      calmT = 0
      note = ''
      noteT = 0
      // A player on a controller may never have pressed a key or clicked: only the title said so.
      if (g.audio.locked) {
        say(FOR_SOUND[g.input.device])
        noteT = SOUND_NOTE_TICKS
      }
    },

    update(g, input) {
      t++
      if (!layout || !amb) {
        if (phase !== 'leave' && (input.pressed.confirm || input.pressed.cancel)) {
          phase = 'leave'
          g.go('title', {}, 'fade')
        }
        return
      }
      amb.update(t)
      if (amb.struck && node === 'mw04' && phase === 'idle' && t - lastThunder >= THUNDER_GAP) {
        lastThunder = t
        g.audio.sfx('thunder')
      }
      if (hop > 0) hop--
      if (noteT > 0) noteT--
      bannerT++
      for (const s of sparks) if (s.t < 99) s.t++
      for (const id of siteIds) {
        if (shake[id] > 0) shake[id]--
        if (lightT[id] < 99) lightT[id]++
      }
      if (t % 30 === 0) refreshBar()

      // A press while it is calming down starts the wait over, so a steady mash ends on the map.
      const calming = calm > 0
      if (calming && !g.transitioning) {
        calm = input.pressed.confirm || input.pressed.cancel ? ARRIVE_CALM : calm - 1
        if (++calmT >= ARRIVE_MAX) calm = 0
      }
      const confirmed = !calming && input.pressed.confirm
      const cancelled = !calming && input.pressed.cancel

      if (phase === 'show') {
        if (confirmed) finishShow()
        else stepShow()
        return
      }
      if (phase === 'walk') {
        stepWalk(confirmed)
        return
      }
      if (phase !== 'idle') return
      if (cancelled) {
        g.audio.sfx('menuBack')
        phase = 'leave'
        g.go('title', {}, 'fade')
        return
      }
      if (confirmed) {
        confirm()
        return
      }
      const h = input.held
      const p = input.pressed
      if (anyDir(p)) {
        if (!pending) pushX = pushY = 0
        pending = true
        latch = LATCH
      }
      if (latch > 0) {
        // The push is everything held or pressed while it settles: both halves of a diagonal,
        // and a tap too short to be held when it is read.
        latch--
        if (h.right || p.right) pushX |= 1
        if (h.left || p.left) pushX |= 2
        if (h.down || p.down) pushY |= 1
        if (h.up || p.up) pushY |= 2
      }
      if (!pending && !anyDir(h)) cameBy = null
      if (latch > 0 || hop > HOP_GO) return
      if (pending) {
        pending = false
        tryMove((pushX & 1) - ((pushX & 2) >> 1), (pushY & 1) - ((pushY & 2) >> 1), true)
      } else if (cameBy && anyDir(h)) {
        tryMove((h.right ? 1 : 0) - (h.left ? 1 : 0), (h.down ? 1 : 0) - (h.up ? 1 : 0), false)
      }
    },

    render(g, ctx) {
      if (!layout) {
        ctx.fillStyle = PAL.green[0]
        ctx.fillRect(0, 0, VIEW_W, VIEW_H)
        drawText(ctx, 'THE MAP ART IS MISSING', VIEW_W / 2, 170, { align: 'center', color: PAL.white, scale: 2 })
        return
      }
      drawWorld(ctx)
      // The bar is opaque: it covers whatever hangs over the map's bottom edge.
      drawBar(ctx, g, bar, t)
    },

    exit() {
      game = null
    },

    state() {
      const [x, y] = layout ? maxxXY() : [0, 0]
      const running = ev
      return {
        phase,
        node,
        road: road?.id ?? '',
        target,
        maxx: [Math.round(x), Math.round(y)],
        pending: events.length + (running ? 1 : 0),
        drawing: running?.kind === 'road' && running.news ? running.news.road.id : '',
        progress: running ? Math.min(1, running.t / running.dur) : 0,
        showing: running?.kind ?? '',
        note: noteT > 0 ? note : '',
        banner,
        roads: [...shown],
        lit: [...lit],
        beatenShown,
        crown: crownShown,
        bar: { sign: bar.sign, name: bar.name, prompt: bar.prompt, extra: bar.extra, tokens: bar.tokens ? [...bar.tokens] : null },
      }
    },

    forget() {
      if (game) forgetSeen(game.save)
    },
  }
  return scene
}
