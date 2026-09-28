import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TriangleAlert, Search, ExternalLink, Info, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { flexwashChargebacks, type CbSite, type ChargebackReport, type Chargeback, type CustomerEvent } from '@/lib/queries/flexwashChargebacks'

const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA') }
const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const num = (n: number) => n.toLocaleString('en-US')

const th = 'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle first:text-left sm:px-4'
const td = 'px-3 py-2 text-right text-sm text-ink first:text-left sm:px-4 tabular-nums'

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-subtle">{sub}</div>}
    </div>
  )
}

export default function ChargebacksPage() {
  const [sites, setSites] = useState<CbSite[]>([])
  const [site, setSite] = useState('')
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(yesterday())
  const [report, setReport] = useState<ChargebackReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Customer activity drawer.
  const [cust, setCust] = useState<{ id: string; name: string } | null>(null)
  const [events, setEvents] = useState<CustomerEvent[] | null>(null)
  const [custLoading, setCustLoading] = useState(false)
  const [custErr, setCustErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const s = await flexwashChargebacks.sites()
        if (!alive) return
        setSites(s)
        if (s.length && !site) setSite(s[0].car_wash_id)
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)) }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = async () => {
    if (!site) return setError('Choose a site.')
    setLoading(true); setError(null)
    try { setReport(await flexwashChargebacks.list(site, start, end)) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setReport(null) }
    finally { setLoading(false) }
  }

  const openCustomer = async (c: Chargeback) => {
    if (!c.customerId) return
    setCust({ id: c.customerId, name: c.customer ?? c.customerId })
    setEvents(null); setCustErr(null); setCustLoading(true)
    try { const r = await flexwashChargebacks.customer(c.customerId); setEvents(r.events) }
    catch (e) { setCustErr(e instanceof Error ? e.message : String(e)) }
    finally { setCustLoading(false) }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = report?.chargebacks ?? []
    return q ? list.filter((c) =>
      (c.customer ?? '').toLowerCase().includes(q) || (c.reason ?? '').toLowerCase().includes(q) ||
      (c.package ?? '').toLowerCase().includes(q) || c.orderId.includes(q) || (c.cardLastFour ?? '').includes(q),
    ) : list
  }, [report, search])

  const distinctCustomers = useMemo(() => new Set((report?.chargebacks ?? []).filter((c) => c.customerId).map((c) => c.customerId)).size, [report])
  const topReason = useMemo(() => {
    const e = Object.entries(report?.byReason ?? {}).sort((a, b) => b[1] - a[1])[0]
    return e ? `${e[0]} (${e[1]})` : '—'
  }, [report])

  const siteName = sites.find((s) => s.car_wash_id === site)?.name ?? ''

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Chargebacks" subtitle="Failed/declined card charges (mostly membership rebills) per FlexWash site, tied to the customer where available." />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="text-xs font-medium text-ink-subtle">Site
          <Select value={site} onChange={(e) => setSite(e.target.value)} className="mt-1 block h-9 w-40">
            {sites.length === 0 && <option value="">Loading…</option>}
            {sites.map((s) => <option key={s.car_wash_id} value={s.car_wash_id}>{s.name}</option>)}
          </Select>
        </label>
        <label className="text-xs font-medium text-ink-subtle">Start
          <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="mt-1 h-9 w-40" />
        </label>
        <label className="text-xs font-medium text-ink-subtle">End
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-9 w-40" />
        </label>
        <Button onClick={() => void load()} disabled={loading || !site}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} /> {loading ? 'Loading…' : 'Run'}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">Could not load chargebacks.</p><p className="mt-0.5 text-danger/80">{error}</p></div>
        </div>
      )}
      {!report && !error && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">Pick a site and date range, then Run. First load can take a few seconds.</p>
      )}

      {report && (
        <>
          <p className="-mt-2 text-sm font-medium text-ink">{siteName} · {report.range.start} to {report.range.end}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Chargebacks" value={num(report.count)} sub="failed card charges" />
            <Kpi label="Amount" value={usd(report.totalCents)} sub="total declined" />
            <Kpi label="Customers" value={num(distinctCustomers)} sub="with an account" />
            <Kpi label="Top reason" value={topReason} />
          </div>

          {Object.keys(report.byReason).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(report.byReason).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                <span key={reason} className="rounded-full border border-border bg-content px-3 py-1 text-xs text-ink-muted">{reason} <span className="font-semibold text-ink">{n}</span></span>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-border bg-content/50 px-3 py-2 text-xs text-ink-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>A chargeback here is a card charge that failed (declined rebill or point-of-sale decline). FlexWash does not expose card-network disputes. Membership rebills carry the customer; walk-up single-wash declines do not. Click a customer to see their full activity.</span>
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-3 px-4 pb-3 pt-4 sm:px-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Chargebacks ({rows.length})</h2>
              <div className="ml-auto flex items-center gap-2 rounded-lg border border-border bg-content px-2 py-1">
                <Search className="size-3.5 text-ink-subtle" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="customer, reason, card, order" className="w-52 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead><tr className="border-y border-border">
                  {['Date', 'Customer', 'Plan / item', 'Amount', 'Reason', 'Card', 'Type', 'Receipt'].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => (
                    <tr key={c.orderId} className="hover:bg-content/40">
                      <td className={td}>{c.at ?? '—'}</td>
                      <td className={cn(td, 'max-w-[180px] truncate')}>
                        {c.customerId ? (
                          <button type="button" onClick={() => void openCustomer(c)} className="text-accent hover:underline">{c.customer ?? c.customerId}</button>
                        ) : <span className="text-ink-subtle">—</span>}
                      </td>
                      <td className={cn(td, 'max-w-[200px] truncate')}>{c.package ?? '—'}</td>
                      <td className={td}>{usd(c.amountCents)}</td>
                      <td className={td}>{c.reason ?? '—'}</td>
                      <td className={td}>{c.cardLastFour ? `••${c.cardLastFour}` : '—'}</td>
                      <td className={td}>{c.type === 'membershipBilling' ? 'Rebill' : (c.type ?? '—')}</td>
                      <td className={td}>{c.receipt ? <a href={c.receipt} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Receipt <ExternalLink className="size-3" /></a> : '—'}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td className={td} colSpan={8}>No chargebacks in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {cust && (
        <Modal open onClose={() => setCust(null)} title={`Activity — ${cust.name}`} size="lg">
          {custLoading && <div className="flex items-center gap-2 py-8 text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading activity…</div>}
          {custErr && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{custErr}</p>}
          {events && events.length === 0 && !custLoading && <p className="py-6 text-center text-sm text-ink-subtle">No activity on record.</p>}
          {events && events.length > 0 && (
            <ol className="flex flex-col gap-3">
              {events.map((e, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{e.name ?? e.type ?? 'Event'}</span>
                    {e.totalCents != null && <span className="text-xs text-ink-muted">{usd(e.totalCents)}</span>}
                    <span className="ml-auto text-xs text-ink-subtle">{e.at ? new Date(e.at).toLocaleString() : ''}</span>
                  </div>
                  {e.items.length > 0 && <div className="text-xs text-ink-muted">{e.items.join(', ')}</div>}
                  {e.text && <div className="text-xs text-ink-subtle">{e.text}</div>}
                  {e.user && <div className="text-[11px] text-ink-subtle">by {e.user}</div>}
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
    </div>
  )
}
