import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO, subDays } from 'date-fns'
import { StatCard } from '@/components/data/StatCard'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ml, type LogReport } from '@/lib/queries/maintenanceLog'
import { useMi } from '../inventory/context'
import { day, errText, moneyWhole, pct } from '../inventory/format'
import { Card, ErrorNote, Loading, Muted } from '../inventory/ui'
import { ENTRY_TYPE } from './labels'

const BASE = '/app/maintenance-log'

const num = (n: number | null | undefined) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }))

// Is preventive maintenance getting done on time, what is it costing, and which
// machines keep breaking.
export default function LogReportsTab() {
  const { refs, me } = useMi()
  const [from, setFrom] = useState(() => format(subDays(new Date(), 89), 'yyyy-MM-dd'))
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [site, setSite] = useState('')
  const [d, setD] = useState<LogReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (me.rank < 2) return
    let alive = true
    ml.report({ from, to, site: site || null }).then((r) => { if (alive) { setD(r); setError(null) } }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [from, to, site, me.rank])

  if (me.rank < 2) return <Muted>Reports are for site managers and up.</Muted>

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
            <StatCard label="Scheduled jobs done" value={d.scheduled_done} hint={`${d.skipped} skipped. ${d.schedules_active} schedules running`} />
            <StatCard label="Done on time" value={pct(d.on_time_pct)} hint="Before the schedule went overdue" />
            <StatCard label="Overdue now" value={d.overdue_now} hint={`${d.due_now} more due today`} />
            <StatCard label="Repairs" value={d.repairs} hint={`${d.preventive} preventive jobs in the same period`} />
            <StatCard label="Time spent" value={`${num(d.labor_hours)} hr`} hint="Logged on entries and work orders" />
            <StatCard label="Machines down" value={`${num(d.downtime_hours)} hr`} hint="Logged on entries" />
            <StatCard label="Parts used" value={moneyWhole(d.parts_cost)} hint="Everything off the shelf" />
            <StatCard label="Outside costs" value={moneyWhole(d.outside_cost)} hint="Vendors and contractors" />
          </div>

          <Card title="By site">
            {d.by_site.length === 0 ? <Muted>Nothing in this period.</Muted> : (
              <div className="-mx-4 overflow-x-auto px-4">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted">
                      <th className="py-1.5 pr-3 font-medium">Site</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Scheduled done</th>
                      <th className="py-1.5 pr-3 text-right font-medium">On time</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Overdue now</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Repairs</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Parts</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Outside</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Hours</th>
                      <th className="py-1.5 text-right font-medium">Per 1,000 cars</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.by_site.map((s) => {
                      const cost = Number(s.parts_cost) + Number(s.outside_cost)
                      return (
                        <tr key={s.site_id}>
                          <td className="py-1.5 pr-3 text-ink">{s.site_name}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{s.scheduled_done}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{pct(s.on_time_pct)}</td>
                          <td className={`py-1.5 pr-3 text-right tabular-nums ${s.overdue_now > 0 ? 'text-danger' : ''}`}>{s.overdue_now}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{s.repairs}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{moneyWhole(s.parts_cost)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{moneyWhole(s.outside_cost)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{num(s.labor_hours)}</td>
                          <td className="py-1.5 text-right tabular-nums">{Number(s.cars) > 0 ? `$${((cost / Number(s.cars)) * 1000).toFixed(2)}` : '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Machines that keep breaking">
              {d.repeat_problems.length === 0 ? <Muted>No machine had three or more repairs in this period.</Muted> : d.repeat_problems.map((r) => (
                <Link key={r.asset_id} to={`${BASE}?asset=${r.asset_id}`} className="flex items-baseline justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0 hover:bg-content">
                  <span className="min-w-0 truncate text-accent">{r.asset_name}<span className="text-ink-muted">{r.site_name ? `, ${r.site_name}` : ''}</span></span>
                  <span className="shrink-0 text-ink-muted">{r.count} repairs, last {day(r.last_at)}</span>
                </Link>
              ))}
            </Card>
            <Card title="Costliest machines">
              {d.top_assets.length === 0 ? <Muted>No parts or outside costs on a machine yet.</Muted> : d.top_assets.map((a) => (
                <Link key={a.asset_id} to={`${BASE}?asset=${a.asset_id}`} className="flex items-baseline justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0 hover:bg-content">
                  <span className="min-w-0 truncate text-accent">{a.asset_name}<span className="text-ink-muted">{a.site_name ? `, ${a.site_name}` : ''}</span></span>
                  <span className="shrink-0 tabular-nums text-ink-muted">{moneyWhole(a.cost)}{a.events ? `, ${a.events} jobs` : ''}</span>
                </Link>
              ))}
            </Card>
            <Card title="Month by month">
              {d.monthly.length === 0 ? <Muted>Nothing in this period.</Muted> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-ink-muted"><th className="py-1 font-medium">Month</th><th className="py-1 text-right font-medium">Preventive</th><th className="py-1 text-right font-medium">Repairs</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {d.monthly.map((m) => (
                      <tr key={m.month}><td className="py-1.5 text-ink">{format(parseISO(`${m.month}-01`), 'MMMM yyyy')}</td><td className="py-1.5 text-right tabular-nums">{m.preventive}</td><td className="py-1.5 text-right tabular-nums">{m.repairs}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title="Log entries by kind">
              {Object.keys(d.by_type).length === 0 ? <Muted>No log entries in this period. Work orders still count in the rest of this page.</Muted> : Object.entries(d.by_type).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 border-t border-border py-1.5 text-sm first:border-t-0">
                  <span className="text-ink">{ENTRY_TYPE[k as keyof typeof ENTRY_TYPE] ?? k}</span>
                  <span className="tabular-nums text-ink-muted">{v}</span>
                </div>
              ))}
            </Card>
          </div>
          <p className="text-xs text-ink-muted">Counts finished work orders and log entries together. Repairs are reactive work orders, plus entries marked repair, failed or needing follow-up.</p>
        </>
      )}
    </div>
  )
}
