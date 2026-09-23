import { useEffect, useMemo, useState } from 'react'
import { Camera, Check, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { siteAuditPhotos } from '@/lib/queries/opsSuite'
import type {
  SiteAuditSchema,
  SiteAuditAnswers,
  SiteAuditSection,
  SiteAuditItem,
} from './siteAuditSchema'
import { emptyAnswersFor } from './siteAuditSchema'

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
  accountId,
  schema,
  initialAnswers,
  onSubmit,
  submitting,
}: {
  accountId: string
  schema: SiteAuditSchema
  initialAnswers?: SiteAuditAnswers
  onSubmit: (answers: SiteAuditAnswers) => void | Promise<void>
  submitting?: boolean
}) {
  const [answers, setAnswers] = useState<SiteAuditAnswers>(
    initialAnswers ?? emptyAnswersFor(schema),
  )
  // Groups this audit's photos in storage before the audit row exists; the
  // storage paths are kept on each item's answer and saved with the audit.
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
                  accountId={accountId}
                  draftId={draftId}
                  value={(answers[item.id] as Record<string, unknown> | undefined) ?? {}}
                  onStatus={(v) => setItem(item.id, { value: v })}
                  onPhotosChange={(next) => setItem(item.id, { photos: next })}
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
  accountId,
  draftId,
  value,
  onStatus,
  onPhotosChange,
}: {
  item: SiteAuditItem
  accountId: string
  draftId: string
  value: Record<string, unknown>
  onStatus: (v: string | null) => void
  onPhotosChange: (photos: string[]) => void
}) {
  const current = (value.value as string | null | undefined) ?? null
  const photos = (value.photos as string[] | undefined) ?? []
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-semibold text-ink">{item.label}</p>
        {item.helpText && <p className="mt-0.5 text-sm text-ink-muted">{item.helpText}</p>}
        <div className="mt-2">
          <ItemPhotos accountId={accountId} draftId={draftId} itemId={item.id} photos={photos} onChange={onPhotosChange} />
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

// Photo attach + thumbnail strip for one item. Uploads immediately to the
// site-audit-photos bucket and keeps the storage paths on the answer, so large
// phone photos never hit the old base64-in-DB size ceiling.
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    for (const p of photos) {
      if (urls[p]) continue
      siteAuditPhotos.signedUrl(p).then((u) => { if (alive && u) setUrls((prev) => ({ ...prev, [p]: u })) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos])

  const pick = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setError(null)
    const added: string[] = []
    for (const f of Array.from(files)) {
      const { path, error: upErr } = await siteAuditPhotos.upload(accountId, draftId, itemId, f)
      if (upErr) { setError(upErr.message); break }
      if (path) added.push(path)
    }
    if (added.length) onChange([...photos, ...added])
    setBusy(false)
  }

  const remove = async (p: string) => {
    await siteAuditPhotos.remove(p)
    onChange(photos.filter((x) => x !== p))
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p} className="relative size-16 overflow-hidden rounded-md border border-border bg-content">
            {urls[p]
              ? <img src={urls[p]} alt="Audit photo" className="size-full object-cover" />
              : <div className="size-full animate-pulse bg-content" />}
            <button
              type="button"
              onClick={() => void remove(p)}
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
      {error && <p className="text-xs text-danger">Could not upload a photo: {error}</p>}
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
      return <p className="text-sm italic text-ink-muted">Attach photos to individual items above.</p>
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
