import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { MonitorSmartphone } from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { useVisibleNavItems } from '@/components/layout/Sidebar'
import { useAuth } from '@/lib/auth'
import { permRole } from '@/lib/rbac'
import { itInventory, type ItOverview } from '@/lib/queries/itInventory'

// IT Inventory on the main dashboard (spec I): the org tiles on All sites and
// the Today strip on a site's dashboard. Same StatCard tiles as the rest of
// the dashboard, each opening the matching list. Shown to people who can open
// IT Inventory, once the company has equipment in it.

export function ItDashboardTiles({ locationId }: { locationId: string | null }) {
  const { profile } = useAuth()
  const nav = useVisibleNavItems(permRole(profile?.role ?? 'employee', profile?.role_category ?? null))
  const canOpen = nav.some((i) => i.to === '/app/it-inventory')
  const [data, setData] = useState<ItOverview | null>(null)

  useEffect(() => {
    if (!canOpen) return
    let alive = true
    void itInventory.overview(locationId, format(new Date(), 'yyyy-MM-dd')).then((r) => { if (alive) setData(r.data) })
    return () => { alive = false }
  }, [canOpen, locationId])

  if (!canOpen || !data || data.total === 0) return null
  const site = locationId ?? 'all'
  const list = (extra: Record<string, string>) => `/app/it-inventory?${new URLSearchParams({ site, ...extra })}`
  const a = data.attention
  return (
    <section>
      <header className="mb-2 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <MonitorSmartphone className="size-4 text-ink-muted" />
          IT equipment
        </h2>
        <Link to={`/app/it-inventory/overview?site=${site}`} className="text-xs font-medium text-accent hover:underline">Overview</Link>
      </header>
      <StatCardRow
        className="grid-cols-2 lg:grid-cols-4"
        items={[
          { label: 'Offline now', value: a.offline, to: list({ health: 'offline' }) },
          { label: 'Out for repair', value: a.repair, to: list({ status: 'name:Out for Repair' }) },
          {
            label: 'Coming due',
            value: a.warranty + a.renewals,
            hint: 'Warranties and renewals, next 60 days',
            to: `/app/it-inventory/overview?site=${site}`,
          },
          { label: 'Low supplies', value: a.low_stock, to: `/app/it-inventory/supplies?${new URLSearchParams({ site, low: '1' })}` },
        ]}
      />
    </section>
  )
}
