import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, CheckCircle2, ClipboardList, MessageSquare, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { dateTime, shortDate } from '@/lib/format'
import {
  checklistReview,
  snapshotItems,
  type ChecklistRun,
  type ItemComment,
  type ItemPhoto,
  type SnapshotItem,
} from '@/lib/queries/checklistReview'
import { CommentThread, ItemPhotos, LateTag, StagePill } from './parts'
import { canReviewSite, clockTime, dayLabel, friendlyError, isLate, noRmReason, runName } from './review'
import { useChecklistRms } from './useChecklistRms'

// One submitted checklist: what the site did, its photos and comments, and the
// Regional Manager's review (acknowledge each flagged item, then mark complete).
export default function ChecklistRunPage() {
  const { id } = useParams<{ id: string }>()
  return id ? <RunDetail key={id} id={id} /> : null
}

function RunDetail({ id }: { id: string }) {
  const { profile } = useAuth()
  const rms = useChecklistRms()
  const [run, setRun] = useState<ChecklistRun | null>(null)
  const [comments, setComments] = useState<ItemComment[]>([])
  const [photos, setPhotos] = useState<ItemPhoto[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, c, p] = await Promise.all([checklistReview.get(id), checklistReview.comments([id]), checklistReview.photos([id])])
    if (r.error || !r.data) {
      setState('missing')
      return
    }
    setRun(r.data)
    setComments((c.data as ItemComment[] | null) ?? [])
    setPhotos((p.data as ItemPhoto[] | null) ?? [])
    setState('ready')
  }, [id])
  useEffect(() => { void load() }, [load])

  if (state === 'loading') return <p className="text-sm text-ink-muted">Loading…</p>
  if (state === 'missing' || !run) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="This checklist isn't available"
        description="It may be at a site you don't have, or it was removed."
        action={<Link to="/app/checklists" className="text-sm font-medium text-accent hover:underline">Back to Checklists</Link>}
      />
    )
  }

  const rm = rms?.get(run.location_id)
  const canReview = run.review_status === 'rm_audit' && canReviewSite(rm, profile?.id, profile?.role)
  const backTab = run.review_status === 'archived' ? 'archive' : run.review_status === 'rm_audit' ? 'rm_audit' : 'today'
  const items = snapshotItems(run)
  const flaggedSet = new Set(run.flagged_items ?? [])

  const addComment = async (itemId: string, body: string) => {
    const { data, error: err } = await checklistReview.addComment({ instance_id: run.id, item_id: itemId, location_id: run.location_id, body })
    if (err || !data) {
      setError('Could not post the comment: ' + friendlyError(err?.message))
      return false
    }
    setComments((prev) => [...prev, data as ItemComment])
    return true
  }
  const removeComment = async (c: ItemComment) => {
    if (!window.confirm('Delete this comment?')) return
    const { data, error: err } = await checklistReview.removeComment(c.id)
    if (err || !data?.length) return setError(err ? friendlyError(err.message) : 'This comment is part of the submitted checklist, so it stays.')
    setComments((prev) => prev.filter((x) => x.id !== c.id))
  }
  // Comments added during the review can be taken back by their author until it's archived.
  const canDelete = (c: ItemComment) =>
    c.author_id === profile?.id && run.review_status === 'rm_audit' && !!run.submitted_at && c.created_at > run.submitted_at

  return (
    <div className="flex flex-col gap-5">
      <Link to={`/app/checklists?tab=${backTab}`} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Back to {backTab === 'archive' ? 'Archive' : backTab === 'rm_audit' ? 'RM Audit' : 'Checklists'}
      </Link>

      <PageHeader
        title={runName(run)}
        subtitle={`${run.location?.name ?? 'Site'} · ${dayLabel(run.instance_date)}`}
        actions={
          <div className="flex items-center gap-1.5">
            {isLate(run) && <LateTag />}
            <StagePill status={run.review_status} />
          </div>
        }
      />

      {run.review_status == null ? (
        <EmptyState
          icon={ClipboardList}
          title="Not submitted yet"
          description="The site is still filling this checklist out. It shows here once they submit it."
          action={<Link to="/app/checklists" className="text-sm font-medium text-accent hover:underline">Go to today's checklists</Link>}
        />
      ) : (
        <>
          <div className="rounded-md border border-border bg-card px-4 py-3 text-sm">
            <p className="text-ink">
              Submitted {shortDate(run.submitted_at)} at {clockTime(run.submitted_at)} by <span className="font-medium">{run.submitted_by_name ?? 'someone'}</span>
              {isLate(run) && run.closes_at ? <span className="text-danger">, after it closed at {clockTime(run.closes_at)}</span> : null}
            </p>
            <p className="mt-0.5 text-ink-muted">
              {run.items_done ?? 0} of {run.items_total ?? 0} done · {flaggedSet.size} flagged · {photos.length} photo{photos.length === 1 ? '' : 's'}
            </p>
          </div>

          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

          {canReview ? (
            <ReviewForm
              run={run}
              items={items}
              comments={comments}
              photos={photos}
              rmLine={
                profile?.role === 'owner' && rm?.user_id !== profile?.id
                  ? rm?.user_id ? `This site's Regional Manager is ${rm.name} (${rm.region}). As an Admin, you can review it for them.` : `${noRmReason(rm)}, so an Admin reviews it.`
                  : null
              }
              onAddComment={addComment}
              onDeleteComment={(c) => void removeComment(c)}
              canDeleteComment={canDelete}
              onCompleted={() => void load()}
            />
          ) : (
            <>
              <StatusCard run={run} rmName={rm?.user_id ? rm.name : null} rmRegion={rm?.region ?? null} noRm={rms ? noRmReason(rm) : '…'} />
              {flaggedSet.size > 0 && (
                <ItemSection
                  title={`Flagged (${flaggedSet.size})`}
                  hint="Not done, or the site left a comment."
                  items={items.filter((it) => flaggedSet.has(it.id))}
                  run={run}
                  comments={comments}
                  photos={photos}
                  acks={(run.rm_acks ?? {}) as Record<string, boolean>}
                  showAcks
                  onAddComment={addComment}
                  onDeleteComment={(c) => void removeComment(c)}
                  canDeleteComment={canDelete}
                />
              )}
            </>
          )}

          <ItemSection
            title={flaggedSet.size > 0 ? 'Everything else' : 'Items'}
            items={items.filter((it) => !flaggedSet.has(it.id))}
            run={run}
            comments={comments}
            photos={photos}
            onAddComment={addComment}
            onDeleteComment={(c) => void removeComment(c)}
            canDeleteComment={canDelete}
          />
        </>
      )}
    </div>
  )
}

function StatusCard({ run, rmName, rmRegion, noRm }: { run: ChecklistRun; rmName: string | null; rmRegion: string | null; noRm: string }) {
  if (run.review_status === 'archived') {
    return (
      <div className="rounded-md border border-ok/40 bg-ok-soft px-4 py-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ok"><CheckCircle2 className="size-4" /> Complete</p>
        <p className="mt-0.5 text-sm text-ink">
          Reviewed by {run.completed_by_name ?? 'someone'} ({run.completed_role === 'admin' ? 'Admin' : 'Regional Manager'}) on {dateTime(run.completed_at)}.
        </p>
        {run.rm_note && <p className="mt-2 whitespace-pre-line text-sm text-ink"><span className="font-medium">Note: </span>{run.rm_note}</p>}
      </div>
    )
  }
  const n = run.flagged_items?.length ?? 0
  return (
    <div className="rounded-md border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
      {n > 0 ? `${n} flagged item${n === 1 ? '' : 's'}. ` : 'Nothing flagged. '}
      {rmName
        ? <>Waiting on <span className="font-semibold">{rmName}</span> (Regional Manager{rmRegion ? `, ${rmRegion}` : ''}) to review it and mark it complete.</>
        : <>{noRm}, so an Admin reviews it and marks it complete.</>}
    </div>
  )
}

// The RM's side: acknowledge each flagged item (saved as they go), an optional
// note, then Mark complete.
function ReviewForm({ run, items, comments, photos, rmLine, onAddComment, onDeleteComment, canDeleteComment, onCompleted }: {
  run: ChecklistRun
  items: SnapshotItem[]
  comments: ItemComment[]
  photos: ItemPhoto[]
  rmLine: string | null
  onAddComment: (itemId: string, body: string) => Promise<boolean>
  onDeleteComment: (c: ItemComment) => void
  canDeleteComment: (c: ItemComment) => boolean
  onCompleted: () => void
}) {
  const flagged = useMemo(() => items.filter((it) => (run.flagged_items ?? []).includes(it.id)), [items, run.flagged_items])
  const [acks, setAcks] = useState<Record<string, boolean>>(() => {
    const saved = (run.rm_acks ?? {}) as Record<string, boolean>
    return Object.fromEntries(Object.entries(saved).filter(([, v]) => v === true))
  })
  const [note, setNote] = useState(run.rm_note ?? '')
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Saves run one at a time, latest values last; a pending note save is flushed
  // before completing or leaving.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  // Kept current by the handlers below, so a save always sends the latest values.
  const latest = useRef({ acks, note })
  const timer = useRef<number | null>(null)
  const closed = useRef(false)

  const save = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    if (closed.current) return chain.current
    setSaved('saving')
    chain.current = chain.current.then(async () => {
      const { acks: a, note: n } = latest.current
      const { error: err } = await checklistReview.review(run.id, a, n, false)
      setSaved(err ? 'error' : 'saved')
      if (err) setError('Could not save: ' + friendlyError(err.message))
    })
    return chain.current
  }, [run.id])

  useEffect(() => {
    const flush = () => { if (timer.current) void save() }
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [save])

  const toggleAck = (itemId: string) => {
    setAcks((prev) => {
      const next = { ...prev }
      if (next[itemId]) delete next[itemId]
      else next[itemId] = true
      latest.current = { acks: next, note: latest.current.note }
      return next
    })
    void save()
  }
  const onNote = (v: string) => {
    setNote(v)
    latest.current = { acks: latest.current.acks, note: v }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), 1000)
  }

  const ackedCount = flagged.filter((it) => acks[it.id]).length
  const ready = ackedCount === flagged.length

  const complete = async () => {
    setBusy(true)
    setError(null)
    await save()
    closed.current = true
    const { error: err } = await checklistReview.review(run.id, latest.current.acks, latest.current.note, true)
    setBusy(false)
    if (err) {
      closed.current = false
      setConfirming(false)
      setError('Could not mark it complete: ' + friendlyError(err.message))
      return
    }
    setConfirming(false)
    onCompleted()
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-md border border-accent/40 bg-card p-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Your review</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {flagged.length > 0
              ? `Acknowledge each flagged item (${flagged.length}), reply where it helps, then mark the checklist complete.`
              : 'Nothing was flagged: every item was checked off and nobody left a comment. Look it over and mark it complete.'}
          </p>
          {rmLine && <p className="mt-1 text-xs text-ink-muted">{rmLine}</p>}
        </div>
        {flagged.length > 0 && (
          <p className="text-xs text-ink-muted">
            {ackedCount} of {flagged.length} acknowledged
            {saved === 'saving' ? ' · Saving…' : saved === 'saved' ? ' · Saved' : saved === 'error' ? ' · Not saved' : ''}
          </p>
        )}
      </section>

      {flagged.length > 0 && (
        <ItemSection
          title={`Flagged (${flagged.length})`}
          hint="Not done, or the site left a comment."
          items={flagged}
          run={run}
          comments={comments}
          photos={photos}
          acks={acks}
          showAcks
          onToggleAck={toggleAck}
          onAddComment={onAddComment}
          onDeleteComment={onDeleteComment}
          canDeleteComment={canDeleteComment}
        />
      )}

      <section className="flex flex-col gap-2 rounded-md border border-border bg-card p-4">
        <label htmlFor="rm-note" className="text-sm font-medium text-ink">Note to the site (optional)</label>
        <textarea
          id="rm-note"
          value={note}
          onChange={(e) => onNote(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Anything else about this checklist"
          className="rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
        />
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!ready && <span className="text-xs text-ink-muted">Acknowledge every flagged item to mark it complete.</span>}
          <Button disabled={!ready || busy} onClick={() => setConfirming(true)}>
            <CheckCircle2 className="size-4" /> Mark complete
          </Button>
        </div>
      </section>

      {confirming && (
        <Modal open onClose={() => !busy && setConfirming(false)} title="Mark this checklist complete?" size="sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              {run.location?.name ?? 'The site'}'s {runName(run)} moves to Archive with your review. It can't be changed after this.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void complete()} disabled={busy}>{busy ? 'Completing…' : 'Mark complete'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function ItemSection({ title, hint, items, run, comments, photos, acks, showAcks, onToggleAck, onAddComment, onDeleteComment, canDeleteComment }: {
  title: string
  hint?: string
  items: SnapshotItem[]
  run: ChecklistRun
  comments: ItemComment[]
  photos: ItemPhoto[]
  acks?: Record<string, boolean>
  showAcks?: boolean
  onToggleAck?: (itemId: string) => void
  onAddComment: (itemId: string, body: string) => Promise<boolean>
  onDeleteComment: (c: ItemComment) => void
  canDeleteComment: (c: ItemComment) => boolean
}) {
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set())
  if (items.length === 0) return null
  const canComment = run.review_status !== 'archived'
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {hint && <p className="text-xs text-ink-muted">{hint}</p>}
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((it) => {
          const itemComments = comments.filter((c) => c.item_id === it.id)
          const itemPhotos = photos.filter((p) => p.item_id === it.id)
          const acked = !!acks?.[it.id]
          const threadOpen = openThreads.has(it.id) || itemComments.length > 0
          return (
            <li key={it.id} className={cn('flex flex-col gap-2 rounded-md border bg-card p-3', showAcks && !acked ? 'border-danger/40' : 'border-border')}>
              <div className="flex items-start gap-3">
                {it.done
                  ? <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Done" />
                  : <X className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Not done" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{it.label}</p>
                  <p className="text-xs text-ink-muted">
                    {it.done
                      ? `Done by ${it.done_by || 'someone'}${it.done_at ? ` at ${clockTime(it.done_at)}` : ''}`
                      : <span className="font-medium text-danger">Not done</span>}
                    {it.requires_photo && !itemPhotos.length ? ' · no photo' : ''}
                  </p>
                </div>
                {!threadOpen && canComment && (
                  <button
                    type="button"
                    onClick={() => setOpenThreads((prev) => new Set(prev).add(it.id))}
                    aria-label={`Comment on ${it.label}`}
                    className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-ink-muted hover:bg-content hover:text-ink"
                  >
                    <MessageSquare className="size-4" />
                  </button>
                )}
                {showAcks && (onToggleAck ? (
                  <Button
                    size="sm"
                    variant={acked ? 'secondary' : 'primary'}
                    className={cn('shrink-0', acked && 'border-ok/40 text-ok')}
                    aria-pressed={acked}
                    onClick={() => onToggleAck(it.id)}
                  >
                    {acked ? <><Check className="size-4" /> Acknowledged</> : 'Acknowledge'}
                  </Button>
                ) : acked ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ok"><Check className="size-3.5" /> Acknowledged</span>
                ) : null)}
              </div>
              {itemPhotos.length > 0 && <ItemPhotos photos={itemPhotos} small />}
              {(threadOpen || itemComments.length > 0) && (
                <CommentThread
                  comments={itemComments}
                  canAdd={canComment}
                  onAdd={(body) => onAddComment(it.id, body)}
                  canDelete={canDeleteComment}
                  onDelete={onDeleteComment}
                  placeholder="Reply or add a comment"
                  autoFocus={openThreads.has(it.id) && itemComments.length === 0}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
