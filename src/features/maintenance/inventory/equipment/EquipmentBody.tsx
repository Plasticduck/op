/* eslint-disable react-refresh/only-export-components -- the detail hook lives with the views it feeds */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, ChevronRight, History, NotebookPen, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Row, Section } from '@/features/it/inventory/DetailParts'
import { mi, type PartListRow } from '@/lib/queries/maintenanceInventory'
import { ml, type ScheduleRow } from '@/lib/queries/maintenanceLog'
import { miEquipment, type EquipmentDetail } from '@/lib/queries/miEquipment'
import { dueText, STATUS as SCHEDULE_STATUS } from '../../log/labels'
import { useMi } from '../context'
import { day, errText, money, qty } from '../format'
import { ErrorNote, Loading, Muted, SearchBox, useDebounced } from '../ui'
import { CRIT, EQUIPMENT_BASE, shortName, STATUS, USAGE_BASIS, warrantyState } from './format'

const ScheduleForm = lazy(() => import('../../log/ScheduleForm'))
const LOG = '/app/maintenance-log'
const INV = '/app/maintenance-inventory'

// One machine's detail, loaded once and refreshed when anything in the module changes.
export function useEquipmentDetail(id: string) {
  const [d, setD] = useState<(EquipmentDetail & { hidden?: boolean; message?: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setD(await miEquipment.detail(id))
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
  return { d, error, reload: load }
}

// Where it is, what it is, its maintenance, work orders and components. Shared by the
// machine's page and the tunnel diagram's side panel.
export function EquipmentOverview({ d, reload, compact }: { d: EquipmentDetail; reload: () => void; compact?: boolean }) {
  const { me } = useMi()
  const a = d.asset
  const [schedules, setSchedules] = useState<ScheduleRow[] | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const loadSchedules = useCallback(() => { void ml.schedules({ asset: a.id }).then(setSchedules).catch(() => setSchedules([])) }, [a.id])
  useEffect(() => { loadSchedules() }, [loadSchedules])
  const warranty = warrantyState(a.warranty_expiry)

  return (
    <div className="flex flex-col gap-5">
      <Section title="Where">
        <Row label="Site">{a.site_name}</Row>
        <Row label="Zone">{a.area_name}</Row>
        <Row label="Tunnel diagram">
          {d.diagram.length > 0 ? (
            <Link to={`${INV}/tunnel?site=${a.location_id}${d.diagram[0].tunnel_no > 1 ? `&tunnel=${d.diagram[0].tunnel_no}` : ''}&item=${d.diagram[0].item_id}`}
              className="text-accent hover:underline">
              Show it{d.diagram[0].via_parent ? ` (as part of ${d.diagram[0].label || 'its machine'})` : d.diagram[0].label ? ` (${d.diagram[0].label})` : ''}
            </Link>
          ) : null}
        </Row>
        {d.ancestors.length > 0 && (
          <Row label="Part of">
            <span className="flex flex-wrap items-center gap-1">
              {d.ancestors.map((x, n) => (
                <span key={x.id} className="inline-flex items-center gap-1">
                  {n > 0 && <ChevronRight className="size-3 text-ink-subtle" />}
                  <Link to={`${EQUIPMENT_BASE}/${x.id}`} className="text-accent hover:underline">{shortName(x.name)}</Link>
                </span>
              ))}
            </span>
          </Row>
        )}
      </Section>

      <Section title="Maintenance">
        <div className="flex flex-wrap gap-1.5 px-3 py-2.5">
          <Link to={`${LOG}?new=1&asset=${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"><NotebookPen className="size-4" /> Log work</Link>
          <Link to={`${LOG}?asset=${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content"><History className="size-4" /> Log history</Link>
          {me.rank >= 2 && a.status !== 'retired' && <Button size="sm" variant="secondary" onClick={() => setScheduling(true)}><CalendarPlus className="size-4" /> Schedule</Button>}
        </div>
        <Row label="Last serviced">{a.last_serviced_at ? day(a.last_serviced_at) : null}</Row>
        {!schedules ? <div className="px-3 py-2.5"><Loading /></div> : schedules.length === 0 ? (
          <div className="px-3 py-2.5 text-sm text-ink-muted">No maintenance scheduled on this machine.</div>
        ) : schedules.map((s) => (
          <Link key={s.id} to={`${LOG}/schedules/${s.id}`} className="flex items-start justify-between gap-2 px-3 py-2.5 text-sm hover:bg-content">
            <span className="min-w-0">
              <span className="block truncate text-accent">{s.title}</span>
              <span className="block text-xs text-ink-muted">{dueText(s)}</span>
            </span>
            <Badge tone={SCHEDULE_STATUS[s.status].tone} className="shrink-0">{SCHEDULE_STATUS[s.status].label}</Badge>
          </Link>
        ))}
      </Section>

      <Section title={`Open work orders${d.open_work_orders.length ? ` (${d.open_work_orders.length})` : ''}`}>
        {d.open_work_orders.length === 0 ? <div className="px-3 py-2.5 text-sm text-ink-muted">None.</div> : d.open_work_orders.map((w) => (
          <Link key={w.id} to={`${INV}/work-orders/${w.id}`} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-content">
            <span className="min-w-0 truncate text-accent">#{w.number} {w.title}</span>
            <Badge tone={w.priority === 'high' ? 'danger' : 'neutral'} className="shrink-0">{w.status.replace(/_/g, ' ')}</Badge>
          </Link>
        ))}
      </Section>

      {d.children.length > 0 && (
        <Section title={`Components (${d.children.length})`}>
          {d.children.map((c) => (
            <Link key={c.id} to={`${EQUIPMENT_BASE}/${c.id}`} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-content">
              <span className="min-w-0">
                <span className="block truncate text-ink">{shortName(c.name)}</span>
                {c.children > 0 && <span className="block text-xs text-ink-muted">{c.children} components</span>}
              </span>
              <span className="flex shrink-0 gap-1">
                {c.crit_class && <Badge tone={CRIT[c.crit_class as 'A' | 'B' | 'C']?.tone ?? 'neutral'}>{c.crit_class}</Badge>}
                {c.status !== 'online' && <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].short}</Badge>}
              </span>
            </Link>
          ))}
        </Section>
      )}

      {!compact && (
        <>
          <Section title="What it is">
            <Row label="Type">{a.type}</Row>
            <Row label="Manufacturer">{a.manufacturer}</Row>
            <Row label="Model">{a.model}</Row>
            <Row label="Serial" copy={a.serial_number} mono>{a.serial_number}</Row>
            <Row label="Criticality">{a.crit_class ? CRIT[a.crit_class as 'A' | 'B' | 'C']?.label : null}</Row>
            <Row label="Vendor">{a.vendor_name}</Row>
            <Row label="Asset number" mono>{a.asset_number}</Row>
            <Row label="Use counted by">{USAGE_BASIS[a.usage_basis]}</Row>
            {a.description && <Row label="Notes">{a.description}</Row>}
          </Section>

          <Section title="Dates">
            <Row label="Installed">{a.install_date ? day(a.install_date) : null}</Row>
            <Row label="Bought">{a.purchase_date ? day(a.purchase_date) : null}</Row>
            <Row label="Warranty">{a.warranty_expiry ? <span>{day(a.warranty_expiry)}{warranty && <span className="ml-2 text-xs text-ink-muted">{warranty.label}</span>}</span> : null}</Row>
            <Row label="Last audited">{a.last_audited_at ? day(a.last_audited_at) : null}</Row>
            {a.retired_at && <Row label="Retired">{day(a.retired_at)}</Row>}
          </Section>

          <BomSection d={d} reload={reload} />

          <Section title={`Service history`}>
            {d.service_history.length === 0 ? <div className="px-3 py-2.5 text-sm text-ink-muted">No finished work orders yet.</div> : d.service_history.map((w) => (
              <Link key={w.id} to={`${INV}/work-orders/${w.id}`} className="flex justify-between gap-2 px-3 py-2.5 text-sm hover:bg-content">
                <span className="min-w-0 truncate text-ink">#{w.number} {w.title}</span>
                <span className="shrink-0 text-xs text-ink-subtle">{day(w.completed_at ?? w.created_at)}</span>
              </Link>
            ))}
          </Section>

          <Section title={`Parts used (${money(d.parts_cost)} to date)`}>
            {d.parts_used.length === 0 ? <div className="px-3 py-2.5 text-sm text-ink-muted">None recorded yet.</div> : d.parts_used.map((u, i) => (
              <div key={i} className="flex justify-between gap-2 px-3 py-2.5 text-sm">
                <Link to={`${INV}/parts/${u.part_id}`} className="min-w-0 truncate text-accent hover:underline">{u.part_name} x{qty(u.qty)}</Link>
                <span className="shrink-0 tabular-nums text-ink-muted">{money(u.cost)}, {day(u.created_at)}</span>
              </div>
            ))}
          </Section>
        </>
      )}

      {scheduling && (
        <Suspense fallback={null}>
          <ScheduleForm init={{ asset: { id: a.id, name: a.name, site_id: a.location_id } }} onClose={() => setScheduling(false)} onSaved={() => { setScheduling(false); loadSchedules() }} />
        </Suspense>
      )}
    </div>
  )
}

function BomSection({ d, reload }: { d: EquipmentDetail; reload: () => void }) {
  const { notify } = useMi()
  const a = d.asset
  const [adding, setAdding] = useState(false)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Parts it takes</span>
        {a.can_manage && <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Plus className="size-4" /> Add</Button>}
      </div>
      <div className="divide-y divide-border rounded-md border border-border">
        {d.bom.length === 0 ? <div className="px-3 py-2.5 text-sm text-ink-muted">None listed yet. Listing them lets a failed check suggest the right parts.</div> : d.bom.map((b) => (
          <div key={b.part_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <Link to={`${INV}/parts/${b.part_id}`} className="min-w-0 flex-1 truncate text-accent hover:underline">{b.part_name}</Link>
            <span className="shrink-0 tabular-nums text-ink-muted">x{qty(b.qty_per)}, <span className={Number(b.on_hand_at_site) < Number(b.qty_per) ? 'text-danger' : ''}>{qty(b.on_hand_at_site)} here</span></span>
            {a.can_manage && (
              <Button variant="ghost" size="icon" aria-label={`Remove ${b.part_name}`} onClick={() => { void mi.setBomLine(a.id, b.part_id, 0).then(reload).catch((e) => notify(errText(e), 'danger')) }}>
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {adding && <AddBomLine assetId={a.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload() }} />}
    </section>
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
          <div className="w-20 shrink-0"><Input aria-label="How many" inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} className="text-center" /></div>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {dq.trim() && rows.length === 0 && <Muted>No parts match.</Muted>}
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
