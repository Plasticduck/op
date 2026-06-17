import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export function RouteStub({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          Built in {phase}.
        </p>
      </div>
      <EmptyState
        icon={Construction}
        title={`${title} — coming in ${phase}`}
        description="This route is wired up so navigation works. The real page will be implemented as part of its phase per the project blueprint."
      />
    </div>
  )
}
