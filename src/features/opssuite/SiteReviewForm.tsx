import { useEffect, useMemo, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { siteReviewPhotos } from '@/lib/queries/opsSuite'
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
  accountId,
}: {
  schema: SiteReviewSchema
  initialAnswers?: SiteReviewAnswers
  onSubmit: (answers: SiteReviewAnswers) => void | Promise<void>
  submitting?: boolean
  accountId: string
}) {
  const [answers, setAnswers] = useState<SiteReviewAnswers>(
    initialAnswers ?? emptyAnswersFor(schema),
  )
  // Stable id used to group this review's uploaded photos in storage before the
  // review row exists.
  const draftId = useMemo(() => crypto.randomUUID(), [])

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
          <div className="flex flex-col gap-4">
            {section.items.map((item: SiteReviewItem) => {
              const value = (answers[item.id] as Record<string, unknown> | undefined) ?? {}
              const photos = (value.photos as string[] | undefined) ?? []
              return (
                <div key={item.id} className="flex flex-col gap-2">
                  <Field label={item.label}>
                    {(id) => renderControl(id, item, value, setItem)}
                  </Field>
                  <ItemPhotos
                    accountId={accountId}
                    draftId={draftId}
                    itemId={item.id}
                    photos={photos}
                    onChange={(next) => setItem(item.id, { photos: next })}
                  />
                </div>
              )
            })}
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

// Photo attach + thumbnail strip for a single review item. Uploads immediately
// to the site-review-photos bucket and keeps the storage paths on the answer.
function ItemPhotos({
  accountId, draftId, itemId, photos, onChange,
}: {
  accountId: string
  draftId: string
  itemId: string
  photos: string[]
  onChange: (photos: string[]) => void
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    for (const p of photos) {
      if (urls[p]) continue
      siteReviewPhotos.signedUrl(p).then((u) => { if (alive && u) setUrls((prev) => ({ ...prev, [p]: u })) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    const added: string[] = []
    for (const f of Array.from(files)) {
      const { path } = await siteReviewPhotos.upload(accountId, draftId, itemId, f)
      if (path) added.push(path)
    }
    if (added.length) onChange([...photos, ...added])
    setBusy(false)
  }

  const remove = async (p: string) => {
    await siteReviewPhotos.remove(p)
    onChange(photos.filter((x) => x !== p))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {photos.map((p) => (
        <div key={p} className="relative size-16 overflow-hidden rounded-md border border-border bg-content">
          {urls[p]
            ? <img src={urls[p]} alt="Review photo" className="size-full object-cover" />
            : <div className="size-full animate-pulse bg-content" />}
          <button
            type="button"
            onClick={() => remove(p)}
            aria-label="Remove photo"
            className="absolute right-0 top-0 grid size-5 place-items-center rounded-bl-md bg-black/60 text-white hover:bg-black/80"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      <label
        className={cn(
          'flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-[11px] font-medium text-ink-muted transition hover:bg-content',
          busy && 'pointer-events-none opacity-50',
        )}
      >
        <Camera className="size-4" />
        {busy ? '…' : 'Photo'}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          disabled={busy}
          onChange={(e) => { void pick(e.target.files); e.target.value = '' }}
        />
      </label>
    </div>
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
        <p className="text-xs text-ink-subtle">Add photos using the button below.</p>
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
