import { Signpost } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

export default function SignagePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and on-site graphics for your locations."
      />
      <EmptyState
        icon={Signpost}
        title="Signage ordering is coming soon"
        description="This is where teams will build and submit signage orders. The item catalog is still being set up."
      />
    </div>
  )
}
