import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, PackageMinus, Plus } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type PartListRow, type StockRow, type WoDetail, type WoRow } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { useMi } from './context'
import { errText, money, qty } from './format'
import { act } from './offline'
import { ConsumePanel, TransferRequestPanel } from './StockActions'
import { Card, Chips, ErrorNote, Loading, Muted, SearchBox, Stepper, useDebounced } from './ui'

// A view of Operator's work orders from the parts side: the same work_orders rows the
// Work Orders pages show, plus planning and issuing parts. Everything else about a work
// order stays on those pages.

const BASE = '/app/maintenance-inventory'

export default function WorkOrdersTab() {
  const { id } = useParams()
  return id ? <WoPage id={id} /> : <WoList />
}

function WoList() {
  const { refs } = useMi()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [status, setStatus] = useState<'open' | 'done'>('open')
  const [site, setSite] = useState('')
  const [rows, setRows] = useState<WoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    let alive = true
    mi.workOrders({ site: site || null, q: dq, status }).then((r) => { if (alive) { setRows(r); setError(null) } }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [site, dq, status])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search work orders" className="min-w-[200px] flex-1" />
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-40">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New</Button>
      </div>
      <Chips value={status} onChange={setStatus} options={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Done' }]} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No work orders match.</Muted>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((w) => (
            <li key={w.id}>
              <Link to={`${BASE}/work-orders/${w.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-content">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">#{w.number} {w.title}</div>
                  <p className="truncate text-xs text-ink-muted">{w.site_name}{w.asset_name ? `, ${w.asset_name}` : ''}</p>
                </div>
                {w.priority === 'high' && <Badge tone="danger">High</Badge>}
                {w.parts_lines > 0 && <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{money(w.parts_cost)}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <NewWo onClose={() => setAdding(false)} onCreated={(wid) => { setAdding(false); navigate(`${BASE}/work-orders/${wid}`) }} />}
    </div>
  )
}

function NewWo({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { refs } = useMi()
  const [site, setSite] = useState(refs.sites[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('medium')
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    try {
      onCreated((await mi.createWorkOrder({ site, title, priority })).id)
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="New work order">
      <div className="flex flex-col gap-3">
        <Field label="What needs doing" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Site">
            {(id) => <Select id={id} value={site} onChange={(e) => setSite(e.target.value)}>{refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          </Field>
          <Field label="Priority">
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            )}
          </Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!title.trim() || !site} onClick={() => void create()}>Create</Button></div>
      </div>
    </Modal>
  )
}

function WoPage({ id }: { id: string }) {
  const { openScan, notify } = useMi()
  const [d, setD] = useState<WoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState<{ partId: string; partName: string } | null | 'search'>(null)

  const load = useCallback(async () => {
    try {
      setD(await mi.workOrderDetail(id))
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
  const w = d.work_order
  const scanContext = {
    workOrder: { id: w.id, number: w.number, title: w.title, site_id: w.location_id },
    asset: w.equipment_id ? { id: w.equipment_id, name: w.asset_name ?? '', site_id: w.location_id } : null,
  }
  const open = ['open', 'in_progress', 'on_hold'].includes(w.status)
  const unreserve = async (partId: string, location: string, amount: number) => {
    try {
      const res = await act('mi_reserve_parts', { p_work_order: w.id, p_part: partId, p_location: location, p_qty: -amount }, 'Released reservation')
      notify(res.queued ? 'Saved on this phone.' : 'Released.')
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/work-orders`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Work orders</Link>
      <div>
        <h1 className="text-xl font-semibold text-ink">#{w.number} {w.title}</h1>
        <p className="text-sm text-ink-muted">{w.site_name}{w.asset_name ? `, ${w.asset_name}` : ''}. {w.status.replace(/_/g, ' ')}, {w.priority} priority.</p>
        {w.description && <p className="mt-1 whitespace-pre-line text-sm text-ink">{w.description}</p>}
        <Link to={`/app/work-orders/${w.id}`} className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"><ExternalLink className="size-3.5" /> Full work order</Link>
      </div>

      {open && (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" onClick={() => { primeScanSound(); openScan(scanContext) }}><PackageMinus className="size-5" /> Scan a part</Button>
          <Button size="lg" variant="secondary" onClick={() => setPicking('search')}><Plus className="size-5" /> Add parts</Button>
        </div>
      )}

      <Card title={`Parts (${money(d.parts_cost)})`}>
        {d.parts.length === 0 ? <Muted>None yet.</Muted> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.parts.map((p) => {
              const reserved = Number(p.qty_planned) - Number(p.qty_issued) + Number(p.qty_returned)
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{p.part_name}</div>
                    <p className="text-xs text-ink-muted">
                      {Number(p.qty_planned) === 0 && Number(p.qty_issued) === 0
                        ? 'Suggested'
                        : `${Number(p.qty_planned) > 0 ? `Planned ${qty(p.qty_planned)}. ` : ''}Used ${qty(p.quantity)}${Number(p.qty_returned) > 0 ? ` (${qty(p.qty_returned)} returned)` : ''}${p.location_name ? `, ${p.location_name}` : ''}`}
                    </p>
                  </div>
                  <span className="tabular-nums text-ink">{money(p.cost)}</span>
                  {open && p.part_id && <Button size="sm" variant="secondary" onClick={() => setPicking({ partId: p.part_id as string, partName: p.part_name })}>{Number(p.qty_issued) > 0 ? 'Use more' : 'Add'}</Button>}
                  {open && p.part_id && p.location_id && reserved > 0 && <Button size="sm" variant="ghost" onClick={() => void unreserve(p.part_id as string, p.location_id as string, reserved)}>Release {qty(reserved)}</Button>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {d.bom.length > 0 && open && (
        <Card title="Suggested from the asset's parts list">
          {d.bom.map((b) => (
            <div key={b.part_id} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="truncate text-ink">{b.part_name} x{qty(b.qty_per)}</span>
              <Button size="sm" variant="secondary" onClick={() => setPicking({ partId: b.part_id, partName: b.part_name })}>Add</Button>
            </div>
          ))}
        </Card>
      )}

      {picking && (
        <AddPartDialog
          siteId={w.location_id}
          workOrderId={w.id}
          scanContext={scanContext}
          start={picking === 'search' ? null : picking}
          onClose={() => setPicking(null)}
          onDone={(m) => { setPicking(null); notify(m); void load() }}
        />
      )}
    </div>
  )
}

// Find a part, see where it's stocked for this site, then use it now or set it aside.
function AddPartDialog({ siteId, workOrderId, scanContext, start, onClose, onDone }: {
  siteId: string
  workOrderId: string
  scanContext: Parameters<typeof ConsumePanel>[0]['context']
  start: { partId: string; partName: string } | null
  onClose: () => void
  onDone: (m: string) => void
}) {
  const [part, setPart] = useState(start)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [found, setFound] = useState<PartListRow[]>([])
  const [stock, setStock] = useState<StockRow[] | null>(null)
  const [row, setRow] = useState<StockRow | null>(null)
  const [mode, setMode] = useState<'use' | 'plan' | 'transfer'>('use')
  const [planQty, setPlanQty] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (part || !dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 15 }).then((r) => { if (alive) setFound(r.rows) })
    return () => { alive = false }
  }, [dq, part])

  useEffect(() => {
    if (!part) return
    let alive = true
    void mi.partStockForSite(part.partId, siteId).then((s) => {
      if (!alive) return
      setStock(s)
      setRow(s[0] ?? null)
    }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [part, siteId])

  const plan = async () => {
    if (!row) return
    try {
      const res = await act('mi_reserve_parts', { p_work_order: workOrderId, p_part: row.part_id, p_location: row.location_id, p_qty: planQty }, `Reserved ${qty(planQty)} ${row.part_name}`)
      onDone(res.queued ? 'Saved on this phone.' : `Set aside ${qty(planQty)} ${row.part_name}.`)
    } catch (e) {
      setError(errText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title={part ? part.partName : 'Add parts'}>
      <div className="flex flex-col gap-3">
        {!part && (
          <>
            <SearchBox value={q} onChange={setQ} placeholder="Find a part" />
            {dq.trim() && found.map((r) => (
              <button key={r.id} type="button" onClick={() => setPart({ partId: r.id, partName: r.name })} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content">
                <span className="truncate text-ink">{r.name}</span>
                <span className="shrink-0 text-xs text-ink-subtle">{qty(r.available)} free</span>
              </button>
            ))}
          </>
        )}
        {part && !stock && !error && <Loading />}
        {error && <ErrorNote>{error}</ErrorNote>}
        {part && stock && stock.length === 0 && <Muted>Not stocked at this site or on your truck. Ask for it from Parts, or order it.</Muted>}
        {part && row && stock && (
          <>
            {stock.length > 1 && (
              <Select aria-label="From" value={row.location_id} onChange={(e) => setRow(stock.find((s) => s.location_id === e.target.value) ?? null)}>
                {stock.map((s) => <option key={s.location_id} value={s.location_id}>{s.location_name}: {qty(s.available)} free</option>)}
              </Select>
            )}
            <Chips value={mode} onChange={setMode} options={[{ value: 'use', label: 'Use now' }, { value: 'plan', label: 'Set aside' }, { value: 'transfer', label: 'Request' }]} />
            {mode === 'use' && <ConsumePanel stock={row} context={scanContext} onDone={onDone} onTransfer={() => setMode('transfer')} />}
            {mode === 'plan' && (
              <div className="flex flex-col gap-3">
                <Muted>Sets stock aside for this job, so another one can't take it. {qty(row.available)} free at {row.location_name}.</Muted>
                <Stepper value={planQty} onChange={setPlanQty} min={1} />
                <Button size="lg" onClick={() => void plan()}>Set aside {qty(planQty)}</Button>
              </div>
            )}
            {mode === 'transfer' && <TransferRequestPanel stock={row} onDone={onDone} />}
          </>
        )}
      </div>
    </Modal>
  )
}
