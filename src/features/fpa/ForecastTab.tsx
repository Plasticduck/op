import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { fpa, type FpaEntity, type FpaForecastRow, type FpaVersion } from '@/lib/queries/fpa'
import { FORECAST_ROWS, change, inEntity, intFmt, money, monthLabel, monthRange, pct, ratio, sumOf, type Series } from './model'

const TH = 'px-2 py-2 text-right font-medium whitespace-nowrap'
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

// The workbook's forecast engine, rolled up for the chosen entity the way its
// FORECAST tab does, next to the actuals for the full-year view.
export function ForecastTab({ entity, series, version, lastClosed }: { entity: FpaEntity | null; series: Series | null; version: FpaVersion; lastClosed: string }) {
  const [rows, setRows] = useState<FpaForecastRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fpa.forecast().then((r) => { if (alive) setRows(r) }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])

  // metric -> month -> value for this entity.
  const agg = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const r of rows ?? []) {
      if (!entity || !inEntity(r, entity.filter_field, entity.filter_value)) continue
      let mm = m.get(r.metric)
      if (!mm) m.set(r.metric, (mm = new Map()))
      mm.set(r.month, (mm.get(r.month) ?? 0) + r.value)
    }
    return m
  }, [rows, entity])
  const months = useMemo(() => [...new Set((rows ?? []).map((r) => r.month))].sort(), [rows])

  if (error) return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load the forecast: {error}</p>
  if (!rows) return <p className="text-sm text-ink-muted">Loading the forecast…</p>
  if (!months.length) return <p className="text-sm text-ink-muted">This version of the workbook has no forecast.</p>
  if (!agg.size) return <p className="text-sm text-ink-muted">The forecast has nothing for {entity?.label ?? 'this entity'}.</p>

  const v = (metric: string, month: string) => agg.get(metric)?.get(month) ?? null
  const fsum = (metric: string, ms: string[]) => ms.reduce<number | null>((t, m) => (v(metric, m) == null ? t : (t ?? 0) + (v(metric, m) as number)), null)
  const year = Number(lastClosed.slice(0, 4))
  const curFcMonths = months.filter((m) => m.startsWith(`${year}-`))
  const nextYear = months.filter((m) => m.startsWith(`${year + 1}-`))
  const actualMonths = (y: number) => monthRange(`${y}-01-01`, y === year ? lastClosed : `${y}-12-01`)

  const full = [
    { label: 'Net revenue', actual: 'Net Revenue', fc: 'Net Revenue', fmt: money },
    { label: 'EBITDA', actual: 'EBITDA', fc: 'EBITDA', fmt: money },
    { label: 'Total cars', actual: 'Cars Washed', fc: 'Total Cars', fmt: intFmt },
  ].map((r) => {
    const prior = series ? sumOf(series, r.actual, actualMonths(year - 1)) : null
    const ytd = series ? sumOf(series, r.actual, actualMonths(year)) : null
    const rest = fsum(r.fc, curFcMonths)
    const est = ytd == null && rest == null ? null : (ytd ?? 0) + (rest ?? 0)
    const next = fsum(r.fc, nextYear)
    return { ...r, prior, ytd, rest, est, next }
  })

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-border bg-card">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Full year · {entity?.label ?? ''}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium" />
                <th className={TH}>FY{year - 1} actual</th>
                <th className={TH}>FY{year} Jan to {monthLabel(lastClosed).split(' ')[0]} actual</th>
                <th className={TH}>Rest of {year} forecast</th>
                <th className={TH}>FY{year} estimate</th>
                <th className={TH}>vs FY{year - 1}</th>
                <th className={TH}>FY{year + 1} forecast</th>
                <th className={TH}>vs FY{year} est.</th>
              </tr>
            </thead>
            <tbody>
              {full.map((r) => (
                <tr key={r.label} className="border-t border-border">
                  <td className="px-3 py-1.5 text-left font-medium text-ink">{r.label}</td>
                  <td className={TD}>{r.fmt(r.prior)}</td>
                  <td className={TD}>{r.fmt(r.ytd)}</td>
                  <td className={TD}>{r.fmt(r.rest)}</td>
                  <td className={cn(TD, 'font-semibold text-ink')}>{r.fmt(r.est)}</td>
                  <td className={TD}>{pct(change(r.est, r.prior), true)}</td>
                  <td className={cn(TD, 'font-semibold text-ink')}>{r.fmt(r.next)}</td>
                  <td className={TD}>{pct(change(r.next, r.est), true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">{version.info.forecast_title ?? 'Forecast'} · {entity?.label ?? ''}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[1400px] text-sm">
            <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="sticky left-0 bg-content px-3 py-2 text-left font-medium">Metric</th>
                {months.map((m) => <th key={m} className={TH}>{monthLabel(m)}</th>)}
                {nextYear.length > 0 && <th className={cn(TH, 'border-l border-border')}>FY{year + 1}</th>}
              </tr>
            </thead>
            <tbody>
              {FORECAST_ROWS.map((r) => {
                const fmt = r.fmt === 'int' ? intFmt : money
                const yearVal = r.stock ? v(r.metric, nextYear[nextYear.length - 1]) : fsum(r.metric, nextYear)
                return (
                  <tr key={r.metric} className={cn('border-t border-border', r.bold && 'bg-content/40 font-semibold text-ink')}>
                    <td className={cn('sticky left-0 px-3 py-1.5 text-left', r.bold ? 'bg-content' : 'bg-card')}>{r.label}</td>
                    {months.map((m) => <td key={m} className={TD}>{fmt(v(r.metric, m))}</td>)}
                    {nextYear.length > 0 && <td className={cn(TD, 'border-l border-border font-semibold')}>{fmt(yearVal)}</td>}
                  </tr>
                )
              })}
              <tr className="border-t border-border text-ink-muted">
                <td className="sticky left-0 bg-card px-3 py-1.5 text-left">EBITDA margin</td>
                {months.map((m) => <td key={m} className={TD}>{pct(ratio(v('EBITDA', m), v('Net Revenue', m)))}</td>)}
                {nextYear.length > 0 && <td className={cn(TD, 'border-l border-border')}>{pct(ratio(fsum('EBITDA', nextYear), fsum('Net Revenue', nextYear)))}</td>}
              </tr>
            </tbody>
          </table>
        </div>
        {!!version.info.forecast_notes?.length && (
          <ul className="list-disc space-y-1 px-8 py-3 text-xs text-ink-muted">
            {version.info.forecast_notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </section>
    </div>
  )
}
