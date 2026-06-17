import { useEffect, useState } from 'react'
import { ChevronDown, Gauge } from 'lucide-react'
import { computeScorecard, type Scorecard } from '@/lib/scorecard'
import { cn } from '@/lib/utils'

// Letter-grade site scorecard for the owner/manager dashboard. The letter is
// the headline; expanding the card shows the five weighted factors with bars.

function gradeColor(letter: string): { text: string; bg: string; bar: string } {
  const head = letter[0]
  if (head === 'A') return { text: 'text-ok', bg: 'bg-ok-soft', bar: 'bg-ok' }
  if (head === 'B') return { text: 'text-accent', bg: 'bg-accent-soft', bar: 'bg-accent' }
  if (head === 'C') return { text: 'text-warn', bg: 'bg-warn-soft', bar: 'bg-warn' }
  return { text: 'text-danger', bg: 'bg-danger-soft', bar: 'bg-danger' }
}

export function SiteScorecard({ locationId, locationName }: { locationId: string; locationName: string }) {
  const [card, setCard] = useState<Scorecard | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setCard(null)
    void computeScorecard(locationId).then((c) => { if (alive) setCard(c) })
    return () => { alive = false }
  }, [locationId])

  if (!card) {
    return (
      <section className="flex items-center gap-3 rounded-md border border-border bg-card p-4">
        <span className="size-14 animate-pulse rounded-xl bg-content" />
        <div className="flex-1">
          <div className="h-4 w-32 animate-pulse rounded bg-content" />
          <div className="mt-2 h-3 w-48 animate-pulse rounded bg-content" />
        </div>
      </section>
    )
  }

  const color = gradeColor(card.letter)

  return (
    <section className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 p-4 text-left"
      >
        <span className={cn('grid size-14 shrink-0 place-items-center rounded-xl text-2xl font-bold', color.bg, color.text)}>
          {card.letter}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Gauge className="size-4 text-ink-muted" /> Site Scorecard
          </div>
          <p className="truncate text-xs text-ink-muted">
            {locationName} scores <span className={cn('font-semibold', color.text)}>{card.total}/100</span> across work orders, assets, checklists, closeouts, and parts.
          </p>
        </div>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-subtle transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3">
          <div className="flex flex-col gap-2.5">
            {card.factors.map((f) => {
              const fc = gradeColor(f.score >= 90 ? 'A' : f.score >= 80 ? 'B' : f.score >= 70 ? 'C' : 'F')
              return (
                <div key={f.key}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium text-ink">{f.label} <span className="text-ink-subtle">({f.weight}%)</span></span>
                    <span className={cn('tabular font-semibold', fc.text)}>{Math.round(f.score)}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-content">
                    <div className={cn('h-full rounded-full', fc.bar)} style={{ width: `${f.score}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-subtle">{f.detail}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
