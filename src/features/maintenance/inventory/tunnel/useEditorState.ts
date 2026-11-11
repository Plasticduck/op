import { useCallback, useReducer } from 'react'
import type { TunnelItem, TunnelZone } from '@/lib/queries/miTunnel'

// The drawing being edited, with undo and redo. A drag records one step when it starts
// and then moves without recording, so undo takes back the whole drag. Changes are
// worked out from the latest draft inside the reducer, so quick pointer moves never
// build on a stale copy.

export type Draft = { length_ft: number; width_ft: number; zones: TunnelZone[]; items: TunnelItem[] }

type State = { draft: Draft; past: Draft[]; future: Draft[]; dirty: boolean }
type Action =
  | { t: 'checkpoint' }
  | { t: 'apply'; fn: (d: Draft) => Draft; record: boolean }
  | { t: 'undo' }
  | { t: 'redo' }

const LIMIT = 100

function reduce(s: State, a: Action): State {
  switch (a.t) {
    case 'checkpoint':
      return { ...s, past: [...s.past, s.draft].slice(-LIMIT), future: [] }
    case 'apply': {
      const draft = a.fn(s.draft)
      if (draft === s.draft) return s
      return a.record
        ? { draft, past: [...s.past, s.draft].slice(-LIMIT), future: [], dirty: true }
        : { ...s, draft, dirty: true }
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1]
      if (!prev) return s
      return { draft: prev, past: s.past.slice(0, -1), future: [s.draft, ...s.future], dirty: true }
    }
    case 'redo': {
      const next = s.future[0]
      if (!next) return s
      return { draft: next, past: [...s.past, s.draft], future: s.future.slice(1), dirty: true }
    }
  }
}

export function useEditorState(initial: Draft) {
  const [s, dispatch] = useReducer(reduce, { draft: initial, past: [], future: [], dirty: false })
  const update = useCallback((fn: (d: Draft) => Draft, record = true) => dispatch({ t: 'apply', fn, record }), [])
  const patchItem = useCallback((id: string, patch: Partial<TunnelItem> | ((i: TunnelItem) => Partial<TunnelItem>), record = true) =>
    dispatch({ t: 'apply', record, fn: (d) => ({ ...d, items: d.items.map((i) => (i.id === id ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)) }) }), [])
  return {
    draft: s.draft,
    dirty: s.dirty,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    update,
    patchItem,
    checkpoint: useCallback(() => dispatch({ t: 'checkpoint' }), []),
    undo: useCallback(() => dispatch({ t: 'undo' }), []),
    redo: useCallback(() => dispatch({ t: 'redo' }), []),
  }
}

let seq = 0
export const tempId = () => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`

// Which zone band a point along the tunnel falls in.
export function zoneAt(zones: TunnelZone[], x: number): string | null {
  return zones.find((z) => x >= Number(z.x_from) && x < Number(z.x_to))?.name ?? null
}

// A sensible drawing for a machine from its MaintainX type.
export function kindForType(type: string | null | undefined): string {
  const s = (type ?? '').toLowerCase()
  if (/wrap/.test(s)) return 'wrap'
  if (/top brush/.test(s)) return 'top_brush'
  if (/wheel/.test(s)) return 'wheel_brush'
  if (/short brush/.test(s)) return 'short_brush'
  if (/gloss|van high|side brush|mitter|rocker/.test(s)) return 'side_brush'
  if (/blower|dryer/.test(s)) return 'blower'
  if (/blaster/.test(s)) return 'blaster'
  if (/tire shine/.test(s)) return 'tire_shine'
  if (/rinse|arch|foam|wax|presoak|sealant|ceramic/.test(s)) return 'arch'
  if (/roller up/.test(s)) return 'roller_up'
  if (/roller down/.test(s)) return 'roller_down'
  if (/chain|conveyor/.test(s)) return 'conveyor'
  if (/eye/.test(s)) return 'photo_eye'
  if (/sensor/.test(s)) return 'sensor'
  if (/vac/.test(s)) return 'vacuum'
  if (/prep/.test(s)) return 'prep_unit'
  return 'equipment'
}
