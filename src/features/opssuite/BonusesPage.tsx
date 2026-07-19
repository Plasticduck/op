import { useCallback, useEffect, useMemo, useState } from 'react'
import { BadgeDollarSign, Check, ChevronLeft, ChevronRight, FileDown, RotateCcw, Save, X } from 'lucide-react'
import { addMonths, format, parseISO, subMonths } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { compareLocationName } from '@/lib/utils'
import { currency } from '@/lib/format'
import { useCompany } from '@/lib/company'
import { updateCompany } from '@/lib/queries/companySettings'
import type { RegionDef } from '@/lib/regions'
import { gmBonus, type GmBonusBase, type GmBonusMonth } from '@/lib/queries/gmBonus'
import { computeGmBonus, type AvgBase, type GmBonusResult, type MembershipBase, type MonthInputs, type PrevCounts } from '@/lib/gmBonus'
import { exportSiteBonusPdf, exportAllSitesBonusPdf, exportRegionalBonusPdf, type AllSitesRow, type RegionalRow } from '@/lib/gmBonusPdf'

const ALL = '__all__'

// Regional Manager quarterly bonus: each region's manager earns a fixed cut of
// the combined GM monthly bonuses across that region's sites for the quarter.
// Region names must match the account's saved regions (Company settings).
const REGION_BONUS: { name: string; pct: number }[] = [
  { name: 'Lubbock Region', pct: 0.24 },
  { name: 'Permian Basin Region (A)', pct: 0.19 },
  { name: 'Permian Basin Region (B)', pct: 0.56 },
  { name: 'New Mexico Region', pct: 0.28 },
  { name: 'Central Region', pct: 0.42 },
]

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`
const pts = (frac: number | null) =>
  frac === null ? '—' : `${frac >= 0 ? '+' : ''}${(frac * 100).toFixed(1)} pts`

const emptyForm = { mighty: '', super: '', wonder: '', avgMos: '', churn: '', conversion: '' }
type Form = typeof emptyForm

const monthOf = (period: string) => format(parseISO(period), 'MMMM yyyy')
const toPeriod = (monthInput: string) => `${monthInput}-01`
const prevPeriod = (period: string) => format(subMonths(parseISO(period), 1), 'yyyy-MM-01')
const nextPeriod = (period: string) => format(addMonths(parseISO(period), 1), 'yyyy-MM-01')

// The baseline in effect for a given month is the latest reset of that kind that
// took effect on or before that month. Resets entered in month M take effect M+1,
// so they never change month M itself.
function effectiveBaseline(baselines: GmBonusBase[], kind: 'membership' | 'avg', period: string) {
  return baselines
    .filter((b) => b.kind === kind && b.effective_from <= period)
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0] ?? null
}

// Compute one site's GM bonus for a month from the saved data, or null if the
// month has no saved numbers. Shared by the All Sites and Regional views.
function computeSiteMonth(
  allMonths: GmBonusMonth[],
  allBaselines: GmBonusBase[],
  siteId: string,
  period: string,
): GmBonusResult | null {
  const monthRow = allMonths.find((m) => m.location_id === siteId && m.period === period)
  if (!monthRow) return null
  const prevRow = allMonths.find((m) => m.location_id === siteId && m.period === prevPeriod(period)) ?? null
  const siteBases = allBaselines.filter((b) => b.location_id === siteId)
  const memRow = effectiveBaseline(siteBases, 'membership', period)
  const aRow = effectiveBaseline(siteBases, 'avg', period)
  return computeGmBonus({
    current: {
      mighty_count: monthRow.mighty_count,
      super_count: monthRow.super_count,
      wonder_count: monthRow.wonder_count,
      avg_mos: Number(monthRow.avg_mos),
      churn_pct: Number(monthRow.churn_pct),
      conversion_pct: Number(monthRow.conversion_pct),
    },
    previous: prevRow
      ? { mighty_count: prevRow.mighty_count, super_count: prevRow.super_count, wonder_count: prevRow.wonder_count }
      : null,
    membershipBase: memRow
      ? { mighty_count: memRow.mighty_count, super_count: memRow.super_count, wonder_count: memRow.wonder_count }
      : null,
    avgBase: aRow ? Number(aRow.avg_mos) : null,
  })
}

// Regional manager names, effective-dated by quarter. Legacy flat `region ->
// name` is coerced to apply to all quarters via an early sentinel key.
type QuarterManagers = Record<string, Record<string, string>>
const LEGACY_Q = '1900-01-01'
function normalizeManagers(raw: unknown): QuarterManagers {
  const out: QuarterManagers = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [region, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'string') {
      if (val.trim()) out[region] = { [LEGACY_Q]: val }
    } else if (val && typeof val === 'object') {
      const inner: Record<string, string> = {}
      for (const [q, name] of Object.entries(val as Record<string, unknown>)) {
        if (typeof name === 'string' && name.trim()) inner[q] = name
      }
      if (Object.keys(inner).length) out[region] = inner
    }
  }
  return out
}
// The manager in effect for a period is the latest assignment on or before it.
// Works for quarter-start or month-start keys (both 'YYYY-MM-01').
function effectiveManager(perPeriod: Record<string, string> | undefined, period: string): string {
  if (!perPeriod) return ''
  const keys = Object.keys(perPeriod).filter((k) => k <= period).sort()
  return keys.length ? perPeriod[keys[keys.length - 1]] : ''
}

// GM/AGM manager names per site, effective-dated by month. Same shape rules as
// normalizeManagers, one level deeper (per site, per role).
type SiteRoleManagers = { gm: Record<string, string>; agm: Record<string, string> }
type SiteManagers = Record<string, SiteRoleManagers>
function normalizeSiteManagers(raw: unknown): SiteManagers {
  const out: SiteManagers = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [loc, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue
    const roles = val as Record<string, unknown>
    const pick = (r: unknown): Record<string, string> => {
      const m: Record<string, string> = {}
      if (r && typeof r === 'object') {
        // Keep empty strings: an explicit blank means "no manager this month",
        // which must persist and not fall back to an earlier month.
        for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
          if (typeof v === 'string') m[k] = v
        }
      }
      return m
    }
    const gm = pick(roles.gm)
    const agm = pick(roles.agm)
    if (Object.keys(gm).length || Object.keys(agm).length) out[loc] = { gm, agm }
  }
  return out
}

const quarterStartOf = (d: Date) => format(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1), 'yyyy-MM-01')
const quarterMonths = (qStart: string) => [0, 1, 2].map((i) => format(addMonths(parseISO(qStart), i), 'yyyy-MM-01'))
const prevQuarter = (qStart: string) => format(subMonths(parseISO(qStart), 3), 'yyyy-MM-01')
const nextQuarter = (qStart: string) => format(addMonths(parseISO(qStart), 3), 'yyyy-MM-01')
const quarterLabel = (qStart: string) => {
  const d = parseISO(qStart)
  const q = Math.floor(d.getMonth() / 3) + 1
  return `Q${q} ${format(d, 'yyyy')} (${format(d, 'MMM')} - ${format(addMonths(d, 2), 'MMM')})`
}

export default function BonusesPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { settings, reload: reloadCompany } = useCompany()
  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => compareLocationName(a.name, b.name)),
    [locations],
  )

  const [mode, setMode] = useState<'gm' | 'regional'>('gm')
  const [locationId, setLocationId] = useState('')
  const [period, setPeriod] = useState(format(new Date(), 'yyyy-MM-01'))
  const [allMonths, setAllMonths] = useState<GmBonusMonth[]>([])
  const [allBaselines, setAllBaselines] = useState<GmBonusBase[]>([])
  const [form, setForm] = useState<Form>(emptyForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId && sortedLocations.length > 0) setLocationId(sortedLocations[0].id)
  }, [sortedLocations, locationId])

  // Load account-wide once; both the single-site and All Sites views read from it.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [b, m] = await Promise.all([gmBonus.allBaselines(), gmBonus.allMonths()])
    setAllBaselines((b.data as GmBonusBase[] | null) ?? [])
    setAllMonths((m.data as GmBonusMonth[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const isAll = locationId === ALL
  const months = useMemo(() => allMonths.filter((m) => m.location_id === locationId), [allMonths, locationId])
  const baselines = useMemo(() => allBaselines.filter((b) => b.location_id === locationId), [allBaselines, locationId])

  const monthRow = useMemo(() => months.find((m) => m.period === period) ?? null, [months, period])
  const prevRow = useMemo(
    () => months.find((m) => m.period === prevPeriod(period)) ?? null,
    [months, period],
  )

  // Prefill the form from a saved month whenever the site/month/data changes.
  useEffect(() => {
    if (monthRow) {
      setForm({
        mighty: String(monthRow.mighty_count),
        super: String(monthRow.super_count),
        wonder: String(monthRow.wonder_count),
        avgMos: String(monthRow.avg_mos),
        churn: String(monthRow.churn_pct),
        conversion: String(monthRow.conversion_pct),
      })
    } else {
      setForm(emptyForm)
    }
    setNotice(null)
  }, [monthRow, locationId, period])

  const current: MonthInputs = {
    mighty_count: num(form.mighty),
    super_count: num(form.super),
    wonder_count: num(form.wonder),
    avg_mos: num(form.avgMos),
    churn_pct: num(form.churn),
    conversion_pct: num(form.conversion),
  }
  const previous: PrevCounts = prevRow
    ? { mighty_count: prevRow.mighty_count, super_count: prevRow.super_count, wonder_count: prevRow.wonder_count }
    : null
  const membershipRow = effectiveBaseline(baselines, 'membership', period)
  const avgRow = effectiveBaseline(baselines, 'avg', period)
  const membershipBase: MembershipBase = membershipRow
    ? {
        mighty_count: membershipRow.mighty_count,
        super_count: membershipRow.super_count,
        wonder_count: membershipRow.wonder_count,
      }
    : null
  const avgBase: AvgBase = avgRow ? Number(avgRow.avg_mos) : null

  const result = computeGmBonus({ current, previous, membershipBase, avgBase })

  // GM/AGM manager names per site, effective-dated by month. Edited names for the
  // viewed month live in nameEdits and reset when the month (or saved data) changes.
  const siteManagers = useMemo(() => normalizeSiteManagers(settings.siteManagers), [settings.siteManagers])
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const loc of sortedLocations) {
      next[`${loc.id}|gm`] = effectiveManager(siteManagers[loc.id]?.gm, period)
      next[`${loc.id}|agm`] = effectiveManager(siteManagers[loc.id]?.agm, period)
    }
    setNameEdits(next)
  }, [sortedLocations, siteManagers, period])
  const nameFor = (siteId: string, role: 'gm' | 'agm') => nameEdits[`${siteId}|${role}`] ?? ''
  const setName = (siteId: string, role: 'gm' | 'agm', value: string) =>
    setNameEdits((m) => ({ ...m, [`${siteId}|${role}`]: value }))

  // Persist on blur. A change applies from the VIEWED month forward, so earlier
  // months keep their prior manager (same rule as the regional page).
  const commitName = (siteId: string, role: 'gm' | 'agm') => {
    if (!profile) return
    const val = nameFor(siteId, role).trim()
    if (val === effectiveManager(siteManagers[siteId]?.[role], period)) return
    const next: SiteManagers = {}
    for (const [loc, roles] of Object.entries(siteManagers)) next[loc] = { gm: { ...roles.gm }, agm: { ...roles.agm } }
    if (!next[siteId]) next[siteId] = { gm: {}, agm: {} }
    // Store the value for this month, including an explicit blank (no manager),
    // so it holds from this month forward instead of re-showing the prior name.
    next[siteId][role][period] = val
    void updateCompany(profile.account_id, { settings: { ...settings, siteManagers: next } }).then(() => reloadCompany())
  }

  // All Sites: each site's current-month result from saved data (no live editing).
  const allRows: AllSitesRow[] = useMemo(
    () =>
      sortedLocations.map((loc) => {
        const row = allMonths.find((m) => m.location_id === loc.id && m.period === period)
        return {
          id: loc.id,
          site: loc.name,
          gmName: effectiveManager(siteManagers[loc.id]?.gm, period),
          agmName: effectiveManager(siteManagers[loc.id]?.agm, period),
          override: row?.gm_override != null ? Number(row.gm_override) : null,
          result: computeSiteMonth(allMonths, allBaselines, loc.id, period),
        }
      }),
    [sortedLocations, allMonths, allBaselines, period, siteManagers],
  )

  const monthLabel = monthOf(period)
  const prevShort = format(parseISO(prevPeriod(period)), 'MMM yyyy')
  // A bonus is only paid when a manager is named (empty name -> $0). An admin
  // override, when set, replaces the calculated GM total (and AGM = override / 2).
  const gmAmount = (name: string | null | undefined, r: GmBonusResult | null, override: number | null) =>
    override != null ? override : name && name.trim() && r ? r.gmTotal : 0
  const agmAmount = (name: string | null | undefined, r: GmBonusResult | null, override: number | null) =>
    !name || !name.trim() ? 0 : override != null ? override / 2 : r ? r.agmTotal : 0
  const allGmSum = allRows.reduce((a, r) => a + gmAmount(r.gmName, r.result, r.override ?? null), 0)
  const allAgmSum = allRows.reduce((a, r) => a + agmAmount(r.agmName, r.result, r.override ?? null), 0)
  const anyAllData = allRows.some((r) => r.result)

  const exportToPdf = async () => {
    setExporting(true)
    try {
      if (isAll) {
        await exportAllSitesBonusPdf(monthLabel, allRows, profile?.brand_logo_url)
      } else {
        const siteName = sortedLocations.find((l) => l.id === locationId)?.name ?? 'Site'
        await exportSiteBonusPdf(
          siteName,
          monthLabel,
          result,
          profile?.brand_logo_url,
          { gm: nameFor(locationId, 'gm'), agm: nameFor(locationId, 'agm') },
          monthRow?.gm_override != null ? Number(monthRow.gm_override) : null,
        )
      }
    } finally {
      setExporting(false)
    }
  }

  const saveOverride = async (value: number | null) => {
    if (!profile || !locationId) return
    const { error: err } = await gmBonus.setOverride({
      account_id: profile.account_id,
      location_id: locationId,
      period,
      gm_override: value,
    })
    setOverrideOpen(false)
    if (err) return setError(err.message)
    setNotice(value == null ? 'Override removed.' : `Override set to ${currency(value)}.`)
    await load()
  }

  const saveMonth = async () => {
    if (!profile || !locationId) return
    setSaving(true)
    setError(null)
    const { error: err } = await gmBonus.upsertMonth({
      account_id: profile.account_id,
      location_id: locationId,
      period,
      mighty_count: current.mighty_count,
      super_count: current.super_count,
      wonder_count: current.wonder_count,
      avg_mos: current.avg_mos,
      churn_pct: current.churn_pct,
      conversion_pct: current.conversion_pct,
      source: 'manual',
      submitted_by: profile.id,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setNotice(`Saved ${monthOf(period)}.`)
    await load()
  }

  // Each one-time goal resets its own baseline independently. A reset takes
  // effect the month AFTER the one being viewed, so this month keeps measuring
  // against the prior baseline and only future months see the new one.
  const resetBase = async (which: 'membership' | 'avg') => {
    if (!profile || !locationId) return
    const label = which === 'membership' ? 'membership baseline' : 'average-months baseline'
    const effective = nextPeriod(period)
    if (!window.confirm(`Set the ${label} to ${monthOf(period)}'s numbers, effective ${monthOf(effective)}?`))
      return
    setSaving(true)
    setError(null)
    const { error: err } = await gmBonus.upsertBaseline({
      account_id: profile.account_id,
      location_id: locationId,
      kind: which,
      effective_from: effective,
      mighty_count: which === 'membership' ? current.mighty_count : 0,
      super_count: which === 'membership' ? current.super_count : 0,
      wonder_count: which === 'membership' ? current.wonder_count : 0,
      avg_mos: which === 'avg' ? current.avg_mos : 0,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setNotice(`${label[0].toUpperCase()}${label.slice(1)} set from ${monthOf(effective)} onward.`)
    await load()
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bonuses"
        subtitle="Admin only."
        actions={
          mode === 'gm' ? (
            <div className="flex flex-wrap gap-2">
              {!isAll && (
                <Button onClick={saveMonth} disabled={saving || !locationId}>
                  <Save className="size-4" /> {saving ? 'Saving…' : `Save ${format(parseISO(period), 'MMM yyyy')}`}
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={exportToPdf}
                disabled={exporting || (isAll && !anyAllData)}
              >
                <FileDown className="size-4" /> {exporting ? 'Exporting…' : 'Export to PDF'}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex w-fit gap-1 rounded-lg border border-border bg-card p-1">
        {([
          { key: 'gm', label: 'GM/AGM Monthly Bonuses' },
          { key: 'regional', label: 'Regional Manager Quarterly Bonuses' },
        ] as const).map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => setMode(o.key)}
            className={
              'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
              (mode === o.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      {mode === 'regional' ? (
        <RegionalBonuses
          allMonths={allMonths}
          allBaselines={allBaselines}
          regions={settings.regions ?? []}
          siteManagers={siteManagers}
          rawManagers={settings.regionalManagers}
          onSaveManagers={async (next) => {
            if (!profile) return
            await updateCompany(profile.account_id, { settings: { ...settings, regionalManagers: next } })
            await reloadCompany()
          }}
          logoUrl={profile?.brand_logo_url}
          loading={loading}
        />
      ) : (
      <>
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Site
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-9 w-64">
            <option value={ALL}>All Sites</option>
            {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Month
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              aria-label="Previous month"
              onClick={() => setPeriod(prevPeriod(period))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="month"
              value={format(parseISO(period), 'yyyy-MM')}
              onChange={(e) => e.target.value && setPeriod(toPeriod(e.target.value))}
              className="h-9 w-44"
            />
            <Button
              variant="secondary"
              size="icon"
              className="size-9"
              aria-label="Next month"
              onClick={() => setPeriod(nextPeriod(period))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </label>
        <span className="pb-2 text-xs text-ink-subtle">
          {isAll
            ? `${allRows.filter((r) => r.result).length} of ${sortedLocations.length} sites have data`
            : `${monthRow ? 'Saved' : 'Not yet saved'} · prior month ${prevRow ? 'on file' : 'missing'}`}
        </span>
      </div>

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ink">{notice}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : isAll ? (
        !anyAllData ? (
          <EmptyState
            icon={BadgeDollarSign}
            title={`No bonus data for ${monthLabel}`}
            description="Pick a month with saved numbers, or enter a site's numbers first. Sites appear here once their month is saved."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">GM</th>
                  <th className="px-3 py-2.5 font-medium">AGM</th>
                  <th className="px-3 py-2.5 text-right font-medium">One-time</th>
                  <th className="px-3 py-2.5 text-right font-medium">Churn</th>
                  <th className="px-3 py-2.5 text-right font-medium">Conversion</th>
                  <th className="px-3 py-2.5 text-right font-medium">GM Total</th>
                  <th className="px-3 py-2.5 text-right font-medium">AGM Total</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((r) => (
                  <tr key={r.site} className="border-t border-border hover:bg-content">
                    <td className="px-3 py-2.5 font-medium text-ink">{r.site}</td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={nameFor(r.id ?? '', 'gm')}
                        onChange={(e) => setName(r.id ?? '', 'gm', e.target.value)}
                        onBlur={() => commitName(r.id ?? '', 'gm')}
                        placeholder="Add name"
                        className="h-8 w-32"
                        aria-label={`GM for ${r.site}`}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <Input
                        value={nameFor(r.id ?? '', 'agm')}
                        onChange={(e) => setName(r.id ?? '', 'agm', e.target.value)}
                        onBlur={() => commitName(r.id ?? '', 'agm')}
                        placeholder="Add name"
                        className="h-8 w-32"
                        aria-label={`AGM for ${r.site}`}
                      />
                    </td>
                    {r.result ? (
                      <>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{currency(r.result.oneTimeTotal)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{currency(r.result.churn.amount)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{currency(r.result.conversion.amount)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-accent">{currency(gmAmount(r.gmName, r.result, r.override ?? null))}{r.override != null && <span className="ml-1 text-[10px] font-normal text-warn">ovr</span>}</td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">{currency(agmAmount(r.agmName, r.result, r.override ?? null))}</td>
                      </>
                    ) : (
                      <td colSpan={5} className="px-3 py-2.5 text-right text-xs text-ink-subtle">No data</td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-content font-semibold">
                  <td className="px-3 py-2.5 text-ink">Total</td>
                  <td colSpan={5} />
                  <td className="px-3 py-2.5 text-right tabular-nums text-accent">{currency(allGmSum)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{currency(allAgmSum)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Inputs */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">This month's numbers</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Mighty Protector" value={form.mighty} onChange={set('mighty')} />
              <NumField label="Super Shine" value={form.super} onChange={set('super')} />
              <NumField label="Wonder Clean" value={form.wonder} onChange={set('wonder')} />
              <NumField label="Total members" value={String(result.currentTotal)} readOnly />
              <NumField
                label="Avg months active"
                value={form.avgMos}
                onChange={set('avgMos')}
                step="0.1"
                sub={`${prevShort}: ${prevRow ? Number(prevRow.avg_mos) : '—'}`}
              />
              <div />
              <NumField
                label="Churn %"
                value={form.churn}
                onChange={set('churn')}
                step="0.1"
                sub={`${prevShort}: ${prevRow ? `${Number(prevRow.churn_pct)}%` : '—'}`}
              />
              <NumField
                label="Conversion %"
                value={form.conversion}
                onChange={set('conversion')}
                step="0.1"
                sub={`${prevShort}: ${prevRow ? `${Number(prevRow.conversion_pct)}%` : '—'}`}
              />
            </div>

            <div className="mt-4 rounded-md border border-border bg-content p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Baselines (in effect for {monthOf(period)})
                </h3>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => resetBase('membership')} disabled={saving}>
                    <RotateCcw className="size-3.5" /> Reset membership
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => resetBase('avg')} disabled={saving}>
                    <RotateCcw className="size-3.5" /> Reset avg months
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-muted">
                {membershipRow ? (
                  <>Membership (since {monthOf(membershipRow.effective_from)}): Mighty {membershipRow.mighty_count},
                    Super {membershipRow.super_count}, Wonder {membershipRow.wonder_count}</>
                ) : (
                  <span className="text-warn">Membership baseline not set for this month.</span>
                )}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {avgRow ? (
                  <>Avg months (since {monthOf(avgRow.effective_from)}): {Number(avgRow.avg_mos)} mo</>
                ) : (
                  <span className="text-warn">Average-months baseline not set for this month.</span>
                )}
              </p>
              <p className="mt-1 text-xs text-ink-subtle">
                A reset uses this month's numbers and takes effect next month, so it never changes this month.
              </p>
            </div>
          </section>

          {/* Membership breakdown */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Membership</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-1.5 font-medium">Level</th>
                    <th className="py-1.5 text-right font-medium">Members</th>
                    <th className="py-1.5 text-right font-medium">Share</th>
                    <th className="py-1.5 text-right font-medium">Δ Prev</th>
                    <th className="py-1.5 text-right font-medium">Δ Base</th>
                  </tr>
                </thead>
                <tbody>
                  {result.levels.map((l) => (
                    <tr key={l.key} className="border-t border-border">
                      <td className="py-1.5 text-ink">{l.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink">{l.count}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pct(l.pct)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pts(l.pctChange)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pts(l.pctChangeSinceBase)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-medium">
                    <td className="py-1.5 text-ink">Total</td>
                    <td className="py-1.5 text-right tabular-nums text-ink">{result.currentTotal}</td>
                    <td colSpan={3} className="py-1.5 text-right text-xs text-ink-subtle">
                      prev {result.previousTotal ?? '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* One-time bonuses */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">One-time bonuses</h2>
            <BonusRow
              label="Lifetime Value (Avg months +1 vs base)"
              detail={`base ${result.avgMos.base ?? '—'} → now ${result.avgMos.current} (${result.avgMos.delta === null ? '—' : `${result.avgMos.delta >= 0 ? '+' : ''}${result.avgMos.delta.toFixed(1)}`} mo)`}
              earned={result.lifetimeValue.earned}
              amount={result.lifetimeValue.amount}
            />
            <BonusRow
              label="Membership (Mighty + Super +10 pts vs base)"
              detail={`combined change ${pts(result.membership.combinedChangeSinceBase)}`}
              earned={result.membership.earned}
              amount={result.membership.amount}
            />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
              <span className="text-ink">One-time total</span>
              <span className="tabular-nums text-ink">{currency(result.oneTimeTotal)}</span>
            </div>
            {(result.lifetimeValue.goalReached || result.membership.goalReached) && (
              <p className="mt-2 text-xs text-warn">
                Goal reached. Reset the baseline once this bonus is paid so future months measure from here.
              </p>
            )}
          </section>

          {/* Monthly rewards + totals */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Monthly rewards</h2>
            <BonusRow
              label={`Churn reward (${result.churn.bracket})`}
              detail={`churn ${result.churn.pct}%`}
              amount={result.churn.amount}
            />
            <BonusRow
              label="Conversion reward"
              detail={`conversion ${result.conversion.pct}%${result.conversion.capped ? ' · capped (churn ≥ 15%)' : ''}`}
              amount={result.conversion.amount}
            />
            <div className="mt-3 flex items-center justify-between rounded-md bg-accent-soft px-3 py-2">
              <span className="text-sm font-semibold text-accent">
                Total GM monthly bonus
                {monthRow?.gm_override != null && <span className="ml-1 text-xs font-normal text-warn">(override)</span>}
              </span>
              <span className="text-lg font-bold tabular-nums text-accent">
                {currency(gmAmount(nameFor(locationId, 'gm'), result, monthRow?.gm_override != null ? Number(monthRow.gm_override) : null))}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm font-semibold text-ink">Total AGM monthly bonus</span>
              <span className="text-lg font-bold tabular-nums text-ink">
                {currency(agmAmount(nameFor(locationId, 'agm'), result, monthRow?.gm_override != null ? Number(monthRow.gm_override) : null))}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-ink-muted">
                {monthRow?.gm_override != null
                  ? `Override set: ${currency(Number(monthRow.gm_override))}`
                  : 'Bonus amount override'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setOverrideOpen(true)} disabled={!locationId}>
                {monthRow?.gm_override != null ? 'Edit override' : 'Override amount'}
              </Button>
            </div>
            <p className="mt-1 text-right text-xs text-ink-subtle">AGM = 1/2 of GM total</p>

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                GM name
                <Input
                  value={nameFor(locationId, 'gm')}
                  onChange={(e) => setName(locationId, 'gm', e.target.value)}
                  onBlur={() => commitName(locationId, 'gm')}
                  placeholder="Add name"
                  className="h-9"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                AGM name
                <Input
                  value={nameFor(locationId, 'agm')}
                  onChange={(e) => setName(locationId, 'agm', e.target.value)}
                  onBlur={() => commitName(locationId, 'agm')}
                  placeholder="Add name"
                  className="h-9"
                />
              </label>
            </div>
          </section>
        </div>
      )}

      {overrideOpen && !isAll && locationId && (
        <OverrideModal
          site={sortedLocations.find((l) => l.id === locationId)?.name ?? 'Site'}
          monthLabel={monthLabel}
          current={monthRow?.gm_override != null ? Number(monthRow.gm_override) : null}
          computed={gmAmount(nameFor(locationId, 'gm'), result, null)}
          onSave={saveOverride}
          onClose={() => setOverrideOpen(false)}
        />
      )}
      </>
      )}
    </div>
  )
}

function OverrideModal({ site, monthLabel, current, computed, onSave, onClose }: {
  site: string
  monthLabel: string
  current: number | null
  computed: number
  onSave: (value: number | null) => Promise<void>
  onClose: () => void
}) {
  const [value, setValue] = useState(current != null ? String(current) : String(computed))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const n = Number(value)
    if (value.trim() === '' || Number.isNaN(n)) return
    if (
      !window.confirm(
        `Are you sure? This overrides the GM bonus for ${site} (${monthLabel}) to ${currency(n)}, replacing the calculated amount. AGM becomes half of it.`,
      )
    )
      return
    setBusy(true)
    await onSave(n)
  }
  const clear = async () => {
    if (!window.confirm(`Remove the override for ${site} (${monthLabel}) and use the calculated amount?`)) return
    setBusy(true)
    await onSave(null)
  }

  return (
    <Modal open onClose={onClose} title="Bonus amount override">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          {site} · {monthLabel}. Calculated GM bonus: {currency(computed)}.
        </p>
        <Field label="Override GM bonus amount">
          {(id) => (
            <Input id={id} type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
        <p className="text-xs text-ink-subtle">AGM becomes half of this amount. Applies to this month only.</p>
        <div className="flex items-center justify-between gap-2">
          {current != null ? (
            <Button variant="ghost" className="text-danger hover:text-danger" onClick={clear} disabled={busy}>
              Clear override
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save override'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function RegionalBonuses({ allMonths, allBaselines, regions, siteManagers, rawManagers, onSaveManagers, logoUrl, loading }: {
  allMonths: GmBonusMonth[]
  allBaselines: GmBonusBase[]
  regions: RegionDef[]
  siteManagers: SiteManagers
  rawManagers: unknown
  onSaveManagers: (next: QuarterManagers) => Promise<void>
  logoUrl?: string | null
  loading: boolean
}) {
  const [qStart, setQStart] = useState(() => quarterStartOf(new Date()))
  const [exporting, setExporting] = useState(false)
  const managers = useMemo(() => normalizeManagers(rawManagers), [rawManagers])
  // Names shown/edited for the currently viewed quarter. Reset when the quarter
  // (or saved data) changes so each quarter shows its own effective manager.
  const [mgr, setMgr] = useState<Record<string, string>>({})
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const rb of REGION_BONUS) next[rb.name] = effectiveManager(managers[rb.name], qStart)
    setMgr(next)
  }, [managers, qStart])
  const months = useMemo(() => quarterMonths(qStart), [qStart])

  const rows: RegionalRow[] = useMemo(
    () =>
      REGION_BONUS.map((rb) => {
        const def = regions.find((r) => r.name === rb.name)
        const siteIds = def?.siteIds ?? []
        let combined = 0
        for (const sid of siteIds) {
          for (const m of months) {
            const row = allMonths.find((x) => x.location_id === sid && x.period === m)
            const ov = row?.gm_override != null ? Number(row.gm_override) : null
            if (ov != null) {
              // An admin override replaces the calculated GM total for that month.
              combined += ov
            } else {
              const res = computeSiteMonth(allMonths, allBaselines, sid, m)
              // Otherwise a site's GM bonus only counts with a named GM that month.
              if (res && effectiveManager(siteManagers[sid]?.gm, m).trim()) combined += res.gmTotal
            }
          }
        }
        return { region: rb.name, pct: rb.pct, sites: siteIds.length, combined, bonus: combined * rb.pct }
      }),
    [regions, months, allMonths, allBaselines, siteManagers],
  )
  const totalCombined = rows.reduce((a, r) => a + r.combined, 0)
  const totalBonus = rows.reduce((a, r) => a + r.bonus, 0)
  const label = quarterLabel(qStart)

  // Persist on blur. A change sets the name for the VIEWED quarter only (from
  // this quarter forward), so earlier quarters keep their prior manager.
  const commitManagers = () => {
    const next: QuarterManagers = {}
    for (const [region, perQ] of Object.entries(managers)) next[region] = { ...perQ }
    let changed = false
    for (const rb of REGION_BONUS) {
      const region = rb.name
      const val = (mgr[region] ?? '').trim()
      if (val === effectiveManager(managers[region], qStart)) continue
      changed = true
      if (!next[region]) next[region] = {}
      if (val === '') {
        delete next[region][qStart]
        if (Object.keys(next[region]).length === 0) delete next[region]
      } else {
        next[region][qStart] = val
      }
    }
    if (changed) void onSaveManagers(next)
  }

  const doExport = async () => {
    setExporting(true)
    try {
      await exportRegionalBonusPdf(label, rows.map((r) => ({ ...r, manager: mgr[r.region] ?? '' })), logoUrl)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-3">
        <span className="text-xs font-medium text-ink-muted">Quarter</span>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="icon" className="size-9" aria-label="Previous quarter" onClick={() => setQStart(prevQuarter(qStart))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="w-44 text-center text-sm font-medium text-ink">{label}</span>
          <Button variant="secondary" size="icon" className="size-9" aria-label="Next quarter" onClick={() => setQStart(nextQuarter(qStart))}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <Button variant="secondary" className="ml-auto" onClick={doExport} disabled={exporting || totalCombined === 0}>
          <FileDown className="size-4" /> {exporting ? 'Exporting…' : 'Export to PDF'}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : regions.length === 0 ? (
        <EmptyState
          icon={BadgeDollarSign}
          title="No regions configured"
          description="Set up regions in Company settings to calculate regional manager bonuses."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Region</th>
                <th className="px-3 py-2.5 font-medium">Regional Manager</th>
                <th className="px-3 py-2.5 text-right font-medium">Sites</th>
                <th className="px-3 py-2.5 text-right font-medium">Regional Mgr Bonus</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.region} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.region}</td>
                  <td className="px-3 py-2.5">
                    <Input
                      value={mgr[r.region] ?? ''}
                      onChange={(e) => setMgr((m) => ({ ...m, [r.region]: e.target.value }))}
                      onBlur={commitManagers}
                      placeholder="Add name"
                      className="h-8 w-48"
                      aria-label={`Regional manager for ${r.region}`}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{r.sites}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-accent">{currency(r.bonus)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-content font-semibold">
                <td className="px-3 py-2.5 text-ink" colSpan={3}>Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-accent">{currency(totalBonus)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-xs text-ink-subtle">
        Each regional manager earns their region's percentage of the combined GM monthly bonuses across that region's
        sites for the three months of the quarter. Figures come straight from the GM/AGM Monthly Bonuses.
      </p>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  readOnly,
  step,
  sub,
}: {
  label: string
  value: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  readOnly?: boolean
  step?: string
  sub?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        className={readOnly ? 'h-9 bg-content' : 'h-9'}
      />
      {sub !== undefined && <span className="text-[11px] font-normal text-ink-subtle">{sub}</span>}
    </label>
  )
}

function BonusRow({
  label,
  detail,
  earned,
  amount,
}: {
  label: string
  detail: string
  earned?: boolean | null
  amount: number
}) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {earned === true && <Badge tone="ok"><Check className="size-3" /> Earned</Badge>}
        {earned === false && <Badge tone="neutral"><X className="size-3" /> No</Badge>}
        <span className="w-16 text-right text-sm font-semibold tabular-nums text-ink">{currency(amount)}</span>
      </div>
    </div>
  )
}
