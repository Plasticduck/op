import { useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type {
  SiteReviewSchema,
  SiteReviewAnswers,
  SiteReviewSection,
  SiteReviewItem,
} from './siteReviewSchema'
import { emptyAnswersFor } from './siteReviewSchema'

export default function SiteReviewForm({
  schema,
  initialAnswers,
  onSubmit,
  submitting,
}: {
  schema: SiteReviewSchema
  initialAnswers?: SiteReviewAnswers
  onSubmit: (answers: SiteReviewAnswers) => void | Promise<void>
  submitting?: boolean
}) {
  const [answers, setAnswers] = useState<SiteReviewAnswers>(
    initialAnswers ?? emptyAnswersFor(schema),
  )

  const setItem = (itemId: string, patch: Record<string, unknown>) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), ...patch },
    }))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit(answers)
      }}
      className="flex flex-col gap-4"
    >
      {schema.sections.map((section: SiteReviewSection) => (
        <section key={section.id} className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 text-base font-semibold text-ink">{section.title}</h3>
          <div className="flex flex-col gap-3">
            {section.items.map((item: SiteReviewItem) => (
              <Field key={item.id} label={item.label}>
                {(id) => renderControl(id, item, (answers[item.id] as Record<string, unknown> | undefined) ?? {}, setItem)}
              </Field>
            ))}
          </div>
        </section>
      ))}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit review'}
        </Button>
      </div>
    </form>
  )
}

function renderControl(
  id: string,
  item: SiteReviewItem,
  value: Record<string, unknown>,
  setItem: (itemId: string, patch: Record<string, unknown>) => void,
) {
  switch (item.type) {
    case 'pass_fail': {
      const current = (value.value as 'pass' | 'fail' | null | undefined) ?? null
      const comments = (value.comments as string | undefined) ?? ''
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setItem(item.id, { value: current === 'pass' ? null : 'pass' })}
              className={cn(
                'h-10 rounded-md border px-4 text-sm font-medium transition-colors',
                current === 'pass'
                  ? 'border-ok bg-ok text-white'
                  : 'border-border bg-card text-ink-muted hover:bg-content',
              )}
            >
              Pass
            </button>
            <button
              type="button"
              onClick={() => setItem(item.id, { value: current === 'fail' ? null : 'fail' })}
              className={cn(
                'h-10 rounded-md border px-4 text-sm font-medium transition-colors',
                current === 'fail'
                  ? 'border-danger bg-danger text-white'
                  : 'border-border bg-card text-ink-muted hover:bg-content',
              )}
            >
              Fail
            </button>
          </div>
          <Input
            id={id}
            value={comments}
            onChange={(e) => setItem(item.id, { comments: e.target.value })}
            placeholder="Comments"
            className="sm:flex-1"
          />
        </div>
      )
    }
    case 'text': {
      const text = (value.value as string | undefined) ?? ''
      return (
        <Input
          id={id}
          value={text}
          onChange={(e) => setItem(item.id, { value: e.target.value })}
        />
      )
    }
    case 'number': {
      const num = (value.value as string | number | undefined) ?? ''
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          value={num as string | number}
          onChange={(e) => setItem(item.id, { value: e.target.value })}
        />
      )
    }
    case 'attachment': {
      return (
        <p className="text-sm italic text-ink-muted">
          Attach files after saving the review.
        </p>
      )
    }
    case 'comments': {
      const text = (value.value as string | undefined) ?? ''
      return (
        <textarea
          id={id}
          value={text}
          onChange={(e) => setItem(item.id, { value: e.target.value })}
          rows={3}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
        />
      )
    }
    default:
      return null
  }
}
