import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, PackageMinus, Plus, Printer, Trash2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type AssetDetail, type AssetRow, type PartListRow } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { useMi } from './context'
import { day, errText, money, qty } from './format'
import { LabelsDialog, type LabelItem } from './LabelsDialog'
import { Card, ErrorNote, Loading, Muted, SearchBox, useDebounced } from './ui'

const BASE = '/app/maintenance-inventory'
const STORE_KEY = 'mi.assets.site'

export default function AssetsTab() {
  const { id } = useParams()
  return id ? <AssetPage id={id} /> : <AssetList />
}

function AssetList() {
  const { refs } = useMi()
  const [site, setSite] = useState(() => {
    const saved = localStorage.getItem(STORE_KEY)
    return saved && refs.sites.some((s) => s.id === saved) ? saved : refs.sites[0]?.id ?? ''
  })
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<AssetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)

  const load = useCallback(async () => {
    if (!site) return
    try {
      setRows(await mi.assets(site, dq))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [site, dq])
  useEffect(() => { void load() }, [load])

  const siteName = refs.sites.find((s) => s.id === site)?.name
  // Parents first, each followed by its components, grouped under the area.
  const tree = useMemo(() => {
    if (!rows) return []
    const ids = new Set(rows.map((r) => r.id))
    const kids = new Map<string, AssetRow[]>()
    for (const r of rows) if (r.parent_id && ids.has(r.parent_id)) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r])
    const out: Array<{ row: AssetRow; depth: number }> = []
    const walk = (r: AssetRow, depth: number) => {
      out.push({ row: r, depth })
      for (const k of kids.get(r.id) ?? []) walk(k, depth + 1)
    }
    for (const r of rows) if (!r.parent_id || !ids.has(r.parent_id)) walk(r, 0)
    return out
  }, [rows])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => { setSite(e.target.value); localStorage.setItem(STORE_KEY, e.target.value) }} className="w-full sm:w-48">
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <SearchBox value={q} onChange={setQ} placeholder="Search this site's equipment" className="min-w-[200px] flex-1" />
        {rows && rows.length > 0 && (
          <Button variant="secondary" onClick={() => setLabels(rows.map((r) => ({ type: 'asset', id: r.id, name: r.name, site: siteName })))}><Printer className="size-4" /> Labels ({rows.length})</Button>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No equipment matches.</Muted>}
      {tree.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {tree.map(({ row: r, depth }) => (
            <li key={r.id}>
              <Link to={`${BASE}/assets/${r.id}`} className="flex min-h-12 items-center gap-2 px-3 py-2 hover:bg-content" style={{ paddingLeft: 12 + Math.min(depth, 3) * 16 }}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{r.name}</div>
                  {r.area_name && <p className="truncate text-xs text-ink-muted">{r.area_name}</p>}
                </div>
                {r.crit_class && <Badge tone={r.crit_class === 'A' ? 'danger' : 'neutral'}>{r.crit_class}</Badge>}
                {r.bom_lines > 0 && <span className="shrink-0 text-xs text-ink-subtle">{r.bom_lines} parts</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} />}
    </div>
  )
}

function AssetPage({ id }: { id: string }) {
  const { refs, notify, openScan, accountId, me } = useMi()
  const [d, setD] = useState<AssetDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [addingPart, setAddingPart] = useState(false)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await mi.assetDetail(id))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  if (d.hidden) return <Muted>{d.message}</Muted>
  const a = d.asset

  const openWo = async () => {
    try {
      const w = await mi.createWorkOrder({ site: a.location_id, title: `Work on ${a.name}`, asset: a.id, parts: d.bom.map((b) => ({ part_id: b.part_id, qty: Number(b.qty_per) })) })
      notify(`Work order #${w.number} opened.`)
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/assets`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Assets</Link>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{a.name}</h1>
          {a.crit_class && <Badge tone={a.crit_class === 'A' ? 'danger' : 'neutral'}>Criticality {a.crit_class}</Badge>}
        </div>
        <p className="text-sm text-ink-muted">{[a.site_name, a.area_name, a.parent_name && `Part of ${a.parent_name}`].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={() => { primeScanSound(); openScan({ asset: { id: a.id, name: a.name, site_id: a.location_id } }) }}><PackageMinus className="size-5" /> Consume a part</Button>
        <Button variant="secondary" size="lg" onClick={() => void openWo()}>Open a work order</Button>
        <Button variant="secondary" size="lg" onClick={() => setLabels([{ type: 'asset', id: a.id, name: a.name, site: a.site_name }])}><Printer className="size-4" /> Label</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Details" actions={a.can_manage ? <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button> : undefined}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-muted">Tag</dt><dd className="font-mono text-ink">{a.tag ?? 'Not printed yet'}</dd>
            <dt className="text-ink-muted">Make and model</dt><dd className="text-ink">{[a.manufacturer, a.model].filter(Boolean).join(' ') || '-'}</dd>
            <dt className="text-ink-muted">Serial</dt><dd className="text-ink">{a.serial_number || '-'}</dd>
            <dt className="text-ink-muted">Installed</dt><dd className="text-ink">{day(a.install_date ?? a.purchase_date)}</dd>
            <dt className="text-ink-muted">Warranty until</dt><dd className="text-ink">{day(a.warranty_expiry)}</dd>
            <dt className="text-ink-muted">Vendor</dt><dd className="text-ink">{a.vendor_name || '-'}</dd>
            <dt className="text-ink-muted">Status</dt><dd className="text-ink">{a.status.replace(/_/g, ' ')}</dd>
            <dt className="text-ink-muted">Parts cost to date</dt><dd className="font-medium text-ink">{money(d.parts_cost)}</dd>
          </dl>
          {d.children.length > 0 && (
            <div className="mt-3 border-t border-border pt-2">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Components</p>
              {d.children.map((c) => <Link key={c.id} to={`${BASE}/assets/${c.id}`} className="block truncate py-1 text-sm text-accent hover:underline">{c.name}</Link>)}
            </div>
          )}
        </Card>

        <Card title="Parts it takes" actions={a.can_manage ? <Button size="sm" variant="secondary" onClick={() => setAddingPart(true)}><Plus className="size-4" /> Add</Button> : undefined}>
          {d.bom.length === 0 ? <Muted>None listed yet. Listing them lets a failed check suggest the right parts.</Muted> : d.bom.map((b) => (
            <div key={b.part_id} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <Link to={`${BASE}/parts/${b.part_id}`} className="min-w-0 flex-1 truncate text-accent hover:underline">{b.part_name}</Link>
              <span className="shrink-0 tabular-nums text-ink-muted">x{qty(b.qty_per)}, <span className={Number(b.on_hand_at_site) < Number(b.qty_per) ? 'text-danger' : ''}>{qty(b.on_hand_at_site)} here</span></span>
              {a.can_manage && (
                <Button variant="ghost" size="icon" aria-label={`Remove ${b.part_name}`} onClick={() => { void mi.setBomLine(a.id, b.part_id, 0).then(load).catch((e) => notify(errText(e), 'danger')) }}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </Card>

        <Card title="Open work orders">
          {d.open_work_orders.length === 0 ? <Muted>None.</Muted> : d.open_work_orders.map((w) => (
            <Link key={w.id} to={`${BASE}/work-orders/${w.id}`} className="block truncate border-t border-border py-2 text-sm text-accent first:border-t-0 hover:underline">#{w.number} {w.title}</Link>
          ))}
        </Card>

        <Card title="Service history">
          {d.service_history.length === 0 ? <Muted>Nothing finished yet.</Muted> : d.service_history.map((w) => (
            <div key={w.id} className="flex justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="min-w-0 truncate text-ink">#{w.number} {w.title}</span>
              <span className="shrink-0 text-xs text-ink-subtle">{day(w.completed_at ?? w.created_at)}</span>
            </div>
          ))}
        </Card>

        <Card title="Parts used" className="lg:col-span-2">
          {d.parts_used.length === 0 ? <Muted>None recorded yet.</Muted> : d.parts_used.map((u, i) => (
            <div key={i} className="flex justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="min-w-0 truncate text-ink">{u.part_name} x{qty(u.qty)}</span>
              <span className="shrink-0 tabular-nums text-ink-muted">{money(u.cost)}, {day(u.created_at)}</span>
            </div>
          ))}
        </Card>
      </div>

      {editing && <AssetForm d={d} accountId={accountId} vendors={refs.vendors} canAddArea={me.rank >= 2} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load() }} />}
      {addingPart && <AddBomLine assetId={a.id} onClose={() => setAddingPart(false)} onSaved={() => { setAddingPart(false); void load() }} />}
      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} />}
    </div>
  )
}

function AssetForm({ d, accountId, vendors, canAddArea, onClose, onSaved }: { d: AssetDetail; accountId: string; vendors: Array<{ id: string; name: string }>; canAddArea: boolean; onClose: () => void; onSaved: () => void }) {
  const a = d.asset
  const [f, setF] = useState({
    area_id: a.area_id ?? '', vendor_id: a.vendor_id ?? '', install_date: a.install_date ?? '', warranty_expiry: a.warranty_expiry ?? '', crit_class: a.crit_class ?? '',
    manufacturer: a.manufacturer ?? '', model: a.model ?? '', serial_number: a.serial_number ?? '',
  })
  const [areas, setAreas] = useState<Array<{ id: string; name: string }>>([])
  const [newArea, setNewArea] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void mi.areas(a.location_id).then(setAreas).catch(() => {}) }, [a.location_id])
  const save = async () => {
    try {
      let area = f.area_id
      if (newArea.trim()) area = (await mi.addArea(accountId, a.location_id, newArea.trim())).id
      await mi.updateAsset(a.id, { ...f, area_id: area })
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title={`Edit ${a.name}`}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Area">
            {(id) => (
              <Select id={id} value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}>
                <option value="">None</option>
                {areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            )}
          </Field>
          {canAddArea && <Field label="Or a new area">{(id) => <Input id={id} value={newArea} onChange={(e) => setNewArea(e.target.value)} placeholder="Dryer Zone" />}</Field>}
          <Field label="Criticality">
            {(id) => (
              <Select id={id} value={f.crit_class} onChange={(e) => setF({ ...f, crit_class: e.target.value })}>
                <option value="">Not set</option>
                <option value="A">A: stops the site</option>
                <option value="B">B: slows it down</option>
                <option value="C">C: can wait</option>
              </Select>
            )}
          </Field>
          <Field label="Vendor">
            {(id) => (
              <Select id={id} value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
                <option value="">None</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Manufacturer">{(id) => <Input id={id} value={f.manufacturer} onChange={(e) => setF({ ...f, manufacturer: e.target.value })} />}</Field>
          <Field label="Model">{(id) => <Input id={id} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />}</Field>
          <Field label="Serial">{(id) => <Input id={id} value={f.serial_number} onChange={(e) => setF({ ...f, serial_number: e.target.value })} />}</Field>
          <Field label="Installed">{(id) => <Input id={id} type="date" value={f.install_date} onChange={(e) => setF({ ...f, install_date: e.target.value })} />}</Field>
          <Field label="Warranty until">{(id) => <Input id={id} type="date" value={f.warranty_expiry} onChange={(e) => setF({ ...f, warranty_expiry: e.target.value })} />}</Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function AddBomLine({ assetId, onClose, onSaved }: { assetId: string; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<PartListRow[]>([])
  const [count, setCount] = useState('1')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 15 }).then((r) => { if (alive) setRows(r.rows) })
    return () => { alive = false }
  }, [dq])
  const add = async (partId: string) => {
    try {
      await mi.setBomLine(assetId, partId, Number(count) || 1)
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="Add a part this takes">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Find a part" className="flex-1" />
          <Input aria-label="How many" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} className="w-20 text-center" />
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {dq.trim() && rows.map((r) => (
          <button key={r.id} type="button" onClick={() => void add(r.id)} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content">
            <span className="truncate text-ink">{r.name}</span>
            <span className="shrink-0 text-xs text-ink-subtle">{r.sku}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
