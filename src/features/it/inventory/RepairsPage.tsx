import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { differenceInCalendarDays, format, parseISO, subDays, subMonths } from 'date-fns'
import { ArrowLeft, Download, Loader2, Search, ShieldCheck, Wrench } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { downloadCsv } from '@/lib/csv'
import { currency } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItRepairRow } from '@/lib/queries/itInventory'
import { fmtDay, fmtDowntime, friendlyError, type Tone } from './format'
import { useItRefs } from './useItRefs'

// Every repair and service job across the sites you can see: what's open now,
// what it's cost (last 90 days, this year, by site and by kind of gear over
// the last 12 months) and how long things were out of service. Logging and
// finishing happen on each item's Repairs tab.

type Show = 'open' | 'done' | 'all'

export function RepairsPage() {
  const navigate = useNavigate()
  const { locations } = useLocations()
  const { refs } = useItRefs()
  const [params, setParams] = useSearchParams()
  const site = params.get('site') ?? 'all'
  const show = (params.get('show') as Show | null) ?? 'all'
  const type = params.get('type') ?? ''
  const q = params.get('q') ?? ''
  const [rows, setRows] = useState<ItRepairRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  useEffect(() => {
    let alive = true
    void itInventory.repairs().then(({ data, error: err }) => {
      if (!alive) return
      setRows(data)
      setError(err?.message ?? null)
    })
    return () => { alive = false }
  }, [])

  const setParam = (patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    return next
  }, { replace: true })

  const atSite = useMemo(() => (rows ?? []).filter((r) => site === 'all' || r.location_id === site), [rows, site])
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return atSite
      .filter((r) => show === 'all' || (show === 'open' ? !r.completion_date : !!r.completion_date))
      .filter((r) => !type || r.maintenance_type_id === type)
      .filter((r) => !words.length || words.every((w) => [r.title, r.notes, r.asset?.asset_tag, r.asset?.name,
        r.supplier_id ? refs?.supplier.get(r.supplier_id)?.name : ''].join(' ').toLowerCase().includes(w)))
      .sort((a, b) => Number(!!a.completion_date) - Number(!!b.completion_date) || b.start_date.localeCompare(a.start_date))
  }, [atSite, show, type, q, refs])

  // Spend counts finished jobs, on the day they were done.
  const totals = useMemo(() => {
    const d90 = format(subDays(new Date(), 90), 'yyyy-MM-dd')
    const yr = format(new Date(), 'yyyy') + '-01-01'
    const y12 = format(subMonths(new Date(), 12), 'yyyy-MM-dd')
    const done = atSite.filter((r) => r.completion_date)
    const sum = (list: ItRepairRow[]) => list.reduce((s, r) => s + (r.cost ?? 0), 0)
    const recent = done.filter((r) => r.completion_date! >= d90)
    const year12 = done.filter((r) => r.completion_date! >= y12)
    const group = (key: (r: ItRepairRow) => string | null | undefined, label: (k: string) => string) => {
      const m = new Map<string, { cost: number; jobs: number; minutes: number }>()
      for (const r of year12) {
        const k = key(r) ?? ''
        const g = m.get(k) ?? { cost: 0, jobs: 0, minutes: 0 }
        g.cost += r.cost ?? 0
        g.jobs += 1
        g.minutes += r.downtime_minutes ?? 0
        m.set(k, g)
      }
      return [...m.entries()].map(([k, v]) => ({ key: k, label: label(k), ...v })).sort((a, b) => b.cost - a.cost)
    }
    return {
      open: atSite.filter((r) => !r.completion_date).length,
      d90: sum(recent),
      year: sum(done.filter((r) => r.completion_date! >= yr)),
      down90: recent.reduce((s, r) => s + (r.downtime_minutes ?? 0), 0),
      bySite: group((r) => r.location_id, (k) => siteName.get(k) ?? 'Another site'),
      byKind: group((r) => r.asset?.category_id, (k) => (k ? refs?.category.get(k)?.name ?? 'Other' : 'Other')),
    }
  }, [atSite, siteName, refs])

  const exportCsv = () => {
    const header = ['Tag', 'Item', 'Site', 'What', 'Kind', 'Vendor', 'Warranty', 'Started', 'Done', 'Cost', 'Out of service (hours)', 'Notes']
    downloadCsv(`it-repairs-${format(new Date(), 'yyyy-MM-dd')}`, [header, ...shown.map((r) => [
      r.asset?.asset_tag ?? '', r.asset?.name ?? '', siteName.get(r.location_id) ?? '', r.title,
      refs?.repairTypes.find((t) => t.id === r.maintenance_type_id)?.name ?? '', r.supplier_id ? refs?.supplier.get(r.supplier_id)?.name ?? '' : '',
      r.is_warranty ? 'Yes' : 'No', r.start_date, r.completion_date ?? '', r.cost ?? '',
      r.downtime_minutes != null ? Math.round((r.downtime_minutes / 60) * 10) / 10 : '', r.notes ?? '',
    ])])
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/app/it-inventory/overview" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> IT Inventory
      </Link>
      <div className="mt-3">
        <PageHeader title="Repairs and service" subtitle="What's being fixed, what it's cost, and how long things were out." />
      </div>
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{friendlyError(error)}</p>}

      {rows === null || !refs ? (
        !error && <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <EmptyState className="mt-6" icon={Wrench} title="No repairs logged yet"
          description="Open an item and use Log repair. Repairs, service calls, upgrades and firmware updates all add up here." />
      ) : (
        <>
          <StatCardRow
            className="mt-5 grid-cols-2 lg:grid-cols-4"
            items={[
              { label: 'Open now', value: totals.open, to: `?${new URLSearchParams({ site, show: 'open' })}` },
              { label: 'Spent, last 90 days', value: currency(totals.d90) },
              { label: `Spent in ${format(new Date(), 'yyyy')}`, value: currency(totals.year) },
              { label: 'Out of service, 90 days', value: fmtDowntime(totals.down90) ?? '0 min' },
            ]}
          />

          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px_auto]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9" placeholder="Search item, job, vendor" aria-label="Search repairs" />
            </div>
            <Select value={site} onChange={(e) => setParam({ site: e.target.value })} aria-label="Site">
              <option value="all">All sites</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Select value={type} onChange={(e) => setParam({ type: e.target.value })} aria-label="Kind">
              <option value="">Every kind</option>
              {refs.repairTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            <div className="flex gap-2">
              <span className="inline-flex flex-1 rounded-lg border border-border bg-card p-0.5">
                {(['all', 'open', 'done'] as Show[]).map((s) => (
                  <button key={s} type="button" onClick={() => setParam({ show: s === 'all' ? null : s })}
                    className={cn('flex-1 rounded-md px-3 py-1.5 text-sm font-medium capitalize transition', show === s ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                    {s}
                  </button>
                ))}
              </span>
              <Button variant="secondary" onClick={exportCsv} aria-label="Export to CSV" title="Export to CSV"><Download className="size-4" /></Button>
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="mt-4 rounded-md border border-border bg-card p-4 text-sm text-ink-muted">Nothing matches.</p>
          ) : (
            <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-card">
              {shown.map((r) => {
                const t = refs.repairTypes.find((x) => x.id === r.maintenance_type_id)
                const open = !r.completion_date
                const days = differenceInCalendarDays(new Date(), parseISO(r.start_date))
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => r.asset && navigate(`/app/it-inventory/${r.asset.id}?tab=repairs`)}
                      className="flex w-full flex-col gap-1 px-3 py-2.5 text-left text-sm hover:bg-content sm:flex-row sm:items-center sm:gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-ink">{r.title}</span>
                          {t && <Badge tone={t.color as Tone}>{t.name}</Badge>}
                          {r.is_warranty && <Badge tone="ok"><ShieldCheck className="size-3" /> Warranty</Badge>}
                          {open && <Badge tone="warn">Open{days > 0 ? ` ${days}d` : ''}</Badge>}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          <span className="font-mono">{r.asset?.asset_tag}</span> {r.asset?.name} · {siteName.get(r.location_id) ?? 'Another site'}
                          {r.supplier_id && refs.supplier.get(r.supplier_id) ? ` · ${refs.supplier.get(r.supplier_id)!.name}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted sm:w-44 sm:text-right">
                        {open ? `Started ${fmtDay(r.start_date)}` : `Done ${fmtDay(r.completion_date!)}`}
                        {!open && fmtDowntime(r.downtime_minutes) && <span className="block">Out {fmtDowntime(r.downtime_minutes)}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums sm:w-24 sm:text-right">
                        {r.cost != null ? <span className={open ? 'text-ink-muted' : 'text-ink'}>{currency(r.cost)}</span> : <span className="text-ink-subtle">–</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {totals.bySite.length + totals.byKind.length > 0 && (
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <Rollup title="Cost by site, last 12 months" rows={site === 'all' ? totals.bySite : []} />
              <Rollup title="Cost by kind of gear, last 12 months" rows={totals.byKind} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Rollup({ title, rows }: { title: string; rows: { key: string; label: string; cost: number; jobs: number; minutes: number }[] }) {
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.cost), 1)
  return (
    <section>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</h2>
      <ul className="divide-y divide-border rounded-md border border-border bg-card">
        {rows.map((r) => (
          <li key={r.key} className="px-3 py-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
              <span className="shrink-0 text-xs text-ink-muted">{r.jobs} {r.jobs === 1 ? 'job' : 'jobs'}{r.minutes ? ` · out ${fmtDowntime(r.minutes)}` : ''}</span>
              <span className="w-24 shrink-0 text-right tabular-nums font-medium text-ink">{currency(r.cost)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border/60">
              <div className="h-full rounded-full bg-accent" style={{ width: `${(r.cost / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
