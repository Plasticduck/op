import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { StatCardRow } from '@/components/data/StatCardRow'
import { miEquipment, type EquipmentList } from '@/lib/queries/miEquipment'
import { useMi } from './context'
import { errText } from './format'
import HomeTab from './HomeTab'
import { Card, ErrorNote, Loading, Muted } from './ui'
import { cars, EQUIPMENT_BASE, needsSticker, shortName, STATUS } from './equipment/format'

// The module's front page: the scan button and the day's to-dos (Home), then the
// equipment at a glance: what's down, where, and how hard each site runs.

export default function OverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <HomeTab />
      <EquipmentAtAGlance />
    </div>
  )
}

function EquipmentAtAGlance() {
  const { refs } = useMi()
  const [d, setD] = useState<EquipmentList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      setD(await miEquipment.list())
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  const s = useMemo(() => {
    if (!d) return null
    const live = d.rows.filter((r) => r.status !== 'retired')
    const machines = live.filter((r) => !r.parent_id)
    const down = live.filter((r) => r.status === 'offline_planned' || r.status === 'offline_unplanned')
    const zoneName = new Map(d.areas.map((a) => [a.id, a.name]))
    const bySite = d.sites.map((site) => {
      const here = live.filter((r) => r.location_id === site.id)
      return {
        ...site,
        machines: here.filter((r) => !r.parent_id).length,
        down: here.filter((r) => r.status === 'offline_planned' || r.status === 'offline_unplanned').length,
        wos: here.reduce((n, r) => n + r.open_wos, 0),
        stickers: here.filter(needsSticker).length,
      }
    }).filter((x) => x.machines > 0 || x.cars_30d)
    const zones = new Map<string, { n: number; down: number }>()
    for (const r of machines) {
      const z = r.area_id ? zoneName.get(r.area_id) ?? 'No zone' : 'No zone'
      const v = zones.get(z) ?? { n: 0, down: 0 }
      v.n++
      if (r.status !== 'online') v.down++
      zones.set(z, v)
    }
    return {
      machines: machines.length,
      down,
      wos: live.reduce((n, r) => n + r.open_wos, 0),
      stickers: machines.filter(needsSticker).length,
      bySite,
      zones: [...zones.entries()].sort((a, b) => (a[0] === 'No zone' ? 1 : b[0] === 'No zone' ? -1 : a[0].localeCompare(b[0]))),
    }
  }, [d])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!s || !d) return <Loading />
  const siteName = new Map(refs.sites.map((x) => [x.id, x.name]))

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Equipment</h2>
      <StatCardRow items={[
        { label: 'Machines in service', value: s.machines.toLocaleString(), to: EQUIPMENT_BASE },
        { label: 'Down right now', value: s.down.length.toLocaleString(), to: `${EQUIPMENT_BASE}?status=down&level=all` },
        { label: 'Open work orders on them', value: s.wos.toLocaleString(), to: `${EQUIPMENT_BASE}?wo=open&level=all` },
        { label: 'Machines without a sticker', value: s.stickers.toLocaleString(), to: `${EQUIPMENT_BASE}?sticker=needs` },
      ]} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="By site" className="lg:col-span-2">
          {s.bySite.length === 0 ? <Muted>No equipment at your sites yet.</Muted> : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                  <tr>
                    <th className="px-4 py-1.5 font-medium">Site</th>
                    <th className="px-2 py-1.5 text-right font-medium">Machines</th>
                    <th className="px-2 py-1.5 text-right font-medium">Down</th>
                    <th className="px-2 py-1.5 text-right font-medium">Open WOs</th>
                    <th className="hidden px-2 py-1.5 text-right font-medium sm:table-cell">No sticker</th>
                    <th className="px-4 py-1.5 text-right font-medium">Cars, 30 days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.bySite.map((x) => (
                    <tr key={x.id} className="hover:bg-content">
                      <td className="px-4 py-2"><Link to={`${EQUIPMENT_BASE}?site=${x.id}`} className="text-accent hover:underline">{x.name}</Link></td>
                      <td className="px-2 py-2 text-right tabular-nums">{x.machines}</td>
                      <td className={x.down ? 'px-2 py-2 text-right font-medium tabular-nums text-danger' : 'px-2 py-2 text-right tabular-nums text-ink-subtle'}>{x.down}</td>
                      <td className={x.wos ? 'px-2 py-2 text-right font-medium tabular-nums text-warn' : 'px-2 py-2 text-right tabular-nums text-ink-subtle'}>{x.wos}</td>
                      <td className="hidden px-2 py-2 text-right tabular-nums text-ink-muted sm:table-cell">{x.stickers}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-muted">{x.cars_30d != null ? cars(x.cars_30d) : <span className="text-ink-subtle" title="No daily car counts for this site">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Down right now">
          {s.down.length === 0 ? <Muted>Everything is running.</Muted> : s.down.slice(0, 12).map((r) => (
            <Link key={r.id} to={`${EQUIPMENT_BASE}/${r.id}`} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="min-w-0">
                <span className="block truncate text-ink">{shortName(r.name)}</span>
                <span className="block truncate text-xs text-ink-muted">{siteName.get(r.location_id)}</span>
              </span>
              <Badge tone={STATUS[r.status].tone} className="shrink-0">{STATUS[r.status].short}</Badge>
            </Link>
          ))}
          {s.down.length > 12 && <Link to={`${EQUIPMENT_BASE}?status=down&level=all`} className="mt-2 block text-xs text-accent hover:underline">All {s.down.length}</Link>}
        </Card>
      </div>

      {s.zones.length > 1 && (
        <Card title="Machines by zone">
          <div className="flex flex-wrap gap-2">
            {s.zones.map(([z, v]) => (
              <Link key={z} to={`${EQUIPMENT_BASE}?zone=${encodeURIComponent(z === 'No zone' ? '-' : z)}`}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-ink hover:bg-content">
                {z} <span className="tabular-nums text-ink-muted">{v.n}</span>{v.down > 0 && <span className="ml-1 tabular-nums text-danger">({v.down} down)</span>}
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
