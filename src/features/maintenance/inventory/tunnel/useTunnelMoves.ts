import { useCallback, useEffect, useMemo, useState } from 'react'
import { miTunnel, type TunnelItem, type TunnelLayout, type TunnelZone } from '@/lib/queries/miTunnel'
import { errText } from '../format'
import { shapeFor } from './shapes'
import { zoneAt } from './useEditorState'

// Machines moved in the 3D view and not saved yet. The page holds them, not the canvas,
// so they show in the diagram and the list too and outlive a 3D failure. They sit on top
// of whatever was last loaded: a reload (someone linked a machine, a scan) keeps them, and
// a copy in sessionStorage keeps them through a page reload or a look at a machine's page.
// Saving sends the whole drawing through mi_tunnel_save, as the editor does, so there is
// nothing new on the server. Every reload moves the version on, so the save's version
// check can't see a clash with a move: each move remembers where its shape stood when it
// was made, and is dropped (and named) once someone else has moved that shape since. This
// person's own save moves shapes too, and machines can still be moved while it is on its
// way: a move kept through a save also remembers where the save put its shape.

// Where a shape stands: as loaded (a move's from), or where it was moved to.
type Spot = { x_ft: number; y_ft: number; side: string }
// Where a shape was moved to, and from. name is kept so a move can still be named after
// someone else deleted its shape. sent is where this person's save put the shape, until the
// drawing shows it there: the reload after a save can lag, fail or be overtaken by an older
// answer, and none of those is someone else moving it.
export type Move = { x_ft: number; y_ft: number; zone: string | null; name: string; from: Spot; sent?: Spot }
type Moves = Record<string, Move>
// key is the person and drawing the moves belong to. past is what undo steps back through.
type Draft = { key: string | null; moves: Moves; past: Moves[] }

const STORE = 'mi.tunnel.draft:'
const UNDO_LIMIT = 100
const NONE: Moves = Object.freeze({})
// Positions are saved to a hundredth of a foot.
const same = (a: number, b: number) => Math.abs(a - b) < 0.005
const at = (i: TunnelItem, m: { x_ft: number; y_ft: number }) => same(Number(i.x_ft), m.x_ft) && same(Number(i.y_ft), m.y_ft)
const spotOf = (i: TunnelItem): Spot => ({ x_ft: Number(i.x_ft), y_ft: Number(i.y_ft), side: i.side })
// Still where it stood when the move was made: nobody else has moved it since.
const unmoved = (i: TunnelItem, from: Spot) => at(i, from) && i.side === from.side

// A shape in the tunnel takes the zone band it stands in, as it does when dropped in the
// editor. Beside the tunnel it keeps the zone it has.
const zoneFor = (i: TunnelItem, x: number, zones: TunnelZone[]) => (i.side === 'outside' ? i.zone : zoneAt(zones, x) ?? i.zone)

const feet = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const asSpot = (v: unknown): Spot | null => {
  const s = v as Partial<Spot> | null | undefined
  return s && feet(s.x_ft) && feet(s.y_ft) && typeof s.side === 'string' ? { x_ft: s.x_ft, y_ft: s.y_ft, side: s.side } : null
}

// A draft read back from sessionStorage. A move with no from can't be checked against
// later changes, so a draft holding one is not used.
function asMoves(v: unknown): Moves | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Moves = {}
  for (const [id, m] of Object.entries(v as Record<string, Partial<Move> | null>)) {
    const from = asSpot(m?.from)
    if (!m || !feet(m.x_ft) || !feet(m.y_ft) || !from) return null
    const sent = asSpot(m.sent)
    out[id] = {
      x_ft: m.x_ft, y_ft: m.y_ft, zone: typeof m.zone === 'string' ? m.zone : null, name: typeof m.name === 'string' ? m.name : 'A machine',
      from, ...(sent ? { sent } : {}),
    }
  }
  return out
}

function read(key: string | null): Draft {
  const empty: Draft = { key, moves: NONE, past: [] }
  if (!key) return empty
  try {
    const raw = sessionStorage.getItem(STORE + key)
    if (!raw) return empty
    const v = JSON.parse(raw) as { moves?: unknown; past?: unknown }
    const moves = asMoves(v.moves)
    if (!moves || Object.keys(moves).length === 0) return empty
    const past = Array.isArray(v.past) ? v.past.map(asMoves).filter((m): m is Moves => !!m) : []
    return { key, moves, past }
  } catch {
    return empty
  }
}

function write(d: Draft) {
  if (!d.key) return
  try {
    if (Object.keys(d.moves).length === 0) sessionStorage.removeItem(STORE + d.key)
    else sessionStorage.setItem(STORE + d.key, JSON.stringify({ moves: d.moves, past: d.past.slice(-30) }))
  } catch { /* private mode, or full */ }
}

// The moves that still mean something on the drawing as it is now. One that lands where
// the shape is already saved is no move (which is also how a save clears them: the reload
// puts every shape where it was moved to). A move whose shape is gone, or was moved by
// someone else since (its x, y or side is no longer what the move started from), is
// dropped and named: putting it back would quietly undo their change, or write a stale y
// or side over it. A shape this person's own save moved stands where the save put it once
// the drawing shows it there (the move then starts from that spot). Until then (flying:
// shapes in a save not answered yet; sent: answered, not reloaded) the drawing's spot for
// it is about to change, so its move is kept as it is, even on that spot.
// Returns the same object when nothing changed.
function settle(moves: Moves, items: TunnelItem[], zones: TunnelZone[], flying: ReadonlySet<string> | null): Settled {
  const byId = new Map(items.map((i) => [i.id, i]))
  const gone: string[] = []
  const changed: string[] = []
  let out: Moves | null = null
  for (const [id, m] of Object.entries(moves)) {
    const i = byId.get(id)
    const landed = i && m.sent && unmoved(i, m.sent) ? m.sent : null
    const waiting = !!i && !landed && (!!m.sent || !!flying?.has(id)) && unmoved(i, m.from)
    const keep = !!i && (waiting || (unmoved(i, landed ?? m.from) && !at(i, m)))
    const zone = i ? zoneFor(i, m.x_ft, zones) : m.zone
    if (keep && zone === m.zone && !landed) continue
    out ??= { ...moves }
    if (keep) out[id] = landed ? { x_ft: m.x_ft, y_ft: m.y_ft, zone, name: m.name, from: landed } : { ...m, zone }
    else {
      delete out[id]
      if (!i) gone.push(m.name)
      else if (!at(i, m)) changed.push(m.name)
    }
  }
  return { moves: out ?? moves, gone, changed }
}

type Settled = { moves: Moves; gone: string[]; changed: string[] }
const SETTLED: Settled = { moves: NONE, gone: [], changed: [] }
const add = (names: string[]) => (was: string[]) => [...new Set([...was, ...names])]

// A save went through: each move still held on a shape it sent learns where it put it.
function sentTo(moves: Moves, spots: Record<string, Spot>): Moves {
  let out: Moves | null = null
  for (const [id, m] of Object.entries(moves)) {
    if (!spots[id]) continue
    out ??= { ...moves }
    out[id] = { ...m, sent: spots[id] }
  }
  return out ?? moves
}

type Args = {
  // The drawing as last loaded (null: none yet, or the site has no drawing).
  layout: TunnelLayout | null
  items: TunnelItem[]
  // Load the drawing again. Must not throw.
  reload: () => Promise<void>
  // Whose moves these are: the signed-in person, and only when they can save the drawing.
  // null holds no moves at all, so someone who can't save never sees a draft (on a shared
  // tab, the last person's), its bar or its leave warnings.
  owner: string | null
}

export function useTunnelMoves({ layout, items: server, reload, owner }: Args) {
  const key = owner && layout ? `${owner}:${layout.id}` : null
  const zones = layout?.zones
  // What this person left unsaved on this drawing in this tab. Read as the drawing
  // arrives, not an effect later: whatever draws it first (the editor keeps what it was
  // first given) must already see the moves.
  const stored = useMemo(() => read(key), [key])
  const [held, setDraft] = useState<Draft>(stored)
  const [saving, setSaving] = useState(false)
  // The shapes whose moves the save on its way is writing.
  const [flying, setFlying] = useState<ReadonlySet<string> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [gone, setGone] = useState<string[]>([])
  const [changed, setChanged] = useState<string[]>([])

  // Another site, tunnel or person: its own draft, and nothing left over from the last one.
  useEffect(() => {
    setDraft(stored)
    setError(null)
    setConflict(false)
    setGone([])
    setChanged([])
  }, [stored])
  // Until that effect has run, the draft held is still the last drawing's.
  const draft = held.key === key ? held : stored

  const live = useMemo(() => (key ? settle(draft.moves, server, zones ?? [], flying) : SETTLED), [key, draft, server, zones, flying])

  useEffect(() => {
    if (held !== draft || live.moves === draft.moves) return
    setDraft((d) => (d === draft ? { ...d, moves: live.moves } : d))
    if (live.gone.length) setGone(add(live.gone))
    if (live.changed.length) setChanged(add(live.changed))
  }, [held, draft, live])

  useEffect(() => { write(held) }, [held])

  const items = useMemo(() => {
    const m = live.moves
    if (Object.keys(m).length === 0) return server
    return server.map((i) => (m[i.id] ? { ...i, x_ft: m[i.id].x_ft, y_ft: m[i.id].y_ft, zone: m[i.id].zone } : i))
  }, [server, live])

  // Where each moved shape is saved, so the 3D view can leave an outline there.
  const saved = useMemo(() => {
    const out: Record<string, { x_ft: number; y_ft: number }> = {}
    for (const i of server) if (live.moves[i.id]) out[i.id] = { x_ft: Number(i.x_ft), y_ft: Number(i.y_ft) }
    return out
  }, [server, live])

  const count = Object.keys(live.moves).length

  const move = useCallback((id: string, x_ft: number, y_ft: number) => {
    const i = server.find((s) => s.id === id)
    if (!key || !i || !Number.isFinite(x_ft) || !Number.isFinite(y_ft)) return
    setDraft((d) => {
      if (d.key !== key) return d
      const was = d.moves[id]
      // Back on its saved spot: that isn't a move anymore. Unless a save of the shape hasn't
      // reached the drawing yet: that spot is about to change, so it stays a move (settle
      // keeps it until the drawing shows where the save put the shape, or the save fails).
      const home = !flying?.has(id) && !(was?.sent && !unmoved(i, was.sent)) && at(i, { x_ft, y_ft })
      if (home ? !was : was && same(was.x_ft, x_ft) && same(was.y_ft, y_ft)) return d
      const moves = { ...d.moves }
      if (home) delete moves[id]
      else {
        // A later move of the same shape still starts from where it stood when first
        // moved, and keeps where a save put it; one left over from before someone else
        // moved it (settle drops those) starts again from where it stands now.
        const kept = was && unmoved(i, was.from) ? was : null
        moves[id] = {
          x_ft, y_ft, zone: zoneFor(i, x_ft, zones ?? []), name: i.label || shapeFor(i.kind).label,
          from: kept?.from ?? spotOf(i), ...(kept?.sent ? { sent: kept.sent } : {}),
        }
      }
      return { key, moves, past: [...d.past, d.moves].slice(-UNDO_LIMIT) }
    })
    setError(null)
  }, [key, server, zones, flying])

  // Not while saving (the bar's Undo is off then too): it would step back past moves the
  // save is already writing, and they would come back with the reload.
  const undo = useCallback(() => {
    if (saving) return
    setDraft((d) => (d.past.length ? { key: d.key, moves: d.past[d.past.length - 1], past: d.past.slice(0, -1) } : d))
  }, [saving])

  const dismiss = useCallback(() => {
    setError(null)
    setConflict(false)
    setGone([])
    setChanged([])
  }, [])

  // Put every machine back where it is saved. Undo still steps back from this.
  const reset = useCallback(() => {
    setDraft((d) => (Object.keys(d.moves).length ? { key: d.key, moves: NONE, past: [...d.past, d.moves].slice(-UNDO_LIMIT) } : d))
    dismiss()
  }, [dismiss])

  // Forget the moves and their history (the site changed, or the editor saved over them).
  const clear = useCallback(() => {
    setDraft((d) => ({ key: d.key, moves: NONE, past: [] }))
    dismiss()
  }, [dismiss])

  const save = useCallback(async () => {
    if (!layout || saving || count === 0) return
    // Where this save puts each moved shape.
    const spots: Record<string, Spot> = {}
    for (const i of items) if (live.moves[i.id]) spots[i.id] = spotOf(i)
    setSaving(true)
    setFlying(new Set(Object.keys(spots)))
    setError(null)
    try {
      // The editor's payload: the whole drawing, shapes numbered in the order they came.
      await miTunnel.save({
        id: layout.id, version: layout.version, name: layout.name, length_ft: Number(layout.length_ft), width_ft: Number(layout.width_ft), zones: layout.zones ?? [],
        items: items.map((i, k) => ({ ...i, sort_order: k })),
      })
      // A machine moved again while the save was on its way stays moved, now measured from
      // where the save put it.
      setDraft((d) => (d.key === key ? { ...d, moves: sentTo(d.moves, spots), past: [] } : d))
      setFlying(null)
      setConflict(false)
      setGone([])
      setChanged([])
      // The fresh drawing has every shape where it was moved to, which settles the moves.
      await reload()
    } catch (e) {
      setFlying(null)
      const m = errText(e)
      if (/Someone else changed/.test(m)) {
        // Their version comes in underneath; the moves stay on top of it for another go,
        // except those on shapes they moved too (settle drops and names them).
        setConflict(true)
        await reload()
      } else {
        // A later failure is the news now, not the conflict before it.
        setConflict(false)
        setError(m)
      }
    } finally {
      setSaving(false)
    }
  }, [layout, key, saving, count, items, live, reload])

  return {
    // The drawing with the moves applied: what every view draws.
    items, saved, count,
    canUndo: draft.past.length > 0,
    move, undo, reset, clear, save, saving,
    // error: why the last save failed. conflict: it failed because someone else saved
    // first. gone: moved shapes that are no longer on the drawing. changed: moved shapes
    // someone else has moved since, whose moves were dropped.
    error, conflict, gone, changed, dismiss,
  }
}

export type TunnelMoves = ReturnType<typeof useTunnelMoves>
