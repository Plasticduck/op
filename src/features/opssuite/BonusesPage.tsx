import { BadgeDollarSign } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

// Admin-only shell for now. The data model and workflow are still to be defined;
// the section exists so it can be built out without re-wiring nav and routing.
export default function BonusesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Bonuses" subtitle="Admin-only bonus tracking." />
      <EmptyState
        icon={BadgeDollarSign}
        title="Bonuses coming soon"
        description="This section is visible to admins only. Tell us what you want to track here and we'll build it out."
      />
    </div>
  )
}
