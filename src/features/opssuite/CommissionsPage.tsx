import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { flexwashSales, type FlexSite } from '@/lib/queries/flexwashSales'
import { fetchCommissions, type CommissionReport } from '@/lib/queries/flexCommissions'

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const isoDay = (d: Date) => d.toISOString().slice(0, 10)
const TIERS = ['Mighty', 'Super Shine', 'Wonder'] as const

export default function CommissionsPage() {
  const [sites, setSites] = useState<FlexSite[]>([])
  const [site, setSite] = useState('all')
  const [start, setStart] = useState(() => isoDay(new Date(Date.now() - 45 * 86400000)))
  const [end, setEnd] = useState(() => isoDay(new Date()))
  const [report, setReport] = useState<CommissionReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void flexwashSales.sites().then(setSites).catch(() => {}) }, [])

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetchCommissions(start, end, site === 'all' ? undefined : [site])
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load commissions.')
    } finally {
      setLoading(false)
    }
  }, [start, end, site])

  // Auto-run once on first mount so the page shows real numbers immediately.
  useEffect(() => {
    void run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rates = report?.rates ?? { Mighty: 12, 'Super Shine': 10, Wonder: 3 }
  const t = report?.totals

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Commissions" subtitle="Membership-sale commissions from FlexWash, attributed to the salesperson, payable once the member's first recharge posts." />

      <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Prototype.</strong> New membership sales are matched to the salesperson FlexWash records on the sale, and marked <span className="font-medium text-ok">payable</span> once that membership makes its first recharge (otherwise <span className="font-medium text-ink">pending</span>). Rates: Mighty Protector {usd(rates.Mighty ?? 12)}, Super Shine {usd(rates['Super Shine'] ?? 10)}, Wonder {usd(rates.Wonder ?? 3)}. Plans that don't match a tier are "Other" (no commission yet).
      </div>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Site
          <Select value={site} onChange={(e) => setSite(e.target.value)} className="h-9 w-56">
            <option value="all">All FlexWash sites</option>
            {sites.map((s) => <option key={s.car_wash_id} value={s.car_wash_id}>{s.name ?? `Site ${s.site_number}`}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Sold from
          <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="h-9 w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Sold to
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="h-9 w-40" />
        </label>
        <Button onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Run report
        </Button>
        {report && <span className="ml-auto self-center text-xs text-ink-subtle">{report.siteCount} site{report.siteCount === 1 ? '' : 's'} · recharges counted through {report.today}</span>}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {loading && !report && (
        <div className="mt-8 flex items-center justify-center gap-2 text-ink-muted">
          <Loader2 className="size-5 animate-spin" /> Pulling FlexWash sales… this can take ~20 seconds for all sites.
        </div>
      )}

      {report && (
        <>
          {/* Summary */}
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Memberships sold" value={String(t!.sales)} />
            <Stat label="Payable commissions" value={usd(t!.payableAmount)} sub={`${t!.payableCount} recharged`} tone="ok" />
            <Stat label="Pending commissions" value={usd(t!.pendingAmount)} sub={`${t!.pendingCount} awaiting 1st recharge`} />
            <Stat label="Salespeople" value={String(report.employees.length)} />
          </div>

          {/* By salesperson */}
          <section className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Salesperson</th>
                  <th className="px-4 py-2.5 text-right font-medium">Sold</th>
                  {TIERS.map((tr) => <th key={tr} className="px-3 py-2.5 text-right font-medium">{tr}</th>)}
                  <th className="px-4 py-2.5 text-right font-medium">Payable</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pending</th>
                </tr>
              </thead>
              <tbody>
                {report.employees.map((e) => (
                  <tr key={e.name} className="border-t border-border hover:bg-content">
                    <td className="px-4 py-2 font-medium text-ink">{e.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{e.sales}</td>
                    {TIERS.map((tr) => <td key={tr} className="px-3 py-2 text-right tabular-nums text-ink-subtle">{e.byTier[tr]?.sold ?? 0}</td>)}
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-ok">{usd2(e.payableAmount)} <span className="text-xs font-normal text-ink-subtle">({e.payableCount})</span></td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{usd2(e.pendingAmount)} <span className="text-xs text-ink-subtle">({e.pendingCount})</span></td>
                  </tr>
                ))}
                {report.employees.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-muted">No membership sales in this range.</td></tr>
                )}
              </tbody>
              {report.employees.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-content font-semibold text-ink">
                    <td className="px-4 py-2.5">Total</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{t!.sales}</td>
                    {TIERS.map((tr) => <td key={tr} className="px-3 py-2.5 text-right tabular-nums">{t!.byTier[tr]?.sold ?? 0}</td>)}
                    <td className="px-4 py-2.5 text-right tabular-nums text-ok">{usd2(t!.payableAmount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd2(t!.pendingAmount)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </section>

          <p className="mt-4 text-xs text-ink-subtle">
            Commission is earned when the membership is sold and becomes payable the day its first recharge posts (≈ one month after the sale). "Payable" here = memberships sold in this range that have already recharged; "Pending" = sold but not yet recharged. New memberships only (reups and interior/MVP plans aren't commissioned yet). Salesperson, plan, and recharge all come from FlexWash's line-item feed.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'ok' ? 'text-ok' : 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-muted">{sub}</div>}
    </div>
  )
}
