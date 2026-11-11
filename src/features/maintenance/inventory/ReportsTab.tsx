import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, subDays } from 'date-fns'
import { StatCard } from '@/components/data/StatCard'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type Dashboard } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { day, errText, money, moneyWhole, pct, qty } from './format'
import { Card, ErrorNote, Loading, Muted } from './ui'

const BASE = '/app/maintenance-inventory'

function Bars({ rows, format: fmt = moneyWhole }: { rows: Array<{ label: string; value: number }>; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.value))))
  if (rows.length === 0) return <Muted>Nothing yet.</Muted>
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.slice(0, 12).map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">{fmt(Number(r.value))}</span>
          </div>
          <div className="mt-0.5 h-1.5 rounded-full bg-content">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(Math.abs(Number(r.value)) / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const SIGNAL_TONE = { green: 'ok', yellow: 'warn', red: 'danger' } as const
const SIGNAL_LABEL = { green: 'Covered', yellow: 'Short', red: 'Part at zero' } as const

export default function ReportsTab() {
  const { refs } = useMi()
  const [from, setFrom] = useState(() => format(subDays(new Date(), 89), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [site, setSite] = useState('')
  const [d, setD] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    mi.dashboard({ from, to, site: site || null }).then((r) => { if (alive) { setD(r); setError(null) } }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [from, to, site])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Site" value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-48">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input aria-label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        <Input aria-label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!d && !error && <Loading />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Inventory value" value={moneyWhole(d.inventory_value)} hint={Number(d.in_transit_value) > 0 ? `${moneyWhole(d.in_transit_value)} more in transit` : undefined} />
            <StatCard label="Stockouts" value={d.stockouts.length} hint={`${qty(d.critical_zero_days)} days critical parts sat at zero`} />
            <StatCard label="Critical spares on hand" value={pct(d.critical_compliance_pct)} hint="Across required kits" />
            <StatCard label="Fill rate" value={pct(d.fill_rate.pct)} hint={`${d.fill_rate.filled} of ${d.fill_rate.lines} job lines filled from stock`} />
            <StatCard label="Turns" value={d.turns ?? '-'} hint={`${moneyWhole(d.issue_cost_12m)} used in 12 months`} />
            <StatCard label="Dead stock" value={moneyWhole(d.dead_stock.value)} hint={`${d.dead_stock.lines} lines with no recent movement`} />
            <StatCard label="Carrying cost" value={moneyWhole(d.carrying_cost)} hint={`${pct(Number(d.carrying_rate) * 100)} of ${moneyWhole(d.avg_inventory_value)} average a year`} />
            <StatCard label="Parts per car" value={d.parts_cost_per_car != null ? `$${Number(d.parts_cost_per_car).toFixed(3)}` : '-'} hint={`${moneyWhole(d.parts_cost)} over ${qty(d.cars)} cars`} />
            <StatCard label="Count accuracy" value={pct(d.count_accuracy.pct)} hint={`Net ${money(d.count_accuracy.net_variance)}, gross ${money(d.count_accuracy.gross_variance)}`} />
            <StatCard label="Tools overdue" value={d.tools.overdue} hint={`${d.tools.checked_out} of ${d.tools.total} out (${pct(d.tools.utilization_pct)})`} />
            <StatCard label="Tools lost or damaged" value={moneyWhole(d.tools.lost_or_damaged_value)} hint="In this period" />
            <StatCard label="Emergency buys" value={d.emergency.orders} hint={`${moneyWhole(d.emergency.total)}, ${moneyWhole(d.emergency.premium)} over normal price`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Inventory value by site"><Bars rows={d.value_by_site} /></Card>
            <Card title="Inventory value by category"><Bars rows={d.value_by_category} /></Card>
            <Card title="Parts cost by site">
              {d.parts_cost_by_site.length === 0 ? <Muted>Nothing used in this period.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.parts_cost_by_site.map((s) => (
                    <li key={s.label} className="flex justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate text-ink">{s.label}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted">{moneyWhole(s.value)}{s.per_car != null ? `, $${Number(s.per_car).toFixed(3)}/car` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Top assets by parts spend">
              {d.top_assets.length === 0 ? <Muted>No parts charged to assets in this period.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.top_assets.map((a) => (
                    <li key={a.asset_id} className="flex justify-between gap-2 py-1.5 text-sm">
                      <Link to={`${BASE}/equipment/${a.asset_id}`} className="truncate text-accent hover:underline">{a.label}</Link>
                      <span className="shrink-0 tabular-nums text-ink-muted">{moneyWhole(a.value)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Parts used by month"><Bars rows={d.monthly_issue_cost.map((m) => ({ label: m.month, value: m.value }))} /></Card>
            <Card title="Critical spares by site">
              {d.site_signals.length === 0 ? <Muted>No kits are required at any site yet. Set them under Settings.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.site_signals.map((s) => (
                    <li key={s.site_id} className="py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{s.site_name}</span>
                        <span className="flex items-center gap-2 tabular-nums text-ink-muted">{pct(s.compliance_pct)} <Badge tone={SIGNAL_TONE[s.signal]}>{SIGNAL_LABEL[s.signal]}</Badge></span>
                      </div>
                      {s.missing.length > 0 && <p className="mt-0.5 text-xs text-ink-muted">Short: {s.missing.slice(0, 6).map((m) => `${m.part_name} (${qty(m.have)} of ${qty(m.need)})`).join(', ')}{s.missing.length > 6 ? ` and ${s.missing.length - 6} more` : ''}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Stockouts">
              {d.stockouts.length === 0 ? <Muted>None.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.stockouts.slice(0, 15).map((s) => (
                    <li key={`${s.part_id}${s.location_name}`} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                      <Link to={`${BASE}/parts/${s.part_id}`} className="truncate text-accent hover:underline">{s.part_name}</Link>
                      <span className="flex shrink-0 items-center gap-1.5 text-ink-muted">{s.location_name}{s.is_critical && <Badge tone="danger">Critical</Badge>}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dead stock">
              {d.dead_stock.top.length === 0 ? <Muted>None.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.dead_stock.top.map((s) => (
                    <li key={`${s.part_id}${s.location_name}`} className="flex justify-between gap-2 py-1.5 text-sm">
                      <Link to={`${BASE}/parts/${s.part_id}`} className="truncate text-accent hover:underline">{s.part_name}</Link>
                      <span className="shrink-0 tabular-nums text-ink-muted">{moneyWhole(s.value)}, {s.last_moved_at ? day(s.last_moved_at) : 'never moved'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Overdue tools">
              {d.tools.overdue_list.length === 0 ? <Muted>None.</Muted> : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.tools.overdue_list.map((t) => (
                    <li key={t.id} className="flex justify-between gap-2 py-1.5 text-sm">
                      <Link to={`${BASE}/tools/${t.id}`} className="truncate text-accent hover:underline">{t.name}</Link>
                      <span className="shrink-0 text-ink-muted">{t.custodian ?? 'A truck or crib'}, due {day(t.due_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Equipment reliability" className="lg:col-span-2">
              {d.equipment_reliability.length === 0 ? <Muted>No downtime logged in this period.</Muted> : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <tr><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 text-right font-medium">Events</th><th className="py-1 pr-2 text-right font-medium">Avg repair (MTTR)</th><th className="py-1 text-right font-medium">Between failures (MTBF)</th></tr>
                    </thead>
                    <tbody>
                      {d.equipment_reliability.map((e) => (
                        <tr key={e.category} className="border-t border-border">
                          <td className="py-1.5 pr-2 text-ink">{e.category}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">{e.events}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums text-ink-muted">{e.mttr_hours != null ? `${qty(e.mttr_hours)} hrs` : '-'}</td>
                          <td className="py-1.5 text-right tabular-nums text-ink-muted">{e.mtbf_days != null ? `${qty(e.mtbf_days)} days` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
