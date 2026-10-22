import { Fragment, useEffect, useState } from 'react'
import { Download, TriangleAlert } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { flexwashSales, type FlexSite, type FlexDepositReport, type DepositDay } from '@/lib/queries/flexwashSales'

// FlexWash Deposit Report: mirrors FlexWash's own daily deposit report (Sales
// Performance → Payment Methods → Processor Settlement → Revenue Accounting), one
// table per site with a Totals row, plus the Voyager Fleet / Wex Fleet discount
// lines broken out per day. Adyen payouts often cover several days, so the
// settlement cells span those days, as on FlexWash's report.

// Previous calendar month as YYYY-MM (deposit reports are usually run monthly).
const lastMonth = () => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return d.toLocaleDateString('en-CA').slice(0, 7)
}
const monthRange = (ym: string): [string, string] => {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]
}
const mdy = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}`
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

const th = 'px-2 py-1.5 text-right text-[10px] font-semibold uppercase tracking-wide text-ink-subtle whitespace-nowrap first:text-left'
const td = 'px-2 py-1.5 text-right text-xs tabular-nums whitespace-nowrap first:text-left'

// Money cell; negatives in red like FlexWash's report.
function M({ v, strong }: { v: number; strong?: boolean }) {
  return <span className={cn(v < 0 && 'text-danger', strong && 'font-semibold')}>{currency(v)}</span>
}
function Fleet({ c, strong }: { c: { count: number; amount: number }; strong?: boolean }) {
  return (
    <span className={cn(strong && 'font-semibold')}>
      <M v={c.amount} strong={strong} />
      <span className="ml-1 text-[10px] text-ink-subtle">({c.count})</span>
    </span>
  )
}

const SUM_KEYS = ['gross', 'discounts', 'refunds', 'tips', 'net', 'fleet', 'prepaids', 'cash', 'card', 'earned', 'deferred', 'taxes', 'netRevenue'] as const

// Column groups, tinted per FlexWash's report so the sections read the same way.
const GROUPS = [
  { label: 'Sales Performance', sub: 'Net calculation', span: 5, cls: 'bg-accent/5' },
  { label: 'Payment Methods', sub: 'Channels', span: 4, cls: 'bg-accent/10' },
  { label: 'Fleet Cards', sub: 'Included in discounts', span: 2, cls: 'bg-content' },
  { label: 'Processor Settlement', sub: 'Adyen', span: 3, cls: 'bg-ok-soft' },
  { label: 'Revenue Accounting', sub: 'Earned & deferred', span: 4, cls: 'bg-warn-soft' },
]
const COLS = ['Gross Sales', 'Discounts', 'Refunds', 'Tips & Cash Back', 'Net Sales', 'Fleet', 'Prepaids', 'Cash', 'Card',
  'Voyager Fleet', 'Wex Fleet', 'Chargebacks', 'Fees', 'Deposits', 'Earned Sales', 'Deferred Sales', 'Taxes', 'Net Revenue']
// Which group each column falls in (for cell tint).
const COL_TINT = GROUPS.flatMap((g) => Array.from({ length: g.span }, () => g.cls))

function totals(r: FlexDepositReport) {
  const t = Object.fromEntries(SUM_KEYS.map((k) => [k, r.days.reduce((a, d) => a + d[k], 0)])) as Record<(typeof SUM_KEYS)[number], number>
  const fleetSum = (k: 'voyager' | 'wex') => r.days.reduce((a, d) => ({ count: a.count + d[k].count, amount: a.amount + d[k].amount }), { count: 0, amount: 0 })
  const settled = r.groups.filter((g) => g.settled)
  return {
    ...t,
    voyager: fleetSum('voyager'),
    wex: fleetSum('wex'),
    chargebacks: settled.reduce((a, g) => a + g.chargebacks, 0),
    fees: settled.reduce((a, g) => a + g.fees, 0),
    deposit: settled.reduce((a, g) => a + g.deposit, 0),
  }
}

function SiteTable({ title, r }: { title: string; r: FlexDepositReport }) {
  // Map each day to its payout group so settlement cells can span the group's days.
  const groupOf = new Map<string, number>()
  r.groups.forEach((g, i) => g.dates.forEach((d) => groupOf.set(d, i)))
  const t = totals(r)
  const pending = r.groups.some((g) => !g.settled)
  const tint = (i: number) => COL_TINT[i]

  const dayCells = (d: DepositDay) => [
    <M key="g" v={d.gross} />, <M key="di" v={d.discounts} />, <M key="r" v={d.refunds} />, <M key="t" v={d.tips} />, <M key="n" v={d.net} />,
    <M key="f" v={d.fleet} />, <M key="p" v={d.prepaids} />, <M key="c" v={d.cash} />, <M key="ca" v={d.card} />,
    <Fleet key="vo" c={d.voyager} />, <Fleet key="we" c={d.wex} />,
  ]
  const acctCells = (d: DepositDay) => [<M key="e" v={d.earned} />, <M key="de" v={d.deferred} />, <M key="tx" v={d.taxes} />, <M key="nr" v={d.netRevenue} strong />]

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {pending && <span className="text-xs font-medium text-warn">Some card payouts haven&apos;t posted yet (pending)</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th} />
              {GROUPS.map((g) => (
                <th key={g.label} colSpan={g.span} className={cn('border-x border-border px-2 py-1.5 text-center', g.cls)}>
                  <div className="text-[11px] font-semibold text-ink">{g.label}</div>
                  <div className="text-[9px] font-normal text-ink-subtle">{g.sub}</div>
                </th>
              ))}
            </tr>
            <tr className="border-b border-border">
              <th className={th}>Date</th>
              {COLS.map((c, i) => <th key={c} className={cn(th, tint(i))}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {r.days.map((d) => {
              const gi = groupOf.get(d.date)
              const g = gi != null ? r.groups[gi] : null
              const firstOfGroup = !!g && g.dates[0] === d.date
              return (
                <tr key={d.date} className="border-t border-border">
                  <td className={td}>{mdy(d.date)}</td>
                  {dayCells(d).map((cell, i) => <td key={i} className={cn(td, tint(i))}>{cell}</td>)}
                  {firstOfGroup && g && (
                    <>
                      <td rowSpan={g.dates.length} className={cn(td, tint(11), 'align-middle')}>{g.settled ? <M v={g.chargebacks} /> : ''}</td>
                      <td rowSpan={g.dates.length} className={cn(td, tint(12), 'align-middle')}>{g.settled ? <M v={g.fees} /> : ''}</td>
                      <td rowSpan={g.dates.length} className={cn(td, tint(13), 'align-middle')}>
                        {g.settled ? <M v={g.deposit} strong /> : <span className="text-warn">Pending</span>}
                        {g.dates.length > 1 && <div className="text-[9px] text-ink-subtle">{md(g.dates[0])} – {md(g.dates[g.dates.length - 1])}</div>}
                      </td>
                    </>
                  )}
                  {!g && <><td className={cn(td, tint(11))} /><td className={cn(td, tint(12))} /><td className={cn(td, tint(13))} /></>}
                  {acctCells(d).map((cell, i) => <td key={i} className={cn(td, tint(14 + i))}>{cell}</td>)}
                </tr>
              )
            })}
            <tr className="border-t-2 border-border bg-content/60 font-semibold">
              <td className={cn(td, 'font-semibold')}>Totals</td>
              {[t.gross, t.discounts, t.refunds, t.tips, t.net, t.fleet, t.prepaids, t.cash, t.card].map((v, i) => (
                <td key={i} className={cn(td, tint(i))}><M v={v} strong /></td>
              ))}
              <td className={cn(td, tint(9))}><Fleet c={t.voyager} strong /></td>
              <td className={cn(td, tint(10))}><Fleet c={t.wex} strong /></td>
              <td className={cn(td, tint(11))}><M v={t.chargebacks} strong /></td>
              <td className={cn(td, tint(12))}><M v={t.fees} strong /></td>
              <td className={cn(td, tint(13))}><M v={t.deposit} strong /></td>
              {[t.earned, t.deferred, t.taxes, t.netRevenue].map((v, i) => (
                <td key={i} className={cn(td, tint(14 + i))}><M v={v} strong /></td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function toCsv(sites: { title: string; r: FlexDepositReport }[]): string {
  const head = ['Site', 'Date', ...COLS.flatMap((c) => (c === 'Voyager Fleet' || c === 'Wex Fleet' ? [c + ' $', c + ' Count'] : [c]))]
  const lines = [head.join(',')]
  const f = (n: number) => n.toFixed(2)
  for (const { title, r } of sites) {
    const groupOf = new Map<string, number>()
    r.groups.forEach((g, i) => g.dates.forEach((d) => groupOf.set(d, i)))
    for (const d of r.days) {
      const g = groupOf.has(d.date) ? r.groups[groupOf.get(d.date)!] : null
      // Settlement goes on the group's first day only, so totals still add up.
      const first = !!g && g.dates[0] === d.date && g.settled
      lines.push([title, d.date, f(d.gross), f(d.discounts), f(d.refunds), f(d.tips), f(d.net), f(d.fleet), f(d.prepaids), f(d.cash), f(d.card),
        f(d.voyager.amount), d.voyager.count, f(d.wex.amount), d.wex.count,
        first ? f(g!.chargebacks) : '', first ? f(g!.fees) : '', first ? f(g!.deposit) : (g && !g.settled && g.dates[0] === d.date ? 'Pending' : ''),
        f(d.earned), f(d.deferred), f(d.taxes), f(d.netRevenue)].join(','))
    }
    const t = totals(r)
    lines.push([title, 'Totals', f(t.gross), f(t.discounts), f(t.refunds), f(t.tips), f(t.net), f(t.fleet), f(t.prepaids), f(t.cash), f(t.card),
      f(t.voyager.amount), t.voyager.count, f(t.wex.amount), t.wex.count, f(t.chargebacks), f(t.fees), f(t.deposit),
      f(t.earned), f(t.deferred), f(t.taxes), f(t.netRevenue)].join(','))
  }
  return lines.join('\n')
}

export default function FlexwashDepositReport({ sites }: { sites: FlexSite[] }) {
  const [site, setSite] = useState<string>('all')
  const [month, setMonth] = useState(lastMonth())
  const [data, setData] = useState<{ title: string; r: FlexDepositReport }[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const chosen = site === 'all' ? sites : sites.filter((s) => s.car_wash_id === site)
    if (!chosen.length || !/^\d{4}-\d{2}$/.test(month)) return
    const [start, end] = monthRange(month)
    let active = true
    setLoading(true)
    setError(null)
    Promise.all(chosen.map((s) => flexwashSales.deposit(s.car_wash_id, start, end).then((r) => ({ title: `MW #${s.site_number}`, r }))))
      .then((d) => { if (active) { setData(d); setLoading(false) } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    return () => { active = false }
  }, [site, month, sites])

  const exportCsv = () => {
    if (!data) return
    const blob = new Blob([toCsv(data)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `flexwash-deposit-${site === 'all' ? 'all-sites' : data[0]?.title.replace(/\W+/g, '') ?? 'site'}-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fd-site" className="text-xs font-medium text-ink-muted">Site</label>
          <Select id="fd-site" value={site} onChange={(e) => setSite(e.target.value)} className="h-9 w-48">
            <option value="all">All Sites</option>
            {sites.map((s) => <option key={s.car_wash_id} value={s.car_wash_id}>#{s.site_number}{s.name ? ` — ${s.name}` : ''}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fd-month" className="text-xs font-medium text-ink-muted">Month</label>
          <Input id="fd-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
        </div>
        <Button variant="secondary" className="ml-auto" disabled={!data || loading} onClick={exportCsv}>
          <Download className="size-4" /> Export CSV
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Could not load the deposit report.</p><p className="mt-0.5 text-danger/80">{error}</p></div>
        </div>
      )}

      {loading && <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">Loading deposit report…</p>}

      {!loading && data && data.map((s) => (
        <Fragment key={s.title}>
          {s.r.days.length
            ? <SiteTable title={s.title} r={s.r} />
            : <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-muted">{s.title}: no activity this month.</p>}
        </Fragment>
      ))}

      {!loading && data && (
        <p className="px-1 text-xs leading-relaxed text-ink-subtle">
          Pulled live from the FlexWash partner API, laid out like FlexWash&apos;s deposit report. Net Sales = Fleet + Prepaids + Cash + Card.
          Deposits = Card + Chargebacks + Fees, from the Adyen payout; a payout that covers several days spans those rows.
          Voyager Fleet and Wex Fleet are those fleet-card discount lines for the day (count in parentheses) — they are already part of Discounts, not added on top.
        </p>
      )}
    </div>
  )
}
