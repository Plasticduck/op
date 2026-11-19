import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { fpa, type FpaEntity, type FpaSite } from '@/lib/queries/fpa'
import { at, change, intFmt, money, monthLabel, pct, periods, ratio, sumOf, toSeries, type Series } from './model'

const METRICS = ['Net Revenue', 'EBITDA', 'Cars Washed', 'KPI Net Revenue', 'KPI Qualifying Cars']
const TH = 'px-2 py-2 text-right font-medium whitespace-nowrap'
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
const tone = (c: number | null) => (c == null || Math.abs(c) < 0.0005 ? 'text-ink-muted' : c > 0 ? 'text-ok' : 'text-danger')

// Every site side by side for the month and the year to date, like the
// workbook's Site Scorecard. Tap a site for its P&L.
export function SitesTab({ month, entities, sites, onPick }: { month: string; entities: FpaEntity[]; sites: FpaSite[]; onPick: (key: string) => void }) {
  const p = useMemo(() => periods(month), [month])
  const rows = useMemo(() => entities.filter((e) => e.kind !== 'group'), [entities])
  const keys = useMemo(() => [...rows.map((e) => e.key), 'G_CONS'], [rows])
  const [data, setData] = useState<{ month: string; by: Map<string, Series> } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fpa.metricsFor(keys, METRICS, p.pyYtd[0], p.month)
      .then((all) => {
        if (!alive) return
        const by = new Map<string, Series>()
        for (const k of keys) by.set(k, toSeries(all.filter((r) => r.entity_key === k)))
        setData({ month: p.month, by })
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [keys, p])

  if (error) return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load the sites: {error}</p>
  if (!data || data.month !== month) return <p className="text-sm text-ink-muted">Loading the sites…</p>

  const siteOf = (key: string) => sites.find((s) => s.key === key)
  const line = (key: string, label: string, sub: string | null, total = false) => {
    const s = data.by.get(key)
    if (!s) return null
    const rev = at(s, 'Net Revenue', p.month)
    const ebitda = at(s, 'EBITDA', p.month)
    const revY = sumOf(s, 'Net Revenue', p.ytd)
    const ebitdaY = sumOf(s, 'EBITDA', p.ytd)
    if (!total && [rev, ebitda, revY, ebitdaY].every((v) => v == null || v === 0)) return null
    return (
      <tr
        key={key}
        className={cn('border-t border-border', total ? 'bg-content/40 font-semibold text-ink' : 'cursor-pointer hover:bg-content')}
        onClick={total ? undefined : () => onPick(key)}
      >
        <td className="px-3 py-1.5 text-left">
          <span className="text-ink">{label}</span>
          {sub && <span className="block text-xs font-normal text-ink-muted">{sub}</span>}
        </td>
        <td className={TD}>{money(rev)}</td>
        <td className={cn(TD, tone(change(rev, at(s, 'Net Revenue', p.py))))}>{pct(change(rev, at(s, 'Net Revenue', p.py)), true)}</td>
        <td className={TD}>{money(ebitda)}</td>
        <td className={cn(TD, 'text-ink-muted')}>{pct(ratio(ebitda, rev))}</td>
        <td className={TD}>{intFmt(at(s, 'Cars Washed', p.month))}</td>
        <td className={TD}>{money(ratio(at(s, 'KPI Net Revenue', p.month), at(s, 'KPI Qualifying Cars', p.month)), true)}</td>
        <td className={TD}>{money(revY)}</td>
        <td className={cn(TD, tone(change(revY, sumOf(s, 'Net Revenue', p.pyYtd))))}>{pct(change(revY, sumOf(s, 'Net Revenue', p.pyYtd)), true)}</td>
        <td className={TD}>{money(ebitdaY)}</td>
        <td className={cn(TD, 'text-ink-muted')}>{pct(ratio(ebitdaY, revY))}</td>
      </tr>
    )
  }

  return (
    <section className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h2 className="text-sm font-semibold text-ink">Sites · {monthLabel(p.month, 'long')} and year to date</h2>
        <p className="text-xs text-ink-muted">Site results are after the corporate allocation. Tap a site for its P&L.</p>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Site</th>
              <th className={TH}>Net revenue</th>
              <th className={TH}>vs PY</th>
              <th className={TH}>EBITDA</th>
              <th className={TH}>Margin</th>
              <th className={TH}>Cars</th>
              <th className={TH}>Rev / car</th>
              <th className={TH}>YTD revenue</th>
              <th className={TH}>vs PY</th>
              <th className={TH}>YTD EBITDA</th>
              <th className={TH}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const site = siteOf(e.key)
              const sub = site ? [site.region, site.format, site.status].filter(Boolean).join(' · ') : null
              return line(e.key, e.label, sub)
            })}
            {line('G_CONS', 'Consolidated', null, true)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
