// Level data in, playable tables out: AreaDef.rows -> a TileGrid and a list of
// spawns. validateLevel() is the lint the level designers run.
import { DEFAULT_LEGEND, TILE, VIEW_W } from '../contract'
import type { AreaDef, LevelDef, SpawnSpec } from '../contract'
import { getBehavior, hasBehavior } from './registry'
import { AIR, TILE_BY_CODE, TILE_INFO } from './tiles'
import type { TileInfo } from './tiles'
import { TUNING } from './tuning'
import type { AreaSpawn, AreaState } from './types'

/** '@' is not an entity: it only marks where Maxx starts. */
export const START_KIND = 'start'
/** Kinds whose spawn tile is somewhere Maxx stands: the start, a retry point, the far end of a warp. */
const STANDING_KINDS = [START_KIND, 'marker', 'door', 'checkpoint']
/** world.flags names with this prefix are cars already counted toward SPOTLESS (see creditCar in api.ts). */
export const WASHED_FLAG = 'washed:'
const WARP_KINDS = ['pipe', 'door']
/** Kinds that end the level: the two exits, and Mudzilla, which completes the level itself once washed. */
const EXIT_KINDS = ['goal', 'secretExit', 'mudzilla']
const MIN_ROWS = 12

/** What a character in an area's rows spawns: the area's own legend first, then the default one. */
export function specFor(area: AreaDef, ch: string): SpawnSpec | undefined {
  const own = area.legend
  if (own && Object.hasOwn(own, ch)) return own[ch]
  if (TILE_INFO[ch]) return undefined
  return Object.hasOwn(DEFAULT_LEGEND, ch) ? DEFAULT_LEGEND[ch] : undefined
}

/** Unknown characters become air, short rows are padded: a broken level still loads. */
export function parseArea(def: AreaDef): AreaState {
  const h = def.rows.length
  let w = 0
  for (const row of def.rows) if (row.length > w) w = row.length
  const t = new Uint8Array(w * h).fill(AIR)
  const spawns: AreaSpawn[] = []
  for (let ty = 0; ty < h; ty++) {
    const row = def.rows[ty]
    for (let tx = 0; tx < row.length; tx++) {
      const ch = row[tx]
      if (ch === ' ') continue
      const spec = specFor(def, ch)
      if (spec) spawns.push({ spec, tx, ty, token: -1 })
      else if (TILE_INFO[ch]) t[ty * w + tx] = ch.charCodeAt(0)
    }
  }
  return { def, grid: { w, h, t, d: new Uint8Array(w * h) }, spawns, entities: null }
}

/** Give each token its slot (0..2): `props.index` if the level says, else the free slots in reading order. */
export function numberTokens(areas: AreaState[]): void {
  const taken = [false, false, false]
  const tokens: AreaSpawn[] = []
  for (const area of areas) for (const sp of area.spawns) if (sp.spec.kind === 'token') tokens.push(sp)
  for (const sp of tokens) {
    const index = sp.spec.props?.index
    if (typeof index === 'number' && index >= 0 && index <= 2) {
      sp.token = Math.floor(index)
      taken[sp.token] = true
    }
  }
  let extra = 0
  for (const sp of tokens) {
    if (sp.token >= 0) continue
    const free = taken.indexOf(false)
    sp.token = free >= 0 ? free : extra++ % 3
    if (free >= 0) taken[free] = true
  }
}

/** Every car the level holds: the ones placed, plus what its spawners will send. */
export function countCars(areas: AreaState[]): number {
  let n = 0
  for (const area of areas) {
    for (const sp of area.spawns) {
      const beh = getBehavior(sp.spec.kind)
      if (!beh) continue
      n += beh.carCount ? beh.carCount(sp.spec) : beh.countsAsCar ? 1 : 0
    }
  }
  return n
}

export function findStart(area: AreaState): AreaSpawn | undefined {
  return area.spawns.find((sp) => sp.spec.kind === START_KIND)
}

/** The arrival point called `name`: a marker, or a pipe or door that carries the name. */
export function findMarker(area: AreaState, name: string): AreaSpawn | undefined {
  return area.spawns.find((sp) => sp.spec.props?.name === name)
}

/** Split a warp target 'areaId:markerName'. A bare 'markerName' means the area you are in. */
export function parseTarget(to: string, hereAreaId: string): { area: string; marker: string } {
  const i = to.indexOf(':')
  if (i < 0) return { area: hereAreaId, marker: to }
  return { area: to.slice(0, i) || hereAreaId, marker: to.slice(i + 1) }
}

/** Bottom-centre of a tile, in pixels: where an entity's feet go. */
export function tileFeetX(tx: number): number {
  return tx * TILE + TILE / 2
}
export function tileFeetY(ty: number): number {
  return (ty + 1) * TILE
}

export interface LevelReport {
  errors: string[]
  warnings: string[]
}

/** Lint a level. Errors would break play; warnings are worth a look. */
export function validateLevel(level: LevelDef): LevelReport {
  const errors: string[] = []
  const warnings: string[] = []
  if (!level.areas || level.areas.length === 0) {
    errors.push('level has no areas')
    return { errors, warnings }
  }
  if (!(level.time > 0)) errors.push(`time must be above 0 (got ${level.time})`)

  const ids = new Set<string>()
  const parsed: AreaState[] = []
  for (const def of level.areas) {
    const at = `area '${def.id}'`
    if (ids.has(def.id)) errors.push(`${at}: duplicate area id`)
    ids.add(def.id)
    if (def.id.includes(':')) errors.push(`${at}: an area id cannot contain ':'`)

    if (def.rows.length < MIN_ROWS) errors.push(`${at}: ${def.rows.length} rows, needs at least ${MIN_ROWS}`)
    const width = def.rows[0]?.length ?? 0
    def.rows.forEach((row, y) => {
      if (row.length !== width) errors.push(`${at}: row ${y} is ${row.length} wide, row 0 is ${width} (ragged rows)`)
    })
    if (width * TILE < VIEW_W) warnings.push(`${at}: ${width} tiles wide, narrower than the screen (${VIEW_W / TILE})`)

    const unknown = new Map<string, string>()
    def.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]
        if (ch === ' ' || TILE_INFO[ch] || specFor(def, ch)) continue
        if (!unknown.has(ch)) unknown.set(ch, `row ${y}, column ${x}`)
      }
    })
    for (const [ch, where] of unknown) errors.push(`${at}: unknown character '${ch}' (first at ${where})`)

    for (const ch of Object.keys(def.legend ?? {})) {
      if (ch.length !== 1) errors.push(`${at}: legend key '${ch}' must be a single character`)
      else if (ch === ' ') errors.push(`${at}: the legend cannot redefine a blank`)
      else if (TILE_INFO[ch]) warnings.push(`${at}: legend character '${ch}' hides the tile of the same character`)
    }
    parsed.push(parseArea(def))
  }

  const starts = findAll(parsed[0], START_KIND).length
  if (starts === 0) errors.push(`area '${parsed[0].def.id}': no '@' start in the first area`)
  else if (starts > 1) warnings.push(`area '${parsed[0].def.id}': ${starts} '@' starts, the first one is used`)

  let exits = 0
  let tokens = 0
  const missing = new Set<string>()
  for (const area of parsed) {
    const at = `area '${area.def.id}'`
    const names = new Set<string>()
    for (const sp of area.spawns) {
      const { kind, props } = sp.spec
      const where = `${at}: ${kind} at column ${sp.tx}, row ${sp.ty}`
      if (EXIT_KINDS.includes(kind)) exits++
      if (kind === 'token') tokens++
      if (kind !== START_KIND && !hasBehavior(kind)) missing.add(kind)

      const name = props?.name
      if (typeof name === 'string') {
        if (names.has(name)) warnings.push(`${where}: the name '${name}' is used twice in this area`)
        names.add(name)
      } else if (kind === 'marker') {
        warnings.push(`${where}: a marker needs props.name`)
      }

      // Maxx is more than a tile tall: where he starts or arrives, the cell above must be open too.
      if (STANDING_KINDS.includes(kind) && tileInfo(area, sp.tx, sp.ty - 1).solid) {
        warnings.push(`${where}: the tile above it is solid, so Maxx would stand inside it`)
      }
      if (kind === 'pipe' && tileInfo(area, sp.tx, sp.ty + 1).ch !== 'P') {
        warnings.push(`${where}: a pipe's character goes in the open cell just above a 'P' tile`)
      }
      if (kind === 'car' && !TUNING.cars[sp.spec.variant ?? '']) {
        warnings.push(`${where}: unknown car variant '${sp.spec.variant ?? ''}' (it will be a compact)`)
      }

      if (!WARP_KINDS.includes(kind)) continue
      const to = props?.to
      if (typeof to !== 'string' || to === '') {
        if (typeof name !== 'string') warnings.push(`${where}: no props.to, so it leads nowhere`)
        continue
      }
      const target = parseTarget(to, area.def.id)
      const dest = parsed.find((a) => a.def.id === target.area)
      if (!dest) errors.push(`${where}: props.to '${to}' points at area '${target.area}', which does not exist`)
      else if (!findMarker(dest, target.marker)) {
        errors.push(`${where}: props.to '${to}' points at marker '${target.marker}', which area '${target.area}' does not have`)
      }
    }
  }
  if (exits === 0) errors.push('no goal or secretExit anywhere in the level (nor a mudzilla, which completes it)')
  if (tokens !== 3) warnings.push(`${tokens} tokens in the level, expected 3`)
  for (const kind of [...missing].sort()) warnings.push(`entity kind '${kind}' has no registered behaviour (it is skipped at runtime)`)

  return { errors, warnings }
}

function findAll(area: AreaState, kind: string): AreaSpawn[] {
  return area.spawns.filter((sp) => sp.spec.kind === kind)
}

function tileInfo(area: AreaState, tx: number, ty: number): TileInfo {
  const g = area.grid
  const inside = tx >= 0 && ty >= 0 && tx < g.w && ty < g.h
  return (inside ? TILE_BY_CODE[g.t[ty * g.w + tx]] : undefined) ?? TILE_INFO[' ']
}
