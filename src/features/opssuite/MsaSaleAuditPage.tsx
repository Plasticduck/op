import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, TriangleAlert, Search, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { drbMsaAudit, type MsaAuditReport, type MsaAuditRow } from '@/lib/queries/drbMsaAudit'
import type { DrbSite } from '@/lib/queries/drbInterior'

const yesterday = () => new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA')
const monthStart = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA')
}
const num = (n: number) => Math.round(n).toLocaleString('en-US')

// Conversion heat, matching the MSA Performance page range (15–25%).
function convColor(v: number | null): string {
  if (v === null) return 'inherit'
  const t = Math.max(0, Math.min(1, (v - 15) / (25 - 15)))
  return `hsl(${4 + t * 136}, 68%, 40%)`
}

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

export default function MsaSaleAuditPage() {
  const [sites, setSites] = useState<DrbSite[]>([])
  const [site, setSite] = useState<string>('')
  const [start, setStart] = useState(monthStart())
  const [end, setEnd] = useState(yesterday())
  const [report, setReport] = useState<MsaAuditReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [empSearch, setEmpSearch] = useState('')
  const [showExcludedOnly, setShowExcludedOnly] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const s = await drbMsaAudit.sites()
        if (!active) return
        setSites(s)
        if (s.length && !site) setSite(String(s[0].site_number))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const load = async () => {
    if (!site) return setError('Choose a site.')
    setLoading(true)
    setError(null)
    try {
      const r = await drbMsaAudit.report(Number(site), start, end)
      setReport(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  // Split real MSAs from the self-serve kiosk pseudo-sellers.
  const msaRows = useMemo(() => (report?.rows ?? []).filter((r) => !r.kiosk), [report])
  const kioskRows = useMemo(() => (report?.rows ?? []).filter((r) => r.kiosk), [report])
  const totals = useMemo(() => {
    const w = msaRows.reduce((a, r) => a + r.eligibleWashes, 0)
    const net = msaRows.reduce((a, r) => a + r.soldNet, 0)
    const raw = msaRows.reduce((a, r) => a + r.soldRaw, 0)
    return { washes: w, net, raw, conv: w > 0 ? Math.round((net / w) * 1000) / 10 : null }
  }, [msaRows])

  const detail = useMemo(() => {
    let list = report?.detail ?? []
    if (showExcludedOnly) list = list.filter((s) => s.excluded)
    const q = empSearch.trim().toLowerCase()
    if (q) list = list.filter((s) => s.employee.toLowerCase().includes(q) || s.code.includes(q) || (s.customer ?? '').includes(q))
    return list
  }, [report, showExcludedOnly, empSearch])

  const excludedLabel = (v: string | null) =>
    v === 'plan_change' ? 'Plan change' : v === 'reactivation_90d' ? 'Decline <90d' : 'Counted'

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="MSA Sale Audit"
        subtitle="Per-sale check of MSA conversion for DRB sites: every membership sold and eligible wash, straight from SiteWatch."
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <label className="text-xs font-medium text-ink-subtle">
          Site
          <Select value={site} onChange={(e) => setSite(e.target.value)} className="mt-1 block h-9 w-44">
            {sites.length === 0 && <option value="">Loading…</option>}
            {sites.map((s) => <option key={s.site_number} value={s.site_number}>{s.name}</option>)}
          </Select>
        </label>
        <label className="text-xs font-medium text-ink-subtle">
          Start
          <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="mt-1 h-9 w-40" />
        </label>
        <label className="text-xs font-medium text-ink-subtle">
          End
          <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="mt-1 h-9 w-40" />
        </label>
        <Button onClick={() => void load()} disabled={loading || !site}>
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} /> {loading ? 'Loading…' : 'Run audit'}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div><p className="font-medium">Could not load the audit.</p><p className="mt-0.5 text-danger/80">{error}</p></div>
        </div>
      )}

      {!report && !error && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
          Pick a site and date range, then Run audit. First load can take a few seconds.
        </p>
      )}

      {report && (
        <>
          <p className="-mt-2 text-sm font-medium text-ink">{report.siteLabel} · {report.range.start} to {report.range.end}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Conversion" value={totals.conv !== null ? `${totals.conv}%` : '—'} sub="memberships ÷ eligible washes" />
            <Kpi label="Memberships sold" value={num(totals.net)} sub={totals.raw !== totals.net ? `${num(totals.raw)} before exclusions` : 'counted'} />
            <Kpi label="Eligible washes" value={num(totals.washes)} sub="retail, non-member" />
            <Kpi label="Excluded" value={num(report.diag.excludedPlanChange + report.diag.excludedReactivation)} sub={`${report.diag.excludedPlanChange} plan change · ${report.diag.excludedReactivation} decline`} />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-content/50 px-3 py-2 text-xs text-ink-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p><span className="font-medium text-ink">Memberships sold:</span> all ARM Plans Sold items, minus {report.rules.soldExclusions}.</p>
              <p><span className="font-medium text-ink">Eligible washes:</span> {report.rules.eligibleWash}.</p>
              <p><span className="font-medium text-ink">Credit:</span> {report.rules.attribution}.</p>
            </div>
          </div>

          {/* By MSA */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="px-4 pb-3 pt-4 sm:px-5"><h2 className="text-sm font-semibold uppercase tracking-wide text-ink">By MSA</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-border">
                    {['MSA', 'Eligible washes', 'Sold', 'Excluded', 'Counted', 'Conversion'].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {msaRows.map((r) => <MsaTr key={r.employeeId} r={r} />)}
                  {msaRows.length === 0 && <tr><td className={td} colSpan={6}>No MSA sales in this range.</td></tr>}
                  {kioskRows.length > 0 && (
                    <>
                      <tr className="bg-content/70"><td colSpan={6} className="px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Self-serve / kiosk (no MSA)</td></tr>
                      {kioskRows.map((r) => <MsaTr key={r.employeeId} r={r} muted />)}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Membership sale detail */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-3 px-4 pb-3 pt-4 sm:px-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Membership sales ({detail.length})</h2>
              <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={showExcludedOnly} onChange={(e) => setShowExcludedOnly(e.target.checked)} /> Excluded only
              </label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-content px-2 py-1">
                <Search className="size-3.5 text-ink-subtle" />
                <input value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} placeholder="MSA, ticket, customer" className="w-44 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-border">
                    {['Date & time', 'Ticket', 'MSA', 'Plan item', 'Customer', 'Status'].map((h) => <th key={h} className={th}>{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.map((s, i) => (
                    <tr key={s.code + s.employeeId + i} className={cn(s.excluded && 'bg-warn-soft/40')}>
                      <td className={td}>{s.day}{s.time ? ` · ${s.time}` : ''}</td>
                      <td className={td}>#{s.code}</td>
                      <td className={cn(td, s.kiosk && 'text-ink-muted')}>{s.employee}</td>
                      <td className={td}>{s.items.join(', ') || '—'}</td>
                      <td className={td}>{s.customer ?? '—'}</td>
                      <td className={td}>
                        <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', s.excluded ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok')}>
                          {excludedLabel(s.excluded)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {detail.length === 0 && <tr><td className={td} colSpan={6}>No membership sales match.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {report && (msaRows.length === 0 && kioskRows.length === 0) && (
            <EmptyState icon={TriangleAlert} title="No data" description="No sales found for this site and range." />
          )}
        </>
      )}
    </div>
  )
}

function MsaTr({ r, muted }: { r: MsaAuditRow; muted?: boolean }) {
  const excluded = r.excludedPlanChange + r.excludedReactivation
  return (
    <tr>
      <td className={cn(td, muted && 'text-ink-muted')}>{r.name}</td>
      <td className={td}>{num(r.eligibleWashes)}</td>
      <td className={td}>{num(r.soldRaw)}</td>
      <td className={td}>{excluded ? num(excluded) : '—'}</td>
      <td className={td}>{num(r.soldNet)}</td>
      <td className={td} style={{ color: muted ? undefined : convColor(r.conversionPct) }}>{r.conversionPct !== null ? `${r.conversionPct}%` : '—'}</td>
    </tr>
  )
}
