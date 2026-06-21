import { useState } from 'react'
import { ChevronRight, Signpost } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { SIGNAGE_CATEGORIES } from './signage/catalog'

export default function SignagePage() {
  const [activeSlug, setActiveSlug] = useState(SIGNAGE_CATEGORIES[0].slug)
  const [activeItem, setActiveItem] = useState<string | null>(null)
  const active =
    SIGNAGE_CATEGORIES.find((c) => c.slug === activeSlug) ?? SIGNAGE_CATEGORIES[0]

  const selectCategory = (slug: string) => {
    setActiveSlug(slug)
    setActiveItem(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and printed products for your locations."
      />

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Top-level categories */}
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
                    onClick={() => selectCategory(c.slug)}
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

        {/* Options within the selected category */}
        <div className="h-fit overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">{active.name}</h2>
            {active.items.length > 0 && (
              <span className="text-xs text-ink-subtle">
                {active.items.length} options
              </span>
            )}
          </div>

          {active.items.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Signpost}
                title="No options yet"
                description="Send the screenshot for this category and its options will be added here."
              />
            </div>
          ) : (
            <ul className="flex flex-col">
              {active.items.map((item) => {
                const isActive = item === activeItem
                return (
                  <li key={item}>
                    <button
                      type="button"
                      onClick={() => setActiveItem(item)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 border-b border-border px-4 py-3 text-left text-sm transition last:border-b-0',
                        isActive
                          ? 'bg-accent-soft font-medium text-accent'
                          : 'text-ink hover:bg-content',
                      )}
                    >
                      {item}
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
          )}

          {activeItem && (
            <div className="border-t border-border bg-content px-4 py-3 text-xs text-ink-muted">
              Sizes and pricing for {activeItem} come next.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
