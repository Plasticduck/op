import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { fpa, type FpaBudgetRow, type FpaVersion } from '@/lib/queries/fpa'
import { change, money, pct } from './model'

const TH = 'px-2 py-2 text-right font-medium whitespace-nowrap'
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'
const tone = (v: number | null) => (v == null || Math.abs(v) < 0.5 ? 'text-ink-muted' : v > 0 ? 'text-ok' : 'text-danger')
const add = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0))
const minus = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b)

type Sums = Pick<FpaBudgetRow, 'revenue_actual' | 'revenue_budget' | 'ebitda_actual' | 'ebitda_budget' | 'adj_ebitda_actual' | 'adj_ebitda_budget'>
const ZERO: Sums = { revenue_actual: null, revenue_budget: null, ebitda_actual: null, ebitda_budget: null, adj_ebitda_actual: null, adj_ebitda_budget: null }
const sum = (rows: Sums[]): Sums => rows.reduce<Sums>((t, r) => ({
  revenue_actual: add(t.revenue_actual, r.revenue_actual), revenue_budget: add(t.revenue_budget, r.revenue_budget),
  ebitda_actual: add(t.ebitda_actual, r.ebitda_actual), ebitda_budget: add(t.ebitda_budget, r.ebitda_budget),
  adj_ebitda_actual: add(t.adj_ebitda_actual, r.adj_ebitda_actual), adj_ebitda_budget: add(t.adj_ebitda_budget, r.adj_ebitda_budget),
}), ZERO)

// The workbook's Budget vs Actual tab: the budget period, by location.
export function BudgetTab({ version }: { version: FpaVersion }) {
  const [rows, setRows] = useState<FpaBudgetRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fpa.budget().then((r) => { if (alive) setRows(r) }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [])
  if (error) return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load the budget: {error}</p>
  if (!rows) return <p className="text-sm text-ink-muted">Loading the budget…</p>
  const locs = rows.filter((r) => r.key !== 'TOTAL')
  if (!locs.length) return <p className="text-sm text-ink-muted">This version of the workbook has no budget vs actual table.</p>
  const total = rows.find((r) => r.key === 'TOTAL') ?? { ...sum(locs), key: 'TOTAL', location: 'Total company' }
  const regions = [...new Set(locs.map((r) => r.region ?? 'Other'))]
  const inBudget = sum(locs.filter((r) => r.in_budget))
  const notIn = sum(locs.filter((r) => r.in_budget === false))

  const cells = (r: Sums) => (
    <>
      <td className={TD}>{money(r.revenue_actual)}</td>
      <td className={TD}>{money(r.revenue_budget)}</td>
      <td className={cn(TD, tone(minus(r.revenue_actual, r.revenue_budget)))}>{money(minus(r.revenue_actual, r.revenue_budget))}</td>
      <td className={cn(TD, tone(minus(r.revenue_actual, r.revenue_budget)))}>{pct(change(r.revenue_actual, r.revenue_budget), true)}</td>
      <td className={TD}>{money(r.ebitda_actual)}</td>
      <td className={TD}>{money(r.ebitda_budget)}</td>
      <td className={cn(TD, tone(minus(r.ebitda_actual, r.ebitda_budget)))}>{money(minus(r.ebitda_actual, r.ebitda_budget))}</td>
      <td className={TD}>{money(r.adj_ebitda_actual)}</td>
      <td className={TD}>{money(r.adj_ebitda_budget)}</td>
      <td className={cn(TD, tone(minus(r.adj_ebitda_actual, r.adj_ebitda_budget)))}>{money(minus(r.adj_ebitda_actual, r.adj_ebitda_budget))}</td>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Total company', r: total },
          { label: 'Budgeted locations (like for like)', r: inBudget },
          { label: 'Not in budget (new, closed, Spotless)', r: notIn },
        ].map(({ label, r }) => (
          <div key={label} className="rounded-md border border-border bg-card px-3 py-3 text-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
            <p className="mt-1 text-ink">Revenue <b className="tabular-nums">{money(r.revenue_actual)}</b> vs <span className="tabular-nums">{money(r.revenue_budget)}</span> <span className={tone(minus(r.revenue_actual, r.revenue_budget))}>{pct(change(r.revenue_actual, r.revenue_budget), true)}</span></p>
            <p className="text-ink">EBITDA <b className="tabular-nums">{money(r.ebitda_actual)}</b> vs <span className="tabular-nums">{money(r.ebitda_budget)}</span></p>
            <p className="text-ink">Adj. EBITDA <b className="tabular-nums">{money(r.adj_ebitda_actual)}</b> vs <span className="tabular-nums">{money(r.adj_ebitda_budget)}</span></p>
          </div>
        ))}
      </section>

      <section className="rounded-md border border-border bg-card">
        <h2 className="px-4 pt-4 text-sm font-semibold text-ink">{version.info.budget_title ?? 'Budget vs actual'}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th rowSpan={2} className="px-3 py-2 text-left align-bottom font-medium">Location</th>
                <th colSpan={4} className="border-l border-border px-2 pt-2 text-center font-semibold">Revenue</th>
                <th colSpan={3} className="border-l border-border px-2 pt-2 text-center font-semibold">EBITDA</th>
                <th colSpan={3} className="border-l border-border px-2 pt-2 text-center font-semibold">Adjusted EBITDA</th>
              </tr>
              <tr>
                <th className={cn(TH, 'border-l border-border')}>Actual</th><th className={TH}>Budget</th><th className={TH}>Var $</th><th className={TH}>Var %</th>
                <th className={cn(TH, 'border-l border-border')}>Actual</th><th className={TH}>Budget</th><th className={TH}>Var $</th>
                <th className={cn(TH, 'border-l border-border')}>Actual</th><th className={TH}>Budget</th><th className={TH}>Var $</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((reg) => {
                const list = locs.filter((r) => (r.region ?? 'Other') === reg)
                return [
                  ...list.map((r) => (
                    <tr key={r.key} className={cn('border-t border-border', r.in_budget === false && 'text-ink-muted')}>
                      <td className="px-3 py-1.5 text-left">
                        <span className="text-ink">{r.location ?? r.key}</span>
                        <span className="block text-xs text-ink-muted">{[r.region, r.landlord, r.in_budget === false ? 'not in budget' : null].filter(Boolean).join(' · ')}</span>
                      </td>
                      {cells(r)}
                    </tr>
                  )),
                  list.length > 1 && (
                    <tr key={`t-${reg}`} className="border-t border-border bg-content/40 font-semibold text-ink">
                      <td className="px-3 py-1.5 text-left">Total {reg}</td>
                      {cells(sum(list))}
                    </tr>
                  ),
                ]
              })}
              <tr className="border-t-2 border-border bg-content/60 font-bold text-ink">
                <td className="px-3 py-2 text-left">Total company</td>
                {cells(total)}
              </tr>
            </tbody>
          </table>
        </div>
        {!!version.info.budget_notes?.length && (
          <ul className="list-disc space-y-1 px-8 py-3 text-xs text-ink-muted">
            {version.info.budget_notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
      </section>
    </div>
  )
}
