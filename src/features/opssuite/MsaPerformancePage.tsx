import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { fetchMsaReport, siteNumber, type MsaReport, type MsaRow } from '@/lib/queries/sitePerformance'

// The dashboard refreshes its live MSA tab every 60s; mirror that here.
const REFRESH_MS = 60_000

// Dashboard's own region mapping (SITE_REGIONS on ops.mwdashboards.com), keyed
// by site number. Dalhart (#34) is its own single-site region there but is
// intentionally excluded here. Sites in none of these regions fall into "Other".
const REGION_BY_SITE: Record<number, string> = {
  1: 'Lubbock', 5: 'Lubbock', 7: 'Lubbock', 9: 'Lubbock', 10: 'Lubbock', 11: 'Lubbock', 14: 'Lubbock',
  2: 'Permian Basin', 8: 'Permian Basin', 15: 'Permian Basin', 22: 'Permian Basin', 25: 'Permian Basin',
  3: 'Permian Basin', 12: 'Permian Basin', 13: 'Permian Basin', 24: 'Permian Basin', 31: 'Permian Basin',
  6: 'Permian Basin', 4: 'Permian Basin',
  27: 'Central Texas', 28: 'Central Texas', 29: 'Central Texas',
  16: 'New Mexico', 23: 'New Mexico', 26: 'New Mexico', 21: 'New Mexico', 17: 'New Mexico', 18: 'New Mexico',
}
// Sites deliberately left out of the region breakdown (Dalhart, per request).
const EXCLUDED_SITES = new Set<number>([34])
const REGION_ORDER = ['Lubbock', 'Permian Basin', 'Central Texas', 'New Mexico', 'Other']

function regionForSite(name: string): string | null {
  const n = siteNumber(name)
  if (n === null) return 'Other'
  if (EXCLUDED_SITES.has(n)) return null
  return REGION_BY_SITE[n] ?? 'Other'
}

type Period = 'today' | 'mtd'

// ---------- formatting + heat ----------

const DASH = '—'

// Data heat: red (worse) to green (better), tuned for the light card surface.
// Conversion range matches the dashboard's MSA_CONVERSION_RANGE (15 to 25%).
function convColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'inherit'
  const t = Math.max(0, Math.min(1, (v - 15) / (25 - 15)))
  const hue = 4 + t * 136
  return `hsl(${hue}, 68%, 40%)`
}

function siteLabel(name: string): string {
  const n = siteNumber(name)
  return n !== null ? `#${n}` : name
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

function RegionHead({ region, sites, right }: { region: string; sites: number; right?: ReactNode }) {
  return (
    <tr className="bg-content/70">
      <td colSpan={99} className="px-4 py-1.5 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-ink">{region}</span>
          <span className="text-[11px] text-ink-subtle">{sites} {sites === 1 ? 'site' : 'sites'}</span>
          {right && <span className="ml-auto text-xs text-ink-muted">{right}</span>}
        </div>
      </td>
    </tr>
  )
}

// ---------- page ----------

export default function MsaPerformancePage() {
  const [report, setReport] = useState<MsaReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>('today')
  const [region, setRegion] = useState<string>('all')
  const [site, setSite] = useState<string>('all')

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const data = await fetchMsaReport()
        if (!active) return
        setReport(data)
        setError(null)
        setUpdatedAt(new Date().toLocaleTimeString())
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

  const convKey = period === 'today' ? 'today_conversion_pct' : 'mtd_conversion_pct'
  const washKey = period === 'today' ? 'today_eligible_washes' : 'mtd_eligible_washes'
  const salesKey = period === 'today' ? 'today_sales' : 'mtd_sales'

  // Regions present in the report (in the dashboard's order), for the region filter.
  const regionOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of report?.rows ?? []) {
      const reg = regionForSite(r.site)
      if (reg !== null) seen.add(reg)
    }
    return REGION_ORDER.filter((r) => seen.has(r))
  }, [report])

  // Every site that appears in the report (Dalhart dropped), in numerical order,
  // for the "by site" dropdown. Narrowed to the chosen region when one is set.
  const siteOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const r of report?.rows ?? []) {
      const reg = regionForSite(r.site)
      if (reg === null) continue
      if (region !== 'all' && reg !== region) continue
      seen.add(r.site)
    }
    return [...seen].sort((a, b) => (siteNumber(a) ?? 1e9) - (siteNumber(b) ?? 1e9))
  }, [report, region])

  // Reset stale selections when the report (or region filter) no longer carries them.
  useEffect(() => {
    if (region !== 'all' && !regionOptions.includes(region)) setRegion('all')
  }, [region, regionOptions])
  useEffect(() => {
    if (site !== 'all' && !siteOptions.includes(site)) setSite('all')
  }, [site, siteOptions])

  // Group the roster into the dashboard's regions (Dalhart dropped), each sorted
  // by conversion % for the selected period. When a single site is chosen, only
  // that site's region and rows are kept.
  const groups = useMemo(() => {
    const buckets = new Map<string, MsaRow[]>()
    for (const r of report?.rows ?? []) {
      if (site !== 'all' && r.site !== site) continue
      const reg = regionForSite(r.site)
      if (reg === null) continue
      if (region !== 'all' && reg !== region) continue
      const list = buckets.get(reg) ?? []
      list.push(r)
      buckets.set(reg, list)
    }
    return REGION_ORDER.filter((r) => buckets.has(r)).map((reg) => ({
      region: reg,
      rows: buckets
        .get(reg)!
        .slice()
        .sort((a, b) => ((b[convKey] as number | null) ?? -1) - ((a[convKey] as number | null) ?? -1)),
    }))
  }, [report, convKey, site, region])

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="MSA Performance"
        subtitle="Salesperson conversion, broken down by region."
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-ink-muted">
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
            {error ? 'Update failed' : updatedAt ? `Updated ${updatedAt}` : 'Connecting...'}
          </span>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="msa-region" className="text-xs font-medium text-ink-muted">Region</label>
            <Select
              id="msa-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="h-9 w-44"
            >
              <option value="all">All regions</option>
              {regionOptions.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="msa-site" className="text-xs font-medium text-ink-muted">Site</label>
            <Select
              id="msa-site"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              className="h-9 w-48"
            >
              <option value="all">All sites</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </div>
        </div>
        <Seg value={period} onChange={setPeriod} />
      </div>
      <p className="-mt-2 text-xs text-ink-subtle">Live, updates every 60s</p>

      {error && !report && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Could not load MSA data.</p>
            <p className="mt-0.5 text-danger/80">{error}</p>
          </div>
        </div>
      )}

      {!report && !error && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
          Warming up. First load can take ~20s.
        </p>
      )}

      {report && groups.length === 0 && (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
          No MSA data available right now.
        </p>
      )}

      {report && groups.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="px-4 pb-3 pt-4 sm:px-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">By MSA</h2>
            <p className="mt-0.5 text-xs text-ink-subtle">
              Every salesperson on the current roster, ranked by conversion % within their region
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-y border-border">
                  {['MSA', 'Site', 'Conversion', 'Eligible Washes', 'Sales'].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {groups.map((g) => (
                  <FragmentRegion key={g.region}>
                    <RegionHead region={g.region} sites={new Set(g.rows.map((r) => r.site)).size} />
                    {g.rows.map((r, i) => (
                      <tr key={r.msa + r.site} className={cn(i === 0 && (r[convKey] as number | null) !== null && 'bg-accent-soft/40')}>
                        <td className={td}>{r.msa}</td>
                        <td className={td}>{siteLabel(r.site)}</td>
                        <td className={td} style={{ color: convColor(r[convKey] as number | null) }}>
                          {(r[convKey] as number | null) !== null ? `${r[convKey]}%` : DASH}
                        </td>
                        <td className={td}>{r[washKey]}</td>
                        <td className={td}>{r[salesKey]}</td>
                      </tr>
                    ))}
                  </FragmentRegion>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="px-1 text-xs leading-relaxed text-ink-subtle">
        Conversion % and eligible washes use the same formula as the Google Sheets MSA dashboard,
        filtered to the current Sales Roster. Today = live so far today; MTD = month to date.
      </p>
    </div>
  )
}

function FragmentRegion({ children }: { children: ReactNode }) {
  return <>{children}</>
}
