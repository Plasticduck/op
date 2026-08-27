import { Megaphone } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

export default function MarketingDashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Marketing Dashboard"
        subtitle="Marketing performance and campaigns at a glance."
      />
      <EmptyState
        icon={Megaphone}
        title="Marketing Dashboard"
        description="Your marketing hub. Tell me what you'd like to track here (campaigns, promotions, social performance, reviews, spend) and I'll build it out."
      />
    </div>
  )
}
