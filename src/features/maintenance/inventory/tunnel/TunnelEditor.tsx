import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useBlocker } from 'react-router-dom'
import { Copy, Loader2, Plus, Redo2, Save, Trash2, Undo2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type AssetRow } from '@/lib/queries/maintenanceInventory'
import { miTunnel, type TunnelAsset, type TunnelData, type TunnelItem, type TunnelLayout, type TunnelSide } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { errText } from '../format'
import { ErrorNote } from '../ui'
import { shortName } from '../equipment/format'
import { snap } from './geometry'
import { SHAPES, shapeFor, type ShapeDef } from './shapes'
import { TunnelDiagram } from './TunnelDiagram'
import { kindForType, tempId, useEditorState, zoneAt, type Draft } from './useEditorState'

// Edit a drawing: drag shapes (they snap to half a foot; hold Alt for finer), add them
// from the palette or from the site's machines that aren't on it yet, and set a shape's
// name, drawing, side, zone, size and machine on the right. Arrow keys nudge (Shift for
// 5 ft), Delete removes, Ctrl+Z undoes. A template links shapes by type instead of to
// machines. Desktop and tablet only: dragging small shapes with a thumb isn't worth it.

type Props = {
  layout: TunnelLayout
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
  unplaced?: TunnelData['unplaced']
  siteId?: string
  siteName?: string
  onClose: (saved: boolean) => void
}

const SIDES: Array<{ value: TunnelSide; label: string }> = [
  { value: 'ds', label: "Driver's side" },
  { value: 'ps', label: 'Passenger side' },
  { value: 'center', label: 'Middle' },
  { value: 'both', label: 'Wall to wall' },
  { value: 'outside', label: 'Beside the tunnel' },
]
const GROUPS: ShapeDef['group'][] = ['Tunnel', 'Brushes', 'Arches and applicators', 'Beside the tunnel', 'Other']

export function TunnelEditor({ layout, items, assets, unplaced = [], siteId, siteName, onClose }: Props) {
  const template = layout.is_template
  const ed = useEditorState({ length_ft: Number(layout.length_ft), width_ft: Number(layout.width_ft), zones: layout.zones ?? [], items })
  const { draft, patchItem, update, checkpoint } = ed
  const [name, setName] = useState(layout.name)
  const [sel, setSel] = useState<string | null>(null)
  const [siteRows, setSiteRows] = useState<AssetRow[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const shapes = useRef<SVGGElement>(null)
  const leaving = useRef(false)
  const dirty = ed.dirty || name !== layout.name

  useEffect(() => {
    if (!siteId) return
    let alive = true
    void mi.assets(siteId).then((r) => { if (alive) setSiteRows(r.filter((x) => x.status !== 'retired')) }).catch(() => {})
    return () => { alive = false }
  }, [siteId])

  // Names and statuses for shapes linked in this session, not just the ones loaded.
  const allAssets = useMemo(() => {
    const out: Record<string, TunnelAsset> = { ...assets }
    for (const r of siteRows) {
      if (!out[r.id]) out[r.id] = { id: r.id, name: r.name, type: r.type ?? undefined, status: r.status as TunnelAsset['status'], open_wos: 0, children: 0, parent_id: r.parent_id ?? undefined }
    }
    return out
  }, [assets, siteRows])
  const onDrawing = useMemo(() => new Set(draft.items.map((i) => i.asset_id).filter(Boolean) as string[]), [draft.items])
  const stillUnplaced = useMemo(() => {
    const top = siteRows.length ? siteRows.filter((r) => !r.parent_id) : unplaced.map((u) => ({ id: u.id, name: u.name, type: u.type }))
    return top.filter((r) => !onDrawing.has(r.id)).map((r) => ({ id: r.id, name: r.name, type: r.type ?? null }))
  }, [siteRows, unplaced, onDrawing])
  const zoneNames = useMemo(() => [...new Set([...draft.zones.map((z) => z.name), ...draft.items.map((i) => i.zone).filter(Boolean) as string[]])], [draft])

  // ---- leaving --------------------------------------------------------------------
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    dirty && !leaving.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const leave = useCallback((saved: boolean) => { leaving.current = true; onClose(saved) }, [onClose])

  // ---- editing ----------------------------------------------------------------------
  const selected = draft.items.find((i) => i.id === sel) ?? null
  const half = draft.width_ft / 2

  const add = (kind: string, extra: Partial<TunnelItem> = {}) => {
    const s = shapeFor(kind)
    const side = extra.side ?? s.side
    const x = snap(draft.length_ft / 2)
    const y = side === 'ds' ? -half + s.h / 2 + 1 : side === 'ps' ? half - s.h / 2 - 1 : side === 'outside' ? half + 14 : 0
    const item: TunnelItem = {
      id: tempId(), kind, label: '', x_ft: x, y_ft: y, w_ft: s.w, h_ft: side === 'both' ? draft.width_ft : s.h, rotation: 0, side,
      zone: side === 'outside' ? null : zoneAt(draft.zones, x), match_type: null, asset_id: null, sort_order: draft.items.length, props: {}, ...extra,
    }
    update((d) => ({ ...d, items: [...d.items, item] }))
    setSel(item.id)
  }
  const addMachine = (m: { id: string; name: string; type: string | null }) => {
    const kind = kindForType(m.type ?? m.name)
    add(kind, { asset_id: template ? null : m.id, match_type: m.type, label: shortName(m.type ?? m.name) })
  }
  const remove = (id: string) => { update((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) })); setSel(null) }
  const duplicate = (i: TunnelItem) => {
    const copy = { ...i, id: tempId(), x_ft: snap(Number(i.x_ft) + 4), asset_id: null, sort_order: draft.items.length }
    update((d) => ({ ...d, items: [...d.items, copy] }))
    setSel(copy.id)
  }

  const toFeet = (cx: number, cy: number) => {
    const m = shapes.current?.getScreenCTM()
    if (!m) return null
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }
  const onItemPointerDown = (e: ReactPointerEvent<SVGGElement>, item: TunnelItem) => {
    if (e.button !== 0) return
    e.preventDefault()
    setSel(item.id)
    const start = toFeet(e.clientX, e.clientY)
    if (!start) return
    const ox = Number(item.x_ft)
    const oy = Number(item.y_ft)
    let moved = false
    const move = (ev: PointerEvent) => {
      const p = toFeet(ev.clientX, ev.clientY)
      if (!p) return
      const dx = p.x - start.x
      const dy = p.y - start.y
      if (!moved) {
        if (Math.hypot(dx, dy) < 0.3) return
        moved = true
        checkpoint()
      }
      const step = ev.altKey ? 0.1 : 0.5
      patchItem(item.id, { x_ft: snap(ox + dx, step), y_ft: snap(oy + dy, step) }, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // Shapes in the tunnel take the zone band they were dropped in.
      if (moved) patchItem(item.id, (i) => (i.side === 'outside' ? {} : { zone: zoneAt(draft.zones, Number(i.x_ft)) ?? i.zone }), false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) ed.redo(); else ed.undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); ed.redo(); return }
      if (!selected) return
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(selected); return }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(selected.id); return }
      if (e.key === 'Escape') { setSel(null); return }
      const step = e.shiftKey ? 5 : 0.5
      const d = e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, -step] : e.key === 'ArrowDown' ? [0, step] : null
      if (!d) return
      e.preventDefault()
      patchItem(selected.id, (i) => ({ x_ft: snap(Number(i.x_ft) + d[0]), y_ft: snap(Number(i.y_ft) + d[1]) }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await miTunnel.save({
        id: layout.id, version: layout.version, name, length_ft: draft.length_ft, width_ft: draft.width_ft, zones: draft.zones,
        items: draft.items.map(({ id, ...rest }, k) => ({ ...(id.startsWith('new-') ? {} : { id }), ...rest, sort_order: k })),
      })
      leave(true)
    } catch (e) {
      const m = errText(e)
      setError(m)
      setConflict(/Someone else changed/.test(m))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{template ? 'Editing a template' : `Editing ${siteName ?? 'this site'}'s tunnel`}</div>
          {template ? <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Template name" className="mt-1 max-w-sm" /> : <div className="truncate text-lg font-semibold text-ink">{layout.name}</div>}
        </div>
        <Button size="sm" variant="ghost" onClick={ed.undo} disabled={!ed.canUndo} aria-label="Undo"><Undo2 className="size-4" /></Button>
        <Button size="sm" variant="ghost" onClick={ed.redo} disabled={!ed.canRedo} aria-label="Redo"><Redo2 className="size-4" /></Button>
        <Button variant="secondary" onClick={() => (dirty ? setConfirmLeave(true) : leave(false))} disabled={saving}><X className="size-4" /> Cancel</Button>
        <Button onClick={() => void save()} disabled={saving || !dirty}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
      </div>
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <ErrorNote>{error}</ErrorNote>
          {conflict && <Button size="sm" variant="secondary" onClick={() => leave(true)}>Reload, losing my changes</Button>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[210px_minmax(0,1fr)_280px]">
        <aside className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto rounded-md border border-border bg-card p-3">
          {!template && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Not on the drawing ({stillUnplaced.length})</h3>
              {stillUnplaced.length === 0 ? <p className="text-xs text-ink-muted">Every machine at this site is on it.</p> : (
                <div className="flex flex-col gap-1">
                  {stillUnplaced.map((m) => (
                    <button key={m.id} type="button" onClick={() => addMachine(m)} className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink hover:bg-content" title="Add it to the drawing">
                      <Plus className="size-3 shrink-0 text-accent" /> <span className="truncate">{shortName(m.name)}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {GROUPS.map((g) => (
            <section key={g}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{g}</h3>
              <div className="flex flex-col gap-1">
                {Object.entries(SHAPES).filter(([, s]) => s.group === g).map(([kind, s]) => (
                  <button key={kind} type="button" onClick={() => add(kind)} className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-ink hover:bg-content">
                    <Plus className="size-3 shrink-0 text-accent" /> {s.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <div className="min-w-0 rounded-md border border-border bg-card p-2">
          <TunnelDiagram layout={draft} items={draft.items} assets={allAssets} orientation="h" colorBy="status" editing
            selectedId={sel} onSelect={setSel} onItemPointerDown={onItemPointerDown} onBackgroundPointerDown={() => setSel(null)} shapesRef={shapes} />
          <p className="mt-2 border-t border-border pt-2 text-xs text-ink-muted">
            Drag to move. Arrow keys nudge half a foot (Shift: 5 ft). Delete removes, Ctrl+D copies, Ctrl+Z undoes.
          </p>
        </div>

        <aside className="max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-3">
          {selected ? (
            <Inspector key={selected.id} item={selected} template={template} zoneNames={zoneNames} siteRows={siteRows}
              onPatch={(p) => patchItem(selected.id, p)} onDelete={() => remove(selected.id)} onDuplicate={() => duplicate(selected)} />
          ) : (
            <DrawingSettings draft={draft} onChange={(fn) => update(fn)} />
          )}
        </aside>
      </div>

      <ConfirmDialog open={confirmLeave || blocker.state === 'blocked'} title="Leave without saving?" description="Your changes to this drawing will be lost."
        confirmLabel="Leave" destructive
        onCancel={() => { setConfirmLeave(false); if (blocker.state === 'blocked') blocker.reset() }}
        onConfirm={() => {
          setConfirmLeave(false)
          if (blocker.state === 'blocked') { leaving.current = true; blocker.proceed() } else leave(false)
        }} />
    </div>
  )
}

function Inspector({ item, template, zoneNames, siteRows, onPatch, onDelete, onDuplicate }: {
  item: TunnelItem; template: boolean; zoneNames: string[]; siteRows: AssetRow[]
  onPatch: (p: Partial<TunnelItem>) => void; onDelete: () => void; onDuplicate: () => void
}) {
  const s = shapeFor(item.kind)
  const num = (k: 'x_ft' | 'y_ft' | 'w_ft' | 'h_ft', label: string, min?: number) => (
    <Field label={label}>
      {(id) => <Input id={id} type="number" step={0.5} min={min} value={Number(item[k])} onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && (min == null || v >= min)) onPatch({ [k]: v }) }} />}
    </Field>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Selected shape</div>
      <Field label="Name on the drawing">{(id) => <Input id={id} value={item.label} onChange={(e) => onPatch({ label: e.target.value })} placeholder={s.label} />}</Field>
      <Field label="Drawing">
        {(id) => (
          <Select id={id} value={item.kind} onChange={(e) => onPatch({ kind: e.target.value })}>
            {GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {Object.entries(SHAPES).filter(([, x]) => x.group === g).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      {!s.scenery && (template ? (
        <Field label="Machine type" hint="At each site this links to the machine of this type.">
          {(id) => <Input id={id} value={item.match_type ?? ''} onChange={(e) => onPatch({ match_type: e.target.value || null })} placeholder="Top Brush 1" />}
        </Field>
      ) : (
        <Field label="Machine">
          {(id) => (
            <Select id={id} value={item.asset_id ?? ''} onChange={(e) => onPatch({ asset_id: e.target.value || null })}>
              <option value="">Not linked</option>
              <optgroup label="Machines">{siteRows.filter((r) => !r.parent_id).map((r) => <option key={r.id} value={r.id}>{shortName(r.name)}</option>)}</optgroup>
              <optgroup label="Components">{siteRows.filter((r) => r.parent_id).map((r) => <option key={r.id} value={r.id}>{shortName(r.name)}</option>)}</optgroup>
            </Select>
          )}
        </Field>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Side">
          {(id) => (
            <Select id={id} value={item.side} onChange={(e) => onPatch({ side: e.target.value as TunnelSide })}>
              {SIDES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Zone">
          {(id) => (
            <>
              <Input id={id} list="tunnel-zone-names" value={item.zone ?? ''} onChange={(e) => onPatch({ zone: e.target.value || null })} />
              <datalist id="tunnel-zone-names">{zoneNames.map((z) => <option key={z} value={z} />)}</datalist>
            </>
          )}
        </Field>
        {num('x_ft', 'Along (ft)')}
        {num('y_ft', 'Across (ft)')}
        {num('w_ft', 'Length (ft)', 0.5)}
        {num('h_ft', 'Width (ft)', 0.5)}
        <Field label="Turn">
          {(id) => (
            <Select id={id} value={String(item.rotation)} onChange={(e) => onPatch({ rotation: Number(e.target.value) as TunnelItem['rotation'] })}>
              {[0, 90, 180, 270].map((r) => <option key={r} value={r}>{r}°</option>)}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex gap-2 border-t border-border pt-3">
        <Button size="sm" variant="secondary" onClick={onDuplicate}><Copy className="size-3.5" /> Copy</Button>
        <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}><Trash2 className="size-3.5" /> Remove</Button>
      </div>
    </div>
  )
}

function DrawingSettings({ draft, onChange }: { draft: Draft; onChange: (fn: (d: Draft) => Draft) => void }) {
  const setZone = (k: number, patch: Partial<Draft['zones'][number]>) => onChange((d) => ({ ...d, zones: d.zones.map((z, i) => (i === k ? { ...z, ...patch } : z)) }))
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">The tunnel</div>
      <p className="text-xs text-ink-muted">Pick a shape to change it, or set the tunnel's size and zones here.</p>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Length (ft)">{(id) => <Input id={id} type="number" min={20} max={400} value={draft.length_ft} onChange={(e) => { const v = Number(e.target.value); if (v >= 20 && v <= 400) onChange((d) => ({ ...d, length_ft: v })) }} />}</Field>
        <Field label="Width (ft)">{(id) => <Input id={id} type="number" min={8} max={60} value={draft.width_ft} onChange={(e) => { const v = Number(e.target.value); if (v >= 8 && v <= 60) onChange((d) => ({ ...d, width_ft: v })) }} />}</Field>
      </div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Zones along the tunnel</div>
      {draft.zones.map((z, k) => (
        <div key={k} className={cn('grid grid-cols-[1fr_56px_56px_32px] items-center gap-1')}>
          <Input value={z.name} onChange={(e) => setZone(k, { name: e.target.value })} aria-label="Zone name" className="h-8 text-xs" />
          <Input type="number" value={Number(z.x_from)} onChange={(e) => setZone(k, { x_from: Number(e.target.value) })} aria-label="From (ft)" className="h-8 px-1 text-xs" />
          <Input type="number" value={Number(z.x_to)} onChange={(e) => setZone(k, { x_to: Number(e.target.value) })} aria-label="To (ft)" className="h-8 px-1 text-xs" />
          <button type="button" aria-label={`Remove ${z.name}`} onClick={() => onChange((d) => ({ ...d, zones: d.zones.filter((_, i) => i !== k) }))} className="grid size-8 place-items-center text-ink-subtle hover:text-danger"><Trash2 className="size-3.5" /></button>
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => onChange((d) => {
        const last = d.zones[d.zones.length - 1]
        const from = last ? Number(last.x_to) : 0
        return { ...d, zones: [...d.zones, { name: 'New zone', x_from: from, x_to: from + 10 }] }
      })}><Plus className="size-3.5" /> Add a zone</Button>
    </div>
  )
}
