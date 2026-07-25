import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import type { AskChoice } from '@/lib/queries/askOperator'
import { cn } from '@/lib/utils'

// The Claude-style picker: the assistant offers a few options plus an optional
// free-text "Other", and the user's pick becomes their next message. Disabled
// once answered so an old turn's options can't be re-fired.
export function ChoicePicker({
  options,
  allowCustom,
  answered,
  onPick,
}: {
  options: AskChoice[]
  allowCustom: boolean
  answered: boolean
  onPick: (text: string) => void
}) {
  const [custom, setCustom] = useState('')
  const [customOpen, setCustomOpen] = useState(false)

  return (
    <div className={cn('mt-1 space-y-2', answered && 'pointer-events-none opacity-60')}>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            disabled={answered}
            onClick={() => onPick(o.label)}
            className="group flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md hover:shadow-accent/5 disabled:hover:translate-y-0 disabled:hover:shadow-none sm:min-w-[9rem]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-ink">{o.label}</span>
              {o.hint && <span className="mt-0.5 block text-[12px] text-ink-muted">{o.hint}</span>}
            </span>
            <ArrowRight className="size-4 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
        ))}
      </div>

      {allowCustom && !answered && (
        <div>
          {customOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (custom.trim()) onPick(custom.trim())
              }}
              className="flex items-center gap-2 rounded-2xl border border-border bg-card py-1.5 pl-4 pr-1.5 focus-within:border-accent/60"
            >
              <input
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Something else…"
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-subtle"
              />
              <button
                type="submit"
                disabled={!custom.trim()}
                className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
                aria-label="Send"
              >
                <ArrowRight className="size-4" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCustomOpen(true)}
              className="rounded-2xl border border-dashed border-border px-3.5 py-2 text-[13px] text-ink-muted transition hover:border-accent/50 hover:text-ink"
            >
              Something else…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
