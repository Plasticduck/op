import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { useCompany } from '@/lib/company'
import { groupByRegions, resolveRegions } from '@/lib/regions'
import { computeScorecards, letterFor, type Scorecard } from '@/lib/scorecard'
import { StatCardRow } from '@/components/data/StatCardRow'
import { WeatherOutlook } from '@/components/data/WeatherOutlook'
import { Select } from '@/components/ui/Select'

// Vivid grade color by letter grade.
function gradeHex(letter: string): string {
  switch (letter[0]) {
    case 'A':
      return '#047857'
    case 'B':
      return '#2563eb'
    case 'C':
      return '#b45309'
    case 'D':
      return '#ea580c'
    default:
      return '#b91c1c'
  }
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

type ScoredLocation = {
  id: string
  name: string
  latitude: number | null
  longitude: number | null
  card: Scorecard | null
}

export default function AllSitesDashboard() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { settings } = useCompany()

  const [cards, setCards] = useState<Record<string, Scorecard>>({})
  const [loading, setLoading] = useState(true)

  const locIds = useMemo(() => locations.map((l) => l.id), [locations])

  useEffect(() => {
    if (locIds.length === 0) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    computeScorecards(locIds).then((res) => {
      if (!active) return
      setCards(res)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [locIds])

  const groups = useMemo(
    () => groupByRegions(locations, resolveRegions(locations, settings.regions)),
    [locations, settings.regions],
  )
  const showRegions = groups.length > 1

  // Portfolio roll-up across every site we have a card for.
  const scored = locations.map((l) => cards[l.id]).filter(Boolean) as Scorecard[]
  const avgTotal = scored.length
    ? Math.round(scored.reduce((a, c) => a + c.total, 0) / scored.length)
    : 0
  const sum = (pick: (c: Scorecard) => number) => scored.reduce((a, c) => a + pick(c), 0)
  const needsAttention = scored.filter(
    (c) => c.total < 80 || c.signals.highPriority > 0 || c.signals.overdue > 0,
  ).length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          {greeting()}, {profile?.name.split(' ')[0]}
        </h1>
        <p className="mt-1 text-sm text-ink-muted sm:text-base">
          All sites overview · {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      <StatCardRow
        className="sm:grid-cols-3 lg:grid-cols-5"
        items={[
          { label: 'Sites', value: locations.length },
          { label: 'Average grade', value: loading ? '—' : letterFor(avgTotal) },
          { label: 'Needs attention', value: loading ? '—' : needsAttention },
          { label: 'High-priority WOs', value: loading ? '—' : sum((c) => c.signals.highPriority) },
          { label: 'Equipment down', value: loading ? '—' : sum((c) => c.signals.equipmentDown) },
        ]}
      />

      {showRegions ? (
        groups.map((g) => (
          <RegionSection
            key={g.region}
            title={g.region}
            locations={g.locations.map((l) => ({
              id: l.id,
              name: l.name,
              latitude: l.latitude,
              longitude: l.longitude,
              card: cards[l.id] ?? null,
            }))}
            loading={loading}
          />
        ))
      ) : (
        <div className="flex flex-col gap-3">
          <WeatherBar
            sites={locations.map((l) => ({
              id: l.id,
              name: l.name,
              latitude: l.latitude,
              longitude: l.longitude,
            }))}
          />
          <SiteGrid
            locations={locations.map((l) => ({
              id: l.id,
              name: l.name,
              latitude: l.latitude,
              longitude: l.longitude,
              card: cards[l.id] ?? null,
            }))}
            loading={loading}
          />
        </div>
      )}
    </div>
  )
}

function RegionSection({
  title,
  locations,
  loading,
}: {
  title: string
  locations: ScoredLocation[]
  loading: boolean
}) {
  const scored = locations.map((l) => l.card).filter(Boolean) as Scorecard[]
  const avg = scored.length
    ? letterFor(Math.round(scored.reduce((a, c) => a + c.total, 0) / scored.length))
    : null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3 border-b border-border pb-1.5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-ink">{title}</h2>
        <span className="text-xs text-ink-muted">{locations.length} sites</span>
        {!loading && avg && (
          <span
            className="rounded px-1.5 py-0.5 text-xs font-semibold text-white"
            style={{ backgroundColor: gradeHex(avg) }}
          >
            {avg}
          </span>
        )}
      </div>
      <WeatherBar sites={locations} />
      <SiteGrid locations={locations} loading={loading} />
    </section>
  )
}

// Weather for a region (or the whole account): a dropdown of its sites. Sites
// without coordinates are greyed out (disabled) until coordinates are set.
function WeatherBar({
  sites,
}: {
  sites: { id: string; name: string; latitude: number | null; longitude: number | null }[]
}) {
  const hasCoords = (s: { latitude: number | null; longitude: number | null }) =>
    s.latitude != null && s.longitude != null
  const withCoords = sites.filter(hasCoords)
  const [id, setId] = useState('')
  useEffect(() => {
    if (id && sites.some((s) => s.id === id && hasCoords(s))) return
    setId(withCoords[0]?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites])
  const selected = sites.find((s) => s.id === id) ?? null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">Weather</p>
        <div className="w-48">
          <Select
            value={id}
            onChange={(e) => setId(e.target.value)}
            aria-label="Weather site"
            className="h-9"
            disabled={withCoords.length === 0}
          >
            {withCoords.length === 0 && <option value="">No coordinates set</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id} disabled={!hasCoords(s)}>
                {s.name}
                {hasCoords(s) ? '' : ' — no coordinates'}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {selected && hasCoords(selected) ? (
        <WeatherOutlook latitude={selected.latitude} longitude={selected.longitude} />
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-ink-muted">
          Set site coordinates (Settings → Locations) to see the weather outlook.
        </p>
      )}
    </div>
  )
}

function SiteGrid({ locations, loading }: { locations: ScoredLocation[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {locations.map((l) => (
        <SiteCard key={l.id} loc={l} loading={loading} />
      ))}
    </div>
  )
}

function SiteCard({ loc, loading }: { loc: ScoredLocation; loading: boolean }) {
  const navigate = useNavigate()
  const { setActiveId } = useLocations()
  const card = loc.card

  const open = () => {
    setActiveId(loc.id)
    navigate('/app/work-orders')
  }

  return (
    <button
      type="button"
      onClick={open}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-border-strong hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{loc.name}</p>
          <p className="text-xs text-ink-muted">
            {loading || !card ? 'Scoring…' : `${card.total}/100`}
          </p>
        </div>
        <span
          className="grid size-11 shrink-0 place-items-center rounded-lg text-lg font-bold text-white"
          style={{ backgroundColor: loading || !card ? '#9aa3b1' : gradeHex(card.letter) }}
        >
          {loading || !card ? '·' : card.letter}
        </span>
      </div>

      {card && (
        <div className="flex flex-wrap gap-1.5">
          <Chip label="high" value={card.signals.highPriority} tone="danger" />
          <Chip label="overdue" value={card.signals.overdue} tone="danger" />
          <Chip label="down" value={card.signals.equipmentDown} tone="warn" />
          <Chip label="low stock" value={card.signals.lowStock} tone="warn" />
          {card.signals.highPriority === 0 &&
            card.signals.overdue === 0 &&
            card.signals.equipmentDown === 0 &&
            card.signals.lowStock === 0 && (
              <span className="rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
                All clear
              </span>
            )}
        </div>
      )}
    </button>
  )
}

function Chip({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'danger' | 'warn'
}) {
  if (value <= 0) return null
  const cls =
    tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {value} {label}
    </span>
  )
}
