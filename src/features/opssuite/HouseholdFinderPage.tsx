import { useCallback, useEffect, useMemo, useState } from 'react'
import { Home, Users, RefreshCw, MapPin, Mail, Phone, ChevronDown, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import {
  householdsSyncedAt,
  regionSummary,
  listHouseholds,
  listMembers,
  runHouseholdSync,
  REGION_ORDER,
  type Household,
  type HouseholdMember,
  type RegionSummary,
} from '@/lib/queries/households'

// Household Finder: DRB/SiteWatch customers grouped into likely households by
// shared residential address, broken out by region. Admin (owner) only. The data
// is a periodic snapshot built by the sync-drb-households edge function, not live.

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function HouseholdFinderPage() {
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [summary, setSummary] = useState<RegionSummary[]>([])
  const [households, setHouseholds] = useState<Household[]>([])
  const [region, setRegion] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    const [when, sum] = await Promise.all([householdsSyncedAt(), regionSummary()])
    setSyncedAt(when)
    setSummary(sum)
  }, [])

  const loadList = useCallback(async (r: string) => {
    setLoading(true)
    try {
      setHouseholds(await listHouseholds(r))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load households.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadMeta() }, [loadMeta])
  useEffect(() => { void loadList(region) }, [region, loadList])

  const totals = useMemo(() => {
    return summary.reduce(
      (a, s) => ({ households: a.households + s.households, people: a.people + s.people }),
      { households: 0, people: 0 },
    )
  }, [summary])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return households
    return households.filter(
      (h) => (h.address ?? '').toLowerCase().includes(q) || (h.zip ?? '').includes(q),
    )
  }, [households, search])

  async function refresh() {
    setSyncing(true)
    setError(null)
    setNotice(null)
    try {
      const res = await runHouseholdSync()
      setNotice(`Updated: ${res.households.toLocaleString()} households, ${res.members.toLocaleString()} people.`)
      await loadMeta()
      await loadList(region)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  const hasData = summary.length > 0 || households.length > 0
  const regionsForTabs = ['All', ...REGION_ORDER.filter((r) => summary.some((s) => s.region === r))]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Household Finder"
        subtitle="DRB members likely sharing a household, grouped by region. Matched on shared residential address."
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={syncing}>
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'Refreshing…' : 'Refresh data'}
          </Button>
        }
      />

      <p className="text-xs text-ink-subtle">
        Snapshot last updated {fmtWhen(syncedAt)}. This is a periodic build from DRB, not a live feed. Refresh can take a minute.
      </p>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}
      {notice && (
        <div className="rounded-md border border-ok/40 bg-ok-soft px-4 py-3 text-sm text-ok">{notice}</div>
      )}

      {!hasData && !loading ? (
        <EmptyState
          icon={Home}
          title="No household data yet"
          description="Click Refresh data to build the first snapshot from DRB. It clusters customers by shared address and groups them by region."
        />
      ) : (
        <>
          {/* Region summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="All regions" households={totals.households} people={totals.people} active={region === 'All'} onClick={() => setRegion('All')} />
            {REGION_ORDER.filter((r) => summary.some((s) => s.region === r)).map((r) => {
              const s = summary.find((x) => x.region === r)!
              return (
                <SummaryCard key={r} label={r} households={s.households} people={s.people} active={region === r} onClick={() => setRegion(r)} />
              )
            })}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {regionsForTabs.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRegion(r)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm font-medium transition',
                    region === r ? 'bg-accent text-white' : 'bg-card border border-border text-ink-muted hover:text-ink',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search address or ZIP"
                className="h-9 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

          {/* Household list */}
          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs font-medium text-ink-subtle">
              <span>{filtered.length.toLocaleString()} households{region !== 'All' ? ` in ${region}` : ''}</span>
              <span>household size</span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-sm text-ink-muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink-muted">No households match.</div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((h) => (
                  <HouseholdItem key={h.id} household={h} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({
  label, households, people, active, onClick,
}: { label: string; households: number; people: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md border p-3 text-left transition',
        active ? 'border-accent bg-accent-soft' : 'border-border bg-card hover:border-ink-subtle',
      )}
    >
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular text-ink">{households.toLocaleString()}</span>
        <span className="text-xs text-ink-subtle">households</span>
      </div>
      <div className="mt-0.5 text-xs text-ink-subtle">{people.toLocaleString()} people</div>
    </button>
  )
}

function HouseholdItem({ household }: { household: Household }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<HouseholdMember[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && members === null) {
      setLoading(true)
      try {
        setMembers(await listMembers(household.id))
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <li>
      <button type="button" onClick={toggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-content/50">
        <MapPin className="size-4 shrink-0 text-ink-subtle" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{household.address ?? '(no address)'}</div>
          <div className="text-xs text-ink-subtle">
            {household.zip ?? ''}{household.region ? ` · ${household.region}` : ''}
          </div>
        </div>
        <span className="flex items-center gap-1 text-xs font-medium text-ink-muted">
          <Users className="size-3.5" />
          {household.member_count}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-subtle transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border bg-content/40 px-4 py-2">
          {loading ? (
            <div className="py-2 text-xs text-ink-muted">Loading members…</div>
          ) : (
            <ul className="flex flex-col gap-1.5 py-1">
              {(members ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm">
                  <span className="font-medium text-ink">{m.full_name ?? '(no name)'}</span>
                  {m.phone && (
                    <span className="flex items-center gap-1 text-xs text-ink-muted">
                      <Phone className="size-3" /> {m.phone}
                    </span>
                  )}
                  {m.email && (
                    <span className="flex items-center gap-1 text-xs text-ink-muted">
                      <Mail className="size-3" /> {m.email}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}
