import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { mi } from '@/lib/queries/maintenanceInventory'
import { ml, type ForecastRow } from '@/lib/queries/maintenanceLog'
import { useMi } from '../inventory/context'
import { day, errText, money, qty } from '../inventory/format'
import { Chips, ErrorNote, Loading, Muted } from '../inventory/ui'
import { LOG_CHANGED } from './context'

const INV = '/app/maintenance-inventory'

type Days = '30' | '60' | '90'

const keyOf = (r: ForecastRow) => `${r.site_id}:${r.part_id}`
const orderQty = (r: ForecastRow) => Math.ceil(Number(r.short) / Number(r.pack_qty || 1)) * Number(r.pack_qty || 1)

// What the schedules will use in the next 30, 60 or 90 days, against what each site has
// free and on order. Shortages can go straight onto draft purchase orders.
export default function ForecastTab() {
  const { refs, me, notify } = useMi()
  const [days, setDays] = useState<Days>('30')
  const [site, setSite] = useState('')
  const [rows, setRows] = useState<ForecastRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await ml.forecast(Number(days), site || null)
      setRows(r)
      setPicked(new Set(r.filter((x) => Number(x.short) > 0 && x.vendor_id && x.can_order).map(keyOf)))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [days, site])
  useEffect(() => {
    void load()
    window.addEventListener(LOG_CHANGED, load)
    window.addEventListener('mi-changed', load)
    return () => {
      window.removeEventListener(LOG_CHANGED, load)
      window.removeEventListener('mi-changed', load)
    }
  }, [load])

  const short = useMemo(() => (rows ?? []).filter((r) => Number(r.short) > 0), [rows])
  const orderable = short.filter((r) => r.vendor_id && r.can_order && picked.has(keyOf(r)))

  const draft = async () => {
    setBusy(true)
    try {
      const res = await mi.createDraftPos(orderable.map((r) => ({ part_id: r.part_id, location_id: r.location_id as string, vendor_id: r.vendor_id as string, qty: orderQty(r), unit_cost: r.unit_cost })), false)
      notify(`${res.created.length} draft PO${res.created.length === 1 ? '' : 's'} made: ${res.created.map((c) => `#${c.number}`).join(', ')}. Review them under Maintenance Inventory > POs.`)
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-44" aria-label="Site">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Chips value={days} onChange={setDays} options={[{ value: '30', label: 'Next 30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} />
      </div>
      <p className="text-xs text-ink-muted">Counts each schedule's due dates in the window, times its parts. Car-based schedules use the site's cars a day over the last four weeks.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No scheduled parts in this window. Schedules with parts listed show here.</Muted>}
      {rows && rows.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 text-sm">
            <span className="text-ink">
              {rows.length} part{rows.length === 1 ? '' : 's'} needed.{' '}
              <b className={short.length ? 'text-danger' : 'text-ok'}>{short.length ? `${short.length} short` : 'Nothing short'}</b>
            </span>
            {me.rank >= 2 && short.length > 0 && (
              <Button onClick={() => void draft()} disabled={busy || orderable.length === 0}><ShoppingCart className="size-4" /> Draft POs for {orderable.length}</Button>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((r) => {
              const isShort = Number(r.short) > 0
              const canPick = me.rank >= 2 && isShort && !!r.vendor_id && r.can_order
              return (
                <li key={keyOf(r)} className="flex items-start gap-3 px-3 py-2.5">
                  {me.rank >= 2 && (
                    <input type="checkbox" aria-label={`Order ${r.part_name} for ${r.site_name}`} className="mt-1 size-4" disabled={!canPick}
                      checked={canPick && picked.has(keyOf(r))}
                      onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(keyOf(r)); else n.delete(keyOf(r)); return n })} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link to={`${INV}/parts/${r.part_id}`} className="text-sm font-medium text-accent hover:underline">{r.part_name}</Link>
                      {r.is_critical && <Badge tone="danger">Critical</Badge>}
                      {isShort ? <Badge tone="danger">Short {qty(r.short)}</Badge> : <Badge tone="ok">Covered</Badge>}
                    </div>
                    <p className="text-xs text-ink-muted">
                      {[site ? null : r.site_name, `need ${qty(r.need)}`, `${qty(r.available)} free`, Number(r.on_order) > 0 ? `${qty(r.on_order)} on order` : null, r.first_due ? `first ${day(r.first_due)}` : null].filter(Boolean).join(' · ')}
                    </p>
                    <p className="text-xs text-ink-subtle">{r.schedules.map((s) => `${s.title} x${s.times}`).join(', ')}</p>
                    {isShort && me.rank >= 2 && (
                      <p className="text-xs text-ink-muted">
                        {!r.vendor_id ? 'No preferred vendor yet: set one on the part to order it here.'
                          : !r.location_id ? 'No stockroom at this site to ship it to.'
                          : !r.can_order ? 'Ordering for this site takes its manager.'
                          : `Order ${qty(orderQty(r))} from ${r.vendor_name} to ${r.location_name}${r.unit_cost != null ? `, about ${money(orderQty(r) * Number(r.unit_cost))}` : ''}`}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
