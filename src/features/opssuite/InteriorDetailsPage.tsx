import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert, Lightbulb } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import {
  fetchInteriorServicesReport,
  fetchInteriorDailyBreakdown,
  type InteriorServicesReport,
  type InteriorDailyBreakdown,
  type InteriorTeam,
  type InteriorSiteRollup,
} from '@/lib/queries/sitePerformance'

// The dashboard refreshes its live Details tab every 60s; mirror that here.
const REFRESH_MS = 60_000

type Period = 'today' | 'mtd'

const DASH = '—'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ---------- formatting + heat ----------

const num = (n: number | null | undefined) => (n == null ? DASH : Math.round(n).toLocaleString('en-US'))
const money = (n: number | null | undefined) =>
  n == null ? DASH : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = (n: number | null | undefined) => (n == null ? DASH : `${n.toFixed(2)}%`)

// Attach-rate heat: red (worse) to green (better). Attach rates here sit around
// 0.8% to 2.4%, so map that band across the same hue sweep the other tabs use.
function attachColor(v: number | null | undefined): string {
  if (v == null) return 'inherit'
  const t = Math.max(0, Math.min(1, (v - 0.8) / (2.4 - 0.8)))
  const hue = 4 + t * 136
  return `hsl(${hue}, 68%, 40%)`
}

// today_* / mtd_* accessor for the selected period.
function val(row: InteriorTeam | InteriorSiteRollup, period: Period, base: string): number {
  return Number((row as unknown as Record<string, number>)[`${period}_${base}`] ?? 0)
}

// ---------- chrome ----------

function Seg({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const options: { key: Period; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'mtd', label: 'MTD' },
  ]
  return (
    <div className="inline-flex gap-1 rounded-lg border border-border bg-content p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded-md px-3 py-1 text-xs font-medium transition',
            value === o.key ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const th = 'px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-subtle first:text-left sm:px-4'
const td = 'px-3 py-2 text-right text-sm text-ink first:text-left sm:px-4 tabular-nums'

function Panel({
  title,
  subtitle,
  live,
  actions,
  children,
}: {
  title: string
  subtitle: string
  live?: boolean
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pb-3 pt-4 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">
            {title}
            {live && <span className="ml-2 text-[11px] font-medium normal-case tracking-normal text-accent">· Live</span>}
          </h2>
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

// ---------- page ----------

export default function InteriorDetailsPage() {
  const [report, setReport] = useState<InteriorServicesReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  const [teamPeriod, setTeamPeriod] = useState<Period>('mtd')
  const [rollupPeriod, setRollupPeriod] = useState<Period>('mtd')
  const [site, setSite] = useState<string>('all') // shared by rollup filter + daily breakdown
  const [year, setYear] = useState<number>(0)
  const [month, setMonth] = useState<number>(0)

  const [daily, setDaily] = useState<InteriorDailyBreakdown | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)

  // Main report poll.
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await fetchInteriorServicesReport()
        if (!active) return
        setReport(data)
        setError(null)
        setUpdatedAt(new Date().toLocaleTimeString())
        // Seed the year/month pickers from the report window on first load.
        setYear((y) => (y ? y : Number(data.window.end.slice(0, 4))))
        setMonth((m) => (m ? m : Number(data.window.end.slice(5, 7))))
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [])

  // Daily breakdown follows the site picker + year/month, and refreshes live.
  useEffect(() => {
    if (!year || !month) return
    let active = true
    const load = async () => {
      try {
        const data = await fetchInteriorDailyBreakdown(site, year, month)
        if (!active) return
        setDaily(data)
        setDailyError(null)
      } catch (e) {
        if (active) setDailyError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [site, year, month])

  const teams = useMemo(() => {
    const list = [...(report?.teams ?? [])]
    return list.sort((a, b) => val(b, teamPeriod, 'pct') - val(a, teamPeriod, 'pct'))
  }, [report, teamPeriod])

  const siteOptions = useMemo(
    () => [...(report?.site_rollup ?? [])].sort((a, b) => a.site_number - b.site_number),
    [report],
  )

  const rollupRows = useMemo(() => {
    const rows = [...(report?.site_rollup ?? [])]
      .filter((r) => site === 'all' || String(r.site_number) === site)
      .sort((a, b) => val(b, rollupPeriod, 'pct') - val(a, rollupPeriod, 'pct'))
    return rows
  }, [report, rollupPeriod, site])

  // Year options span the archive (2025) through the report's current year.
  const yearOptions = useMemo(() => {
    const cur = year || new Date().getFullYear()
    const years: number[] = []
    for (let y = 2025; y <= cur; y++) years.push(y)
    return years
  }, [year])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Detail Performance"
        subtitle="Interior services attach rate: hustles, MVP sales, and extras by team and site."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {error ? 'Update failed' : updatedAt ? `Updated ${updatedAt}` : 'Connecting...'}
          </span>
        }
      />

      {error && !report && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load Details data.</p>
            <p className="mt-0.5 text-danger/80">{error}</p>
          </div>
        </div>
      )}

      {!report && !error && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
          Warming up. First load can take ~20s.
        </p>
      )}

      {report && (
        <>
          {report.commentary.length > 0 && (
            <section className="rounded-xl border border-border bg-card px-4 py-3 sm:px-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
                <Lightbulb className="size-4 text-accent" />
                Highlights
              </div>
              <ul className="space-y-1 text-sm text-ink-muted">
                {report.commentary.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-ink-subtle">•</span>
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Team Standings */}
          <Panel
            title="Team Standings"
            live
            subtitle="Attach rate = (Hustles + Intro MVP sales + Mighty MVP sales) ÷ Cars Washed"
            actions={<Seg value={teamPeriod} onChange={setTeamPeriod} />}
          >
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-border">
                  {['Rank', 'Team', 'Sites', 'Hustles', 'Intro MVP', 'Mighty MVP', 'Conv', 'Cars', '%', 'Extras $'].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {teams.map((t, i) => (
                  <tr key={t.team} className={cn(i === 0 && val(t, teamPeriod, 'pct') > 0 && 'bg-accent-soft/40')}>
                    <td className={td}>{i + 1}</td>
                    <td className={cn(td, 'font-medium')}>{t.team}</td>
                    <td className={td}>{t.sites.map((n) => `#${n}`).join(', ')}</td>
                    <td className={td}>{num(val(t, teamPeriod, 'hustles'))}</td>
                    <td className={td}>{num(val(t, teamPeriod, 'intro_mvp'))}</td>
                    <td className={td}>{num(val(t, teamPeriod, 'mighty_mvp'))}</td>
                    <td className={td}>{num(val(t, teamPeriod, 'conv'))}</td>
                    <td className={td}>{num(val(t, teamPeriod, 'cars'))}</td>
                    <td className={td} style={{ color: attachColor(val(t, teamPeriod, 'pct')) }}>{pct(val(t, teamPeriod, 'pct'))}</td>
                    <td className={td}>{money(val(t, teamPeriod, 'extras'))}</td>
                  </tr>
                ))}
                {teams.length === 0 && (
                  <tr><td className="px-4 py-8 text-center text-sm text-ink-muted" colSpan={10}>No team data right now.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          {/* Site Rollup */}
          <Panel
            title="Site Rollup"
            live
            subtitle="Every interior-capable site, including sites with no team assigned yet"
            actions={
              <>
                <Select value={site} onChange={(e) => setSite(e.target.value)} className="h-9 w-40">
                  <option value="all">All sites</option>
                  {siteOptions.map((s) => (
                    <option key={s.site_number} value={String(s.site_number)}>#{s.site_number}</option>
                  ))}
                </Select>
                <Seg value={rollupPeriod} onChange={setRollupPeriod} />
              </>
            }
          >
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-border">
                  {['Site', 'Team', 'Hustles', 'Conv', 'Cars', '%', 'Intro MVP', 'Mighty MVP', 'Yesterday %', 'Extras $'].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rollupRows.map((r) => (
                  <tr key={r.site_number}>
                    <td className={cn(td, 'font-medium')}>#{r.site_number}</td>
                    <td className={td}>{r.team ?? DASH}</td>
                    <td className={td}>{num(val(r, rollupPeriod, 'hustles'))}</td>
                    <td className={td}>{num(val(r, rollupPeriod, 'conv'))}</td>
                    <td className={td}>{num(val(r, rollupPeriod, 'cars'))}</td>
                    <td className={td} style={{ color: attachColor(val(r, rollupPeriod, 'pct')) }}>{pct(val(r, rollupPeriod, 'pct'))}</td>
                    <td className={td}>{num(val(r, rollupPeriod, 'intro_mvp'))}</td>
                    <td className={td}>{num(val(r, rollupPeriod, 'mighty_mvp'))}</td>
                    <td className={td} style={{ color: attachColor(r.yesterday_pct) }}>{pct(r.yesterday_pct)}</td>
                    <td className={td}>{money(val(r, rollupPeriod, 'extras'))}</td>
                  </tr>
                ))}
                {rollupRows.length === 0 && (
                  <tr><td className="px-4 py-8 text-center text-sm text-ink-muted" colSpan={10}>No site data right now.</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          {/* Daily Breakdown */}
          <Panel
            title="Daily Breakdown"
            subtitle={
              site === 'all'
                ? 'Company-wide daily totals for the selected month'
                : `Site #${site} daily totals for the selected month`
            }
            actions={
              <>
                <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="h-9 w-24">
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
                <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))} className="h-9 w-28">
                  {MONTHS.map((mn, i) => (
                    <option key={mn} value={i + 1}>{mn}</option>
                  ))}
                </Select>
              </>
            }
          >
            {dailyError && !daily ? (
              <p className="px-4 py-8 text-center text-sm text-danger">{dailyError}</p>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-y border-border">
                    {['Date', 'Cars', 'Hustles', 'Intro MVP', 'Mighty MVP', 'Conv', 'Run %', 'Extras $'].map((h) => (
                      <th key={h} className={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(daily?.days ?? []).map((d) => (
                    <tr key={d.date}>
                      <td className={td}>{d.date}</td>
                      <td className={td}>{num(d.cars)}</td>
                      <td className={td}>{num(d.hustles)}</td>
                      <td className={td}>{num(d.intro_mvp)}</td>
                      <td className={td}>{num(d.mighty_mvp)}</td>
                      <td className={td}>{num(d.conv)}</td>
                      <td className={td} style={{ color: attachColor(d.run_pct) }}>{pct(d.run_pct)}</td>
                      <td className={td}>{money(d.extras)}</td>
                    </tr>
                  ))}
                  {(daily?.days?.length ?? 0) === 0 && (
                    <tr><td className="px-4 py-8 text-center text-sm text-ink-muted" colSpan={8}>No days recorded for this month.</td></tr>
                  )}
                </tbody>
                {daily && daily.days.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-content/60 font-semibold">
                      <td className={cn(td, 'font-semibold')}>Total</td>
                      <td className={td}>{num(daily.totals.cars)}</td>
                      <td className={td}>{num(daily.totals.hustles)}</td>
                      <td className={td}>{num(daily.totals.intro_mvp)}</td>
                      <td className={td}>{num(daily.totals.mighty_mvp)}</td>
                      <td className={td}>{num(daily.totals.conv)}</td>
                      <td className={td} style={{ color: attachColor(daily.totals.pct) }}>{pct(daily.totals.pct)}</td>
                      <td className={td}>{money(daily.totals.extras)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </Panel>
        </>
      )}

      <p className="px-1 text-xs leading-relaxed text-ink-subtle">
        Live, updates every 60s. Attach rate = (Hustles + Intro MVP + Mighty MVP sales) ÷ Cars Washed. Today = live so far today, MTD = month to date. Pulled from the same live source as the ops.mwdashboards.com Details tab.
      </p>
    </div>
  )
}
