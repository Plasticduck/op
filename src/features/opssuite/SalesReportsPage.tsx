import { ChartNoAxesCombined } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

export default function SalesReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales Reports"
        subtitle="Sales performance across your locations."
      />
      <EmptyState
        icon={ChartNoAxesCombined}
        title="Sales reports coming soon"
        description="Sales reporting will live here."
      />
    </div>
  )
}
