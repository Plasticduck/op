import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Boxes, Loader2 } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow, type ItOverview } from '@/lib/queries/itInventory'
import { friendlyError, notWorking, statusTone, WARRANTY_WINDOW_DAYS } from './format'
import { ItIcon } from './ItIcon'
import { SectionNav } from './SectionNav'
import { RENEWAL_WINDOW_DAYS } from './subscriptions'
import { useItRefs, type ItRefs } from './useItRefs'

// The IT Inventory overview (spec I). All sites: what needs attention, counts
// by site and category, monthly subscription spend and recent repair spend.
// One site: the same, plus its equipment area by area (cards, not a floor
// plan). Every number links to the list it counts.

export function OverviewPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const { refs, error: refsError } = useItRefs()
  const [params, setParams] = useSearchParams()
  const site = params.get('site') ?? (locations.length > 1 ? 'all' : activeLocation?.id ?? 'all')
  const loc = site === 'all' ? null : site
  const today = format(new Date(), 'yyyy-MM-dd')
  const [data, setData] = useState<ItOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    void itInventory.overview(loc, today).then((r) => {
      if (!alive) return
      setData(r.data)
      setError(r.error)
    })
    return () => { alive = false }
  }, [loc, today])

  // Lists filtered to what a number counts, at the same site(s).
  const list = (extra: Record<string, string> = {}) => `/app/it-inventory?${new URLSearchParams({ site, ...extra })}`
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const a = data?.attention
  const siteName = loc ? locations.find((l) => l.id === loc)?.name : null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="IT Inventory" subtitle={siteName ? `What needs attention at ${siteName}.` : 'What needs attention across your sites.'} />
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SectionNav />
        {locations.length > 1 && (
          <Select value={site} onChange={(e) => setParams({ site: e.target.value }, { replace: true })} aria-label="Site" className="sm:w-60">
            <option value="all">All sites</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        )}
      </div>

      {(error || refsError) && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the overview: {friendlyError(error ?? refsError ?? '')}</p>}

      {!data ? (
        !error && <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : data.total === 0 && data.spend.by_site.length === 0 ? (
        <EmptyState className="mt-6" icon={Boxes} title={siteName ? `Nothing recorded at ${siteName} yet` : 'Nothing recorded yet'}
          description="Add equipment or import a spreadsheet, and this page fills in: what's not working, what's out for repair, what's coming due."
          action={staff ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate('/app/it-inventory')}>Add equipment</Button>
              <Button variant="secondary" onClick={() => navigate('/app/it-inventory/import')}>Import a spreadsheet</Button>
            </div>
          ) : undefined} />
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          <section>
            <SectionTitle>Needs attention</SectionTitle>
            <StatCardRow
              className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
              items={[
                { label: 'Not working', value: a!.not_working, to: list({ health: 'offline' }) },
                { label: 'Out for repair', value: a!.repair, to: list({ status: 'name:Out for Repair' }) },
                { label: 'Warranty ending', value: a!.warranty, hint: `Next ${WARRANTY_WINDOW_DAYS} days`, to: list({ warranty: 'expiring' }) },
                { label: 'Renewals due', value: a!.renewals, hint: `Next ${RENEWAL_WINDOW_DAYS} days`, to: `/app/it-inventory/subscriptions?${new URLSearchParams({ site, due: '1' })}` },
                { label: 'Audits overdue', value: a!.audits, to: '/app/it-inventory/audits' },
                { label: 'Low supplies', value: a!.low_stock, to: `/app/it-inventory/supplies?${new URLSearchParams({ site, low: '1' })}` },
                { label: 'Stickers to print', value: a!.stickers, to: list({ sticker: 'needs' }) },
              ]}
            />
          </section>

          <StatCardRow
            className="grid-cols-1 sm:grid-cols-3"
            items={[
              { label: 'Equipment', value: data.total.toLocaleString(), to: list() },
              {
                label: 'Subscriptions a month',
                value: currency(data.spend.monthly),
                hint: data.spend.unpriced ? `${data.spend.unpriced} without a monthly price` : undefined,
                to: `/app/it-inventory/subscriptions?${new URLSearchParams({ site })}`,
              },
              { label: 'Repairs, last 90 days', value: currency(data.repair_spend_90d), hint: 'From maintenance records' },
            ]}
          />

          {!loc && data.by_site.length > 0 && <BySite data={data} />}
          {loc && refs && <ByArea locationId={loc} refs={refs} list={list} />}
          {data.by_category.length > 0 && <ByCategory data={data} list={list} />}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{children}</h2>
}

// Small number cell that links to the matching list, muted when zero.
function Num({ n, to, tone }: { n: number; to: string; tone?: 'danger' | 'warn' }) {
  if (!n) return <span className="text-ink-subtle">0</span>
  return (
    <Link to={to} className={cn('font-medium hover:underline', tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink')}>
      {n.toLocaleString()}
    </Link>
  )
}

function BySite({ data }: { data: ItOverview }) {
  const spend = new Map(data.spend.by_site.map((s) => [s.id, s.monthly]))
  const shared = data.spend.by_site.find((s) => s.id === null)
  const at = (id: string, extra: Record<string, string> = {}) => `/app/it-inventory?${new URLSearchParams({ site: id, ...extra })}`
  return (
    <section>
      <SectionTitle>By site</SectionTitle>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold">Site</th>
              <th className="px-3 py-2 text-right font-semibold">Equipment</th>
              <th className="px-3 py-2 text-right font-semibold">Not working</th>
              <th className="px-3 py-2 text-right font-semibold">Out for repair</th>
              <th className="px-3 py-2 text-right font-semibold">Audit overdue</th>
              <th className="px-3 py-2 text-right font-semibold">Subscriptions / mo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {data.by_site.map((s) => (
              <tr key={s.id} className="hover:bg-content">
                <td className="whitespace-nowrap px-3 py-2"><Link to={`/app/it-inventory/overview?site=${s.id}`} className="font-medium text-ink hover:underline">{s.name}</Link></td>
                <td className="px-3 py-2 text-right"><Num n={s.total} to={at(s.id)} /></td>
                <td className="px-3 py-2 text-right"><Num n={s.not_working} to={at(s.id, { health: 'offline' })} tone="danger" /></td>
                <td className="px-3 py-2 text-right"><Num n={s.repair} to={at(s.id, { status: 'name:Out for Repair' })} tone="warn" /></td>
                <td className="px-3 py-2 text-right"><Num n={s.audits_overdue} to={at(s.id, { audit: 'overdue' })} tone="warn" /></td>
                <td className="px-3 py-2 text-right">
                  {spend.get(s.id) ? (
                    <Link to={`/app/it-inventory/subscriptions?site=${s.id}`} className="text-ink hover:underline">{currency(spend.get(s.id))}</Link>
                  ) : <span className="text-ink-subtle">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shared?.monthly ? (
        <p className="mt-2 text-xs text-ink-muted">
          Plus {currency(shared.monthly)} a month for <Link to={`/app/it-inventory/subscriptions?${new URLSearchParams({ site: 'every' })}`} className="text-accent hover:underline">subscriptions that cover every site</Link>.
        </p>
      ) : null}
    </section>
  )
}

function ByCategory({ data, list }: { data: ItOverview; list: (extra?: Record<string, string>) => string }) {
  return (
    <section>
      <SectionTitle>By category</SectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.by_category.map((c) => (
          <Link key={c.id} to={list({ cat: c.id })}
            className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-sm transition hover:border-border-strong hover:bg-content/40">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><ItIcon name={c.icon} className="size-4" /></span>
            <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
            {c.not_working > 0 && <Badge tone="danger">{c.not_working} not working</Badge>}
            <span className="tabular-nums font-semibold text-ink">{c.total}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}

const PER_CARD = 8

// One site's equipment, grouped by area in walk order.
function ByArea({ locationId, refs, list }: { locationId: string; refs: ItRefs; list: (extra?: Record<string, string>) => string }) {
  const [assets, setAssets] = useState<ItAssetRow[] | null>(null)
  useEffect(() => {
    let alive = true
    setAssets(null)
    void itInventory.assetsForSite(locationId).then(({ data }) => { if (alive) setAssets(data) })
    return () => { alive = false }
  }, [locationId])

  const groups = useMemo(() => {
    if (!assets) return []
    const active = assets.filter((r) => refs.status.get(r.status_label_id)?.type !== 'archived')
    const areas = refs.areas.filter((x) => x.location_id === locationId)
    const out = areas.map((area) => ({ id: area.id, name: area.name, items: active.filter((r) => r.area_id === area.id) }))
    const known = new Set(areas.map((x) => x.id))
    const loose = active.filter((r) => !r.area_id || !known.has(r.area_id))
    if (loose.length) out.push({ id: '', name: 'No area set', items: loose })
    return out.filter((g) => g.items.length)
  }, [assets, refs, locationId])

  if (!assets) return <div className="grid place-items-center py-8 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  if (!groups.length) return null
  return (
    <section>
      <SectionTitle>Area by area</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.id || 'none'} className="rounded-md border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <h3 className="text-sm font-semibold text-ink">{g.name}</h3>
              <span className="text-xs tabular-nums text-ink-muted">
                {g.items.length}
                {g.items.some((r) => notWorking(r.health_state)) && (
                  <span className="ml-1.5 text-danger">{g.items.filter((r) => notWorking(r.health_state)).length} not working</span>
                )}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {g.items.slice(0, PER_CARD).map((r) => {
                const st = refs.status.get(r.status_label_id)
                return (
                  <li key={r.id}>
                    <Link to={`/app/it-inventory/${r.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-content">
                      <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
                      {notWorking(r.health_state) && <Badge tone="danger">Not working</Badge>}
                      {st && st.type !== 'deployable' && <Badge tone={statusTone(st)}>{st.name}</Badge>}
                      <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{r.asset_tag}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {g.items.length > PER_CARD && (
              <Link to={list(g.id ? { area: g.id } : {})} className="block border-t border-border px-3 py-2 text-xs font-medium text-accent hover:underline">
                All {g.items.length} in {g.name}
              </Link>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
