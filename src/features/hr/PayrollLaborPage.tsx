import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { format, startOfMonth, subDays, subMonths, endOfMonth } from 'date-fns'
import { Clock, Loader2, RefreshCw, Download, Search, Building2, Users } from 'lucide-react'
import { isolvedLabor, type LaborResponse } from '@/lib/queries/isolved'
import { fnErrorMessage } from '@/lib/fnError'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const num = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

type Preset = { label: string; range: () => { start: string; end: string } }
const PRESETS: Preset[] = [
  { label: 'This month', range: () => ({ start: iso(startOfMonth(new Date())), end: iso(new Date()) }) },
  { label: 'Last 14 days', range: () => ({ start: iso(subDays(new Date(), 13)), end: iso(new Date()) }) },
  {
    label: 'Last month',
    range: () => ({ start: iso(startOfMonth(subMonths(new Date(), 1))), end: iso(endOfMonth(subMonths(new Date(), 1))) }),
  },
]

function downloadCsv(name: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function PayrollLaborPage() {
  const [start, setStart] = useState(() => iso(startOfMonth(new Date())))
  const [end, setEnd] = useState(() => iso(new Date()))
  const [data, setData] = useState<LaborResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sites' | 'employees'>('sites')
  const [empSearch, setEmpSearch] = useState('')

  const load = useCallback(async (s: string, e: string) => {
    setLoading(true)
    setError(null)
    try {
      const { data: d, error: err } = await isolvedLabor(s, e)
      if (err || d?.error) {
        setError(await fnErrorMessage(err, (d ?? null) as { message?: string; error?: string } | null, 'Could not load payroll labor from iSolved.'))
        setData(null)
        return
      }
      setData(d ?? null)
    } catch {
      setError('Could not load payroll labor from iSolved.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(start, end)
    // Load once on mount with the default range; further loads are on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const payTypes = data?.payTypes ?? []

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    const list = data?.employees ?? []
    return q ? list.filter((e) => e.name.toLowerCase().includes(q) || e.employeeNumber.includes(q)) : list
  }, [data, empSearch])

  const exportSites = () => {
    if (!data) return
    const header = ['Site', ...payTypes, 'Total hours', 'Employees']
    const rows = data.sites.map((s) => [s.site, ...payTypes.map((p) => s.byPayType[p] ?? 0), s.totalHours, s.employees])
    const totalRow = ['Total', ...payTypes.map((p) => data.totals.byPayType[p] ?? 0), data.totals.totalHours, data.totals.employees]
    downloadCsv(`payroll-labor-by-site-${start}-to-${end}.csv`, [header, ...rows, totalRow])
  }
  const exportEmployees = () => {
    if (!data) return
    const header = ['Employee', 'Emp #', 'Sites', ...payTypes, 'Total hours']
    const rows = data.employees.map((e) => [e.name, e.employeeNumber, e.sites.join(' / '), ...payTypes.map((p) => e.byPayType[p] ?? 0), e.totalHours])
    downloadCsv(`payroll-labor-by-employee-${start}-to-${end}.csv`, [header, ...rows])
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Clock className="size-6 text-accent" /> Payroll Labor
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Timecard hours from iSolved, by site and pay type.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const r = p.range()
                setStart(r.start)
                setEnd(r.end)
                void load(r.start, r.end)
              }}
              className="rounded-lg border border-border bg-content px-3 py-2 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-ink-subtle">
            Start
            <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="mt-1 block rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-subtle">
            End
            <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="mt-1 block rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          </label>
          <button
            onClick={() => void load(start, end)}
            disabled={loading}
            className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && !data && (
        <div className="mt-8 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" /> Loading labor from iSolved…</div>
      )}

      {data && (
        <>
          {/* Totals */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Total hours" value={num(data.totals.totalHours)} tone="accent" />
            <Stat label="Employees" value={String(data.totals.employees)} />
            <Stat label="Sites" value={String(data.totals.sites)} />
            {payTypes.map((p) => (
              <Stat key={p} label={p} value={num(data.totals.byPayType[p] ?? 0)} />
            ))}
          </div>

          {/* Tabs */}
          <div className="mt-6 flex items-center gap-2 border-b border-border">
            <Tab active={tab === 'sites'} onClick={() => setTab('sites')} icon={<Building2 className="size-4" />} label={`By Site (${data.sites.length})`} />
            <Tab active={tab === 'employees'} onClick={() => setTab('employees')} icon={<Users className="size-4" />} label={`By Employee (${data.employees.length})`} />
            <div className="ml-auto pb-2">
              <button
                onClick={tab === 'sites' ? exportSites : exportEmployees}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-accent hover:text-ink"
              >
                <Download className="size-3.5" /> Export CSV
              </button>
            </div>
          </div>

          {tab === 'sites' ? (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Site</th>
                    {payTypes.map((p) => <th key={p} className="px-4 py-2.5 text-right font-semibold">{p}</th>)}
                    <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Emps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.sites.map((s) => (
                    <tr key={s.site} className="hover:bg-content/50">
                      <td className="px-4 py-2.5 font-medium text-ink">{s.site}</td>
                      {payTypes.map((p) => <td key={p} className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.byPayType[p] ? num(s.byPayType[p]) : '—'}</td>)}
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{num(s.totalHours)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.employees}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-content font-semibold">
                  <tr>
                    <td className="px-4 py-2.5 text-ink">Total</td>
                    {payTypes.map((p) => <td key={p} className="px-4 py-2.5 text-right tabular-nums text-ink">{num(data.totals.byPayType[p] ?? 0)}</td>)}
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{num(data.totals.totalHours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{data.totals.employees}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <Search className="size-4 text-ink-subtle" />
                <input
                  value={empSearch}
                  onChange={(e) => setEmpSearch(e.target.value)}
                  placeholder="Search employee by name or number"
                  className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
                />
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-4 py-2.5 font-semibold">Employee</th>
                      <th className="px-4 py-2.5 font-semibold">Sites</th>
                      {payTypes.map((p) => <th key={p} className="px-4 py-2.5 text-right font-semibold">{p}</th>)}
                      <th className="px-4 py-2.5 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredEmployees.map((e) => (
                      <tr key={e.employeeNumber} className="hover:bg-content/50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink">{e.name}</div>
                          <div className="text-xs text-ink-subtle">#{e.employeeNumber}</div>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{e.sites.join(', ')}</td>
                        {payTypes.map((p) => <td key={p} className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{e.byPayType[p] ? num(e.byPayType[p]) : '—'}</td>)}
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{num(e.totalHours)}</td>
                      </tr>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <tr><td colSpan={payTypes.length + 3} className="px-4 py-6 text-center text-ink-subtle">No employees match "{empSearch}".</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="mt-4 text-xs text-ink-subtle">
            Source: iSolved timecard data for {data.range.startDate} to {data.range.endDate}. Hours only (pay rates are not included in this feed).
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className={`rounded-xl border border-border p-4 ${tone === 'accent' ? 'bg-accent-soft' : 'bg-card'}`}>
      <div className={`text-xs font-medium ${tone === 'accent' ? 'text-accent' : 'text-ink-subtle'}`}>{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  )
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
    >
      {icon}
      {label}
    </button>
  )
}
