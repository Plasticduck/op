import { useCallback, useEffect, useMemo, useState } from 'react'
import { subDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { WorkOrdersTab } from './tabs/WorkOrdersTab'
import { AssetHealthTab } from './tabs/AssetHealthTab'
import { ReportingDetailsTab } from './tabs/ReportingDetailsTab'
import { RecentActivityTab } from './tabs/RecentActivityTab'
import { ExportDataTab } from './tabs/ExportDataTab'
import { LibraryTab } from './tabs/LibraryTab'

type Tab = 'work-orders' | 'asset-health' | 'details' | 'recent-activity' | 'export' | 'library'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'work-orders', label: 'Work Orders' },
  { key: 'asset-health', label: 'Asset Health' },
  { key: 'details', label: 'Reporting Details' },
  { key: 'recent-activity', label: 'Recent Activity' },
  { key: 'library', label: 'Report Library' },
  { key: 'export', label: 'Export Data' },
]

const PRESETS: Array<{ key: string; label: string; days: number }> = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '60d', label: 'Last 60 days', days: 60 },
  { key: '90d', label: 'Last 90 days', days: 90 },
]

export default function ReportingPage() {
  const [tab, setTab] = useState<Tab>('work-orders')
  const [days, setDays] = useState(60)

  // Memoized range so child tabs only re-fetch when the range actually changes.
  const range = useMemo(() => {
    const to = new Date()
    const from = subDays(to, days)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [days])

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Reporting"
        subtitle="Work order, asset health, and operations insights."
      />

      {/* Date range presets */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] uppercase tracking-wider text-ink-subtle">Range:</span>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setDays(p.days)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition',
              days === p.days ? 'bg-accent text-white' : 'bg-content text-ink-muted hover:text-ink',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition',
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <TabContent tab={tab} range={range} />
    </div>
  )
}

function TabContent({ tab, range }: { tab: Tab; range: { from: string; to: string } }) {
  if (tab === 'work-orders') return <WorkOrdersTab range={range} />
  if (tab === 'asset-health') return <AssetHealthTab />
  if (tab === 'details') return <ReportingDetailsTab range={range} />
  if (tab === 'recent-activity') return <RecentActivityTab range={range} />
  if (tab === 'library') return <LibraryTab />
  return <ExportDataTab />
}

// no-op so TS doesn't flag the destructure of `range` as unused when a tab
// doesn't need it (AssetHealthTab + ExportDataTab use snapshots).
void useCallback; void useEffect
