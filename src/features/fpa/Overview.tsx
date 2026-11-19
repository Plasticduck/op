import { Fragment, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fpa, type FpaEntity } from '@/lib/queries/fpa'
import {
  KPIS, PL_ROWS, at, change, fmtKpi, money, moneyShort, monthLabel, monthRange, addMonths, pct, periods, pts, ratio, sumOf,
  type Periods, type Series,
} from './model'
import { TrendChart } from './TrendChart'

// Lines where a rise is bad (costs), for colouring the changes.
const COSTS = new Set([
  'Chemical (CPC)', 'Labor – Hourly (COGS)', 'Lube Product Cost', 'Other COGS', 'Total COGS', 'Salaried Site Managers',
  'Corporate Salaries & Bonuses', 'Payroll Taxes, Benefits & Services', 'Electricity', 'Water / Storm / Sewer', 'Other Utilities',
  'Repairs & Maintenance', 'Backroom Chemical', 'Sales & Marketing', 'Merchant Fees', 'Insurance (P&C)', 'Technology & Software',
  'Property & Other Taxes', 'Startup / Pre-Opening', 'Other Operating Expenses', 'Guarantee Payments', 'Corporate Allocation',
  'Total Operating Expenses', 'Other Non-Operating Expense', 'Rent – MW Properties', 'Rent – MW Holdings', 'Rent – Other Leases', 'Total Rent',
  'Depreciation & Amortization', 'Interest Expense', 'Franchise (Income) Tax', 'ASC 842 Lease Reclass',
])

const tone = (c: number | null, cost: boolean) =>
  c == null || Math.abs(c) < 0.0005 ? 'text-ink-muted' : (c > 0) !== cost ? 'text-ok' : 'text-danger'

export function Overview({ series, entity, month }: { series: Series | null; entity: FpaEntity | null; month: string }) {
  const p = useMemo(() => periods(month), [month])
  if (!series) return <p className="text-sm text-ink-muted">Loading {entity?.label ?? 'the model'}…</p>
  return (
    <div className="flex flex-col gap-5">
      <Tiles s={series} p={p} />
      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-ink">Net revenue and EBITDA, last 24 months</h2>
        <TrendChart
          points={monthRange(addMonths(month, -23), month).map((m) => ({ month: m, a: at(series, 'Net Revenue', m), b: at(series, 'EBITDA', m) }))}
          aLabel="Net revenue"
          bLabel="EBITDA"
        />
      </section>
      <PlTable s={series} p={p} entity={entity} />
      <KpiTable s={series} p={p} />
    </div>
  )
}

function Tile({ label, value, line1, line2 }: { label: string; value: string; line1?: React.ReactNode; line2?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-card px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold tabular-nums text-ink">{value}</p>
      {line1 && <p className="mt-0.5 text-xs text-ink-muted">{line1}</p>}
      {line2 && <p className="text-xs text-ink-muted">{line2}</p>}
    </div>
  )
}

const Delta = ({ c, cost = false }: { c: number | null; cost?: boolean }) => <span className={tone(c, cost)}>{pct(c, true)}</span>

function Tiles({ s, p }: { s: Series; p: Periods }) {
  const rev = at(s, 'Net Revenue', p.month)
  const ebitda = at(s, 'EBITDA', p.month)
  const revYtd = sumOf(s, 'Net Revenue', p.ytd)
  const ebitdaYtd = sumOf(s, 'EBITDA', p.ytd)
  const cars = at(s, 'Cars Washed', p.month)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile label={`Net revenue · ${monthLabel(p.month)}`} value={moneyShort(rev)}
        line1={<>vs PM <Delta c={change(rev, at(s, 'Net Revenue', p.pm))} /> · vs PY <Delta c={change(rev, at(s, 'Net Revenue', p.py))} /></>} />
      <Tile label={`EBITDA · ${monthLabel(p.month)}`} value={moneyShort(ebitda)}
        line1={`Margin ${pct(ratio(ebitda, rev))}`} line2={<>vs PY <Delta c={change(ebitda, at(s, 'EBITDA', p.py))} /></>} />
      <Tile label="Net revenue · YTD" value={moneyShort(revYtd)}
        line1={<>vs PY <Delta c={change(revYtd, sumOf(s, 'Net Revenue', p.pyYtd))} /></>} />
      <Tile label="EBITDA · YTD" value={moneyShort(ebitdaYtd)}
        line1={`Margin ${pct(ratio(ebitdaYtd, revYtd))}`} line2={<>vs PY <Delta c={change(ebitdaYtd, sumOf(s, 'EBITDA', p.pyYtd))} /></>} />
      <Tile label="EBITDAR · TTM" value={moneyShort(sumOf(s, 'EBITDAR', p.ttm))}
        line1={`TTM EBITDA ${moneyShort(sumOf(s, 'EBITDA', p.ttm))}`} />
      <Tile label={`Cars · ${monthLabel(p.month)}`} value={cars == null ? 'n/a' : Math.round(cars).toLocaleString('en-US')}
        line1={<>vs PY <Delta c={change(cars, at(s, 'Cars Washed', p.py))} /></>}
        line2={`YTD ${(sumOf(s, 'Cars Washed', p.ytd) ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`} />
    </div>
  )
}

type Cols = { m: number | null; pm: number | null; py: number | null; ytd: number | null; pyYtd: number | null; ttm: number | null }
const colsFor = (get: (months: string[]) => number | null, p: Periods): Cols => ({
  m: get([p.month]), pm: get([p.pm]), py: get([p.py]), ytd: get(p.ytd), pyYtd: get(p.pyYtd), ttm: get(p.ttm),
})

const TH = 'px-2 py-2 text-right font-medium whitespace-nowrap'
const TD = 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap'

function PlTable({ s, p, entity }: { s: Series; p: Periods; entity: FpaEntity | null }) {
  const rev: Cols = colsFor((ms) => sumOf(s, 'Net Revenue', ms), p)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h2 className="text-sm font-semibold text-ink">P&L · {entity?.label ?? ''}</h2>
        <p className="text-xs text-ink-muted">QuickBooks accounts rolled into the model’s lines. Tap a line for its GL accounts.</p>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Line</th>
              <th className={TH}>{monthLabel(p.month)}</th>
              <th className={TH}>% rev</th>
              <th className={TH}>Prior month</th>
              <th className={TH}>vs PM</th>
              <th className={TH}>{monthLabel(p.py)}</th>
              <th className={TH}>vs PY</th>
              <th className={TH}>YTD</th>
              <th className={TH}>% rev</th>
              <th className={TH}>PY YTD</th>
              <th className={TH}>vs PY</th>
              <th className={TH}>TTM</th>
            </tr>
          </thead>
          <tbody>
            {PL_ROWS.map((row, i) => {
              if (row.kind === 'header') {
                return (
                  <tr key={`h${i}`} className="border-t border-border bg-content/50">
                    <td colSpan={12} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{row.label}</td>
                  </tr>
                )
              }
              const c = colsFor((ms) => sumOf(s, row.metric, ms), p)
              if (row.kind === 'line' && [c.m, c.pm, c.py, c.ytd, c.pyYtd, c.ttm].every((v) => v == null || Math.abs(v) < 0.005)) return null
              const cost = COSTS.has(row.metric)
              const isTotal = row.kind === 'total'
              const drill = row.kind === 'line' && row.drill && entity
              const expanded = open === row.metric
              return (
                <Fragment key={row.metric}>
                  <tr
                    className={cn(
                      'border-t border-border',
                      isTotal && 'bg-content/40 font-semibold text-ink',
                      row.kind === 'memo' && 'italic text-ink-muted',
                      drill && 'cursor-pointer hover:bg-content',
                    )}
                    onClick={drill ? () => setOpen(expanded ? null : row.metric) : undefined}
                    aria-expanded={drill ? expanded : undefined}
                  >
                    <td className="px-3 py-1.5 text-left">
                      <span className="inline-flex items-center gap-1">
                        {drill ? (expanded ? <ChevronDown className="size-3.5 text-ink-subtle" /> : <ChevronRight className="size-3.5 text-ink-subtle" />) : <span className="w-3.5" />}
                        {row.kind === 'memo' ? row.label : row.metric}
                      </span>
                    </td>
                    <td className={TD}>{money(c.m)}</td>
                    <td className={cn(TD, 'text-ink-muted')}>{pct(ratio(c.m, rev.m))}</td>
                    <td className={TD}>{money(c.pm)}</td>
                    <td className={cn(TD, tone(change(c.m, c.pm), cost))}>{pct(change(c.m, c.pm), true)}</td>
                    <td className={TD}>{money(c.py)}</td>
                    <td className={cn(TD, tone(change(c.m, c.py), cost))}>{pct(change(c.m, c.py), true)}</td>
                    <td className={TD}>{money(c.ytd)}</td>
                    <td className={cn(TD, 'text-ink-muted')}>{pct(ratio(c.ytd, rev.ytd))}</td>
                    <td className={TD}>{money(c.pyYtd)}</td>
                    <td className={cn(TD, tone(change(c.ytd, c.pyYtd), cost))}>{pct(change(c.ytd, c.pyYtd), true)}</td>
                    <td className={TD}>{money(c.ttm)}</td>
                  </tr>
                  {expanded && entity && <Drill metric={row.metric} entity={entity} p={p} rev={rev} cost={cost} />}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-ink-muted">
        Costs are shown as positive amounts, as in QuickBooks. EBITDA = gross profit − operating expenses ± other non-operating items − rent; Net income adds the lines below it.
      </p>
    </section>
  )
}

// One line's GL accounts, from the QuickBooks lines behind it.
function Drill({ metric, entity, p, rev, cost }: { metric: string; entity: FpaEntity; p: Periods; rev: Cols; cost: boolean }) {
  const [rows, setRows] = useState<{ account: string; c: Cols }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fpa.plLines(metric, { field: entity.filter_field, value: entity.filter_value }, p.pyYtd[0], p.month)
      .then((lines) => {
        if (!alive) return
        const by = new Map<string, Map<string, number>>()
        for (const l of lines) {
          const k = l.account ?? '(no account)'
          let m = by.get(k)
          if (!m) by.set(k, (m = new Map()))
          m.set(l.month, (m.get(l.month) ?? 0) + l.amount)
        }
        const sum = (m: Map<string, number>, ms: string[]) => {
          let any = false
          let t = 0
          for (const x of ms) if (m.has(x)) { any = true; t += m.get(x)! }
          return any ? t : null
        }
        setRows([...by.entries()]
          .map(([account, m]) => ({ account, c: { m: sum(m, [p.month]), pm: sum(m, [p.pm]), py: sum(m, [p.py]), ytd: sum(m, p.ytd), pyYtd: sum(m, p.pyYtd), ttm: sum(m, p.ttm) } }))
          .sort((a, b) => Math.abs(b.c.ytd ?? 0) - Math.abs(a.c.ytd ?? 0)))
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [metric, entity.filter_field, entity.filter_value, p])
  if (error) return <tr><td colSpan={12} className="px-8 py-2 text-xs text-danger">Could not load the accounts: {error}</td></tr>
  if (!rows) return <tr><td colSpan={12} className="px-8 py-2 text-xs text-ink-muted"><Loader2 className="mr-1 inline size-3.5 animate-spin" />Loading GL accounts…</td></tr>
  if (!rows.length) return <tr><td colSpan={12} className="px-8 py-2 text-xs text-ink-muted">No QuickBooks lines for this period.</td></tr>
  return (
    <>
      {rows.map(({ account, c }) => (
        <tr key={account} className="border-t border-border/60 bg-content/30 text-xs text-ink-muted">
          <td className="py-1 pl-10 pr-3 text-left">{account}</td>
          <td className={TD}>{money(c.m)}</td>
          <td className={TD}>{pct(ratio(c.m, rev.m))}</td>
          <td className={TD}>{money(c.pm)}</td>
          <td className={cn(TD, tone(change(c.m, c.pm), cost))}>{pct(change(c.m, c.pm), true)}</td>
          <td className={TD}>{money(c.py)}</td>
          <td className={cn(TD, tone(change(c.m, c.py), cost))}>{pct(change(c.m, c.py), true)}</td>
          <td className={TD}>{money(c.ytd)}</td>
          <td className={TD}>{pct(ratio(c.ytd, rev.ytd))}</td>
          <td className={TD}>{money(c.pyYtd)}</td>
          <td className={cn(TD, tone(change(c.ytd, c.pyYtd), cost))}>{pct(change(c.ytd, c.pyYtd), true)}</td>
          <td className={TD}>{money(c.ttm)}</td>
        </tr>
      ))}
    </>
  )
}

function KpiTable({ s, p }: { s: Series; p: Periods }) {
  return (
    <section className="rounded-md border border-border bg-card">
      <h2 className="px-4 pt-4 text-sm font-semibold text-ink">Operating KPIs</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-content text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">KPI</th>
              <th className={TH}>{monthLabel(p.month)}</th>
              <th className={TH}>Prior month</th>
              <th className={TH}>vs PM</th>
              <th className={TH}>{monthLabel(p.py)}</th>
              <th className={TH}>vs PY</th>
              <th className={TH}>YTD</th>
              <th className={TH}>PY YTD</th>
              <th className={TH}>vs PY</th>
            </tr>
          </thead>
          <tbody>
            {KPIS.map((k) => {
              const v = { m: k.value(s, [p.month]), pm: k.value(s, [p.pm]), py: k.value(s, [p.py]), ytd: k.value(s, p.ytd), pyYtd: k.value(s, p.pyYtd) }
              const cost = /chemical|labor|water|electric|churn/i.test(k.label)
              const diff = (a: number | null, b: number | null) => (k.diffPts ? (a == null || b == null ? null : a - b) : change(a, b))
              const show = (a: number | null, b: number | null) => (k.diffPts ? pts(diff(a, b)) : pct(diff(a, b), true))
              return (
                <tr key={k.label} className="border-t border-border">
                  <td className="px-3 py-1.5 text-left text-ink">
                    {k.label}
                    {k.hint && <span className="ml-1 text-xs text-ink-subtle">· {k.hint}</span>}
                  </td>
                  <td className={cn(TD, 'text-ink')}>{fmtKpi(k.fmt, v.m)}</td>
                  <td className={TD}>{fmtKpi(k.fmt, v.pm)}</td>
                  <td className={cn(TD, tone(diff(v.m, v.pm), cost))}>{show(v.m, v.pm)}</td>
                  <td className={TD}>{fmtKpi(k.fmt, v.py)}</td>
                  <td className={cn(TD, tone(diff(v.m, v.py), cost))}>{show(v.m, v.py)}</td>
                  <td className={cn(TD, 'text-ink')}>{fmtKpi(k.fmt, v.ytd)}</td>
                  <td className={TD}>{fmtKpi(k.fmt, v.pyYtd)}</td>
                  <td className={cn(TD, tone(diff(v.ytd, v.pyYtd), cost))}>{show(v.ytd, v.pyYtd)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-3 text-xs text-ink-muted">
        Per-car figures use the model’s qualifying cars (sites with at least its minimum cars that month). Members are month-end counts from the POS.
      </p>
    </section>
  )
}
