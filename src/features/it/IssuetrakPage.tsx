import { LifeBuoy, Plug } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'

// Help-desk tracking built on the Issuetrak API. The live integration (ticket
// list, detail, create, status) is wired once the Issuetrak API details and
// credentials are provided. Until then this is the landing page for the section.
export default function IssuetrakPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Issuetrak"
        subtitle="IT help desk. Submit and track support tickets through Issuetrak."
      />
      <EmptyState
        icon={Plug}
        title="Issuetrak not connected yet"
        description="Once the Issuetrak API details are added, tickets will load here: submit, assign, and track issues through to resolved."
      />
      <div className="mx-auto flex max-w-md items-center gap-2 text-xs text-ink-subtle">
        <LifeBuoy className="size-4" />
        Connect Issuetrak to turn this into a live help-desk queue.
      </div>
    </div>
  )
}
