import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { dateTime } from '@/lib/format'
import { checklistReview, type ItemComment, type ItemPhoto } from '@/lib/queries/checklistReview'

const PILL = 'inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold'

// Where a day's checklist is: being filled out, waiting on the RM, or archived.
export function StagePill({ status }: { status: string | null }) {
  if (status === 'rm_audit') return <span className={cn(PILL, 'bg-warn-soft text-warn')}>RM Audit</span>
  if (status === 'archived') return <span className={cn(PILL, 'bg-ok-soft text-ok')}>Archived</span>
  return <span className={cn(PILL, 'bg-content text-ink-muted')}>In progress</span>
}

export function LateTag() {
  return <span className={cn(PILL, 'bg-danger-soft text-danger')}>Late</span>
}

// An item's photos as thumbnails that open the full picture. The uploader can
// take theirs back while the checklist is being filled out.
export function ItemPhotos({ photos, canRemove, onRemove, small }: {
  photos: ItemPhoto[]
  canRemove?: (p: ItemPhoto) => boolean
  onRemove?: (p: ItemPhoto) => void
  small?: boolean
}) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [full, setFull] = useState<Record<string, string>>({})
  const key = photos.map((p) => p.path).join('|')
  useEffect(() => {
    let alive = true
    for (const p of photos) {
      void checklistReview.photoUrl(p.path, 240).then((u) => { if (alive && u) setThumbs((prev) => ({ ...prev, [p.path]: u })) })
      void checklistReview.photoUrl(p.path, 1600).then((u) => { if (alive && u) setFull((prev) => ({ ...prev, [p.path]: u })) })
    }
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (photos.length === 0) return null
  const box = small ? 'size-14' : 'size-16 sm:size-20'
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <div key={p.id} className="relative">
          {thumbs[p.path] ? (
            <a href={full[p.path] ?? thumbs[p.path]} target="_blank" rel="noreferrer" className={cn('block overflow-hidden rounded-md border border-border', box)}>
              <img src={thumbs[p.path]} alt={`Photo by ${p.uploaded_by_name ?? 'someone'}`} className="size-full object-cover" />
            </a>
          ) : (
            <div className={cn('animate-pulse rounded-md border border-border bg-content', box)} />
          )}
          {canRemove?.(p) && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p)}
              aria-label="Remove photo"
              className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full border border-border bg-card text-ink-muted shadow-sm hover:text-danger"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

const ROLE_TAG: Record<string, { label: string; cls: string } | undefined> = {
  rm: { label: 'RM', cls: 'bg-accent-soft text-accent' },
  admin: { label: 'Admin', cls: 'bg-accent-soft text-accent' },
}

// The comments on one item, oldest first, with a box to add one.
export function CommentThread({ comments, canAdd, onAdd, canDelete, onDelete, placeholder, autoFocus }: {
  comments: ItemComment[]
  canAdd: boolean
  onAdd: (body: string) => Promise<boolean>
  canDelete?: (c: ItemComment) => boolean
  onDelete?: (c: ItemComment) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(40, el.scrollHeight + 2) + 'px'
  }, [draft])
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const add = async () => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    const ok = await onAdd(body)
    setBusy(false)
    if (ok) setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      {comments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {comments.map((c) => {
            const tag = ROLE_TAG[c.author_role]
            return (
              <li key={c.id} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span className="font-medium text-ink">{c.author_name ?? 'Someone'}</span>
                  {tag && <span className={cn('rounded px-1.5 py-px text-[11px] font-semibold', tag.cls)}>{tag.label}</span>}
                  <span>{dateTime(c.created_at)}</span>
                  {canDelete?.(c) && onDelete && (
                    <button type="button" onClick={() => onDelete(c)} aria-label="Delete comment" className="ml-auto text-ink-subtle hover:text-danger">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-line break-words text-sm text-ink">{c.body}</p>
              </li>
            )
          })}
        </ul>
      )}
      {canAdd && (
        <div className="flex items-end gap-2">
          <textarea
            ref={ref}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void add()
              }
            }}
            maxLength={2000}
            rows={1}
            placeholder={placeholder ?? 'Add a comment'}
            aria-label="Comment"
            className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Button size="sm" variant="secondary" className="h-10" disabled={!draft.trim() || busy} onClick={() => void add()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : 'Post'}
          </Button>
        </div>
      )}
    </div>
  )
}
