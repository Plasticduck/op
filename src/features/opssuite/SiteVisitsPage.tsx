import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { MapPinCheck, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { durationHm } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import {
  siteVisits,
  canonicalPeople,
  FLEET_CATEGORIES,
  FLEET_CATEGORY_LABEL,
  type FleetCategory,
  type FleetPerson,
  type SiteVisit,
} from '@/lib/queries/fleet'

// Site Visits: who parked at each Mighty Wash site, from Verizon Connect Reveal
// trips (reveal-visits-sync, hourly). A visit is a vehicle parked within the
// site's geofence. People are tagged by type (Regional Manager, Executive,
// Maintenance, Facilities, IT, Other) on the People tab; Regional Managers and
// Executives are pre-tagged from their Operator role. A vehicle with no driver
// assigned in Reveal shows up as its own "person" (named after the vehicle);
// merging it into its driver shows those visits under the driver.
// Pre-launch: kevan@washlyfe.com only.

const HISTORY_DAYS = 90
const DAY_MS = 86400_000
const LOG_LIMIT = 300

type Tab = 'sites' | 'log' | 'people'
type CatFilter = 'all' | FleetCategory | 'untagged'

const daysAgo = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / DAY_MS)
function agoLabel(iso: string): string {
  const d = daysAgo(iso)
  return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`
}
// Within a week is fine, within two is getting long, past that is overdue.
function recencyTone(iso: string | null): 'ok' | 'warn' | 'danger' {
  if (!iso) return 'danger'
  const d = daysAgo(iso)
  return d <= 7 ? 'ok' : d <= 14 ? 'warn' : 'danger'
}
const when = (iso: string) => format(new Date(iso), 'MMM d, h:mm a')
function stay(v: SiteVisit): string {
  if (v.departed_at) return durationHm(v.arrived_at, v.departed_at)
  return Date.now() - Date.parse(v.arrived_at) < DAY_MS ? 'Still there' : 'Unknown'
}

export default function SiteVisitsPage() {
  const { locations } = useLocations()
  const [tab, setTab] = useState<Tab>('sites')
  const [visits, setVisits] = useState<SiteVisit[]>([])
  const [people, setPeople] = useState<FleetPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS).toISOString()
      const [v, p] = await Promise.all([siteVisits.between(since), siteVisits.people()])
      if (p.error) throw p.error
      setVisits(v)
      setPeople(p.data ?? [])
      setError(null)
    } catch {
      setError('Could not load site visits.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const syncNow = async () => {
    setSyncing(true)
    setSyncNote(null)
    const { data, error: err } = await siteVisits.sync()
    setSyncing(false)
    if (err) { setSyncNote('Sync failed. The hourly sync will try again.'); return }
    setSyncNote(`Synced ${(data as { visits?: number })?.visits ?? 0} visits from yesterday and today.`)
    void load()
  }

  // Every visit counts toward its person after merges.
  const canon = useMemo(() => canonicalPeople(people), [people])
  const personOf = useCallback((v: SiteVisit) => (v.person_key ? canon.get(v.person_key) : undefined), [canon])
  const categoryOf = useCallback((v: SiteVisit) => (personOf(v)?.category as FleetCategory | null | undefined) ?? null, [personOf])
  const nameOf = useCallback((v: SiteVisit) => personOf(v)?.name ?? v.person_name ?? v.vehicle_name ?? 'Unknown', [personOf])
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const sites = useMemo(() => {
    const mapped = locations
      .filter((l) => l.latitude != null && l.longitude != null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const since30 = Date.now() - 30 * DAY_MS
    return mapped.map((l) => {
      // visits are newest first, so the first match is the latest.
      const here = visits.filter((v) => v.location_id === l.id)
      return {
        id: l.id,
        name: l.name,
        last: here[0] ?? null,
        lastRm: here.find((v) => categoryOf(v) === 'regional_manager') ?? null,
        lastMaint: here.find((v) => categoryOf(v) === 'maintenance') ?? null,
        count30: here.filter((v) => Date.parse(v.arrived_at) >= since30).length,
      }
    })
  }, [locations, visits, categoryOf])
  const unmapped = locations.filter((l) => (l.latitude == null || l.longitude == null) && !/unassigned/i.test(l.name))

  const untagged = people.filter((p) => !p.category && !p.merged_into).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Site Visits"
        subtitle={`Vehicles parked at each site, from Verizon Connect GPS. Last ${HISTORY_DAYS} days, updated hourly.`}
        actions={
          <Button variant="secondary" onClick={() => void syncNow()} disabled={syncing}>
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} /> {syncing ? 'Syncing...' : 'Sync now'}
          </Button>
        }
      />
      {syncNote && <p className="text-sm text-ink-muted">{syncNote}</p>}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border">
        <TabButton active={tab === 'sites'} onClick={() => setTab('sites')} label="Sites" count={sites.length} />
        <TabButton active={tab === 'log'} onClick={() => setTab('log')} label="Visit log" count={visits.length} />
        <TabButton active={tab === 'people'} onClick={() => setTab('people')} label="People" count={people.filter((p) => !p.merged_into).length} />
      </div>

      {untagged > 0 && tab !== 'people' && (
        <p className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink">
          {untagged} {untagged === 1 ? 'person is' : 'people are'} not tagged yet. Tag maintenance techs on the{' '}
          <button className="font-medium text-accent underline" onClick={() => setTab('people')}>People</button> tab so the
          Last maintenance visit column fills in.
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : tab === 'sites' ? (
        <SitesTab sites={sites} unmapped={unmapped.map((l) => l.name)} nameOf={nameOf} />
      ) : tab === 'log' ? (
        <LogTab visits={visits} people={people} siteName={siteName} categoryOf={categoryOf} personOf={personOf} nameOf={nameOf} />
      ) : (
        <PeopleTab
          people={people}
          visits={visits}
          canon={canon}
          onChange={(key, category) => setPeople((ps) => ps.map((p) => (p.person_key === key ? { ...p, category } : p)))}
          onReload={() => void load()}
        />
      )}
    </div>
  )
}

type SiteRow = {
  id: string
  name: string
  last: SiteVisit | null
  lastRm: SiteVisit | null
  lastMaint: SiteVisit | null
  count30: number
}

function SitesTab({ sites, unmapped, nameOf }: { sites: SiteRow[]; unmapped: string[]; nameOf: (v: SiteVisit) => string }) {
  if (sites.length === 0) return <EmptyState icon={MapPinCheck} title="No sites on the map" description="Sites need a map location to track visits." />
  const visitCell = (v: SiteVisit | null, toned: boolean) =>
    v ? (
      <div>
        {toned ? <Badge tone={recencyTone(v.arrived_at)}>{agoLabel(v.arrived_at)}</Badge> : <span className="text-ink">{agoLabel(v.arrived_at)}</span>}
        <div className="mt-0.5 text-xs text-ink-muted">
          {nameOf(v)} · {when(v.arrived_at)} · {stay(v)}
        </div>
      </div>
    ) : toned ? (
      <Badge tone="danger">None in {HISTORY_DAYS} days</Badge>
    ) : (
      <span className="text-ink-subtle">None in {HISTORY_DAYS} days</span>
    )
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 font-medium">Site</th>
              <th className="px-3 py-2.5 font-medium">Last Regional Manager visit</th>
              <th className="px-3 py-2.5 font-medium">Last maintenance visit</th>
              <th className="px-3 py-2.5 font-medium">Last visit by anyone</th>
              <th className="px-3 py-2.5 text-right font-medium">Visits, 30 days</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} className="border-t border-border align-top hover:bg-content">
                <td className="px-3 py-2.5 font-medium text-ink">{s.name}</td>
                <td className="px-3 py-2.5">{visitCell(s.lastRm, true)}</td>
                <td className="px-3 py-2.5">{visitCell(s.lastMaint, true)}</td>
                <td className="px-3 py-2.5">{visitCell(s.last, false)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink">{s.count30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-subtle">
        Green: within 7 days. Amber: 8 to 14 days. Red: over 14 days.
        {unmapped.length > 0 && ` Not tracked (no map location in Operator): ${unmapped.join(', ')}.`}
      </p>
    </div>
  )
}

function LogTab({ visits, people, siteName, categoryOf, personOf, nameOf }: {
  visits: SiteVisit[]
  people: FleetPerson[]
  siteName: Map<string, string>
  categoryOf: (v: SiteVisit) => FleetCategory | null
  personOf: (v: SiteVisit) => FleetPerson | undefined
  nameOf: (v: SiteVisit) => string
}) {
  const [site, setSite] = useState('all')
  const [person, setPerson] = useState('all')
  const [cat, setCat] = useState<CatFilter>('all')
  const [days, setDays] = useState(30)

  const siteOptions = useMemo(
    () => [...new Set(visits.map((v) => v.location_id))]
      .map((id) => ({ id, name: siteName.get(id) ?? 'Unknown site' }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    [visits, siteName],
  )
  const rows = useMemo(() => {
    const since = Date.now() - days * DAY_MS
    return visits.filter((v) =>
      Date.parse(v.arrived_at) >= since &&
      (site === 'all' || v.location_id === site) &&
      (person === 'all' || personOf(v)?.person_key === person) &&
      (cat === 'all' || (cat === 'untagged' ? !categoryOf(v) : categoryOf(v) === cat)),
    )
  }, [visits, site, person, cat, days, categoryOf, personOf])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="sm:w-44">
          <option value="all">All sites</option>
          {siteOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={person} onChange={(e) => setPerson(e.target.value)} className="sm:w-56">
          <option value="all">Everyone</option>
          {people.filter((p) => !p.merged_into).map((p) => <option key={p.person_key} value={p.person_key}>{p.name}</option>)}
        </Select>
        <Select value={cat} onChange={(e) => setCat(e.target.value as CatFilter)} className="sm:w-48">
          <option value="all">All types</option>
          {FLEET_CATEGORIES.map((c) => <option key={c} value={c}>{FLEET_CATEGORY_LABEL[c]}</option>)}
          <option value="untagged">Not tagged</option>
        </Select>
        <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} className="sm:w-40">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value={String(HISTORY_DAYS)}>Last {HISTORY_DAYS} days</option>
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={MapPinCheck} title="No visits" description="No visits match these filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Arrived</th>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Vehicle</th>
                  <th className="px-3 py-2.5 font-medium">Left</th>
                  <th className="px-3 py-2.5 text-right font-medium">Time on site</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, LOG_LIMIT).map((v) => {
                  const c = categoryOf(v)
                  return (
                    <tr key={v.id} className="border-t border-border hover:bg-content">
                      <td className="whitespace-nowrap px-3 py-2 text-ink">{when(v.arrived_at)}</td>
                      <td className="px-3 py-2 font-medium text-ink">{siteName.get(v.location_id) ?? 'Unknown site'}</td>
                      <td className="px-3 py-2 text-ink">
                        {nameOf(v)}
                        {c && <span className="ml-1.5 text-xs text-ink-subtle">{FLEET_CATEGORY_LABEL[c]}</span>}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{v.vehicle_name ?? '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{v.departed_at ? format(new Date(v.departed_at), 'h:mm a') : '-'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{stay(v)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {rows.length > LOG_LIMIT && (
            <p className="text-xs text-ink-subtle">Showing the newest {LOG_LIMIT} of {rows.length} visits. Narrow the filters to see more.</p>
          )}
        </>
      )}
    </div>
  )
}

function PeopleTab({ people, visits, canon, onChange, onReload }: {
  people: FleetPerson[]
  visits: SiteVisit[]
  canon: Map<string, FleetPerson>
  onChange: (key: string, category: FleetCategory | null) => void
  onReload: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const main = useMemo(() => people.filter((p) => !p.merged_into), [people])
  const mergedUnder = useMemo(() => {
    const m = new Map<string, FleetPerson[]>()
    for (const p of people) if (p.merged_into) m.set(p.merged_into, [...(m.get(p.merged_into) ?? []), p])
    return m
  }, [people])

  // Visit counts per person, merged entries included.
  const stats = useMemo(() => {
    const since30 = Date.now() - 30 * DAY_MS
    const m = new Map<string, { count30: number; last: string | null }>()
    for (const v of visits) {
      const key = v.person_key ? canon.get(v.person_key)?.person_key : undefined
      if (!key) continue
      const s = m.get(key) ?? { count30: 0, last: null }
      if (Date.parse(v.arrived_at) >= since30) s.count30++
      if (!s.last) s.last = v.arrived_at
      m.set(key, s)
    }
    return m
  }, [visits, canon])

  // For a vehicle-named entry (no driver assigned those days), suggest whoever
  // drives that same vehicle most on the days it does have a driver.
  const suggestions = useMemo(() => {
    const byVehicle = new Map<string, Map<string, number>>()
    for (const v of visits) {
      if (!v.person_key || v.person_key.startsWith('v:')) continue
      const key = canon.get(v.person_key)?.person_key
      if (!key || key.startsWith('v:')) continue
      const counts = byVehicle.get(v.vehicle_number) ?? new Map<string, number>()
      counts.set(key, (counts.get(key) ?? 0) + 1)
      byVehicle.set(v.vehicle_number, counts)
    }
    const out = new Map<string, FleetPerson>()
    for (const p of main) {
      if (!p.person_key.startsWith('v:')) continue
      const counts = byVehicle.get(p.person_key.slice(2))
      if (!counts) continue
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      const target = top && canon.get(top[0])
      if (target && target.person_key !== p.person_key) out.set(p.person_key, target)
    }
    return out
  }, [visits, canon, main])

  const save = async (key: string, value: string) => {
    const category = (value || null) as FleetCategory | null
    setSaving(key)
    setErr(null)
    const { data, error } = await siteVisits.setCategory(key, category)
    setSaving(null)
    if (error || !data?.length) { setErr('Could not save that change.'); return }
    onChange(key, category)
  }

  const merge = async (from: FleetPerson, into: FleetPerson) => {
    setSaving(from.person_key)
    setErr(null)
    const { error } = await siteVisits.merge(from.person_key, into.person_key)
    setSaving(null)
    if (error) { setErr(`Could not merge ${from.name}.`); return }
    onReload()
  }
  const unmerge = async (p: FleetPerson) => {
    setSaving(p.person_key)
    setErr(null)
    const { error } = await siteVisits.unmerge(p.person_key)
    setSaving(null)
    if (error) { setErr(`Could not undo the merge for ${p.name}.`); return }
    onReload()
  }
  const mergeAllSuggested = async () => {
    const pairs = [...suggestions.entries()]
      .map(([key, into]) => [main.find((p) => p.person_key === key), into] as const)
      .filter((pair): pair is readonly [FleetPerson, FleetPerson] => !!pair[0])
    const list = pairs.map(([from, into]) => `${from.name} -> ${into.name}`).join('\n')
    if (!window.confirm(`Merge these ${pairs.length}?\n\n${list}`)) return
    setSaving('all')
    setErr(null)
    for (const [from, into] of pairs) {
      const { error } = await siteVisits.merge(from.person_key, into.person_key)
      if (error) { setErr(`Stopped at ${from.name}: could not merge.`); break }
    }
    setSaving(null)
    onReload()
  }

  if (people.length === 0) return <EmptyState icon={MapPinCheck} title="No people yet" description="People appear after the first sync." />
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">
        Everyone Verizon Connect has trips for. The type decides which column a visit counts toward on the Sites tab.
        Site staff parked at their own wash are best tagged Other. Entries named after a vehicle are trips from days
        no driver was assigned in Verizon; merge them into the person who drives it.
      </p>
      {suggestions.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          <span className="text-ink">
            {suggestions.size} vehicle {suggestions.size === 1 ? 'entry has' : 'entries have'} a suggested driver.
          </span>
          <Button size="sm" variant="secondary" disabled={saving != null} onClick={() => void mergeAllSuggested()}>
            Merge all suggestions
          </Button>
        </div>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 font-medium">Name</th>
              <th className="px-3 py-2.5 font-medium">Email in Verizon</th>
              <th className="px-3 py-2.5 text-right font-medium">Visits, 30 days</th>
              <th className="px-3 py-2.5 font-medium">Last visit</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Merge</th>
            </tr>
          </thead>
          <tbody>
            {main.map((p) => {
              const s = stats.get(p.person_key)
              const merged = mergedUnder.get(p.person_key) ?? []
              const suggested = suggestions.get(p.person_key)
              const busy = saving === p.person_key || saving === 'all'
              return (
                <tr key={p.person_key} className="border-t border-border align-top hover:bg-content">
                  <td className="px-3 py-2">
                    <div className="font-medium text-ink">
                      {p.name}
                      {p.user_id && <span className="ml-1.5 text-xs font-normal text-ink-subtle">Operator user</span>}
                      {p.person_key.startsWith('v:') && <span className="ml-1.5 text-xs font-normal text-ink-subtle">Vehicle</span>}
                    </div>
                    {merged.map((m) => (
                      <div key={m.person_key} className="mt-0.5 text-xs text-ink-muted">
                        Includes {m.name}{' '}
                        <button
                          className="font-medium text-accent hover:underline disabled:opacity-50"
                          disabled={saving != null}
                          onClick={() => void unmerge(m)}
                        >
                          Undo
                        </button>
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">{p.email ?? '-'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">{s?.count30 ?? 0}</td>
                  <td className="px-3 py-2 text-ink-muted">{s?.last ? agoLabel(s.last) : '-'}</td>
                  <td className="px-3 py-2">
                    <Select
                      value={p.category ?? ''}
                      disabled={busy}
                      onChange={(e) => void save(p.person_key, e.target.value)}
                      className="w-44"
                    >
                      <option value="">Not tagged</option>
                      {FLEET_CATEGORIES.map((c) => <option key={c} value={c}>{FLEET_CATEGORY_LABEL[c]}</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1.5">
                      {suggested && (
                        <Button size="sm" variant="secondary" disabled={saving != null} onClick={() => void merge(p, suggested)}>
                          Merge into {suggested.name}
                        </Button>
                      )}
                      <Select
                        value=""
                        disabled={saving != null}
                        onChange={(e) => {
                          const into = main.find((x) => x.person_key === e.target.value)
                          if (into) void merge(p, into)
                        }}
                        className="w-48"
                      >
                        <option value="">Merge into...</option>
                        {main
                          .filter((x) => x.person_key !== p.person_key)
                          .map((x) => <option key={x.person_key} value={x.person_key}>{x.name}</option>)}
                      </Select>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
        active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
      <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
        active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted')}>{count}</span>
    </button>
  )
}
