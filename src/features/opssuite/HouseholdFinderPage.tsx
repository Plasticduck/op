import { useCallback, useEffect, useMemo, useState } from 'react'
import { Home, Users, RefreshCw, MapPin, Mail, Phone, CreditCard, ChevronDown, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import {
  householdsSyncedAt,
  typeCounts,
  regionSummary,
  listHouseholds,
  listMembers,
  runHouseholdSync,
  REGION_ORDER,
  MATCH_LABEL,
  type MatchType,
  type Household,
  type HouseholdMember,
  type RegionSummary,
  type TypeCount,
} from '@/lib/queries/households'

// Household Finder: active DRB members clustered into likely households by a
// shared phone, a shared payment card, or a shared address, broken out by
// region. Admin (owner) only. A periodic snapshot, not a live feed.

const TYPE_ICON: Record<MatchType, typeof Phone> = { phone: Phone, card: CreditCard, address: MapPin }

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function HouseholdFinderPage() {
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [counts, setCounts] = useState<TypeCount[]>([])
  const [matchType, setMatchType] = useState<MatchType>('phone')
  const [summary, setSummary] = useState<RegionSummary[]>([])
  const [households, setHouseholds] = useState<Household[]>([])
  const [region, setRegion] = useState<string>('All')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadMeta = useCallback(async () => {
    const [when, tc] = await Promise.all([householdsSyncedAt(), typeCounts()])
    setSyncedAt(when)
    setCounts(tc)
  }, [])

  const loadType = useCallback(async (t: MatchType, r: string) => {
    setLoading(true)
    try {
      const [sum, list] = await Promise.all([regionSummary(t), listHouseholds(t, r)])
      setSummary(sum)
      setHouseholds(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load households.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadMeta() }, [loadMeta])
  useEffect(() => { void loadType(matchType, region) }, [matchType, region, loadType])

  // If the selected match type has no data (e.g. card while it's disabled),
  // fall back to the first type that does.
  useEffect(() => {
    if (!counts.length) return
    const current = counts.find((c) => c.match_type === matchType)
    if (current && current.households > 0) return
    const first = counts.find((c) => c.households > 0)
    if (first && first.match_type !== matchType) setMatchType(first.match_type)
  }, [counts, matchType])

  const totals = useMemo(
    () => summary.reduce((a, s) => ({ households: a.households + s.households, people: a.people + s.people }), { households: 0, people: 0 }),
    [summary],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return households
    return households.filter(
      (h) => (h.match_value ?? '').toLowerCase().includes(q) || (h.address ?? '').toLowerCase().includes(q) || (h.zip ?? '').includes(q),
    )
  }, [households, search])

  async function refresh() {
    setSyncing(true)
    setError(null)
    setProgress('Starting…')
    try {
      await runHouseholdSync((t) => {
        const parts = (['phone', 'card', 'address'] as MatchType[])
          .filter((k) => t[k]).map((k) => `${t[k].toLocaleString()} ${MATCH_LABEL[k].toLowerCase()}`)
        setProgress(parts.length ? `Found ${parts.join(', ')}…` : 'Working…')
      })
      setProgress(null)
      await loadMeta()
      await loadType(matchType, region)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed.')
      setProgress(null)
    } finally {
      setSyncing(false)
    }
  }

  const hasData = counts.some((c) => c.households > 0)
  const regionsForTabs = ['All', ...REGION_ORDER.filter((r) => summary.some((s) => s.region === r))]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Household Finder"
        subtitle="Active DRB members likely sharing a household, matched on shared phone, card, or address."
        actions={
          <Button variant="secondary" size="sm" onClick={refresh} disabled={syncing}>
            <RefreshCw className={cn('size-4', syncing && 'animate-spin')} />
            {syncing ? 'Refreshing…' : 'Refresh data'}
          </Button>
        }
      />

      <p className="text-xs text-ink-subtle">
        Snapshot last updated {fmtWhen(syncedAt)}. Members are customers with recharge billing in the last ~60 days. A refresh runs in the background and can take several minutes.
      </p>

      {progress && (
        <div className="rounded-md border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-accent">{progress}</div>
      )}
      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!hasData && !loading ? (
        <EmptyState
          icon={Home}
          title="No household data yet"
          description="Click Refresh data to build the first snapshot from DRB. It clusters active members by shared phone, card, and address, then groups them by region."
        />
      ) : (
        <>
          {/* Match-type tabs (only those with data) */}
          <div className="flex flex-wrap gap-2">
            {(['phone', 'card', 'address'] as MatchType[])
              .filter((t) => (counts.find((x) => x.match_type === t)?.households ?? 0) > 0)
              .map((t) => {
              const c = counts.find((x) => x.match_type === t)
              const Icon = TYPE_ICON[t]
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setMatchType(t); setRegion('All') }}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-4 py-2 text-sm transition',
                    matchType === t ? 'border-accent bg-accent-soft text-ink' : 'border-border bg-card text-ink-muted hover:text-ink',
                  )}
                >
                  <Icon className="size-4" />
                  <span className="font-medium">Shared {MATCH_LABEL[t].toLowerCase()}</span>
                  <span className="tabular text-ink-subtle">{(c?.households ?? 0).toLocaleString()}</span>
                </button>
              )
            })}
          </div>

          {/* Region summary cards */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="All regions" households={totals.households} people={totals.people} active={region === 'All'} onClick={() => setRegion('All')} />
            {REGION_ORDER.filter((r) => summary.some((s) => s.region === r)).map((r) => {
              const s = summary.find((x) => x.region === r)!
              return <SummaryCard key={r} label={r} households={s.households} people={s.people} active={region === r} onClick={() => setRegion(r)} />
            })}
          </div>

          {/* Region filter + search */}
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
                placeholder="Search"
                className="h-9 w-56 rounded-md border border-border bg-card pl-8 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              />
            </div>
          </div>

          {/* Household list */}
          <div className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-xs font-medium text-ink-subtle">
              <span>{filtered.length.toLocaleString()} households{region !== 'All' ? ` in ${region}` : ''}</span>
              <span>members</span>
            </div>
            {loading ? (
              <div className="p-8 text-center text-sm text-ink-muted">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink-muted">No households match.</div>
            ) : (
              <ul className="divide-y divide-border">
                {filtered.map((h) => <HouseholdItem key={h.id} household={h} />)}
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
      className={cn('rounded-md border p-3 text-left transition', active ? 'border-accent bg-accent-soft' : 'border-border bg-card hover:border-ink-subtle')}
    >
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular text-ink">{households.toLocaleString()}</span>
        <span className="text-xs text-ink-subtle">households</span>
      </div>
      <div className="mt-0.5 text-xs text-ink-subtle">{people.toLocaleString()} members</div>
    </button>
  )
}

function HouseholdItem({ household }: { household: Household }) {
  const [open, setOpen] = useState(false)
  const [members, setMembers] = useState<HouseholdMember[] | null>(null)
  const [loading, setLoading] = useState(false)

  const Icon = TYPE_ICON[household.match_type]
  const title = household.match_type === 'address'
    ? (household.address ?? '(no address)')
    : (household.match_value ?? '(unknown)')
  const sub = household.match_type === 'address'
    ? [household.zip, household.region].filter(Boolean).join(' · ')
    : (household.region ?? '')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && members === null) {
      setLoading(true)
      try { setMembers(await listMembers(household.id)) } finally { setLoading(false) }
    }
  }

  return (
    <li>
      <button type="button" onClick={toggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-content/50">
        <Icon className="size-4 shrink-0 text-ink-subtle" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{title}</div>
          <div className="text-xs text-ink-subtle">{sub}</div>
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
                    <span className="flex items-center gap-1 text-xs text-ink-muted"><Phone className="size-3" /> {m.phone}</span>
                  )}
                  {m.email && (
                    <span className="flex items-center gap-1 text-xs text-ink-muted"><Mail className="size-3" /> {m.email}</span>
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
