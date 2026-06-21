import { useState } from 'react'
import { ChevronRight, Signpost } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { SIGNAGE_CATEGORIES } from './signage/catalog'

export default function SignagePage() {
  const [activeSlug, setActiveSlug] = useState(SIGNAGE_CATEGORIES[0].slug)
  const active =
    SIGNAGE_CATEGORIES.find((c) => c.slug === activeSlug) ?? SIGNAGE_CATEGORIES[0]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and printed products for your locations."
      />

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <nav
          aria-label="Select products"
          className="h-fit overflow-hidden rounded-lg border border-border bg-card"
        >
          <div className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Select Products
          </div>
          <ul className="flex flex-col">
            {SIGNAGE_CATEGORIES.map((c) => {
              const isActive = c.slug === active.slug
              return (
                <li key={c.slug}>
                  <button
                    type="button"
                    onClick={() => setActiveSlug(c.slug)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left text-sm transition last:border-b-0',
                      isActive
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-ink hover:bg-content',
                    )}
                  >
                    {c.name}
                    <ChevronRight
                      className={cn(
                        'size-4 shrink-0',
                        isActive ? 'text-accent' : 'text-ink-subtle',
                      )}
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>

        <EmptyState
          icon={Signpost}
          title={active.name}
          description="Products for this category will appear here. Send the item screenshots for this category and they'll be built out to match."
        />
      </div>
    </div>
  )
}
