import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Brush, ChevronRight, Cog, Droplets, Factory, Fan, Gauge, Link2, Loader2, ScanEye, SprayCan, Wind, type LucideIcon,
} from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { currency } from '@/lib/format'
import { mi, type Dashboard, type HomeData } from '@/lib/queries/maintenanceInventory'
import { miEquipment, type EquipmentList, type EquipmentRow, type MiArea } from '@/lib/queries/miEquipment'
import { cn } from '@/lib/utils'
import { useMi } from './context'
import { errText } from './format'
import { cars, EQUIPMENT_BASE, needsSticker, shortName, STATUS, warrantyState } from './equipment/format'

// The module's front page, laid out like IT Inventory's: what needs attention, a few
// totals, then site by site (all sites) or zone by zone (one site), and machines by
// type. Every number links to the list it counts. The site picker sits beside the
// section bar (the shell draws it) and lives in ?site=.

const BASE = '/app/maintenance-inventory'
const isDown = (r: EquipmentRow) => r.status === 'offline_planned' || r.status === 'offline_unplanned'
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export default function OverviewPage() {
  const { me, refs } = useMi()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const siteParam = params.get('site')
  const loc = siteParam && refs.sites.some((s) => s.id === siteParam) ? siteParam : null
  const [eq, setEq] = useState<EquipmentList | null>(null)
  const [home, setHome] = useState<HomeData | null>(null)
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [e, h] = await Promise.all([miEquipment.list(), mi.home()])
      setEq(e)
      setHome(h)
      setError(null)
    } catch (err) {
      setError(errText(err))
    }
  }, [])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  // Parts spend is a manager's number (mi_dashboard needs rank 2).
  useEffect(() => {
    if (me.rank < 2) return
    let alive = true
    setDash(null)
    void mi.dashboard({ site: loc }).then((d) => { if (alive) setDash(d) }).catch(() => {})
    return () => { alive = false }
  }, [me.rank, loc])

  const s = useMemo(() => {
    if (!eq) return null
    const live = eq.rows.filter((r) => r.status !== 'retired' && (!loc || r.location_id === loc))
    const machines = live.filter((r) => !r.parent_id)
    const sites = eq.sites.filter((x) => !loc || x.id === loc)
    const counted = sites.filter((x) => x.cars_30d != null)
    const types = new Map<string, { n: number; down: number }>()
    for (const r of machines) {
      const t = r.type?.trim() || 'No type'
      const v = types.get(t) ?? { n: 0, down: 0 }
      v.n++
      if (isDown(r)) v.down++
      types.set(t, v)
    }
    return {
      live,
      machines,
      down: live.filter(isDown).length,
      wos: live.reduce((n, r) => n + r.open_wos, 0),
      warranty: live.filter((r) => warrantyState(r.warranty_expiry)?.tone === 'warn').length,
      stickers: machines.filter(needsSticker).length,
      cars30: counted.length ? counted.reduce((n, x) => n + (x.cars_30d ?? 0), 0) : null,
      uncounted: sites.length - counted.length,
      types: [...types.entries()].sort((a, b) => (a[0] === 'No type' ? 1 : b[0] === 'No type' ? -1 : a[0].localeCompare(b[0], undefined, { numeric: true }))),
    }
  }, [eq, loc])

  // Lists filtered to what a number counts, at the same site(s).
  const list = useCallback((extra: Record<string, string> = {}) =>
    `${EQUIPMENT_BASE}?${new URLSearchParams({ ...(loc ? { site: loc } : {}), ...extra })}`, [loc])

  if (error) return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load the overview: {error}</p>
  if (!s || !eq || !home) return <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>

  const siteName = loc ? refs.sites.find((x) => x.id === loc)?.name : null
  const t = home.to_do
  const transfers = t.transfers_to_approve + t.transfers_to_ship + t.transfers_to_receive
  const counts = t.counts_open + t.counts_to_review
  const pos = t.pos_to_approve + t.pos_to_receive
  const stockTodo = transfers + counts + pos + t.part_requests
  const stockHint = [
    transfers && plural(transfers, 'transfer'),
    counts && plural(counts, 'count'),
    pos && plural(pos, 'PO'),
    t.part_requests && plural(t.part_requests, 'part request'),
  ].filter(Boolean).join(', ')
  const stockTo = transfers ? `${BASE}/transfers` : counts ? `${BASE}/counts` : pos ? `${BASE}/pos` : t.part_requests ? `${BASE}/parts?requests=1` : `${BASE}/transfers`
  const overdueTools = home.my_tools.filter((x) => x.overdue).length
  const allSites = loc ? 'All your sites' : undefined

  return (
    <div className="flex flex-col gap-6">
      {me.has_sample_data && (
        <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Sample data is loaded.{me.rank >= 5 ? <> <Link to={`${BASE}/settings`} className="font-medium underline">Settings</Link> can remove it.</> : ' An admin can remove it in Settings.'}
        </p>
      )}

      {home.handoffs.length > 0 && (
        <section>
          <SectionTitle>Waiting on you</SectionTitle>
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {home.handoffs.map((h) => (
              <Link key={h.id} to={`${BASE}/tools/${h.id}`} className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm hover:bg-content">
                <span className="text-ink">{h.from ?? 'Someone'} is handing you <b>{h.name}</b></span>
                <ChevronRight className="size-4 shrink-0 text-ink-subtle" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {s.live.length === 0 ? (
        <EmptyState icon={Factory} title={siteName ? `No equipment at ${siteName} yet` : 'No equipment yet'}
          description="Add the machines at your sites, or import a spreadsheet, and this page fills in: what's down, what has open work orders, what needs a sticker."
          action={me.rank >= 2 ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate(`${EQUIPMENT_BASE}?add=1`)}>Add equipment</Button>
              {me.rank >= 4 && <Button variant="secondary" onClick={() => navigate(`${BASE}/import`)}>Import a spreadsheet</Button>}
            </div>
          ) : undefined} />
      ) : (
        <>
          <section>
            <SectionTitle>Needs attention</SectionTitle>
            <StatCardRow
              className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
              items={[
                { label: 'Down', value: s.down, to: list({ status: 'down', level: 'all' }) },
                { label: 'Open work orders', value: s.wos, to: list({ wo: 'open', level: 'all' }) },
                { label: 'Warranty ending', value: s.warranty, hint: 'Next 60 days', to: list({ warranty: 'expiring', level: 'all' }) },
                { label: 'Low stock', value: home.low_stock_total, hint: allSites, to: `${BASE}/parts?filter=low` },
                { label: 'Stock to handle', value: stockTodo, hint: stockHint || allSites, to: stockTo },
                { label: 'Stickers to print', value: s.stickers, to: list({ sticker: 'needs' }) },
                { label: 'My tools', value: home.my_tools.length, hint: overdueTools ? `${overdueTools} overdue` : 'Checked out to you', to: `${BASE}/tools` },
              ]}
            />
          </section>

          <StatCardRow
            className="grid-cols-1 sm:grid-cols-3"
            items={[
              { label: 'Machines', value: s.machines.length.toLocaleString(), hint: plural(s.live.length - s.machines.length, 'component'), to: list() },
              {
                label: 'Cars washed, last 30 days',
                value: s.cars30 == null ? '–' : cars(s.cars30),
                hint: s.uncounted ? `${plural(s.uncounted, 'site')} without daily counts` : 'What the use counters count',
              },
              ...(me.rank >= 2 ? [{
                label: 'Parts used, last 90 days',
                value: dash ? currency(dash.parts_cost) : '…',
                hint: dash?.parts_cost_per_car != null ? `${currency(dash.parts_cost_per_car * 1000)} per 1,000 cars` : 'Net of returns',
                to: `${BASE}/reports`,
              }] : []),
            ]}
          />

          {!loc && <BySite eq={eq} />}
          {loc && <ZoneByZone site={loc} rows={s.machines} areas={eq.areas} list={list} />}
          {s.types.length > 0 && <ByType types={s.types} list={list} />}
        </>
      )}
    </div>
  )
}

function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{children}</h2>
      {action}
    </div>
  )
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

function BySite({ eq }: { eq: EquipmentList }) {
  const rows = useMemo(() => {
    const live = eq.rows.filter((r) => r.status !== 'retired')
    return eq.sites.map((site) => {
      const here = live.filter((r) => r.location_id === site.id)
      const machines = here.filter((r) => !r.parent_id)
      return {
        ...site,
        machines: machines.length,
        down: here.filter(isDown).length,
        wos: here.reduce((n, r) => n + r.open_wos, 0),
        stickers: machines.filter(needsSticker).length,
      }
    }).filter((x) => x.machines > 0).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [eq])
  if (!rows.length) return null
  const at = (id: string, extra: Record<string, string> = {}) => `${EQUIPMENT_BASE}?${new URLSearchParams({ site: id, ...extra })}`
  return (
    <section>
      <SectionTitle>By site</SectionTitle>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="px-3 py-2 font-semibold">Site</th>
              <th className="px-3 py-2 text-right font-semibold">Machines</th>
              <th className="px-3 py-2 text-right font-semibold">Down</th>
              <th className="px-3 py-2 text-right font-semibold">Open work orders</th>
              <th className="px-3 py-2 text-right font-semibold">Stickers to print</th>
              <th className="px-3 py-2 text-right font-semibold">Cars, 30 days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border tabular-nums">
            {rows.map((x) => (
              <tr key={x.id} className="hover:bg-content">
                <td className="whitespace-nowrap px-3 py-2"><Link to={`${BASE}?site=${x.id}`} className="font-medium text-ink hover:underline">{x.name}</Link></td>
                <td className="px-3 py-2 text-right"><Num n={x.machines} to={at(x.id)} /></td>
                <td className="px-3 py-2 text-right"><Num n={x.down} to={at(x.id, { status: 'down', level: 'all' })} tone="danger" /></td>
                <td className="px-3 py-2 text-right"><Num n={x.wos} to={at(x.id, { wo: 'open', level: 'all' })} tone="warn" /></td>
                <td className="px-3 py-2 text-right"><Num n={x.stickers} to={at(x.id, { sticker: 'needs' })} /></td>
                <td className="px-3 py-2 text-right">
                  {x.cars_30d != null ? <span className="text-ink">{cars(x.cars_30d)}</span> : <span className="text-ink-subtle" title="No daily car counts for this site">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const PER_CARD = 8

// One site's machines, zone by zone in tunnel order, like IT's area by area.
function ZoneByZone({ site, rows, areas, list }: { site: string; rows: EquipmentRow[]; areas: MiArea[]; list: (extra?: Record<string, string>) => string }) {
  const groups = useMemo(() => {
    const zones = areas.filter((a) => a.site_id === site).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const out = zones.map((z) => ({ id: z.id, name: z.name, items: rows.filter((r) => r.area_id === z.id) }))
    const known = new Set(zones.map((z) => z.id))
    const loose = rows.filter((r) => !r.area_id || !known.has(r.area_id))
    if (loose.length) out.push({ id: '', name: 'No zone set', items: loose })
    return out.filter((g) => g.items.length)
  }, [site, rows, areas])
  if (!groups.length) return null
  return (
    <section>
      <SectionTitle action={<Link to={`${BASE}/tunnel?site=${site}`} className="text-xs font-medium text-accent hover:underline">Tunnel diagram</Link>}>Zone by zone</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => {
          const down = g.items.filter(isDown).length
          return (
            <div key={g.id || 'none'} className="rounded-md border border-border bg-card">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h3 className="text-sm font-semibold text-ink">{g.name}</h3>
                <span className="text-xs tabular-nums text-ink-muted">
                  {g.items.length}
                  {down > 0 && <span className="ml-1.5 text-danger">{down} down</span>}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {g.items.slice(0, PER_CARD).map((r) => (
                  <li key={r.id}>
                    <Link to={`${EQUIPMENT_BASE}/${r.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-content">
                      <span className="min-w-0 flex-1 truncate text-ink">{shortName(r.name)}</span>
                      {r.status !== 'online' && <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].short}</Badge>}
                      {r.tag && <span className="shrink-0 font-mono text-[11px] text-ink-subtle">{r.tag}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
              {g.items.length > PER_CARD && (
                <Link to={list({ zone: g.id ? g.name : '-' })} className="block border-t border-border px-3 py-2 text-xs font-medium text-accent hover:underline">
                  All {g.items.length} in {g.name}
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const TYPES_SHOWN = 12

function ByType({ types, list }: { types: Array<[string, { n: number; down: number }]>; list: (extra?: Record<string, string>) => string }) {
  const [all, setAll] = useState(false)
  const shown = all ? types : types.slice(0, TYPES_SHOWN)
  return (
    <section>
      <SectionTitle>By type</SectionTitle>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map(([name, v]) => {
          const Icon = typeIcon(name)
          return (
            <Link key={name} to={list(name === 'No type' ? {} : { type: name })}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-sm transition hover:border-border-strong hover:bg-content/40">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent/15 text-accent"><Icon className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate text-ink">{name}</span>
              {v.down > 0 && <Badge tone="danger">{v.down} down</Badge>}
              <span className="tabular-nums font-semibold text-ink">{v.n}</span>
            </Link>
          )
        })}
      </div>
      {types.length > TYPES_SHOWN && (
        <button type="button" onClick={() => setAll((x) => !x)} className="mt-2 text-xs font-medium text-accent hover:underline">
          {all ? 'Show fewer' : `Show all ${types.length} types`}
        </button>
      )}
    </section>
  )
}

// A picture for each kind of machine, from words in its type.
function typeIcon(type: string): LucideIcon {
  const t = type.toLowerCase()
  if (/air ?comp|compressor|vacuum|vac\b/.test(t)) return Wind
  if (/blower|dryer|fan/.test(t)) return Fan
  if (/brush|wrap|boss|mitter|curtain|van high/.test(t)) return Brush
  if (/chain|conveyor|roller|belt/.test(t)) return Link2
  if (/eye|sensor|truck bed|camera/.test(t)) return ScanEye
  if (/prep|gun|bug/.test(t)) return SprayCan
  if (/blaster|pump|pressure|motor/.test(t)) return Gauge
  if (/rinse|r\.?o\.?\b|soft|water|hydra|chem|presoak|shine|wax|foam/.test(t)) return Droplets
  return Cog
}
