import { useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type {
  MarketResearchSchema,
  MarketResearchAnswers,
  MarketResearchSection,
  MarketResearchItem,
} from './marketResearchSchema'
import { emptyAnswersFor } from './marketResearchSchema'

export default function MarketResearchForm({
  schema,
  initialAnswers,
  onSubmit,
  submitting,
}: {
  schema: MarketResearchSchema
  initialAnswers?: MarketResearchAnswers
  onSubmit: (answers: MarketResearchAnswers) => void | Promise<void>
  submitting?: boolean
}) {
  const [answers, setAnswers] = useState<MarketResearchAnswers>(
    initialAnswers ?? emptyAnswersFor(schema),
  )

  const setItem = (itemId: string, patch: Record<string, unknown>) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...((prev[itemId] as Record<string, unknown> | undefined) ?? {}), ...patch },
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
      {schema.sections.map((section: MarketResearchSection) => (
        <section key={section.id} className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 text-base font-semibold text-ink">{section.title}</h3>
          <div className="flex flex-col gap-3">
            {section.items.map((item: MarketResearchItem) => (
              <Field key={item.id} label={item.label} required={item.required}>
                {(id) => renderControl(id, item, (answers[item.id] as Record<string, unknown> | undefined) ?? {}, setItem)}
              </Field>
            ))}
          </div>
        </section>
      ))}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit research'}
        </Button>
      </div>
    </form>
  )
}

function renderControl(
  id: string,
  item: MarketResearchItem,
  value: Record<string, unknown>,
  setItem: (itemId: string, patch: Record<string, unknown>) => void,
) {
  switch (item.type) {
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
    case 'textarea': {
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
    case 'select': {
      const text = (value.value as string | undefined) ?? ''
      const options = item.options ?? []
      return (
        <Select id={id} value={text} onChange={(e) => setItem(item.id, { value: e.target.value })}>
          <option value="">Select…</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      )
    }
    case 'rating': {
      const min = item.min ?? 1
      const max = item.max ?? 5
      const raw = value.value as number | null | undefined
      const current = typeof raw === 'number' ? raw : min
      const hasValue = typeof raw === 'number'
      return (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={1}
            value={current}
            onChange={(e) => setItem(item.id, { value: Number(e.target.value) })}
            className="w-full"
          />
          <span className="w-12 text-right text-sm tabular-nums text-ink">
            {hasValue ? `${current} / ${max}` : '—'}
          </span>
        </div>
      )
    }
    case 'datetime': {
      const text = (value.value as string | undefined) ?? ''
      return (
        <Input
          id={id}
          type="datetime-local"
          value={text}
          onChange={(e) => setItem(item.id, { value: e.target.value })}
        />
      )
    }
    case 'attachment': {
      return (
        <p className="text-sm italic text-ink-muted">
          Attach files after saving.
        </p>
      )
    }
    default:
      return null
  }
}
