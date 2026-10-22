import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fetchRechargeDaily, type RechargeDaily, type DayTotals } from '@/lib/queries/rechargeTiming'

// Recharge Timing: when memberships recharge across the company, as a
// day-of-month distribution (1st..31st), SiteWatch + FlexWash stacked. A single
// month shows that month's totals per day; a multi-month period shows the average
// per month for each day (days 29-31 only average over months that have them).

type Period = 'month' | '3' | '6'
type Metric = 'count' | 'amount'

const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toLocaleDateString('en-CA').slice(0, 7)
}
const monthEnd = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}
const addMonths = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th')
const int = (n: number) => Math.round(n).toLocaleString('en-US')

type DayRow = { day: number; sw: DayTotals; fw: DayTotals; months: number }

// Roll calendar dates up to day-of-month, averaging per month when months > 1.
function byDayOfMonth(d: RechargeDaily, start: string, end: string): DayRow[] {
  const rows: DayRow[] = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, sw: { count: 0, amount: 0 }, fw: { count: 0, amount: 0 }, months: 0 }))
  for (let ym = start.slice(0, 7); ym <= end.slice(0, 7); ym = addMonths(ym, 1)) {
    const last = Number(monthEnd(ym).slice(8))
    for (let day = 1; day <= last; day++) rows[day - 1].months++
  }
  const add = (m: Map<string, DayTotals>, key: 'sw' | 'fw') => {
    for (const [date, t] of m) {
      if (date < start || date > end) continue
      const r = rows[Number(date.slice(8)) - 1]
      r[key].count += t.count
      r[key].amount += t.amount
    }
  }
  add(d.siteWatch, 'sw')
  add(d.flexWash, 'fw')
  return rows
}

// Two categorical series (validated light + dark against the card surfaces):
// SiteWatch = slot 1 blue, FlexWash = slot 2 orange.
const SERIES_CSS = `
.rt-sw { fill: #2a78d6 } .rt-fw { fill: #eb6834 }
.rt-sw-bg { background: #2a78d6 } .rt-fw-bg { background: #eb6834 }
.dark .rt-sw { fill: #3987e5 } .dark .rt-fw { fill: #d95926 }
.dark .rt-sw-bg { background: #3987e5 } .dark .rt-fw-bg { background: #d95926 }
`

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-subtle">{sub}</div>}
    </div>
  )
}

// Nice upper bound + ~4 gridlines for the y axis.
function niceScale(max: number): number[] {
  if (max <= 0) return [0]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(v)
  return ticks
}

export function Chart({ rows, metric, avg }: { rows: DayRow[]; metric: Metric; avg: boolean }) {
  const [hover, setHover] = useState<number | null>(null)
  const val = (r: DayRow, k: 'sw' | 'fw') => { const v = r[k][metric]; return avg ? (r.months ? v / r.months : 0) : v }
  const totals = rows.map((r) => val(r, 'sw') + val(r, 'fw'))
  const grand = totals.reduce((a, b) => a + b, 0)
  const ticks = niceScale(Math.max(...totals))
  const top = ticks[ticks.length - 1] || 1
  const fmt = (v: number) => (metric === 'amount' ? currency(v) : int(v))
  const fmtAxis = (v: number) => (metric === 'amount' ? (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`) : v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))

  const W = 960, H = 300, padL = 48, padR = 8, padT = 22, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const slot = plotW / 31
  const barW = Math.max(4, slot * 0.62)
  const y = (v: number) => padT + plotH - (v / top) * plotH
  const peak = totals.indexOf(Math.max(...totals))

  // A bar segment with the 4px rounded end only on the top of the stack.
  const seg = (x: number, y0: number, y1: number, cls: string, roundTop: boolean) => {
    const h = y0 - y1
    if (h <= 0) return null
    if (!roundTop) return <rect x={x} y={y1} width={barW} height={h} className={cls} />
    const r = Math.min(4, h, barW / 2)
    return <path d={`M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z`} className={cls} />
  }

  const h = hover != null ? rows[hover] : null
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Recharges by day of month">
        {/* recessive grid + y axis labels */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" className="text-ink-subtle">{fmtAxis(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = padL + i * slot + (slot - barW) / 2
          const sw = val(r, 'sw'), fw = val(r, 'fw')
          const base = y(0)
          const ySw = y(sw)
          // 2px surface gap between the stacked segments.
          const yFwBase = fw > 0 && sw > 0 ? ySw - 2 : ySw
          const yTop = y(sw + fw) - (fw > 0 && sw > 0 ? 2 : 0)
          return (
            <g key={r.day} opacity={hover == null || hover === i ? 1 : 0.45}>
              {seg(x, base, ySw, 'rt-sw', fw <= 0)}
              {fw > 0 && seg(x, yFwBase, Math.min(yTop, yFwBase), 'rt-fw', true)}
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="currentColor" className="text-ink-subtle">{r.day}</text>
              {i === peak && totals[i] > 0 && (
                <text x={x + barW / 2} y={yTop - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="currentColor" className="text-ink">{fmt(totals[i])}</text>
              )}
              {/* hit target: the full column, wider than the bar */}
              <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)} />
            </g>
          )
        })}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-2 z-10 w-48 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
          style={{ left: `clamp(0px, calc(${((padL + hover * slot + slot / 2) / W) * 100}% - 96px), calc(100% - 192px))` }}
        >
          <div className="mb-1 font-semibold text-ink">{ordinal(h.day)} of the month{avg ? ' · avg / month' : ''}</div>
          <div className="flex items-center justify-between gap-2 text-ink-muted"><span className="flex items-center gap-1.5"><span className="rt-sw-bg inline-block size-2.5 rounded-sm" />SiteWatch</span><span className="tabular-nums text-ink">{fmt(val(h, 'sw'))}</span></div>
          <div className="flex items-center justify-between gap-2 text-ink-muted"><span className="flex items-center gap-1.5"><span className="rt-fw-bg inline-block size-2.5 rounded-sm" />FlexWash</span><span className="tabular-nums text-ink">{fmt(val(h, 'fw'))}</span></div>
          <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold text-ink"><span>Total</span><span className="tabular-nums">{fmt(totals[hover])}</span></div>
          <div className="text-ink-subtle">{grand > 0 ? ((totals[hover] / grand) * 100).toFixed(1) : '0'}% of the {avg ? 'average month' : 'month'}</div>
        </div>
      )}
    </div>
  )
}

export default function RechargeTimingPage() {
  const [period, setPeriod] = useState<Period>('month')
  const [month, setMonth] = useState(lastMonth())
  const [metric, setMetric] = useState<Metric>('count')
  const [showTable, setShowTable] = useState(false)
  const [data, setData] = useState<RechargeDaily | null>(null)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Single month, or the last N complete months.
  const [start, end] = useMemo<[string, string]>(() => {
    if (period === 'month') return [`${month}-01`, monthEnd(month)]
    const last = lastMonth()
    return [`${addMonths(last, -(Number(period) - 1))}-01`, monthEnd(last)]
  }, [period, month])
  const avg = period !== 'month'

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return
    let active = true
    setLoading(true)
    setError(null)
    setProgress(null)
    fetchRechargeDaily(start, end, (d, t) => { if (active) setProgress([d, t]) })
      .then((d) => { if (active) { setData(d); setLoading(false) } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { active = false }
  }, [start, end])

  const rows = useMemo(() => (data ? byDayOfMonth(data, start, end) : []), [data, start, end])
  const per = (r: DayRow, k: 'sw' | 'fw', m: Metric) => { const v = r[k][m]; return avg ? (r.months ? v / r.months : 0) : v }
  const total = (m: Metric) => rows.reduce((a, r) => a + r.sw[m] + r.fw[m], 0)
  const dayTotal = (r: DayRow) => per(r, 'sw', metric) + per(r, 'fw', metric)
  const grand = rows.reduce((a, r) => a + dayTotal(r), 0)
  const ranked = [...rows].sort((a, b) => dayTotal(b) - dayTotal(a))
  const peak = ranked[0]
  const top3Share = grand > 0 ? (ranked.slice(0, 3).reduce((a, r) => a + dayTotal(r), 0) / grand) * 100 : 0
  const typical = (() => { const v = rows.filter((r) => r.months).map(dayTotal).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0 })()
  const fmt = (v: number) => (metric === 'amount' ? currency(v) : int(v))
  const periodLabel = period === 'month' ? monthLabel(month) : `${monthLabel(start.slice(0, 7))} – ${monthLabel(end.slice(0, 7))}`

  return (
    <div className="flex flex-col gap-5">
      <style>{SERIES_CSS}</style>
      <PageHeader
        title="Recharge Timing"
        subtitle="When memberships recharge across the company, by day of the month (SiteWatch + FlexWash)."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {error ? 'Load failed' : loading ? (progress ? `Loading FlexWash ${progress[0]}/${progress[1]} days` : 'Loading...') : 'Loaded'}
          </span>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="rt-period" className="text-xs font-medium text-ink-muted">Period</label>
          <Select id="rt-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="h-9 w-44">
            <option value="month">One month</option>
            <option value="3">Last 3 months</option>
            <option value="6">Last 6 months</option>
          </Select>
        </div>
        {period === 'month' && (
          <div className="flex flex-col gap-1">
            <label htmlFor="rt-month" className="text-xs font-medium text-ink-muted">Month</label>
            <Input id="rt-month" type="month" value={month} max={lastMonth()} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-muted">Show</span>
          <div className="inline-flex h-9 rounded-lg border border-border bg-card p-0.5">
            {([['count', 'Recharges'], ['amount', 'Dollars']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setMetric(k)}
                className={cn('rounded-md px-3 text-sm font-medium', metric === k ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Could not load recharge data.</p><p className="mt-0.5 text-danger/80">{error}</p></div>
        </div>
      )}
      {data && !data.flexIncluded && !loading && (
        <p className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2 text-sm text-warn">FlexWash couldn&apos;t be reached, so this shows SiteWatch recharges only.</p>
      )}

      {loading && !data && <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">Loading recharges…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={avg ? 'Recharges (period)' : 'Recharges'} value={int(total('count'))} sub={`${int(rows.reduce((a, r) => a + r.sw.count, 0))} SiteWatch · ${int(rows.reduce((a, r) => a + r.fw.count, 0))} FlexWash`} />
            <Stat label={avg ? 'Recharge $ (period)' : 'Recharge $'} value={currency(total('amount'))} sub={periodLabel} />
            <Stat label="Busiest day" value={peak ? ordinal(peak.day) : '—'} sub={peak && grand > 0 ? `${fmt(dayTotal(peak))} · ${((dayTotal(peak) / grand) * 100).toFixed(1)}% of the ${avg ? 'average ' : ''}month` : undefined} />
            <Stat label="Top 3 days" value={`${top3Share.toFixed(1)}%`} sub={`${ranked.slice(0, 3).map((r) => ordinal(r.day)).join(', ')} · a typical day is ${fmt(typical)}`} />
          </div>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{metric === 'amount' ? 'Recharge dollars' : 'Recharges'} by day of month</h2>
                <p className="mt-0.5 text-xs text-ink-subtle">{periodLabel}{avg ? ' · average per month for each day' : ''}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-ink-muted">
                <span className="flex items-center gap-1.5"><span className="rt-sw-bg inline-block size-2.5 rounded-sm" />SiteWatch</span>
                <span className="flex items-center gap-1.5"><span className="rt-fw-bg inline-block size-2.5 rounded-sm" />FlexWash</span>
                <button type="button" onClick={() => setShowTable((v) => !v)} className="rounded-md border border-border px-2 py-1 text-ink-muted hover:text-ink">{showTable ? 'Hide table' : 'Show table'}</button>
              </div>
            </div>
            <div className="px-2 py-3 sm:px-4">
              <Chart rows={rows} metric={metric} avg={avg} />
            </div>
            {showTable && (
              <div className="overflow-x-auto border-t border-border">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-ink-subtle">
                      {['Day', 'SiteWatch', 'FlexWash', 'Total', 'Share', 'Cumulative'].map((c) => <th key={c} className="px-4 py-2 text-right font-semibold first:text-left">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      let cum = 0
                      return rows.filter((r) => r.months).map((r) => {
                        const t = dayTotal(r)
                        cum += t
                        return (
                          <tr key={r.day} className="border-t border-border tabular-nums">
                            <td className="px-4 py-1.5 text-left">{ordinal(r.day)}</td>
                            <td className="px-4 py-1.5 text-right">{fmt(per(r, 'sw', metric))}</td>
                            <td className="px-4 py-1.5 text-right">{fmt(per(r, 'fw', metric))}</td>
                            <td className="px-4 py-1.5 text-right font-semibold">{fmt(t)}</td>
                            <td className="px-4 py-1.5 text-right">{grand > 0 ? ((t / grand) * 100).toFixed(1) : '0'}%</td>
                            <td className="px-4 py-1.5 text-right text-ink-muted">{grand > 0 ? ((cum / grand) * 100).toFixed(1) : '0'}%</td>
                          </tr>
                        )
                      })
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="px-1 text-xs leading-relaxed text-ink-subtle">
            SiteWatch = every line in the &ldquo;ARM Plans Recharged&rdquo; category across all sites (matches the DRB General Sales Report).
            FlexWash = membership rebills (system-generated plan charges) across every FlexWash site. Sites that moved to FlexWash still
            bill their older members in SiteWatch while new members bill in FlexWash, so the two are added together.
            {avg && ' Multi-month periods show the average per month for each day; the 29th–31st average only over months that have them.'}
          </p>
        </>
      )}
    </div>
  )
}
