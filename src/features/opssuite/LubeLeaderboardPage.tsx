import { useEffect, useMemo, useState } from 'react'
import { Trophy, Medal, ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { fetchLubeStats, type LubeStats, type LubeAddonTech } from '@/lib/queries/lube'

// Add-on contest leaderboard for lube techs. Pick a contest window, a metric to
// compete on, and (optionally) a single add-on category, and rank the top techs.

type RangeKey = 'today' | 'week' | 'mtd' | 'lastmonth' | 'd30' | 'ytd'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'mtd', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'd30', label: 'Last 30 days' },
  { key: 'ytd', label: 'This year' },
]
function rangeDates(key: RangeKey): { start: string; end: string } {
  const now = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  // Last month is a closed window (1st -> last day of the previous month), unlike
  // the other ranges which run up to today.
  if (key === 'lastmonth') {
    return {
      start: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      end: iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    }
  }
  const end = iso(now)
  let start: Date
  if (key === 'today') start = now
  else if (key === 'week') start = new Date(now.getTime() - 6 * 86400_000)
  else if (key === 'mtd') start = new Date(now.getFullYear(), now.getMonth(), 1)
  else if (key === 'ytd') start = new Date(now.getFullYear(), 0, 1)
  else start = new Date(now.getTime() - 29 * 86400_000)
  return { start: iso(start), end }
}

const usd = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = (n: number) => Math.round(n).toLocaleString()

// Overall (all-add-on) contest metrics.
type MetricKey = 'dollars' | 'avg' | 'attach' | 'per_ticket' | 'units' | 'tickets'
const METRICS: Record<MetricKey, { label: string; blurb: string; value: (t: LubeAddonTech) => number; fmt: (n: number) => string }> = {
  dollars: { label: 'Add-on revenue', blurb: 'Total upsell dollars', value: (t) => t.dollars, fmt: usd },
  avg: { label: 'Avg add-on $/ticket', blurb: 'Add-on $ per car', value: (t) => t.avg_addon_per_ticket, fmt: usd2 },
  attach: { label: 'Attach rate', blurb: '% of cars that got an add-on', value: (t) => t.attach_rate, fmt: (n) => `${n}%` },
  per_ticket: { label: 'Add-ons per ticket', blurb: 'Units per car', value: (t) => t.units_per_ticket, fmt: (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
  units: { label: 'Total add-ons', blurb: 'Units sold', value: (t) => t.units, fmt: int },
  tickets: { label: 'Tickets', blurb: 'Cars worked', value: (t) => t.tickets, fmt: int },
}

type Row = { employee_id: string; name: string; value: number; sub: string }
const MEDAL = ['text-[#d4af37]', 'text-[#9ca3af]', 'text-[#cd7f32]'] // gold / silver / bronze

// Techs kept out of the contest (e.g. managers/leads), matched on name.
const EXCLUDED_TECHS = new Set(['jose gonzales', 'tiffany morris'])
const isExcluded = (name: string) => EXCLUDED_TECHS.has(name.trim().toLowerCase())

export default function LubeLeaderboardPage() {
  const [range, setRange] = useState<RangeKey>('mtd')
  const [metric, setMetric] = useState<MetricKey>('avg')
  const [category, setCategory] = useState<string>('__all__')
  const [catMetric, setCatMetric] = useState<'units' | 'dollars'>('units')
  const [data, setData] = useState<LubeStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { start, end } = rangeDates(range)
    let alive = true
    setLoading(true); setError(null)
    fetchLubeStats(start, end)
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Failed to load.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range])

  const categoryNames = useMemo(() => (data?.addonCategories ?? []).map((c) => c.name), [data])
  const usingCategory = category !== '__all__'

  const { rows, metricLabel, fmt } = useMemo(() => {
    if (!data) return { rows: [] as Row[], metricLabel: '', fmt: int as (n: number) => string }
    const techs = data.addonsByTech.filter((t) => !isExcluded(t.name))
    const excludedIds = new Set(data.addonsByTech.filter((t) => isExcluded(t.name)).map((t) => t.employee_id))
    if (usingCategory) {
      const ticketsById = new Map(techs.map((t) => [t.employee_id, t]))
      const byTech = new Map<string, Row>()
      for (const m of data.techCategoryMatrix) {
        if (m.category !== category || excludedIds.has(m.employee_id)) continue
        const t = ticketsById.get(m.employee_id)
        const name = t?.name ?? `#${m.employee_id}`
        const value = catMetric === 'dollars' ? m.dollars : m.units
        byTech.set(m.employee_id, { employee_id: m.employee_id, name, value, sub: `${int(m.units)} units · ${usd(m.dollars)}` })
      }
      // Include techs with 0 of this category too (so a contest shows everyone).
      for (const t of techs) if (!byTech.has(t.employee_id)) byTech.set(t.employee_id, { employee_id: t.employee_id, name: t.name, value: 0, sub: '0 units' })
      const f = catMetric === 'dollars' ? usd : int
      return { rows: [...byTech.values()].sort((a, b) => b.value - a.value), metricLabel: `${category} · ${catMetric === 'dollars' ? 'revenue' : 'units'}`, fmt: f }
    }
    const m = METRICS[metric]
    const rows = techs.map((t) => ({
      employee_id: t.employee_id, name: t.name, value: m.value(t),
      sub: `${int(t.tickets)} tickets · ${int(t.units)} add-ons · ${usd(t.dollars)}`,
    })).sort((a, b) => b.value - a.value)
    return { rows, metricLabel: m.label, fmt: m.fmt }
  }, [data, metric, category, catMetric, usingCategory])

  // Per-tech add-on breakdown by item (category), biggest dollars first, so each
  // person's row can expand to show what made up their add-on sales.
  const breakdownById = useMemo(() => {
    const m = new Map<string, { category: string; dollars: number; units: number }[]>()
    for (const r of data?.techCategoryMatrix ?? []) {
      if (r.dollars <= 0 && r.units <= 0) continue
      const arr = m.get(r.employee_id) ?? []
      arr.push({ category: r.category, dollars: r.dollars, units: r.units })
      m.set(r.employee_id, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => b.dollars - a.dollars)
    return m
  }, [data])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const top3 = rows.slice(0, 3)
  const { start, end } = rangeDates(range)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add-on Leaderboard"
        subtitle="Run add-on contests for the lube techs. Pick a window, a metric, and (optionally) an add-on to compete on."
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap gap-1">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)}
              className={cn('rounded-full px-3 py-1 text-sm font-medium transition', range === r.key ? 'bg-accent text-white' : 'bg-content border border-border text-ink-muted hover:text-ink')}>
              {r.label}
            </button>
          ))}
        </div>
        <label className="text-xs font-medium text-ink-subtle">Compete on
          <Select value={usingCategory ? '__cat__' : metric} onChange={(e) => { if (e.target.value !== '__cat__') { setCategory('__all__'); setMetric(e.target.value as MetricKey) } }} className="mt-1 block h-9 w-48">
            {(Object.keys(METRICS) as MetricKey[]).map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
            {usingCategory && <option value="__cat__">By add-on category</option>}
          </Select>
        </label>
        <label className="text-xs font-medium text-ink-subtle">Add-on
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block h-9 w-48">
            <option value="__all__">All add-ons</option>
            {categoryNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </label>
        {usingCategory && (
          <label className="text-xs font-medium text-ink-subtle">Rank by
            <Select value={catMetric} onChange={(e) => setCatMetric(e.target.value as 'units' | 'dollars')} className="mt-1 block h-9 w-32">
              <option value="units">Units</option>
              <option value="dollars">Revenue</option>
            </Select>
          </label>
        )}
      </div>

      {error && <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      <p className="-mt-2 text-xs text-ink-subtle">Contest: <span className="font-medium text-ink">{metricLabel}</span> · {start} to {end}</p>

      {loading ? (
        <div className="h-64 animate-pulse rounded bg-content" />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-ink-muted">No lube tech activity in this window.</div>
      ) : (
        <>
          {/* Podium */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {top3.map((r, i) => (
              <div key={r.employee_id} className={cn('relative overflow-hidden rounded-xl border p-4', i === 0 ? 'border-accent bg-accent-soft sm:order-2 sm:-mt-2 sm:scale-[1.03]' : 'border-border bg-card', i === 1 && 'sm:order-1', i === 2 && 'sm:order-3')}>
                <div className="flex items-center gap-2">
                  <Trophy className={cn('size-5', MEDAL[i])} />
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'}</span>
                </div>
                <div className="mt-2 truncate text-lg font-bold text-ink" title={r.name}>{r.name}</div>
                <div className="mt-1 text-3xl font-extrabold tabular text-ink">{fmt(r.value)}</div>
                <div className="mt-1 text-xs text-ink-subtle">{r.sub}</div>
              </div>
            ))}
          </div>

          {/* Full ranking */}
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">Full ranking</h2>
            </div>
            <ol className="divide-y divide-border">
              {rows.map((r, i) => {
                const bd = breakdownById.get(r.employee_id) ?? []
                const open = expanded.has(r.employee_id)
                return (
                  <li key={r.employee_id} className={cn(i < 3 && 'bg-content/40')}>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(r.employee_id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-content"
                      aria-expanded={open}
                    >
                      <div className="w-7 shrink-0 text-center">
                        {i < 3 ? <Medal className={cn('mx-auto size-5', MEDAL[i])} /> : <span className="text-sm font-semibold text-ink-subtle">{i + 1}</span>}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-ink">{r.name}</div>
                        <div className="truncate text-xs text-ink-subtle">{r.sub}</div>
                      </div>
                      <div className="shrink-0 text-right text-lg font-bold tabular text-ink">{fmt(r.value)}</div>
                      <ChevronDown className={cn('size-4 shrink-0 text-ink-muted transition', open && 'rotate-180')} />
                    </button>
                    {open && (
                      <div className="border-t border-border bg-content/30 px-4 py-2 pl-14">
                        {bd.length === 0 ? (
                          <p className="py-1 text-xs text-ink-subtle">No add-on sales in this window.</p>
                        ) : (
                          <ul className="divide-y divide-border/60">
                            <li className="flex items-center gap-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                              <span className="min-w-0 flex-1">Add-on item</span>
                              <span className="w-16 shrink-0 text-right">Units</span>
                              <span className="w-24 shrink-0 text-right">Revenue</span>
                            </li>
                            {bd.map((c) => (
                              <li key={c.category} className="flex items-center gap-3 py-1.5 text-sm">
                                <span className="min-w-0 flex-1 truncate text-ink-muted">{c.category}</span>
                                <span className="w-16 shrink-0 text-right tabular text-ink-subtle">{int(c.units)}</span>
                                <span className="w-24 shrink-0 text-right font-medium tabular text-ink">{usd(c.dollars)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </section>

          <p className="px-1 text-xs text-ink-subtle">
            {METRICS[metric] && !usingCategory ? METRICS[metric].blurb + '. ' : ''}
            Add-ons = upsell parts/accessories credited to the Lube Top Tech on the ticket.
          </p>
        </>
      )}
    </div>
  )
}
