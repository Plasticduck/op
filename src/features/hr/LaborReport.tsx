import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { addDays, differenceInCalendarDays, format, parseISO, startOfMonth, startOfWeek, subDays, subMonths, endOfMonth } from 'date-fns'
import { Clock, Loader2, RefreshCw, Download, Search, Building2, Users, Wallet, Timer, MapPin } from 'lucide-react'
import { isolvedLabor, type LaborResponse, type SalariedScope } from '@/lib/queries/isolved'
import { fnErrorMessage } from '@/lib/fnError'
import { fetchCarsBySite } from '@/lib/queries/carsBySite'
import OnTheClock from './OnTheClock'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
// Labor site label "MW01" -> store number 1 (Corporate/Spotless -> null).
const storeOf = (label: string): number | null => { const m = label.match(/^MW(\d+)$/); return m ? parseInt(m[1], 10) : null }
const num = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Mighty Wash pays bi-weekly, Monday through Sunday of the second week. Any
// pay-period start works as the anchor; Mon 10/19/2026 started one (confirmed).
const PAY_PERIOD_ANCHOR = '2026-10-19'
const PAY_PERIOD_DAYS = 14
function currentPayPeriodStart(today = new Date()): Date {
  const anchor = parseISO(PAY_PERIOD_ANCHOR)
  const periods = Math.floor(differenceInCalendarDays(today, anchor) / PAY_PERIOD_DAYS)
  return addDays(anchor, periods * PAY_PERIOD_DAYS)
}

type Preset = { label: string; range: () => { start: string; end: string } }
// Ranges that include today end today (iSolved has nothing for future days).
const PRESETS: Preset[] = [
  { label: 'Today', range: () => ({ start: iso(new Date()), end: iso(new Date()) }) },
  { label: 'Yesterday', range: () => ({ start: iso(subDays(new Date(), 1)), end: iso(subDays(new Date(), 1)) }) },
  { label: 'Week (M–Sun)', range: () => ({ start: iso(startOfWeek(new Date(), { weekStartsOn: 1 })), end: iso(new Date()) }) },
  { label: 'Pay Period', range: () => ({ start: iso(currentPayPeriodStart()), end: iso(new Date()) }) },
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

// Two views share this report:
//   - 'labor'    (Labor Data): hourly + non-Corporate salaried, with a toggle to
//     show or hide salaried. Corporate salaried is never shown here.
//   - 'salaried' (Salaried Labor): salaried only, all sites incl. Corporate.
export type LaborVariant = 'labor' | 'salaried'

export default function LaborReport({ variant }: { variant: LaborVariant }) {
  const salaried = variant === 'salaried'
  // Labor Data opens on Today; Salaried Labor (salary allocated over the range)
  // opens on This month.
  const defaultPreset = salaried ? 'This month' : 'Today'
  const [start, setStart] = useState(() => PRESETS.find((p) => p.label === defaultPreset)!.range().start)
  const [end, setEnd] = useState(() => iso(new Date()))
  const [data, setData] = useState<LaborResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'sites' | 'employees' | 'live'>('sites')
  const [empSearch, setEmpSearch] = useState('')
  // Labor Data only: whether salaried (non-Corporate) staff are shown.
  const [showSalaried, setShowSalaried] = useState(true)
  // Which quick range is in effect (cleared when the dates are edited by hand).
  const [activePreset, setActivePreset] = useState<string | null>(defaultPreset)

  const scopeFor = useCallback(
    (show: boolean): SalariedScope => (salaried ? 'only' : show ? 'exclude-corporate' : 'none'),
    [salaried],
  )

  // Labor Data only: official cars washed per store for the same range.
  const [cars, setCars] = useState<Map<number, number> | null>(null)
  const loadCars = useCallback((s: string, e: string) => {
    if (salaried) return
    setCars(null)
    fetchCarsBySite(s, e).then(setCars).catch(() => setCars(new Map()))
  }, [salaried])

  // Admin region pick ('' = all sites). Read through a ref so every reload
  // (presets, refresh, salaried toggle) keeps the chosen region.
  const [region, setRegion] = useState('')
  const regionRef = useRef('')
  const load = useCallback(async (s: string, e: string, scope: SalariedScope, regionOverride?: string) => {
    const reg = regionOverride ?? regionRef.current
    setLoading(true)
    setError(null)
    loadCars(s, e)
    try {
      const { data: d, error: err } = await isolvedLabor(s, e, scope, reg || null)
      if (err || d?.error) {
        setError(await fnErrorMessage(err, (d ?? null) as { message?: string; error?: string } | null, 'Could not load labor from iSolved.'))
        setData(null)
        return
      }
      setData(d ?? null)
    } catch {
      setError('Could not load labor from iSolved.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [loadCars])

  useEffect(() => {
    void load(start, end, scopeFor(showSalaried))
    // Load once on mount with the default range; further loads are on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const payTypes = data?.payTypes ?? []
  // Region view: RMs are locked to their region (no salaried data, no picker);
  // admins choose from the account's regions. Options stick once loaded.
  const regionLocked = !!data?.region?.locked
  const lockedRegions = data?.region?.names ?? []
  const [regionOptions, setRegionOptions] = useState<string[]>([])
  useEffect(() => { if (data?.regions && !data.region?.locked) setRegionOptions(data.regions) }, [data])
  // Pay-type columns shown on screen. Labor Data hides Hourly and PTO (the CSV
  // export still includes every pay type).
  const shownTypes = salaried ? payTypes : payTypes.filter((p) => !/^(hourly|pto|salaried)$/i.test(p))
  // Labor Data's By Site table also drops the Emps column and adds Cars.
  const showEmps = salaried
  const showCars = !salaried
  const carsFor = (label: string) => { const n = storeOf(label); return n == null ? null : cars?.get(n) ?? null }
  const carsTotal = cars && data ? data.sites.reduce((a, x) => a + (carsFor(x.site) ?? 0), 0) : null
  // The On the Clock headcount only means something when the range includes today.
  const showOnClock = !salaried && !!data?.includesToday

  const filteredEmployees = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    const list = data?.employees ?? []
    return q ? list.filter((e) => e.name.toLowerCase().includes(q) || e.employeeNumber.includes(q)) : list
  }, [data, empSearch])

  const filePrefix = salaried ? 'salaried-labor' : 'labor-data'
  const exportSites = () => {
    if (!data) return
    const oc = showOnClock
    const cc = showCars && cars != null
    const header = ['Site', ...(oc ? ['On the clock'] : []), ...(cc ? ['Cars'] : []), ...payTypes, 'Total hours', 'Est. cost', 'Employees']
    const rows = data.sites.map((s) => [s.site, ...(oc ? [s.onClock ?? 0] : []), ...(cc ? [carsFor(s.site) ?? ''] : []), ...payTypes.map((p) => s.byPayType[p] ?? 0), s.totalHours, s.cost, s.employees])
    const totalRow = ['Total', ...(oc ? [data.totals.onClock ?? 0] : []), ...(cc ? [carsTotal ?? ''] : []), ...payTypes.map((p) => data.totals.byPayType[p] ?? 0), data.totals.totalHours, data.totals.totalCost, data.totals.employees]
    downloadCsv(`${filePrefix}-by-site-${start}-to-${end}.csv`, [header, ...rows, totalRow])
  }
  const exportEmployees = () => {
    if (!data) return
    const header = ['Employee', 'Emp #', 'Type', 'Rate', 'Sites', ...payTypes, 'Total hours', 'Est. cost']
    const rows = data.employees.map((e) => [e.name, e.employeeNumber, e.payType, e.rate, e.sites.join(' / '), ...payTypes.map((p) => e.byPayType[p] ?? 0), e.totalHours, e.cost])
    downloadCsv(`${filePrefix}-by-employee-${start}-to-${end}.csv`, [header, ...rows])
  }

  const title = salaried ? 'Salaried Labor' : 'Labor Data'
  const Icon = salaried ? Wallet : Clock
  const subtitle = salaried
    ? 'Salaried staff and estimated salary cost from iSolved, including Corporate, by site and employee.'
    : 'Timecard hours and estimated labor cost from iSolved, by site and employee. Corporate salaried is excluded here.'

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
            <Icon className="size-6 text-accent" /> {title}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
        </div>
      </div>
      {tab !== 'live' && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink-muted">
          <strong className="text-ink">Estimate.</strong> Dollar figures are estimated from base pay rates and salaries, not the payroll gross: they exclude employer taxes and benefits, shift differentials, bonuses, retro pay, and mid-period rate changes.
        </div>
      )}

      {/* Tabs */}
      <div className="mt-5 flex items-center gap-2 border-b border-border">
        <Tab active={tab === 'sites'} onClick={() => setTab('sites')} icon={<Building2 className="size-4" />} label={`By Site${data ? ` (${data.sites.length})` : ''}`} />
        <Tab active={tab === 'employees'} onClick={() => setTab('employees')} icon={<Users className="size-4" />} label={`By Employee${data ? ` (${data.employees.length})` : ''}`} />
        {!salaried && <Tab active={tab === 'live'} onClick={() => setTab('live')} icon={<Timer className="size-4" />} label="On the Clock" />}
        {tab !== 'live' && data && (
          <div className="ml-auto pb-2">
            <button
              onClick={tab === 'sites' ? exportSites : exportEmployees}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-accent hover:text-ink"
            >
              <Download className="size-3.5" /> Export CSV
            </button>
          </div>
        )}
      </div>

      {tab === 'live' && <OnTheClock />}

      {/* Controls (cost report only) */}
      {tab !== 'live' && (
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                const r = p.range()
                setStart(r.start)
                setEnd(r.end)
                setActivePreset(p.label)
                void load(r.start, r.end, scopeFor(showSalaried))
              }}
              aria-pressed={activePreset === p.label}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${activePreset === p.label ? 'border-accent bg-accent text-white' : 'border-border bg-content text-ink-muted hover:border-accent hover:text-ink'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!salaried && regionLocked && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm font-semibold text-accent" title="You can view your region's sites">
            <MapPin className="size-4" /> {lockedRegions.join(' + ')}
          </span>
        )}
        {!salaried && !regionLocked && regionOptions.length > 0 && (
          <label className="text-xs font-medium text-ink-subtle">
            Region
            <select
              value={region}
              onChange={(e) => {
                const v = e.target.value
                setRegion(v)
                regionRef.current = v
                void load(start, end, scopeFor(showSalaried), v)
              }}
              className="mt-1 block rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink"
            >
              <option value="">All sites</option>
              {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {!salaried && !regionLocked && (
          <button
            type="button"
            role="switch"
            aria-checked={showSalaried}
            onClick={() => {
              const next = !showSalaried
              setShowSalaried(next)
              void load(start, end, scopeFor(next))
            }}
            className="flex items-center gap-2 rounded-lg border border-border bg-content px-3 py-2 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink"
          >
            <span className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ${showSalaried ? 'bg-accent' : 'bg-border'}`}>
              <span className={`inline-block size-4 rounded-full bg-white shadow transition ${showSalaried ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </span>
            Show salaried
          </button>
        )}
        <div className="flex items-end gap-2">
          <label className="text-xs font-medium text-ink-subtle">
            Start
            <input type="date" value={start} max={end} onChange={(e) => { setStart(e.target.value); setActivePreset(null) }} className="mt-1 block rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          </label>
          <label className="text-xs font-medium text-ink-subtle">
            End
            <input type="date" value={end} min={start} onChange={(e) => { setEnd(e.target.value); setActivePreset(null) }} className="mt-1 block rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          </label>
          <button
            onClick={() => void load(start, end, scopeFor(showSalaried))}
            disabled={loading}
            className="inline-flex h-[38px] items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </button>
        </div>
      </div>
      )}

      {tab !== 'live' && error && <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {tab !== 'live' && loading && !data && (
        <div className="mt-8 flex items-center justify-center gap-2 text-ink-muted"><Loader2 className="size-5 animate-spin" /> Loading labor from iSolved…</div>
      )}

      {tab !== 'live' && data && (
        <>
          {/* Totals */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Est. labor cost" value={usd(data.totals.totalCost)} tone="accent" />
            {showOnClock && <Stat label="On the clock now" value={String(data.totals.onClock ?? 0)} />}
            {showCars && <Stat label="Cars" value={carsTotal == null ? '…' : carsTotal.toLocaleString('en-US')} />}
            <Stat label="Total hours" value={num(data.totals.totalHours)} />
            <Stat label="Blended rate" value={data.totals.totalHours ? `${usd2(data.totals.totalCost / data.totals.totalHours)}/hr` : "—"} />
            <Stat label="Employees" value={String(data.totals.employees)} />
            <Stat label="Sites" value={String(data.totals.sites)} />
            {shownTypes.map((p) => (
              <Stat key={p} label={`${p} hrs`} value={num(data.totals.byPayType[p] ?? 0)} />
            ))}
          </div>

          {showOnClock && (
            <p className="mt-3 text-xs text-ink-muted">
              <strong className="text-ink">Total hrs</strong> is time actually worked: finished shifts plus time so far for everyone still clocked in
              (PTO is not included). <strong className="text-ink">On the Clock</strong> is how many people are clocked in right now.
            </p>
          )}

          <div className="mt-6" />

          {tab === 'sites' ? (
            <div className="mt-3 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Site</th>
                    {showOnClock && <th className="px-4 py-2.5 text-right font-semibold">On the Clock</th>}
                    {showCars && <th className="px-4 py-2.5 text-right font-semibold">Cars</th>}
                    {shownTypes.map((p) => <th key={p} className="px-4 py-2.5 text-right font-semibold">{p}</th>)}
                    <th className="px-4 py-2.5 text-right font-semibold">Total hrs</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Est. cost</th>
                    <th className="px-4 py-2.5 text-right font-semibold">$/hr</th>
                    {showEmps && <th className="px-4 py-2.5 text-right font-semibold">Emps</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.sites.map((s) => (
                    <tr key={s.site} className="hover:bg-content/50">
                      <td className="px-4 py-2.5 font-medium text-ink">{s.site}</td>
                      {showOnClock && <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink">{s.onClock ? s.onClock : '—'}</td>}
                      {showCars && <td className="px-4 py-2.5 text-right tabular-nums text-ink">{cars == null ? '…' : carsFor(s.site) != null ? carsFor(s.site)!.toLocaleString('en-US') : '—'}</td>}
                      {shownTypes.map((p) => <td key={p} className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.byPayType[p] ? num(s.byPayType[p]) : '—'}</td>)}
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{num(s.totalHours)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{usd(s.cost)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.totalHours ? usd2(s.cost / s.totalHours) : "—"}</td>
                      {showEmps && <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{s.employees}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-content font-semibold">
                  <tr>
                    <td className="px-4 py-2.5 text-ink">Total</td>
                    {showOnClock && <td className="px-4 py-2.5 text-right tabular-nums text-ink">{data.totals.onClock ?? 0}</td>}
                    {showCars && <td className="px-4 py-2.5 text-right tabular-nums text-ink">{carsTotal == null ? '…' : carsTotal.toLocaleString('en-US')}</td>}
                    {shownTypes.map((p) => <td key={p} className="px-4 py-2.5 text-right tabular-nums text-ink">{num(data.totals.byPayType[p] ?? 0)}</td>)}
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{num(data.totals.totalHours)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{usd(data.totals.totalCost)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink">{data.totals.totalHours ? usd2(data.totals.totalCost / data.totals.totalHours) : "—"}</td>
                    {showEmps && <td className="px-4 py-2.5 text-right tabular-nums text-ink">{data.totals.employees}</td>}
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
                      <th className="px-4 py-2.5 font-semibold">Type</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Rate</th>
                      <th className="px-4 py-2.5 font-semibold">Sites</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Total hrs</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredEmployees.map((e) => (
                      <tr key={e.employeeNumber} className="hover:bg-content/50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-ink">{e.name}</div>
                          <div className="text-xs text-ink-subtle">#{e.employeeNumber}</div>
                        </td>
                        <td className="px-4 py-2.5 text-ink-muted">{e.payType || "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{e.rate ? usd2(e.rate) : "—"}</td>
                        <td className="px-4 py-2.5 text-ink-muted">{e.sites.join(', ')}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{num(e.totalHours)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">{usd(e.cost)}</td>
                      </tr>
                    ))}
                    {filteredEmployees.length === 0 && (
                      <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-subtle">No employees match "{empSearch}".</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="mt-4 text-xs text-ink-subtle">
            Source: iSolved for {data.range.startDate} to {data.range.endDate}. {footerNote(data)}
            {data.totals.unratedEmployees > 0 ? ` ${data.totals.unratedEmployees} employee(s) had no rate on file (shown at $0).` : ''}
          </p>
        </>
      )}
    </div>
  )
}

function footerNote(data: LaborResponse): string {
  switch (data.salariedScope) {
    case 'only':
      return 'Salaried staff only, including Corporate, costed from salary (annual / 365 times days) and assigned to their work location.'
    case 'none':
      return 'Salaried hidden: hourly staff costed from timecard punches (overtime at 1.5x). Active hourly with no hours in this range are listed at $0.'
    default:
      return 'Hourly staff from timecard punches (overtime at 1.5x) plus active salaried costed from salary (annual / 365 times days), assigned to their work location. Corporate salaried is excluded. Active employees with no hours in this range are listed at $0.'
  }
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
