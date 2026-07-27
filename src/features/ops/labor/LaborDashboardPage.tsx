import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Car, Clock, Users, BarChart3, CheckCircle2, AlertTriangle, XCircle, Pencil, Lightbulb, Trophy, CloudRain, Sun } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteNumber } from '@/lib/queries/sitePerformance'
import { labor, benchmarkFor, weatherForecast, type BenchmarkTier, type LaborDay, type WeatherDay } from '@/lib/queries/labor'

// Guardrails and the sample schedule breakdown are static (per the mockup). The
// schedule snapshot is sample data until the Schedule is populated with matching
// positions; hours scale to the (sample) scheduled total.
const GUARDRAILS = [
  'Wash quality on standard',
  'Customer service excellent',
  'Safety always',
  'Tunnel throughput strong',
  'Membership and retail execution strong',
]
const POS_TEMPLATE = [
  { area: 'Management', count: 2, w: 18 },
  { area: 'Front Line (Cashier / POS)', count: 2, w: 16 },
  { area: 'Prep / Lot', count: 3, w: 21 },
  { area: 'Tunnel (Wash / Detail)', count: 10, w: 44 },
  { area: 'Drying / Final', count: 4, w: 22 },
  { area: 'Sales / Greeter', count: 2, w: 12 },
]
const POS_TOTAL_W = POS_TEMPLATE.reduce((s, p) => s + p.w, 0)

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
const nf = (n: number) => Math.round(n).toLocaleString('en-US')
const money = (n: number) => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Distribute a scheduled-hours total across the sample positions.
function sampleSchedule(total: number) {
  const rows = POS_TEMPLATE.map((p) => ({ area: p.area, count: p.count, hours: round1((total * p.w) / POS_TOTAL_W) }))
  const diff = round1(total - rows.reduce((s, r) => s + r.hours, 0))
  if (diff) rows[3].hours = round1(rows[3].hours + diff) // Tunnel absorbs rounding residual
  return rows
}

type Status = 'benchmark' | 'review' | 'action'
function statusFor(variance: number): Status {
  if (variance <= 0) return 'benchmark'
  if (variance <= 4) return 'review'
  return 'action'
}

export default function LaborDashboardPage() {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const [days, setDays] = useState<LaborDay[]>([])
  const [weather, setWeather] = useState<WeatherDay[]>([])
  const [tiers, setTiers] = useState<BenchmarkTier[]>([])
  const [isSiteOverride, setIsSiteOverride] = useState(false)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)

  const activeId = activeLocation?.id ?? null
  const sn = activeLocation ? siteNumber(activeLocation.name) : null
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager'

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const since = format(new Date(Date.now() - 60 * 86400000), 'yyyy-MM-dd')
    const [d, w, t] = await Promise.all([
      sn != null ? labor.days(sn, since) : Promise.resolve([] as LaborDay[]),
      activeId ? labor.weather(activeId, since) : Promise.resolve([] as WeatherDay[]),
      labor.tiersForSite(profile.account_id, activeId),
    ])
    setDays(d)
    setWeather(w)
    setTiers(t.tiers)
    setIsSiteOverride(t.isSiteOverride)
    setLoading(false)
  }, [profile, sn, activeId])

  useEffect(() => {
    void load()
  }, [load])

  const m = useMemo<Metrics>(() => {
    const tomorrow = new Date(Date.now() + 86400000)
    const weatherMap = new Map(weather.map((w) => [w.date, w]))
    const fc = weatherForecast(days, weatherMap, tomorrow)
    const forecast = fc.cars
    const earnedMax = benchmarkFor(tiers, forecast)
    // Scheduled is sample/placeholder until the Schedule is wired: target a hair
    // under the benchmark so the plan reads as "at or below."
    const scheduled = Math.max(0, earnedMax - 3)
    const variance = scheduled - earnedMax
    const status = statusFor(variance)

    const withCars = days.filter((d) => d.cars > 0)
    const last7 = withCars.slice(-7)

    // Month-to-date over the current calendar month's populated days.
    const monthStart = format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd')
    const mtd = withCars.filter((d) => d.date >= monthStart)
    const totCars = mtd.reduce((s, d) => s + d.cars, 0)
    const totHours = mtd.reduce((s, d) => s + d.hours, 0)
    const totSales = mtd.reduce((s, d) => s + d.sales, 0)
    const totLabor = mtd.reduce((s, d) => s + d.labor_cost, 0)
    const totEarned = mtd.reduce((s, d) => s + benchmarkFor(tiers, d.cars), 0)

    return {
      tomorrow, forecast, earnedMax, scheduled, variance, status, last7, mtd,
      weather: fc.weather, weatherWet: fc.wet, weatherFactor: fc.factor, baselineForecast: fc.baseline,
      totCars, totHours, totSales, totLabor, totEarned,
      belowBenchmark: totEarned - totHours,
      avgHours: mtd.length ? totHours / mtd.length : 0,
      carsPerHour: totHours ? totCars / totHours : 0,
      laborPct: totSales ? (totLabor / totSales) * 100 : mtd.length ? mtd.reduce((s, d) => s + (d.labor_pct ?? 0), 0) / mtd.length : 0,
      revPerHour: totHours ? totSales / totHours : 0,
    }
  }, [days, weather, tiers])

  if (loading) return <p className="text-sm text-ink-muted">Loading labor dashboard…</p>

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Labor Dashboard"
        subtitle="Daily labor planning. Plan smart, operate efficiently, earn the hours."
        actions={
          <div className="text-right text-sm">
            <div className="font-semibold text-ink">{activeLocation?.name ?? 'Select a site'}</div>
            <div className="text-ink-muted">Tomorrow: {format(m.tomorrow, 'EEEE, MMMM d, yyyy')}</div>
          </div>
        }
      />

      {sn == null || days.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No performance data for this site yet"
          description="The labor dashboard uses this site's daily car counts and hours. Pick a site with Site Performance data from the site switcher."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <PlanPanel m={m} />
            <BenchmarkPanel tiers={tiers} forecast={m.forecast} canEdit={canEdit} isSiteOverride={isSiteOverride} onEdit={() => setEditOpen(true)} />
            <StatusPanel />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <RollingPanel last7={m.last7} tiers={tiers} />
            <MtdPanel m={m} />
            <SchedulePanel scheduled={m.scheduled} />
          </div>
          <p className="text-xs text-ink-subtle">
            Earned labor hours are based on the forecast (same weekday history) and this site's benchmark table. Actuals come from Site Performance. Scheduled hours and the position snapshot are sample data until the Schedule is populated. Adjust throughout the day based on actual traffic.
          </p>
        </>
      )}

      {editOpen && profile && (
        <BenchmarkEditor
          accountId={profile.account_id}
          locationId={activeLocation?.id ?? null}
          locationName={activeLocation?.name ?? null}
          initial={tiers}
          isSiteOverride={isSiteOverride}
          onClose={() => setEditOpen(false)}
          onSaved={() => { setEditOpen(false); void load() }}
        />
      )}
    </div>
  )
}

// ---- Panels ---------------------------------------------------------------

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card ${className ?? ''}`}>
      <div className="border-b border-border bg-shell px-4 py-2.5">
        <h2 className="text-center text-sm font-bold uppercase tracking-wide text-ink-invert">{title}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">{children}</div>
    </section>
  )
}

type Metrics = {
  tomorrow: Date; forecast: number; earnedMax: number; scheduled: number; variance: number; status: Status
  weather: WeatherDay | null; weatherWet: boolean; weatherFactor: number; baselineForecast: number
  last7: LaborDay[]; mtd: LaborDay[]; totCars: number; totHours: number; totSales: number; totLabor: number; totEarned: number
  belowBenchmark: number; avgHours: number; carsPerHour: number; laborPct: number; revPerHour: number
}

function PlanRow({ icon: Icon, label, sub, value, valueClass }: { icon: typeof Car; label: string; sub?: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{label}</div>
        {sub && <div className="text-xs text-ink-muted">{sub}</div>}
      </div>
      <div className={`text-xl font-bold tabular-nums ${valueClass ?? 'text-accent'}`}>{value}</div>
    </div>
  )
}

const STATUS_META: Record<Status, { tone: 'ok' | 'warn' | 'danger'; label: string; icon: typeof CheckCircle2; desc: string }> = {
  benchmark: { tone: 'ok', label: 'Benchmark', icon: CheckCircle2, desc: 'Operating at or below the earned-hours ceiling is encouraged when service, safety, sales, and wash quality are maintained.' },
  review: { tone: 'warn', label: 'Review', icon: AlertTriangle, desc: 'Scheduled above the benchmark maximum. Monitor and evaluate.' },
  action: { tone: 'danger', label: 'Action Required', icon: XCircle, desc: 'Well above the benchmark maximum. Regional review required.' },
}

function PlanPanel({ m }: { m: Metrics }) {
  const s = STATUS_META[m.status]
  const under = m.scheduled <= m.earnedMax
  const toneBg = s.tone === 'ok' ? 'bg-ok-soft text-ok' : s.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'
  return (
    <Panel title="Tomorrow's Plan">
      <PlanRow icon={Car} label="Forecast Cars" value={nf(m.forecast)} />
      {m.weather && (
        <div className="-mt-1 flex items-center gap-2 rounded-md border border-border bg-content px-3 py-1.5 text-xs text-ink-muted">
          {m.weatherWet ? <CloudRain className="size-3.5 text-accent" /> : <Sun className="size-3.5 text-warn" />}
          <span>
            {m.weather.conditions ?? 'Forecast'}
            {m.weather.temp_max != null ? `, ${Math.round(m.weather.temp_max)}°` : ''}
            {m.weather.precip_in != null && m.weather.precip_in > 0 ? `, ${m.weather.precip_in.toFixed(2)} in rain` : ''}
          </span>
          {m.weatherWet && m.weatherFactor !== 1 && (
            <span className="ml-auto font-semibold text-accent">
              {m.weatherFactor < 1 ? '▼' : '▲'} {Math.abs(Math.round((1 - m.weatherFactor) * 100))}% vs {nf(m.baselineForecast)} dry
            </span>
          )}
        </div>
      )}
      <PlanRow icon={Clock} label="Earned Labor Hours" sub="Benchmark maximum" value={<span>up to {nf(m.earnedMax)}</span>} valueClass="text-ok" />
      <PlanRow icon={Users} label="Currently Scheduled" value={nf(m.scheduled)} />
      <PlanRow icon={BarChart3} label="Schedule Variance" sub="vs benchmark maximum" value={<span>{nf(Math.abs(m.variance))} {under ? 'under' : 'over'} {under ? '↓' : '↑'}</span>} valueClass={under ? 'text-ok' : 'text-danger'} />
      <div className={`mt-1 flex items-start gap-3 rounded-lg px-4 py-3 ${toneBg}`}>
        <s.icon className="mt-0.5 size-5 shrink-0" />
        <div>
          <div className="text-sm font-bold uppercase tracking-wide">Status: {s.label}</div>
          <p className="mt-1 text-xs opacity-90">{s.desc}</p>
        </div>
      </div>
    </Panel>
  )
}

function BenchmarkPanel({ tiers, forecast, canEdit, isSiteOverride, onEdit }: { tiers: BenchmarkTier[]; forecast: number; canEdit: boolean; isSiteOverride: boolean; onEdit: () => void }) {
  const activeMin = tiers.find((t) => forecast >= t.min_cars && (t.max_cars == null || forecast <= t.max_cars))?.min_cars
  return (
    <Panel title="Earned Labor Hours Benchmark">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-ink-muted">Maximum benchmark labor hours by forecasted daily cars. Operating at or below is the goal.</p>
        {canEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}><Pencil className="size-3.5" /> Edit</Button>
        )}
      </div>
      {isSiteOverride && <Badge tone="accent">Site-specific benchmark</Badge>}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Expected cars / day</th><th className="px-3 py-2 text-right">Benchmark: up to</th></tr>
          </thead>
          <tbody>
            {tiers.map((t) => {
              const on = t.min_cars === activeMin
              return (
                <tr key={t.min_cars} className={`border-t border-border ${on ? 'bg-ok-soft font-semibold' : ''}`}>
                  <td className="px-3 py-1.5 text-ink">{t.max_cars == null ? `${t.min_cars} or more` : t.min_cars === 0 ? `${t.max_cars} or less` : `${t.min_cars} – ${t.max_cars}`}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-ok">{nf(t.max_hours)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-xs text-accent">
        <Lightbulb className="mt-0.5 size-3.5 shrink-0" />
        <span>Tip: Schedule to the earned-hours ceiling, then adjust through the day based on actual traffic.</span>
      </div>
    </Panel>
  )
}

function StatusPanel() {
  const rows: Array<{ tone: 'ok' | 'warn' | 'danger'; label: string; range: string; note: string }> = [
    { tone: 'ok', label: 'Benchmark', range: 'At or below', note: 'At or below benchmark' },
    { tone: 'warn', label: 'Review', range: '1 to 4 hours above', note: 'Monitor and evaluate' },
    { tone: 'danger', label: 'Action Required', range: '5+ hours above', note: 'Regional review required' },
  ]
  const meta = { ok: { c: 'text-ok bg-ok-soft', I: CheckCircle2 }, warn: { c: 'text-warn bg-warn-soft', I: AlertTriangle }, danger: { c: 'text-danger bg-danger-soft', I: XCircle } }
  return (
    <Panel title="Status Key & Guardrails">
      <div className="flex flex-col gap-2">
        {rows.map((r) => {
          const mm = meta[r.tone]
          return (
            <div key={r.label} className={`flex items-center gap-3 rounded-md px-3 py-2 ${mm.c}`}>
              <mm.I className="size-5 shrink-0" />
              <div className="flex-1"><div className="text-sm font-bold uppercase">{r.label}</div><div className="text-xs opacity-90">{r.note}</div></div>
              <div className="text-right text-xs font-semibold">{r.range}</div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 rounded-md border border-border bg-content p-3">
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-muted">Important guardrails</div>
        <ul className="flex flex-col gap-1">
          {GUARDRAILS.map((g) => (
            <li key={g} className="flex items-center gap-2 text-sm text-ink"><CheckCircle2 className="size-3.5 text-accent" /> {g}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs font-semibold text-ink-muted">If any guardrail is not met, do not reduce labor below what is needed to maintain the standard.</p>
      </div>
    </Panel>
  )
}

function RollingPanel({ last7, tiers }: { last7: LaborDay[]; tiers: BenchmarkTier[] }) {
  const rows = last7.map((d) => ({ date: d.date, cars: d.cars, actual: d.hours, earned: benchmarkFor(tiers, d.cars) }))
  return (
    <Panel title="7-Day Rolling Performance">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">No recent days with data.</p>
      ) : (
        <ComboChart rows={rows} />
      )}
      <p className="rounded-md border border-accent/20 bg-accent-soft px-3 py-2 text-center text-xs text-accent">
        Operating below the earned-hours line while maintaining the guardrails is how we drive labor efficiency.
      </p>
    </Panel>
  )
}

function ComboChart({ rows }: { rows: Array<{ date: string; cars: number; actual: number; earned: number }> }) {
  const W = 520, H = 240, padL = 34, padR = 34, padT = 16, padB = 34
  const iw = W - padL - padR, ih = H - padT - padB
  const maxHours = Math.max(...rows.map((r) => Math.max(r.actual, r.earned)), 10) * 1.15
  const maxCars = Math.max(...rows.map((r) => r.cars), 10) * 1.25
  const n = rows.length
  const band = iw / n
  const yH = (v: number) => padT + ih - (v / maxHours) * ih
  const cx = (i: number) => padL + band * i + band / 2
  const line = (key: 'actual' | 'earned') => rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${cx(i).toFixed(1)} ${yH(r[key]).toFixed(1)}`).join(' ')
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[460px]" role="img" aria-label="7-day rolling performance">
        {/* bars = cars */}
        {rows.map((r, i) => {
          const bw = band * 0.5
          const h = (r.cars / maxCars) * ih
          return <rect key={i} x={cx(i) - bw / 2} y={padT + ih - h} width={bw} height={h} rx={2} className="fill-border" />
        })}
        {/* earned (dashed) + actual (solid) */}
        <path d={line('earned')} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 4" />
        <path d={line('actual')} fill="none" stroke="#16a34a" strokeWidth={2.5} />
        {rows.map((r, i) => <circle key={i} cx={cx(i)} cy={yH(r.actual)} r={3} fill="#16a34a" />)}
        {/* x labels */}
        {rows.map((r, i) => (
          <text key={i} x={cx(i)} y={H - 12} textAnchor="middle" className="fill-ink-muted" fontSize="10">
            {format(new Date(r.date + 'T12:00:00'), 'EEE')} {format(new Date(r.date + 'T12:00:00'), 'M/d')}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap justify-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 bg-[#16a34a]" /> Actual hours</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 border-t-2 border-dashed border-[#2563eb]" /> Earned hours (max)</span>
        <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-border" /> Cars</span>
      </div>
    </div>
  )
}

function MtdRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between border-b border-border/60 py-1.5 text-sm ${highlight ? 'rounded bg-ok-soft px-2 font-semibold text-ok' : ''}`}>
      <span className={highlight ? '' : 'text-ink-muted'}>{label}</span>
      <span className={`tabular-nums ${highlight ? '' : 'font-semibold text-ink'}`}>{value}</span>
    </div>
  )
}

function MtdPanel({ m }: { m: Metrics }) {
  const monthLabel = format(new Date(), 'MMMM')
  return (
    <Panel title={`Month-to-Date Summary (${monthLabel})`}>
      <MtdRow label="Total forecast cars" value={nf(m.totCars)} />
      <MtdRow label="Total earned hours (benchmark max)" value={nf(m.totEarned)} />
      <MtdRow label="Total actual hours" value={nf(m.totHours)} />
      <MtdRow label="Hours below benchmark" value={nf(m.belowBenchmark)} highlight={m.belowBenchmark >= 0} />
      <MtdRow label="Average hours per day" value={round1(m.avgHours).toString()} />
      <MtdRow label="Average cars per labor hour" value={round1(m.carsPerHour).toString()} />
      <MtdRow label="Labor % (MTD)" value={round1(m.laborPct) + '%'} />
      <MtdRow label="Revenue per labor hour" value={money(m.revPerHour)} />
      {m.belowBenchmark >= 0 && (
        <div className="mt-1 flex items-center gap-2 rounded-md border border-ok/30 bg-ok-soft px-3 py-2 text-xs text-ok">
          <Trophy className="size-4 shrink-0" /> {nf(m.belowBenchmark)} hours below benchmark this month while maintaining performance.
        </div>
      )}
    </Panel>
  )
}

function SchedulePanel({ scheduled }: { scheduled: number }) {
  const rows = sampleSchedule(scheduled)
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  const totalHours = round1(rows.reduce((s, r) => s + r.hours, 0))
  return (
    <Panel title="Tomorrow's Schedule Snapshot">
      <Badge tone="warn">Sample data</Badge>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr><th className="px-3 py-2">Position / area</th><th className="px-3 py-2 text-right">Employees</th><th className="px-3 py-2 text-right">Hours</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.area} className="border-t border-border"><td className="px-3 py-1.5 text-ink">{r.area}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.count}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.hours.toFixed(1)}</td></tr>
            ))}
            <tr className="border-t border-border bg-content font-semibold"><td className="px-3 py-1.5 text-ink">Totals</td><td className="px-3 py-1.5 text-right tabular-nums">{totalCount}</td><td className="px-3 py-1.5 text-right tabular-nums">{totalHours.toFixed(1)}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-md bg-accent-soft px-3 py-2 text-sm font-bold text-accent">
        <span>Total labor hours scheduled</span><span className="tabular-nums">{nf(scheduled)}.0</span>
      </div>
      <p className="text-xs text-ink-subtle">Adjust throughout the day based on actual traffic. Remove excess labor early to protect your daily results.</p>
    </Panel>
  )
}

// ---- Benchmark editor -----------------------------------------------------

function BenchmarkEditor({ accountId, locationId, locationName, initial, isSiteOverride, onClose, onSaved }: {
  accountId: string
  locationId: string | null
  locationName: string | null
  initial: BenchmarkTier[]
  isSiteOverride: boolean
  onClose: () => void
  onSaved: () => void
}) {
  // Scope: edit the account default, or a per-site override.
  const [scope, setScope] = useState<'default' | 'site'>(isSiteOverride || !locationId ? (locationId ? 'site' : 'default') : 'default')
  const [rows, setRows] = useState<BenchmarkTier[]>(initial.length ? initial : [{ min_cars: 0, max_cars: null, max_hours: 0 }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const setRow = (i: number, patch: Partial<BenchmarkTier>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const addRow = () => setRows((p) => [...p, { min_cars: (p[p.length - 1]?.max_cars ?? 0) + 1, max_cars: null, max_hours: 0 }])
  const removeRow = (i: number) => setRows((p) => p.filter((_, j) => j !== i))

  const save = async () => {
    setBusy(true)
    setErr(null)
    const target = scope === 'site' ? locationId : null
    const clean = rows
      .map((r) => ({ min_cars: Math.round(Number(r.min_cars) || 0), max_cars: r.max_cars == null || String(r.max_cars) === '' ? null : Math.round(Number(r.max_cars)), max_hours: Number(r.max_hours) || 0 }))
      .sort((a, b) => a.min_cars - b.min_cars)
    const { error } = await labor.saveTiers(accountId, target, clean)
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Edit earned-hours benchmark" size="lg">
      <div className="flex flex-col gap-4">
        {locationId && (
          <label className="flex flex-col gap-1 text-sm text-ink-muted">
            Applies to
            <select value={scope} onChange={(e) => setScope(e.target.value as 'default' | 'site')} className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink">
              <option value="default">All sites (account default)</option>
              <option value="site">{locationName} only</option>
            </select>
          </label>
        )}
        {err && <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</div>}
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr><th className="px-2 py-2">Min cars</th><th className="px-2 py-2">Max cars (blank = up)</th><th className="px-2 py-2">Max hours</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1.5"><Input type="number" value={r.min_cars} onChange={(e) => setRow(i, { min_cars: Number(e.target.value) })} className="h-8 w-24" /></td>
                  <td className="px-2 py-1.5"><Input type="number" value={r.max_cars ?? ''} onChange={(e) => setRow(i, { max_cars: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-24" placeholder="and up" /></td>
                  <td className="px-2 py-1.5"><Input type="number" value={r.max_hours} onChange={(e) => setRow(i, { max_hours: Number(e.target.value) })} className="h-8 w-24" /></td>
                  <td className="px-2 py-1.5 text-right"><Button variant="ghost" size="sm" className="text-danger" onClick={() => removeRow(i)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="secondary" size="sm" onClick={addRow}>Add tier</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save benchmark'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
