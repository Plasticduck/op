import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, ScanLine, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { mi, type HomeData } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { useMi } from './context'
import { day, errText, qty } from './format'
import { refreshSnapshot } from './offline'
import { Card, ErrorNote, Loading, Muted, Thumb } from './ui'

const BASE = '/app/maintenance-inventory'

export default function HomeTab() {
  const { openScan } = useMi()
  const [d, setD] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await mi.home())
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => {
    void load()
    void refreshSnapshot()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  const todo = d?.to_do
  const tasks = todo ? [
    { n: todo.transfers_to_approve, label: 'transfers to approve', to: `${BASE}/transfers` },
    { n: todo.transfers_to_ship, label: 'transfers to ship', to: `${BASE}/transfers` },
    { n: todo.transfers_to_receive, label: 'transfers arriving', to: `${BASE}/transfers` },
    { n: todo.counts_open, label: 'counts open', to: `${BASE}/counts` },
    { n: todo.counts_to_review, label: 'counts to review', to: `${BASE}/counts` },
    { n: todo.pos_to_approve, label: 'POs to approve', to: `${BASE}/pos` },
    { n: todo.pos_to_receive, label: 'POs to receive', to: `${BASE}/pos` },
    { n: todo.part_requests, label: 'part requests', to: `${BASE}/parts?requests=1` },
  ].filter((t) => t.n > 0) : []

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => { primeScanSound(); openScan() }}
        className="flex h-28 w-full items-center justify-center gap-3 rounded-xl bg-accent text-2xl font-semibold text-white shadow-sm transition hover:bg-accent-hover active:scale-[0.99]"
      >
        <ScanLine className="size-8" /> Scan
      </button>

      {error && <ErrorNote>{error}</ErrorNote>}
      {!d && !error && <Loading />}

      {d && d.handoffs.length > 0 && (
        <Card title="Waiting on you">
          {d.handoffs.map((h) => (
            <Link key={h.id} to={`${BASE}/tools/${h.id}`} className="flex min-h-12 w-full items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="text-ink">{h.from ?? 'Someone'} is handing you <b>{h.name}</b></span>
              <ChevronRight className="size-4 text-ink-subtle" />
            </Link>
          ))}
        </Card>
      )}

      {tasks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tasks.map((t) => (
            <Link key={t.label} to={t.to} className="rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-content">
              <span className="tabular-nums text-accent">{t.n}</span> {t.label}
            </Link>
          ))}
        </div>
      )}

      {d && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="My tools" actions={<Link to={`${BASE}/tools`} className="text-xs text-accent hover:underline">All tools</Link>}>
            {d.my_tools.length === 0 ? <Muted>You don't have any checked out.</Muted> : d.my_tools.map((t) => (
              <Link key={t.id} to={`${BASE}/tools/${t.id}`} className="flex min-h-11 items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <span className="truncate text-ink">{t.name}</span>
                {t.overdue ? <Badge tone="danger">Overdue</Badge> : t.due_at ? <span className="shrink-0 text-xs text-ink-muted">Due {day(t.due_at)}</span> : null}
              </Link>
            ))}
          </Card>

          <Card title="My open work orders" actions={<Link to={`${BASE}/work-orders`} className="text-xs text-accent hover:underline">All</Link>}>
            {d.my_work_orders.length === 0 ? <Muted>Nothing assigned to you or opened by you.</Muted> : d.my_work_orders.map((w) => (
              <Link key={w.id} to={`${BASE}/work-orders/${w.id}`} className="block min-h-11 border-t border-border py-2 text-sm first:border-t-0">
                <div className="truncate text-ink">#{w.number} {w.title}</div>
                <div className="truncate text-xs text-ink-muted">{w.site_name}{w.asset_name ? `, ${w.asset_name}` : ''}</div>
              </Link>
            ))}
          </Card>

          <Card title={<span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4 text-warn" /> Low stock at my sites{d.low_stock_total > d.low_stock.length ? ` (${d.low_stock_total})` : ''}</span>}
            actions={<Link to={`${BASE}/parts?filter=low`} className="text-xs text-accent hover:underline">All</Link>}>
            {d.low_stock.length === 0 ? <Muted>Nothing's low.</Muted> : d.low_stock.map((s) => (
              <Link key={`${s.part_id}${s.location_id}`} to={`${BASE}/parts/${s.part_id}`} className="flex min-h-11 items-center gap-2 border-t border-border py-2 text-sm first:border-t-0">
                <Thumb path={s.photo_path} className="size-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-ink">{s.part_name}</div>
                  <div className="truncate text-xs text-ink-muted">{s.location_name}: {qty(s.available)} free{s.min_qty != null ? `, min ${qty(s.min_qty)}` : ''}</div>
                </div>
                {s.is_critical && <Badge tone="danger">Critical</Badge>}
              </Link>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
