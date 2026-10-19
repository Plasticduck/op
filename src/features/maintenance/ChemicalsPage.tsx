import { useCallback, useEffect, useState } from 'react'
import { Droplets, Loader2, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import {
  fetchPackageCounts,
  lastCompleteMonth,
  type PackageCounts,
} from '@/lib/queries/chemicals'

// Chemicals — the Chemical Manager's hub. First tool: a monthly report of how
// many times each wash package was used across all sites (retail + member
// redemptions), so chemical usage can be tracked against wash volume.

const nf = (n: number) => n.toLocaleString('en-US')
const monthLabel = (ym: string) =>
  new Date(ym + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

// Package tiers in the order the Chemical Manager reads them, with brand colors.
const TIERS: Array<{ key: 'wonder' | 'superShine' | 'mighty'; label: string; accent: string; soft: string }> = [
  { key: 'wonder', label: 'Wonder', accent: 'text-accent', soft: 'bg-accent-soft' },
  { key: 'superShine', label: 'Super Shine', accent: 'text-warn', soft: 'bg-warn-soft' },
  { key: 'mighty', label: 'Mighty Protector', accent: 'text-danger', soft: 'bg-danger-soft' },
]

export default function ChemicalsPage() {
  const [month, setMonth] = useState<string>(() => lastCompleteMonth())
  const [data, setData] = useState<PackageCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const maxMonth = lastCompleteMonth()

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchPackageCounts(ym))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Could not load the report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(month) }, [load, month])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-8">
      <PageHeader title="Chemicals" subtitle="The Chemical Manager hub." />

      <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><Droplets className="size-5" /></span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Monthly wash package report</h2>
              <p className="text-xs text-ink-subtle">Every wash by package, all sites</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <span className="uppercase tracking-wider text-ink-subtle">Month</span>
              <input
                type="month"
                value={month}
                max={maxMonth}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="h-9 rounded-lg border border-border bg-content px-2 text-sm text-ink"
              />
            </label>
            <button
              onClick={() => void load(month)}
              disabled={loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-content px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink disabled:opacity-60"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh
            </button>
          </div>
        </div>

        <div className="p-4">
          <div className="mb-3 text-sm text-ink-muted">{monthLabel(month)}</div>

          {error ? (
            <div className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
          ) : loading && !data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-ink-muted"><Loader2 className="size-5 animate-spin" /> Running the report…</div>
          ) : data ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {TIERS.map((t) => (
                  <div key={t.key} className="rounded-xl border border-border bg-content/40 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{t.label}</div>
                    <div className={`mt-1 text-3xl font-extrabold tabular-nums ${t.accent}`}>{nf(data[t.key])}</div>
                    <div className="mt-0.5 text-[11px] text-ink-subtle">washes</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-baseline justify-between rounded-xl border border-border bg-card px-4 py-3">
                <span className="text-sm font-medium text-ink-muted">Total (3 packages)</span>
                <span className="text-2xl font-bold tabular-nums text-ink">{nf(data.total)}</span>
              </div>
              {!data.flexIncluded && (
                <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-xs text-warn">
                  FlexWash sites (MW17, MW18) couldn’t be loaded this time, so they’re not in these totals. Refresh to try again.
                </div>
              )}
            </>
          ) : null}

          <p className="mt-4 text-xs text-ink-subtle">
            Counts every time each package was used — retail washes plus member redemptions — across all sites. DRB sites
            come from the POS wash ledger (the same source as the dashboards); the FlexWash sites (MW17, MW18) come from
            the FlexWash API, counted the same way as the FlexWash Sales report.
          </p>
        </div>
      </section>
    </div>
  )
}
