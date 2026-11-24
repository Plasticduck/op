// Helpers for building MW03 from pieces: stretches of rows laid side by side, with the scenery
// and the one-off things placed by column and row so the rows themselves stay readable.
import { DEFAULT_LEGEND, TILE_CHARS } from '../../contract'
import type { AreaDef, MusicId, SpawnSpec, ThemeId } from '../../contract'

/** Something placed at a column and row of its piece (the tile its feet stand in). */
export type Thing = [col: number, row: number, spec: SpawnSpec]

/** One stretch of an area: its rows (all `width` long) and what stands in it. */
export interface Piece {
  name: string
  width: number
  rows: string[]
  things: Thing[]
}

/** Pieces joined left to right: the rows, the things at their area columns, and where each piece starts. */
export interface Joined {
  width: number
  rows: string[]
  things: Thing[]
  at: Record<string, number>
}

/**
 * What went wrong while the level was put together (a row too long, a thing on a taken cell).
 * Collected, never thrown: levels/index.ts loads every level at once, so a throw here would
 * take the whole game down. Empty in a level that is right.
 */
export const PROBLEMS: string[] = []

export function piece(name: string, width: number, rows: string[], things: Thing[] = []): Piece {
  for (let y = 0; y < rows.length; y++) {
    if (rows[y].length > width) PROBLEMS.push(`${name}: row ${y} is ${rows[y].length} wide, the piece is ${width}`)
  }
  return { name, width, rows: rows.map((r) => r.padEnd(width).slice(0, width)), things }
}

export function join(pieces: Piece[]): Joined {
  const rows: string[] = pieces[0].rows.map(() => '')
  const things: Thing[] = []
  const at: Record<string, number> = {}
  let x = 0
  for (const p of pieces) {
    if (p.rows.length !== rows.length) PROBLEMS.push(`${p.name}: ${p.rows.length} rows, the area has ${rows.length}`)
    at[p.name] = x
    for (let y = 0; y < rows.length; y++) rows[y] += p.rows[y] ?? ' '.repeat(p.width)
    for (const [col, row, spec] of p.things) things.push([x + col, row, spec])
    x += p.width
  }
  return { width: x, rows, things, at }
}

/** Characters handed out to placed things: printable, never a tile, a default entity or a mark the level tools draw. */
const POOL = '0123456789ADEFJKNQRSTVYZaelmqx&+-_:;,/()[]{}<>'.split('').filter((ch) => !TILE_CHARS.includes(ch) && !(ch in DEFAULT_LEGEND) && !'+:.x'.includes(ch))

/**
 * An area from joined pieces. `legend` is for the characters written in the rows by hand; each
 * distinct placed thing gets a spare character of its own, written into its (blank) cell.
 */
export function area(id: string, theme: ThemeId, joined: Joined, legend: Record<string, SpawnSpec>, music?: MusicId): AreaDef {
  const grid = joined.rows.map((r) => r.split(''))
  const used = new Set<string>(Object.keys(legend))
  for (const row of grid) for (const ch of row) used.add(ch)
  const spare = POOL.filter((ch) => !used.has(ch))
  const out: Record<string, SpawnSpec> = { ...legend }
  const chars = new Map<string, string>()
  for (const [col, row, spec] of joined.things) {
    const cell = grid[row]?.[col]
    if (cell !== ' ') {
      PROBLEMS.push(`${id}: ${String(spec.props?.sprite ?? spec.kind)} at ${col},${row} lands on '${cell ?? 'nothing'}'`)
      continue
    }
    const key = JSON.stringify(spec)
    let ch = chars.get(key)
    if (!ch) {
      ch = spare.shift()
      if (!ch) {
        PROBLEMS.push(`${id}: out of legend characters at ${col},${row}`)
        continue
      }
      chars.set(key, ch)
      out[ch] = spec
    }
    grid[row][col] = ch
  }
  const def: AreaDef = { id, theme, rows: grid.map((r) => r.join('')), legend: out }
  if (music) def.music = music
  return def
}

export const decor = (name: string, opts: { front?: boolean; flip?: boolean } = {}): SpawnSpec => ({
  kind: 'decor',
  props: { sprite: `decor_${name}`, front: opts.front === true, flip: opts.flip === true },
})

export const sign = (text: string): SpawnSpec => ({ kind: 'sign', props: { text } })
