import { useState } from 'react'
import { Camera, Check, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type {
  SiteAuditSchema,
  SiteAuditAnswers,
  SiteAuditSection,
  SiteAuditItem,
} from './siteAuditSchema'
import { emptyAnswersFor } from './siteAuditSchema'

// Staged photos per item id, uploaded after the audit is created.
export type SiteAuditPhotos = Record<string, File[]>

// Pass / warn / fail — green check, yellow exclamation, red X.
const STATUS = [
  { value: 'pass', color: '#16a34a', label: 'Pass', icon: <Check className="size-5" strokeWidth={3} /> },
  {
    value: 'warn',
    color: '#ca8a04',
    label: 'Needs attention',
    icon: <span className="text-lg font-extrabold leading-none">!</span>,
  },
  { value: 'fail', color: '#dc2626', label: 'Fail', icon: <X className="size-5" strokeWidth={3} /> },
] as const

export default function SiteAuditForm({
  schema,
  initialAnswers,
  onSubmit,
  submitting,
}: {
  schema: SiteAuditSchema
  initialAnswers?: SiteAuditAnswers
  onSubmit: (answers: SiteAuditAnswers, photos: SiteAuditPhotos) => void | Promise<void>
  submitting?: boolean
}) {
  const [answers, setAnswers] = useState<SiteAuditAnswers>(
    initialAnswers ?? emptyAnswersFor(schema),
  )
  const [photos, setPhotos] = useState<SiteAuditPhotos>({})

  const setItem = (itemId: string, patch: Record<string, unknown>) => {
    setAnswers((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? {}), ...patch },
    }))
  }

  const addPhotos = (itemId: string, files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length) setPhotos((prev) => ({ ...prev, [itemId]: [...(prev[itemId] ?? []), ...list] }))
  }
  const removePhoto = (itemId: string, i: number) =>
    setPhotos((prev) => ({ ...prev, [itemId]: (prev[itemId] ?? []).filter((_, idx) => idx !== i) }))

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit(answers, photos)
      }}
      className="flex flex-col gap-4"
    >
      {schema.sections.map((section: SiteAuditSection) => (
        <section key={section.id} className="rounded-md border border-border bg-card p-4">
          <h3 className="mb-3 border-b border-border pb-2 text-base font-semibold text-ink">
            {section.title}
          </h3>
          <div className="flex flex-col">
            {section.items.map((item: SiteAuditItem) =>
              item.type === 'pass_fail' ? (
                <PassFailRow
                  key={item.id}
                  item={item}
                  value={(answers[item.id] as Record<string, unknown> | undefined) ?? {}}
                  photos={photos[item.id] ?? []}
                  onStatus={(v) => setItem(item.id, { value: v })}
                  onAddPhotos={(files) => addPhotos(item.id, files)}
                  onRemovePhoto={(i) => removePhoto(item.id, i)}
                />
              ) : (
                <div key={item.id} className="border-b border-border py-3 last:border-b-0">
                  <Field label={item.label}>
                    {(id) => (
                      <div className="flex flex-col gap-1">
                        {item.helpText && <p className="text-xs text-ink-muted">{item.helpText}</p>}
                        {renderControl(
                          id,
                          item,
                          (answers[item.id] as Record<string, unknown> | undefined) ?? {},
                          setItem,
                        )}
                      </div>
                    )}
                  </Field>
                </div>
              ),
            )}
          </div>
        </section>
      ))}

      <div className="flex justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit audit'}
        </Button>
      </div>
    </form>
  )
}

function PassFailRow({
  item,
  value,
  photos,
  onStatus,
  onAddPhotos,
  onRemovePhoto,
}: {
  item: SiteAuditItem
  value: Record<string, unknown>
  photos: File[]
  onStatus: (v: string | null) => void
  onAddPhotos: (files: FileList | null) => void
  onRemovePhoto: (i: number) => void
}) {
  const current = (value.value as string | null | undefined) ?? null
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{item.label}</p>
        {item.helpText && <p className="mt-0.5 text-sm text-ink-muted">{item.helpText}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-content">
            <Camera className="size-3.5" /> Add Photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                onAddPhotos(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {photos.map((f, i) => (
            <span
              key={`${f.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-full bg-content px-2 py-0.5 text-xs text-ink-muted"
            >
              <span className="max-w-32 truncate">{f.name}</span>
              <button type="button" onClick={() => onRemovePhoto(i)} aria-label="Remove photo">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        {STATUS.map((s) => {
          const selected = current === s.value
          return (
            <button
              key={s.value}
              type="button"
              aria-label={s.label}
              aria-pressed={selected}
              onClick={() => onStatus(selected ? null : s.value)}
              className={cn(
                'grid size-11 place-items-center rounded-md border-2 transition',
                !selected && 'opacity-60 hover:opacity-100',
              )}
              style={{
                borderColor: s.color,
                color: s.color,
                backgroundColor: selected ? `${s.color}22` : 'transparent',
              }}
            >
              {s.icon}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function renderControl(
  id: string,
  item: SiteAuditItem,
  value: Record<string, unknown>,
  setItem: (itemId: string, patch: Record<string, unknown>) => void,
) {
  switch (item.type) {
    case 'text': {
      const text = (value.value as string | undefined) ?? ''
      return (
        <Input id={id} value={text} onChange={(e) => setItem(item.id, { value: e.target.value })} />
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
      return <p className="text-sm italic text-ink-muted">Attach files after saving the audit.</p>
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
