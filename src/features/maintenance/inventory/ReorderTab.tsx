import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Repeat, ShoppingCart } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type Suggestion } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { errText, money, qty } from './format'
import { act } from './offline'
import { Card, ErrorNote, Loading, Muted } from './ui'

// The reorder board: anything with available + on order at or below its reorder point,
// grouped by preferred vendor. Stock sitting over max elsewhere shows first, since a
// transfer beats a purchase.

const BASE = '/app/maintenance-inventory'
const key = (s: Suggestion) => `${s.part_id}:${s.location_id}`

export default function ReorderTab() {
  const { refs, notify } = useMi()
  const navigate = useNavigate()
  const [location, setLocation] = useState('')
  const [rows, setRows] = useState<Suggestion[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [vendorPick, setVendorPick] = useState<Record<string, string>>({})
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await mi.reorder(location || null))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [location])
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const m = new Map<string, { vendor: string | null; rows: Suggestion[] }>()
    for (const s of rows ?? []) {
      const k = s.vendor_id ?? 'none'
      if (!m.has(k)) m.set(k, { vendor: s.vendor_name, rows: [] })
      m.get(k)?.rows.push(s)
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'none' ? 1 : b[0] === 'none' ? -1 : (a[1].vendor ?? '').localeCompare(b[1].vendor ?? '')))
  }, [rows])

  const qtyOf = (s: Suggestion) => Number(qtys[key(s)] ?? s.suggested_qty)
  const vendorOf = (s: Suggestion) => s.vendor_id ?? vendorPick[key(s)] ?? ''
  const chosen = (rows ?? []).filter((s) => !skip.has(key(s)) && qtyOf(s) > 0 && vendorOf(s))
  const total = chosen.reduce((a, s) => a + qtyOf(s) * Number(s.unit_cost ?? 0), 0)

  const create = async () => {
    setBusy(true)
    try {
      const res = await mi.createDraftPos(chosen.map((s) => ({ part_id: s.part_id, location_id: s.location_id, vendor_id: vendorOf(s), qty: qtyOf(s), unit_cost: s.unit_cost })), urgent)
      notify(`${res.created.length} draft PO${res.created.length === 1 ? '' : 's'} created.`)
      if (res.created.length === 1) navigate(`${BASE}/pos/${res.created[0].po_id}`)
      else navigate(`${BASE}/pos`)
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  const transferFrom = async (s: Suggestion, from: { location_id: string; excess: number }) => {
    try {
      const amount = Math.min(Number(from.excess), qtyOf(s))
      const res = await act<{ number: number }>('mi_start_transfer', { p_from: from.location_id, p_to: s.location_id, p_lines: [{ part_id: s.part_id, qty: amount }] }, `Asked for ${qty(amount)} ${s.part_name}`)
      notify(res.queued ? 'Saved on this phone.' : `Transfer #${res.data.number} requested for ${qty(amount)}.`)
      setSkip((p) => new Set(p).add(key(s)))
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={location} onChange={(e) => setLocation(e.target.value)} className="w-full sm:w-64">
          <option value="">All my locations</option>
          {refs.locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        {rows && rows.length > 0 && (
          <>
            <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent</label>
            <Button className="sm:ml-auto" disabled={busy || chosen.length === 0} onClick={() => void create()}>
              <ShoppingCart className="size-4" /> Create draft POs ({chosen.length} lines, {money(total)})
            </Button>
          </>
        )}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>Nothing needs ordering. Parts show up here when available plus on order drops to the reorder point.</Muted>}
      {groups.map(([id, g]) => (
        <Card key={id} title={g.vendor ?? 'No preferred vendor'}>
          <ul className="flex flex-col divide-y divide-border">
            {g.rows.map((s) => (
              <li key={key(s)} className="flex flex-col gap-2 py-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" aria-label={`Include ${s.part_name}`} className="mt-1 size-5 shrink-0" checked={!skip.has(key(s))}
                    onChange={(e) => setSkip((p) => { const n = new Set(p); if (e.target.checked) n.delete(key(s)); else n.add(key(s)); return n })} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link to={`${BASE}/parts/${s.part_id}`} className="font-medium text-ink hover:underline">{s.part_name}</Link>
                      {s.is_critical && <Badge tone="danger">Critical</Badge>}
                    </div>
                    <p className="text-xs text-ink-muted">
                      {s.location_name}: {qty(s.available)} free, {qty(s.on_order)} on order, reorder at {qty(s.reorder_point)}, max {qty(s.max_qty)}
                      {s.pack_qty > 1 ? `. Pack of ${qty(s.pack_qty)}.` : ''}{s.lead_time_days != null ? ` ${s.lead_time_days} day lead.` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Input aria-label="Order quantity" inputMode="decimal" className="h-10 w-20 text-center" value={qtys[key(s)] ?? String(s.suggested_qty)}
                      onChange={(e) => setQtys((p) => ({ ...p, [key(s)]: e.target.value }))} />
                    <span className="hidden w-20 text-right text-sm tabular-nums text-ink-muted sm:block">{money(qtyOf(s) * Number(s.unit_cost ?? 0))}</span>
                  </div>
                </div>
                {!s.vendor_id && (
                  <Select aria-label="Vendor" className="ml-8 w-auto" value={vendorPick[key(s)] ?? ''} onChange={(e) => setVendorPick((p) => ({ ...p, [key(s)]: e.target.value }))}>
                    <option value="">Pick a vendor for this order</option>
                    {refs.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </Select>
                )}
                {s.overstock.length > 0 && (
                  <div className="ml-8 flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
                    <Repeat className="size-4 shrink-0" />
                    <span>Check other sites first:</span>
                    {s.overstock.map((o) => (
                      <Button key={o.location_id} size="sm" variant="secondary" onClick={() => void transferFrom(s, o)}>
                        {o.location_name} has {qty(o.excess)} extra
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
