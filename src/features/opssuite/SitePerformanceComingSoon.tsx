import { Activity } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

// Placeholder while the live Site Performance feed is paused. The full
// implementation lives in SitePerformancePage.tsx; repoint the route back to it
// to restore.
export default function SitePerformanceComingSoon() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Site Performance" subtitle="Live site operations metrics." />
      <EmptyState icon={Activity} title="Coming soon" description="Site performance analytics are on the way." />
    </div>
  )
}
