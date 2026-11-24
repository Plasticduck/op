// What the save says the map should look like: which sites are open, cleared, spotless,
// which roads are paved, and what the map has not yet shown the player (those get drawn in
// with a flourish the next time the map is up).
//
// Rules (part 4, "Scene flow"; scenes/play/record.ts writes the save):
//   - HQ is always open. Main site k (0-based, MW01 = 0) is open when k < save.unlocked, or
//     when the save has it cleared. Rival Row is open when save.secretFound.
//   - A road is paved when both its ends are open. The hidden roads also need secretFound,
//     so the leg Rival Row -> MW06 is never a short cut past MW04 and MW05.
//   - What the map shows is what can be reached from HQ along paved roads. A save that says
//     a site is open but gives no paved way to it (edited by hand, or written by an old build)
//     shows that site as locked, so Maxx can never be put down where he cannot walk away.
import type { LevelRecord, SaveApi } from '../../contract'
import { emptyMapMemory } from '../../engine/save'
import { LEVEL_META, RIVALS_META } from '../../levels/meta'
import type { MapLayout, MapRoad } from './layout'

export type SiteState = 'locked' | 'open' | 'cleared' | 'spotless'

export const HQ = 'hq'
export const RIVALS = RIVALS_META.id
export const RIVAL_COUNT = 4

/** Own keys only: a level id such as 'constructor' must not find Object's. */
export const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key)

/** Main sites by id: their index in LEVEL_META. */
const MAIN_INDEX: Record<string, number> = Object.fromEntries(LEVEL_META.map((m, i) => [m.id, i]))

export function recordOf(save: SaveApi, id: string): LevelRecord | null {
  return has(save.data.levels, id) ? save.data.levels[id] : null
}

/** What the save alone says, before asking whether a road leads there. */
export function siteOpen(save: SaveApi, id: string): boolean {
  if (id === HQ) return true
  if (id === RIVALS) return save.data.secretFound
  if (!has(MAIN_INDEX, id)) return false
  return MAIN_INDEX[id] < save.data.unlocked || !!recordOf(save, id)?.cleared
}

export function roadOpen(save: SaveApi, road: MapRoad): boolean {
  if (road.secret && !save.data.secretFound) return false
  return siteOpen(save, road.a) && siteOpen(save, road.b)
}

/** Everything the player can get to: the sites reached from HQ along paved roads, and those roads. */
export interface Reach {
  sites: Set<string>
  roads: Set<string>
}

export function reach(save: SaveApi, layout: MapLayout): Reach {
  const sites = new Set<string>([HQ])
  const roads = new Set<string>()
  const paved = layout.roads.filter((r) => roadOpen(save, r))
  for (let grew = true; grew; ) {
    grew = false
    for (const r of paved) {
      if (roads.has(r.id) || !(sites.has(r.a) || sites.has(r.b))) continue
      roads.add(r.id)
      sites.add(r.a)
      sites.add(r.b)
      grew = true
    }
  }
  return { sites, roads }
}

export function siteState(save: SaveApi, id: string, open: ReadonlySet<string>): SiteState {
  if (!open.has(id)) return 'locked'
  const rec = recordOf(save, id)
  if (!rec?.cleared) return 'open'
  return rec.spotless ? 'spotless' : 'cleared'
}

/**
 * Gold tokens collected across the eight main levels, and how many there are. Rival Row's three
 * show on its own badge and bar but stay out of the 24, as the ending's other rows count eight.
 */
export function tokenTotals(save: SaveApi): { got: number; of: number } {
  let got = 0
  for (const m of LEVEL_META) {
    const rec = recordOf(save, m.id)
    if (rec) for (const t of rec.tokens) if (t) got++
  }
  return { got, of: LEVEL_META.length * 3 }
}

export function rivalsBeaten(save: SaveApi): number {
  return Math.max(0, Math.min(RIVAL_COUNT, Math.floor(save.data.rivalsBeaten) || 0))
}

/*
 * What the player has already been shown lives in the save (save.data.map), so each flourish
 * plays once, reload or not. Empty `roads` means the map has never looked at this save (a new
 * game, an erased save, or one from before the field existed): the road from HQ is always
 * paved, so once the map has looked, `roads` is never empty again.
 */

/** For tests: the next visit counts as the map's first look at this save. */
export function forgetSeen(save: SaveApi): void {
  save.data.map = emptyMapMemory()
  save.commit()
}

export function lastNode(save: SaveApi): string | null {
  return save.data.map.node || null
}

export function noteNode(save: SaveApi, node: string): void {
  const m = save.data.map
  if (m.node === node) return
  m.node = node
  save.commit()
}

/** A flourish has played to its end (or been hurried there): it is not news again. */
export function noteShown(save: SaveApi, what: { road?: string; beaten?: number; champion?: boolean }): void {
  const m = save.data.map
  if (what.road && !m.roads.includes(what.road)) m.roads.push(what.road)
  if (what.beaten !== undefined) m.beaten = Math.max(m.beaten, Math.min(RIVAL_COUNT, what.beaten))
  if (what.champion) m.champion = true
  save.commit()
}

export interface RoadNews {
  road: MapRoad
  /** Draw it from its b end towards a. */
  reverse: boolean
}

export interface News {
  /** Roads to draw in, in order. */
  roads: RoadNews[]
  /** Rivals beaten since the map last looked: shown unmasked one by one, from this many. */
  beatenFrom: number
  /** The crown is new. */
  champion: boolean
}

/**
 * What to show with a flourish, in order. The rest is remembered as seen at once; each piece of
 * news is remembered as its flourish ends (noteShown), so a page closed halfway shows the rest
 * next time. The map's first look at a save shows the map as it is, except that arriving from a
 * clear still draws what that clear opened (`from`, `exit`): the road on from that site while the
 * site at its end has never been cleared, and the hidden road while Rival Row has never been played.
 */
export function takeNews(save: SaveApi, layout: MapLayout, from: string | null, exit: string | null): News {
  const open = reach(save, layout).roads
  const roads = layout.roads.filter((r) => open.has(r.id))
  const mem = save.data.map
  const looked = mem.roads.length > 0
  const beaten = rivalsBeaten(save)
  const champion = save.data.champion
  let fresh: MapRoad[] = []
  let beatenFrom = beaten
  let crown = false
  if (looked) {
    fresh = roads.filter((r) => !mem.roads.includes(r.id))
    beatenFrom = Math.min(beaten, mem.beaten)
    crown = champion && !mem.champion
  } else {
    if (from && (exit === 'goal' || exit === 'secret')) {
      const rivalsNew = !recordOf(save, RIVALS)?.cleared && beaten === 0
      fresh = roads.filter((r) => (r.secret ? exit === 'secret' && rivalsNew : r.a === from && !recordOf(save, r.b)?.cleared))
    }
    if (from === RIVALS) crown = champion && exit === 'goal'
  }
  // A road no longer open (the save went back) is forgotten, so it is news again if it reopens.
  mem.roads = roads.filter((r) => !fresh.includes(r)).map((r) => r.id)
  mem.beaten = beatenFrom
  mem.champion = champion && !crown
  save.commit()

  // Main roads first, in map order. Then the hidden road, drawn out from the end it was found
  // from: from MW03 by default, from MW06 when that is where the player came out.
  const main = fresh.filter((r) => !r.secret)
  const out: RoadNews[] = main.map((road) => ({ road, reverse: false }))
  const secret = fresh.filter((r) => r.secret)
  const backwards = secret.length > 0 && secret[secret.length - 1].b === from && secret[0].a !== from
  if (backwards) secret.reverse()
  for (const road of secret) out.push({ road, reverse: backwards })
  return { roads: out, beatenFrom, champion: crown }
}
