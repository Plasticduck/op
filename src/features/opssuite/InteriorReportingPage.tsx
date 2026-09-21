import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert, Armchair } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { flexwashSales, type FlexSite, type FlexInteriorReport } from '@/lib/queries/flexwashSales'
import { drbInterior, type DrbInteriorReport, type DrbSite } from '@/lib/queries/drbInterior'
import { carsWashedTotal } from '@/lib/queries/carsWashed'

// DRB detail categories in the order we present them.
const DRB_CAT_ORDER = ['Detail Services', 'Detail Extras', 'ARM Plans Sold', 'ARM Plans Recharged']

const num = (n: number) => Math.round(n).toLocaleString('en-US')
const money = (n: number) => currency(n)
const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const monthStart = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}

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

function Row({ label, count, amount, strong }: { label: string; count?: number; amount?: number; strong?: boolean }) {
  return (
    <tr className={cn('border-t border-border', strong && 'bg-content/60 font-semibold')}>
      <td className={cn(td, strong && 'font-semibold')}>{label}</td>
      <td className={td}>{count == null ? '' : num(count)}</td>
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

export default function InteriorReportingPage() {
  const [sites, setSites] = useState<FlexSite[]>([])
  const [drbSites, setDrbSites] = useState<DrbSite[]>([])
  // Combined site pick: 'all', 'fw:<car_wash_id>', or 'drb:<site_number>'.
  const [selection, setSelection] = useState<string>('all')
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(yesterday())
  const [report, setReport] = useState<FlexInteriorReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drb, setDrb] = useState<DrbInteriorReport | null>(null)
  const [drbLoading, setDrbLoading] = useState(false)
  const [drbError, setDrbError] = useState<string | null>(null)
  const [fwCars, setFwCars] = useState(0)
  const [drbCars, setDrbCars] = useState(0)

  useEffect(() => {
    flexwashSales.sites().then(setSites)
    drbInterior.sites().then(setDrbSites).catch(() => setDrbSites([]))
  }, [])

  // Which source(s) the current pick covers, and the ids/site numbers in scope.
  const fwActive = selection === 'all' || selection.startsWith('fw:')
  const drbActive = selection === 'all' || selection.startsWith('drb:')
  const fwIds = selection === 'all' ? sites.map((s) => s.car_wash_id) : selection.startsWith('fw:') ? [selection.slice(3)] : []
  const drbNums = selection.startsWith('drb:') ? [Number(selection.slice(4))] : []
  const fwSiteNums = fwIds.length ? sites.filter((s) => fwIds.includes(s.car_wash_id)).map((s) => s.site_number) : []
  const drbScopeNums = selection === 'all' ? drbSites.map((s) => s.site_number) : drbNums

  useEffect(() => {
    if (!fwActive) { setReport(null); setError(null); setFwCars(0); return }
    if (!fwIds.length || !start || !end || start > end) return
    let active = true
    setLoading(true)
    setError(null)
    flexwashSales
      .interiorReport(fwIds, start, end)
      .then((r) => { if (active) { setReport(r); setLoading(false) } })
      .catch((e) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })
    void carsWashedTotal(fwSiteNums, start, end).then((c) => { if (active) setFwCars(c) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, sites, start, end])

  useEffect(() => {
    if (!drbActive) { setDrb(null); setDrbError(null); setDrbCars(0); return }
    if (!start || !end || start > end) return
    let active = true
    setDrbLoading(true)
    setDrbError(null)
    drbInterior
      .report(start, end, drbNums.length ? drbNums : undefined)
      .then((d) => { if (active) { setDrb(d); setDrbLoading(false) } })
      .catch((e) => { if (active) { setDrbError(e instanceof Error ? e.message : String(e)); setDrbLoading(false) } })
    void carsWashedTotal(drbScopeNums, start, end).then((c) => { if (active) setDrbCars(c) })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, start, end, drbSites])

  const r = report
  const avgTicket = useMemo(() => (r && r.paid.count > 0 ? r.paid.revenue / r.paid.count : 0), [r])

  // DRB items grouped by category in a fixed order for display.
  const drbGroups = useMemo(() => {
    if (!drb) return []
    const rank = (c: string) => { const i = DRB_CAT_ORDER.indexOf(c); return i < 0 ? 99 : i }
    const map = new Map<string, { category: string; items: DrbInteriorReport['items']; count: number; revenue: number }>()
    for (const it of drb.items) {
      let g = map.get(it.category)
      if (!g) { g = { category: it.category, items: [], count: 0, revenue: 0 }; map.set(it.category, g) }
      g.items.push(it)
      g.count += it.count
      g.revenue += it.revenue
    }
    return [...map.values()].sort((a, b) => rank(a.category) - rank(b.category))
  }, [drb])

  // MVP UNLMTD membership rows, one per active source (+ a Total when both show).
  type MvpBucket = { count: number; revenue: number }
  const mvpRows: { src: string; sold: MvpBucket; recharged: MvpBucket }[] = []
  if (fwActive && report) mvpRows.push({ src: 'FlexWash', sold: report.mvp.sold, recharged: report.mvp.recharged })
  if (drbActive && drb) mvpRows.push({ src: 'DRB', sold: drb.mvp.sold, recharged: drb.mvp.recharged })
  const mvpTotal = mvpRows.reduce(
    (a, r2) => ({
      sold: { count: a.sold.count + r2.sold.count, revenue: a.sold.revenue + r2.sold.revenue },
      recharged: { count: a.recharged.count + r2.recharged.count, revenue: a.recharged.revenue + r2.recharged.revenue },
    }),
    { sold: { count: 0, revenue: 0 }, recharged: { count: 0, revenue: 0 } },
  )

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Interior Reporting"
        subtitle="Interior and detail services across the FlexWash and DRB sites."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', (loading || drbLoading) && 'animate-spin')} />
            {(error || drbError) ? 'Load failed' : (loading || drbLoading) ? 'Loading...' : (report || drb) ? 'Loaded' : 'Pick a range'}
          </span>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="ir-site" className="text-xs font-medium text-ink-muted">Site</label>
          <Select id="ir-site" value={selection} onChange={(e) => setSelection(e.target.value)} className="h-9 w-56">
            <option value="all">All Sites</option>
            {sites.length > 0 && (
              <optgroup label="FlexWash">
                {sites.map((s) => (
                  <option key={s.car_wash_id} value={`fw:${s.car_wash_id}`}>#{s.site_number}{s.name ? ` — ${s.name}` : ''}</option>
                ))}
              </optgroup>
            )}
            {drbSites.length > 0 && (
              <optgroup label="DRB">
                {drbSites.map((s) => (
                  <option key={s.site_number} value={`drb:${s.site_number}`}>#{s.site_number} — {s.name}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ir-start" className="text-xs font-medium text-ink-muted">From</label>
          <Input id="ir-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ir-end" className="text-xs font-medium text-ink-muted">To</label>
          <Input id="ir-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 w-40" />
        </div>
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

      {r && !error && (
        <>
          <h2 className="-mb-1 text-sm font-semibold uppercase tracking-wide text-ink-muted">FlexWash</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Interior Revenue" value={money(r.total.revenue)} sub={`${num(r.total.count)} services · ${num(r.days)} day${r.days === 1 ? '' : 's'}`} />
            <Kpi label="Cars Washed" value={num(fwCars)} sub={fwCars ? `${((r.total.count / fwCars) * 100).toFixed(1)}% interior attach` : 'official cars'} />
            <Kpi label="Paid (Retail)" value={money(r.paid.revenue)} sub={`${num(r.paid.count)} services`} />
            <Kpi label="Member Redeemed" value={num(r.member.count)} sub={r.member.revenue ? money(r.member.revenue) : 'included in membership'} />
            <Kpi label="Avg Retail Ticket" value={money(avgTicket)} sub="paid interior only" />
          </div>

          <Section title="FlexWash interior items" sub="Everything in FlexWash's detail category, by item.">
            {r.items.length === 0 ? (
              <EmptyState icon={Armchair} title="No interior services in this range" description="Try a wider date range or a different site." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Count</th>
                    <th className={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((it) => (
                    <Row key={it.name} label={it.name} count={it.count} amount={it.revenue} />
                  ))}
                  <Row label="Total" count={r.total.count} amount={r.total.revenue} strong />
                </tbody>
              </table>
            )}
          </Section>

          {r.bySite.length > 1 && (
            <Section title="By site" sub="Interior services and revenue per FlexWash site.">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Site</th>
                    <th className={th}>Count</th>
                    <th className={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySite.map((s) => (
                    <Row key={s.site} label={s.site} count={s.count} amount={s.revenue} />
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}

      {/* DRB detail — pulled from SiteWatch by report category, scoped to the pick. */}
      {drbActive && (
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">DRB (detail)</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-ink-muted">
            <RefreshCw className={cn('size-3', drbLoading && 'animate-spin')} />
            {drbError ? 'Load failed' : drbLoading ? 'Loading...' : drb ? (drbNums.length ? `Site #${drbNums[0]}` : 'All DRB sites') : '—'}
          </span>
        </div>
      )}

      {drbError && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load DRB data.</p>
            <p className="mt-0.5 text-danger/80">{drbError}</p>
          </div>
        </div>
      )}

      {drb && !drbError && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Detail Revenue" value={money(drb.total.revenue)} sub="Detail Services + Extras + ARM plan items" />
            <Kpi label="Cars Washed" value={num(drbCars)} sub={drbCars ? `${((drb.total.count / drbCars) * 100).toFixed(1)}% interior attach` : 'official cars'} />
            <Kpi label="Detail Items" value={num(drb.total.count)} sub="line items sold" />
            <Kpi label="Quantity" value={num(drb.total.qty)} sub="units" />
          </div>

          <Section title="DRB detail items" sub="Detail Services, Detail Extras, and the selected ARM plan items across the DRB sites.">
            {drb.items.length === 0 ? (
              <EmptyState icon={Armchair} title="No DRB detail items in this range" description="Try a wider date range." />
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={th}>Count</th>
                    <th className={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {drbGroups.map((g) => (
                    <Fragment key={g.category}>
                      <tr className="border-t border-border bg-content/60">
                        <td className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted" colSpan={3}>{g.category}</td>
                      </tr>
                      {g.items.map((it) => (
                        <Row key={g.category + it.name} label={it.name} count={it.count} amount={it.revenue} />
                      ))}
                      <Row label={`${g.category} subtotal`} count={g.count} amount={g.revenue} strong />
                    </Fragment>
                  ))}
                  <Row label="Total" count={drb.total.count} amount={drb.total.revenue} strong />
                </tbody>
              </table>
            )}
          </Section>

          {drb.bySite.length > 1 && (
            <Section title="DRB by site" sub="Detail revenue per DRB site.">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Site</th>
                    <th className={th}>Count</th>
                    <th className={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {drb.bySite.map((s) => (
                    <Row key={s.site_number} label={s.name} count={s.count} amount={s.revenue} />
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}

      {/* MVP UNLMTD memberships: new sales + recharges, spanning both sources. */}
      {mvpRows.length > 0 && (
        <>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">MVP UNLMTD memberships</h2>
          <Section title="Memberships sold & recharged" sub="New MVP UNLMTD memberships and their recharges, for the sites in view.">
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Source</th>
                  <th className={th}>Sold</th>
                  <th className={th}>Sold $</th>
                  <th className={th}>Recharged</th>
                  <th className={th}>Recharged $</th>
                </tr>
              </thead>
              <tbody>
                {mvpRows.map((m) => (
                  <tr key={m.src} className="border-t border-border">
                    <td className={td}>{m.src}</td>
                    <td className={td}>{num(m.sold.count)}</td>
                    <td className={td}>{money(m.sold.revenue)}</td>
                    <td className={td}>{num(m.recharged.count)}</td>
                    <td className={td}>{money(m.recharged.revenue)}</td>
                  </tr>
                ))}
                {mvpRows.length > 1 && (
                  <tr className="border-t border-border bg-content/60 font-semibold">
                    <td className={cn(td, 'font-semibold')}>Total</td>
                    <td className={td}>{num(mvpTotal.sold.count)}</td>
                    <td className={td}>{money(mvpTotal.sold.revenue)}</td>
                    <td className={td}>{num(mvpTotal.recharged.count)}</td>
                    <td className={td}>{money(mvpTotal.recharged.revenue)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </Section>

          {fwActive && report && report.mvp.plans.length > 0 && (
            <Section title="FlexWash MVP plans" sub="MVP UNLMTD sold and recharged by plan template.">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Plan</th>
                    <th className={th}>Sold</th>
                    <th className={th}>Sold $</th>
                    <th className={th}>Recharged</th>
                    <th className={th}>Recharged $</th>
                  </tr>
                </thead>
                <tbody>
                  {report.mvp.plans.map((p) => (
                    <tr key={p.name} className="border-t border-border">
                      <td className={td}>{p.name}</td>
                      <td className={td}>{num(p.soldCount)}</td>
                      <td className={td}>{money(p.soldRevenue)}</td>
                      <td className={td}>{num(p.rechargeCount)}</td>
                      <td className={td}>{money(p.rechargeRevenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {drbActive && drb && drb.mvp.items.length > 0 && (
            <Section title="DRB MVP items" sub="MVP ARM items, Sold and Recharged.">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={cn(th, 'text-left')}>Category</th>
                    <th className={th}>Count</th>
                    <th className={th}>Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {drb.mvp.items.map((it) => (
                    <tr key={it.name} className="border-t border-border">
                      <td className={td}>{it.name}</td>
                      <td className={cn(td, 'text-left')}>{it.category}</td>
                      <td className={td}>{num(it.count)}</td>
                      <td className={td}>{money(it.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}
        </>
      )}

      <p className="text-xs text-ink-subtle">
        FlexWash revenue is the interior line price, gross of separately-listed discounts;
        member-redeemed services are included in a membership and may show $0. DRB revenue is the
        net line amount (SUM of AMT) for every item in the Detail Services and Detail Extras report
        categories, plus MVP Mighty ARM Sld, Intro MVP PB/NM Rchg, Intro MVP Rchg, and MVP Mighty
        Switch Rc. MVP UNLMTD counts new memberships sold (every "sold" classification) and their
        recharges/rebills: FlexWash MVP UNLMTD + Launch MVP UNLMTD plans, and the DRB MVP ARM items.
        The all-sites DRB rollup excludes the FlexWash sites (so they are not double counted) and the
        corporate/HQ sites.
      </p>
    </div>
  )
}
