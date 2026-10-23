import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, Download, Droplets, Loader2, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuth } from '@/lib/auth'
import {
  fetchPackageReport,
  lastCompleteMonth,
  type PackageReport,
  type TierKey,
} from '@/lib/queries/chemicals'
import { exportChemicalsPdf } from '@/lib/reports/chemicalsPdf'

// Chemicals — the Chemical Manager's hub. First tool: a monthly report of how
// many times each wash package was used, broken down by site with a grand total
// (retail + member redemptions), exportable to a branded PDF. Each site row opens
// to its package-by-package lines (item name + source), each counted under its tier.

const nf = (n: number) => n.toLocaleString('en-US')
const monthLabel = (ym: string) =>
  new Date(ym + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

const TIERS: Array<{ key: TierKey; label: string; accent: string }> = [
  { key: 'flash', label: 'Flash', accent: 'text-ok' },
  { key: 'wonder', label: 'Wonder', accent: 'text-accent' },
  { key: 'superShine', label: 'Super Shine', accent: 'text-warn' },
  { key: 'mighty', label: 'Mighty Protector', accent: 'text-danger' },
]

export default function ChemicalsPage() {
  const { profile } = useAuth()
  const [month, setMonth] = useState<string>(() => lastCompleteMonth())
  const [data, setData] = useState<PackageReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openSites, setOpenSites] = useState<Set<string>>(() => new Set())

  const maxMonth = lastCompleteMonth()
  const totalOnly = data?.sites.filter((r) => r.totalOnly) ?? []
  const allOpen = !!data && data.sites.length > 0 && data.sites.every((r) => r.totalOnly || openSites.has(r.site))
  const toggleSite = (site: string) =>
    setOpenSites((prev) => {
      const next = new Set(prev)
      if (next.has(site)) next.delete(site)
      else next.add(site)
      return next
    })

  const load = useCallback(async (ym: string) => {
    setLoading(true)
    setError(null)
    try {
      setData(await fetchPackageReport(ym))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Could not load the report.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load(month) }, [load, month])

  const exportPdf = () => {
    if (!data) return
    void exportChemicalsPdf({
      monthLabel: monthLabel(month),
      sites: data.sites,
      grand: data.grand,
      logoUrl: profile?.brand_logo_url ?? null,
      flexIncluded: data.flexIncluded,
    })
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-8">
      <PageHeader title="Chemicals" subtitle="The Chemical Manager hub." />

      <section className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-accent"><Droplets className="size-5" /></span>
            <div>
              <h2 className="text-sm font-semibold text-ink">Monthly wash package report</h2>
              <p className="text-xs text-ink-subtle">Every wash by package, by site</p>
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
              onClick={() => exportPdf()}
              disabled={loading || !data}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-content px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink disabled:opacity-60"
              title="Export this report as a PDF"
            >
              <Download className="size-4" /> Export PDF
            </button>
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
              {/* Grand total */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {TIERS.map((t) => (
                  <div key={t.key} className="rounded-xl border border-border bg-content/40 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{t.label}</div>
                    <div className={`mt-1 text-3xl font-extrabold tabular-nums ${t.accent}`}>{nf(data.grand[t.key])}</div>
                    <div className="mt-0.5 text-[11px] text-ink-subtle">
                      {t.key === 'flash' ? 'washes · sites that sell it' : 'washes · excludes MW19 and HQ'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-baseline justify-between rounded-xl border border-border bg-card px-4 py-3">
                <span className="text-sm font-medium text-ink-muted">
                  Grand total washes
                  {totalOnly.length > 0 && (
                    <span className="block text-[11px] font-normal text-ink-subtle">
                      includes {totalOnly.map((r) => `${r.site.replace('MightyWash 0', 'MW')} (${nf(r.total)})`).join(', ')} with no package split †
                    </span>
                  )}
                </span>
                <span className="text-2xl font-bold tabular-nums text-ink">{nf(data.grand.total)}</span>
              </div>

              {!data.flexIncluded && (
                <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-xs text-warn">
                  The FlexWash sites couldn’t be loaded this time, so they’re not in these totals. Refresh to try again.
                </div>
              )}

              {/* Per-site breakdown; each site opens to its packages */}
              <div className="mt-5 mb-2 flex items-center justify-between gap-3">
                <p className="text-xs text-ink-subtle">Tap a site to see it package by package.</p>
                {data.sites.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenSites(allOpen ? new Set() : new Set(data.sites.map((r) => r.site)))}
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink"
                  >
                    {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
                    {allOpen ? 'Collapse all' : 'Expand all'}
                  </button>
                )}
              </div>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-3 py-2 font-medium">Site</th>
                      {TIERS.map((t) => (
                        <th key={t.key} className="px-3 py-2 text-right font-medium">{t.label}</th>
                      ))}
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.sites.map((r) => {
                      if (r.totalOnly) {
                        return (
                          <tr key={r.site}>
                            <td className="px-3 py-2 pl-[2.125rem] font-medium text-ink">
                              {r.site}
                              <span className="ml-1 text-ink-subtle" title="Total from the monthly car count sheet; no package split">†</span>
                            </td>
                            {TIERS.map((t) => (
                              <td key={t.key} className="px-3 py-2 text-right text-ink-subtle">—</td>
                            ))}
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{nf(r.total)}</td>
                          </tr>
                        )
                      }
                      const open = openSites.has(r.site)
                      return (
                        <Fragment key={r.site}>
                          <tr onClick={() => toggleSite(r.site)} className="cursor-pointer transition hover:bg-content">
                            <td className="px-3 py-2 font-medium text-ink">
                              <button
                                type="button"
                                aria-expanded={open}
                                onClick={(e) => { e.stopPropagation(); toggleSite(r.site) }}
                                className="inline-flex items-center gap-1.5 text-left"
                              >
                                <ChevronDown className={`size-4 shrink-0 text-ink-subtle transition ${open ? 'rotate-180' : ''}`} />
                                {r.site}
                              </button>
                            </td>
                            {TIERS.map((t) => (
                              <td key={t.key} className="px-3 py-2 text-right tabular-nums text-ink-muted">
                                {/* Not every site sells Flash: a dash, not a 0. */}
                                {t.key === 'flash' && r.flash === 0 ? <span className="text-ink-subtle">—</span> : nf(r[t.key])}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{nf(r.total)}</td>
                          </tr>
                          {open && r.packages.map((p) => (
                            <tr key={`${r.site}|${p.source}|${p.name}`} className="bg-content/40 text-xs">
                              <td className="py-1.5 pl-9 pr-3 text-ink-muted">
                                {p.name}
                                <span className="ml-2 rounded border border-border px-1 py-px text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
                                  {p.source}
                                </span>
                              </td>
                              {TIERS.map((t) => (
                                <td key={t.key} className="px-3 py-1.5 text-right tabular-nums text-ink-muted">
                                  {p.tier === t.key ? nf(p.count) : ''}
                                </td>
                              ))}
                              <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{nf(p.count)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                    {data.sites.length === 0 && (
                      <tr><td colSpan={TIERS.length + 2} className="px-3 py-6 text-center text-ink-subtle">No wash package activity this month.</td></tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border bg-content/60 font-semibold text-ink">
                      <td className="px-3 py-2">Grand total</td>
                      {TIERS.map((t) => (
                        <td key={t.key} className="px-3 py-2 text-right tabular-nums">{nf(data.grand[t.key])}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums">{nf(data.grand.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : null}

          <p className="mt-4 text-xs text-ink-subtle">
            Counts every time each package was used — retail washes plus member redemptions. DRB sites come from the POS
            wash ledger (the same source as the dashboards); FlexWash sites come from the FlexWash API’s paid package
            lines, from the day each site switched over (“- Issue” washes count under their package). Wex/Voyager fleet
            plan lines aren’t counted. Flash is only sold at some sites; a dash means the site had no Flash washes. † MW33 isn’t on DRB or FlexWash, so its washes are the month’s total from the car count
            sheet, with no package split: they’re in the grand total of washes but not in the package totals.
          </p>
        </div>
      </section>
    </div>
  )
}
