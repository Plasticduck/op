import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export type LocationOption = { id: string; name: string }

export function MultiLocationSelect({
  options,
  value,
  onChange,
}: {
  options: LocationOption[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-1">
      {options.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-ink-muted">No locations yet.</p>
      )}
      {options.map((o) => {
        const checked = value.includes(o.id)
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => toggle(o.id)}
            className={cn(
              'flex items-center justify-between rounded px-2 py-1.5 text-sm',
              checked ? 'bg-accent-soft text-ink' : 'text-ink-muted hover:bg-content',
            )}
          >
            {o.name}
            <span
              className={cn(
                'grid size-4 place-items-center rounded border',
                checked ? 'border-accent bg-accent text-white' : 'border-border',
              )}
            >
              {checked && <Check className="size-3" />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
