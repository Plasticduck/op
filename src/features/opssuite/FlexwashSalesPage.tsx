import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert, Download } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { flexwashSales, type FlexSite, type FlexSalesReport, type FlexBreakdown } from '@/lib/queries/flexwashSales'
import { downloadFlexwashSalesPdf } from '@/lib/flexwashSalesPdf'

const num = (n: number) => Math.round(n).toLocaleString('en-US')
const money = (n: number) => currency(n)
const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')

// A titled report block, styled like the rest of the app.
function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-ink-subtle">{sub}</p>}
      </div>
      {children}
    </section>
  )
}

const th = 'px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle first:text-left'
const td = 'px-4 py-2 text-right text-sm text-ink first:text-left tabular-nums'

// One Description | Count | Amount row (DRB report shape).
function Row({ label, count, amount, strong }: { label: string; count?: number | string; amount?: number; strong?: boolean }) {
  return (
    <tr className={cn('border-t border-border', strong && 'bg-content/60 font-semibold')}>
      <td className={cn(td, strong && 'font-semibold')}>{label}</td>
      <td className={td}>{count == null ? '' : typeof count === 'number' ? num(count) : count}</td>
      <td className={td}>{amount == null ? '' : money(amount)}</td>
    </tr>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-subtle">{sub}</div>}
    </div>
  )
}

export default function FlexwashSalesPage() {
  const [sites, setSites] = useState<FlexSite[]>([])
  const [carWashId, setCarWashId] = useState<string>('')
  const [start, setStart] = useState(yesterday())
  const [end, setEnd] = useState(yesterday())
  const [report, setReport] = useState<FlexSalesReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breakdown, setBreakdown] = useState<FlexBreakdown | null>(null)
  const [bdLoading, setBdLoading] = useState(false)

  useEffect(() => {
    flexwashSales.sites().then((s) => {
      setSites(s)
      if (s.length) setCarWashId((cur) => cur || s[0].car_wash_id)
    })
  }, [])

  useEffect(() => {
    const ids = carWashId === 'all' ? sites.map((s) => s.car_wash_id) : carWashId ? [carWashId] : []
    if (!ids.length || !start || !end || start > end) return
    let active = true
    setLoading(true)
    setError(null)
    flexwashSales
      .report(ids, start, end)
      .then((r) => { if (active) { setReport(r); setLoading(false) } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    setBdLoading(true)
    flexwashSales
      .lineItemBreakdown(ids, start, end)
      .then((b) => { if (active) { setBreakdown(b); setBdLoading(false) } })
      .catch(() => { if (active) { setBreakdown(null); setBdLoading(false) } })
    return () => { active = false }
  }, [carWashId, sites, start, end])

  const siteLabel = useMemo(() => {
    if (carWashId === 'all') return 'All Sites'
    const s = sites.find((x) => x.car_wash_id === carWashId)
    return s ? `#${s.site_number}` : ''
  }, [sites, carWashId])

  const r = report
  // Discounts from FlexWash's discount endpoint plus rewashes (pulled from the line items).
  const discounts = r ? [...r.discounts, ...(breakdown?.extraDiscounts ?? [])].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) : []

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="FlexWash Sales Reports"
        subtitle="Daily sales for the FlexWash sites (17, 18, 29, 30), grouped to mirror the DRB General Sales Report."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {error ? 'Load failed' : loading ? 'Loading...' : report ? 'Loaded' : 'Pick a site'}
          </span>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="fw-site" className="text-xs font-medium text-ink-muted">Site</label>
          <Select id="fw-site" value={carWashId} onChange={(e) => setCarWashId(e.target.value)} className="h-9 w-48">
            <option value="all">All Sites</option>
            {sites.map((s) => (
              <option key={s.car_wash_id} value={s.car_wash_id}>#{s.site_number}{s.name ? ` — ${s.name}` : ''}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fw-start" className="text-xs font-medium text-ink-muted">From</label>
          <Input id="fw-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fw-end" className="text-xs font-medium text-ink-muted">To</label>
          <Input id="fw-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 w-40" />
        </div>
        <Button
          variant="secondary"
          className="ml-auto"
          disabled={!report || loading}
          onClick={() => report && downloadFlexwashSalesPdf({ ...report, discounts }, breakdown, { siteLabel, start, end, brandLogoUrl: '/mighty-max-in-flight.png' })}
        >
          <Download className="size-4" /> Export PDF
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load FlexWash data.</p>
            <p className="mt-0.5 text-danger/80">{error}</p>
          </div>
        </div>
      )}

      {!r && !error && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
          {loading ? 'Loading FlexWash sales...' : 'Select a site and date range.'}
        </p>
      )}

      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Cars washed" value={num(r.wash.total)} sub={`${num(r.wash.single)} single · ${num(r.wash.member)} member`} />
            <Kpi label="Net site sales" value={money(r.revenue.total)} sub="total to account for" />
            <Kpi label="Membership recharge" value={money(r.revenue.membership)} sub="ARM plans recharged" />
            <Kpi label="Plans sold" value={num(r.plans.total)} sub="new memberships" />
          </div>

          <Section title="Line Item Sales Breakdown" sub="Net sales by product (discounts folded into each wash, like items grouped; tax excluded). Ticket Avg = revenue / count.">
            {bdLoading && !breakdown ? (
              <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">Loading line items...</p>
            ) : breakdown && breakdown.groups.length ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Line Item</th>
                      <th className={th}>Count</th>
                      <th className={th}>Ticket Avg</th>
                      <th className={th}>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {breakdown.groups.map((g) => (
                      <Fragment key={g.key}>
                        <tr className="border-t-2 border-border bg-content/60">
                          <td className={cn(td, 'font-semibold')}>{g.label}</td>
                          <td className={cn(td, 'font-semibold')}>{num(g.count)}</td>
                          <td className={cn(td, 'font-semibold')}>{money(g.count ? g.revenue / g.count : 0)}</td>
                          <td className={cn(td, 'font-semibold')}>{money(g.revenue)}</td>
                        </tr>
                        {g.items.map((it) => (
                          <tr key={g.key + it.name} className="border-t border-border">
                            <td className="px-4 py-2 pl-8 text-left text-sm text-ink-muted">{it.name}</td>
                            <td className={td}>{num(it.count)}</td>
                            <td className={td}>{money(it.count ? it.revenue / it.count : 0)}</td>
                            <td className={td}>{money(it.revenue)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-sm text-ink-muted sm:px-5">No line items for this range.</p>
            )}
          </Section>

          <Section title="Carwash Sales" sub="Washes and retail revenue by service tier (FlexWash reports by tier, not by wash package name).">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Description</th>
                    <th className={th}>Washes</th>
                    <th className={th}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <Row label="Express" count={r.wash.express} amount={r.revenue.express} />
                  <Row label="Full Service" count={r.wash.fullService} amount={r.revenue.fullService} />
                  <Row label="Detail" count={r.wash.detail} amount={r.revenue.detail} />
                  <Row label="Fleet" count={r.wash.fleet} amount={r.revenue.fleet} />
                  <Row label="Gross Wash Sales (retail)" amount={r.revenue.retailWash} strong />
                  <Row label="Wash Book (prepaid)" amount={r.revenue.washBook} />
                  <Row label="Gift Cards" amount={r.revenue.giftCard} />
                  <Row label="Adjustments / Other" amount={r.revenue.other} />
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-4 py-2 text-xs text-ink-subtle sm:px-5">
              Payment mix: {num(r.wash.single)} single (retail) washes, {num(r.wash.member)} member washes, {num(r.wash.total)} total.
            </div>
          </Section>

          <Section title="Prepaid Plans & Membership" sub="New plans sold and membership activity (DRB: ARM Plans Sold / Recharged / Redeemed).">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={th}>Description</th>
                    <th className={th}>Count</th>
                    <th className={th}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.plans.byTier.map((p) => (
                    <Row key={p.name} label={p.name} count={p.count} />
                  ))}
                  <Row label="Plans Sold (total)" count={r.plans.total} strong />
                  <Row label="Membership Recharge" amount={r.revenue.membership} />
                  <Row label="Member Redemptions" count={r.wash.member} />
                </tbody>
              </table>
            </div>
          </Section>

          {discounts.length > 0 && (
            <Section title="Discounts" sub="Named discount lines (DRB: Less Wash Discounts).">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Discount</th>
                      <th className={th}>Count</th>
                      <th className={th}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discounts.map((d) => (
                      <Row key={d.name} label={d.name} count={d.count} amount={-Math.abs(d.amount)} />
                    ))}
                    <Row label="Total Discounts" count={discounts.reduce((a, d) => a + d.count, 0)} amount={-discounts.reduce((a, d) => a + Math.abs(d.amount), 0)} strong />
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {r.accounting && (
            <Section title="Total to Account For" sub="Sales summary and tender breakdown (DRB: Total to Account For + credit-card/cash tenders).">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className={th}>Description</th>
                      <th className={th} />
                      <th className={th}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <Row label="Gross Sales" amount={r.accounting.gross} />
                    <Row label="Less Discounts" amount={-r.accounting.discount} />
                    {r.accounting.promotion !== 0 && <Row label="Less Promotions" amount={-r.accounting.promotion} />}
                    <Row label="Less Refunds" amount={-r.accounting.refund} />
                    <Row label="Net Sales" amount={r.accounting.net} strong />
                    <Row label="Cash" amount={r.accounting.cash} />
                    <Row label="Credit / Debit Card" amount={r.accounting.card} />
                    {r.accounting.giftCard !== 0 && <Row label="Gift Card" amount={r.accounting.giftCard} />}
                    {r.accounting.fleetUnpaid !== 0 && <Row label="Fleet (unpaid / A/R)" amount={r.accounting.fleetUnpaid} />}
                    <Row label="Total to Account For" amount={r.accounting.cash + r.accounting.card + r.accounting.giftCard + r.accounting.fleetUnpaid} strong />
                    <Row label="Sales Tax" amount={r.accounting.tax} />
                    {r.accounting.tip !== 0 && <Row label="Tips" amount={r.accounting.tip} />}
                  </tbody>
                </table>
              </div>
              {Object.entries(r.accounting.cardByProcessor).filter(([, v]) => v).length > 1 && (
                <div className="border-t border-border px-4 py-2 text-xs text-ink-subtle sm:px-5">
                  Card by processor: {Object.entries(r.accounting.cardByProcessor).filter(([, v]) => v).map(([k, v]) => `${k} ${money(v)}`).join(' · ')}.
                </div>
              )}
            </Section>
          )}

          <p className="px-1 text-xs leading-relaxed text-ink-subtle">
            {siteLabel} · {r.days} {r.days === 1 ? 'day' : 'days'}. All pulled live from the FlexWash partner API and grouped to match the DRB General Sales Report: line items, discounts, tenders, and total to account for. FlexWash reports card tenders by processor (Adyen/Clover/Pax) rather than by card brand.
          </p>
        </>
      )}
    </div>
  )
}
