import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Donut, StatTile } from '@/components/data/Charts'
import { Wos } from '@/components/ui/Wos'
import { reporting } from '@/lib/queries/reporting'
import { CRITICALITY_TONE, STATUS_LABEL, type AssetCriticality, type AssetStatus } from '@/lib/queries/assets'
import { currency } from '@/lib/format'

type AssetMetric = {
  id: string
  asset_number: number
  name: string
  type: string | null
  status: AssetStatus
  criticality: AssetCriticality
  location: { id: string; name: string } | null
  open_wo: Array<{ count: number }>
  all_wo: Array<{ id: string; status: string; completed_at: string | null; created_at: string }>
}

export function AssetHealthTab() {
  const [rows, setRows] = useState<AssetMetric[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    void reporting.assetsWithMetrics().then(({ data }) => {
      setRows((data as unknown as AssetMetric[]) ?? [])
      setLoading(false)
    })
  }, [])

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-5 animate-spin text-ink-muted" /></div>
  }

  const online = rows.filter((r) => r.status === 'online').length
  const planned = rows.filter((r) => r.status === 'offline_planned').length
  const unplanned = rows.filter((r) => r.status === 'offline_unplanned').length
  const retired = rows.filter((r) => r.status === 'retired').length
  const operating = rows.filter((r) => r.status !== 'retired').length
  const availability = operating > 0 ? Math.round((online / operating) * 1000) / 10 : 0

  // Sort by Open WOs + Unplanned downtime first.
  const problematic = [...rows]
    .map((r) => ({
      ...r,
      openCount: r.open_wo?.[0]?.count ?? 0,
      failures: r.all_wo?.filter((w) => w.status === 'done').length ?? 0,
    }))
    .sort((a, b) => {
      const aProblem = (a.status === 'offline_unplanned' ? 1000 : 0) + a.openCount * 10 + a.failures
      const bProblem = (b.status === 'offline_unplanned' ? 1000 : 0) + b.openCount * 10 + b.failures
      return bProblem - aProblem
    })
    .slice(0, 12)

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="text-sm font-semibold text-accent">Current Status ›</button>
          <span className="text-[11px] text-ink-subtle">Live</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <div>
            <Donut
              segments={[
                { label: 'Online', value: online, color: '#22c55e' },
                { label: 'Offline (Planned)', value: planned, color: '#eab308' },
                { label: 'Offline (Unplanned)', value: unplanned, color: '#ef4444' },
                { label: 'Retired', value: retired, color: '#94a3b8' },
              ]}
              label={availability + '%'}
              sublabel="Availability"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile value={availability + '%'} label="Asset Availability" tone="ok" sublabel="Operating assets online" />
            <StatTile value={online} label="Online" tone="ok" />
            <StatTile value={unplanned} label="Offline (Unplanned)" tone="danger" />
            <StatTile value={planned} label="Offline (Planned)" tone="warn" />
          </div>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4">
        <button type="button" className="mb-3 text-sm font-semibold text-accent">Most Problematic Assets ›</button>
        {problematic.length === 0 ? (
          <p className="text-sm text-ink-muted">No assets yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="bg-content text-left text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Asset Name</th>
                  <th className="px-3 py-2 font-medium">Criticality</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Open <Wos /></th>
                  <th className="px-3 py-2 text-right font-medium">Total <Wos /></th>
                  <th className="px-3 py-2 text-right font-medium">Est. Cost</th>
                </tr>
              </thead>
              <tbody>
                {problematic.map((r) => {
                  const estCost = r.failures * 75 // rough placeholder; pulls from time entries in v2
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-content/50">
                      <td className="px-3 py-2 font-medium text-ink">#{String(r.asset_number).padStart(2, '0')} . {r.name}</td>
                      <td className="px-3 py-2"><Badge tone={CRITICALITY_TONE[r.criticality]}>{r.criticality}</Badge></td>
                      <td className="px-3 py-2 text-ink-muted">{r.location?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">{r.type ?? '—'}</td>
                      <td className="px-3 py-2"><Badge tone={r.status === 'online' ? 'ok' : r.status === 'offline_unplanned' ? 'danger' : 'warn'}>{STATUS_LABEL[r.status]}</Badge></td>
                      <td className={'px-3 py-2 text-right tabular ' + (r.openCount > 0 ? 'font-semibold text-warn' : 'text-ink-muted')}>{r.openCount}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-muted">{r.all_wo?.length ?? 0}</td>
                      <td className="px-3 py-2 text-right tabular text-ink-muted">{estCost > 0 ? currency(estCost) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
