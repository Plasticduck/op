import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, ClipboardList, History, Loader2, MessageSquare, Send, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { ChecklistItemActions } from '@/features/maintenance/inventory/ChecklistHooks'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { cn } from '@/lib/utils'
import { dateTime, timeOfDay } from '@/lib/format'
import { checklists, type ChecklistInstance, type ChecklistItemEvent } from '@/lib/queries/ops'
import { checklistReview, type ItemComment, type ItemPhoto, type MissingItem } from '@/lib/queries/checklistReview'
import { CommentThread, ItemPhotos, LateTag, StagePill } from './parts'
import { MISSING_TEXT, clockTime, friendlyError, isLate, missingBeforeSubmit } from './review'

type InstanceWithTemplate = ChecklistInstance & {
  checklist: {
    id: string
    name: string
    description: string | null
    opens_at_local: string
    closes_at_local: string | null
    reset_policy: string
    roles: string[] | null
  }
}

type ItemRow = { id: string; label: string; order_index: number; requires_photo: boolean; asset_id?: string | null }

type StateEntry = {
  checked: boolean
  last_actor_name: string | null
  last_event_at: string | null
}

const stateKey = (instanceId: string, itemId: string) => `${instanceId}:${itemId}`

function isOpenNow(opensAt: string, closesAt: string | null): boolean {
  const now = Date.now()
  if (now < new Date(opensAt).getTime()) return false
  return !closesAt || now < new Date(closesAt).getTime()
}

// Today's checklists at one site: check items off, add photos and comments, and
// submit each checklist to the Regional Manager when it's done.
export function TodayView({ locationId, locationName }: { locationId: string; locationName: string }) {
  const { profile } = useAuth()
  const isManagerPlus = profile?.role !== 'employee'

  const [instances, setInstances] = useState<InstanceWithTemplate[]>([])
  const [itemsByChecklist, setItemsByChecklist] = useState<Record<string, ItemRow[]>>({})
  const [state, setState] = useState<Map<string, StateEntry>>(new Map())
  const [comments, setComments] = useState<ItemComment[]>([])
  const [photos, setPhotos] = useState<ItemPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set())
  const [photoBusy, setPhotoBusy] = useState<Set<string>>(new Set())
  const [missing, setMissing] = useState<Record<string, MissingItem[]>>({})
  const [confirmFor, setConfirmFor] = useState<InstanceWithTemplate | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [historyFor, setHistoryFor] = useState<{ instanceId: string; itemId: string; label: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const targetRef = useRef<{ instanceId: string; itemId: string; checkAfter: boolean } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const { data: instData, error: instErr } = await checklists.ensureTodayForLocation(locationId)
    if (instErr) {
      setError(instErr.message)
      setInstances([])
      setLoading(false)
      return
    }
    // An instance whose template embed came back null (RLS hid the template)
    // would crash the render, so drop those rather than trust it.
    type RawInstance = ChecklistInstance & { checklist: InstanceWithTemplate['checklist'] | null }
    const list = ((instData as RawInstance[] | null) ?? []).filter((i): i is InstanceWithTemplate => i.checklist != null)

    const ids = Array.from(new Set(list.map((i) => i.checklist_id)))
    const itemResults = await Promise.all(ids.map((id) => checklists.items(id)))
    const itemsMap: Record<string, ItemRow[]> = {}
    ids.forEach((id, idx) => {
      itemsMap[id] = ((itemResults[idx].data as ItemRow[] | null) ?? []).slice().sort((a, b) => a.order_index - b.order_index)
    })

    const instanceIds = list.map((i) => i.id)
    const [stateRes, commentRes, photoRes] = await Promise.all([
      checklists.itemStateFor(instanceIds),
      checklistReview.comments(instanceIds),
      checklistReview.photos(instanceIds),
    ])
    const map = new Map<string, StateEntry>()
    ;((stateRes.data as Array<{ instance_id: string | null; item_id: string | null; checked: boolean | null; last_actor_name: string | null; last_event_at: string | null }> | null) ?? []).forEach((row) => {
      if (!row.instance_id || !row.item_id) return
      map.set(stateKey(row.instance_id, row.item_id), { checked: !!row.checked, last_actor_name: row.last_actor_name, last_event_at: row.last_event_at })
    })
    setInstances(list)
    setItemsByChecklist(itemsMap)
    setState(map)
    setComments((commentRes.data as ItemComment[] | null) ?? [])
    setPhotos((photoRes.data as ItemPhoto[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const instanceIds = useMemo(() => instances.map((i) => i.id), [instances])
  const instanceIdsKey = instanceIds.join(',')

  // Checks from other people at the site show up as they happen.
  useEffect(() => {
    if (instanceIds.length === 0) return
    const channel = supabase
      .channel(`checklist-events-${locationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'checklist_item_events', filter: `instance_id=in.(${instanceIds.join(',')})` },
        (payload) => {
          const row = payload.new as ChecklistItemEvent
          setState((prev) => {
            const key = stateKey(row.instance_id, row.item_id)
            const existing = prev.get(key)
            if (existing?.last_event_at && new Date(existing.last_event_at) > new Date(row.occurred_at)) return prev
            const next = new Map(prev)
            next.set(key, { checked: row.action === 'check', last_actor_name: row.actor_name, last_event_at: row.occurred_at })
            return next
          })
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [locationId, instanceIdsKey, instanceIds])

  const clearMissing = (instanceId: string, itemId: string) =>
    setMissing((prev) => (prev[instanceId] ? { ...prev, [instanceId]: prev[instanceId].filter((m) => m.item_id !== itemId) } : prev))

  const setChecked = async (instanceId: string, itemId: string, nextChecked: boolean) => {
    const key = stateKey(instanceId, itemId)
    const prevEntry = state.get(key)
    setState((prev) => new Map(prev).set(key, { checked: nextChecked, last_actor_name: profile?.name ?? '', last_event_at: new Date().toISOString() }))
    const { error: err } = await checklists.toggleItem(instanceId, itemId, nextChecked, profile?.id ?? '', profile?.name ?? null)
    if (err) {
      setState((prev) => {
        const next = new Map(prev)
        if (prevEntry) next.set(key, prevEntry)
        else next.delete(key)
        return next
      })
      setError(friendlyError(err.message))
      return
    }
    clearMissing(instanceId, itemId)
  }

  const openPicker = (instanceId: string, itemId: string, checkAfter: boolean) => {
    targetRef.current = { instanceId, itemId, checkAfter }
    fileRef.current?.click()
  }

  // A photo item needs its photo before it can be checked off.
  const onTapItem = (inst: InstanceWithTemplate, item: ItemRow) => {
    const checked = !!state.get(stateKey(inst.id, item.id))?.checked
    if (!checked && item.requires_photo && !photos.some((p) => p.instance_id === inst.id && p.item_id === item.id)) {
      openPicker(inst.id, item.id, true)
      return
    }
    void setChecked(inst.id, item.id, !checked)
  }

  const onFiles = async (files: FileList | null) => {
    const t = targetRef.current
    if (!files || files.length === 0 || !t || !profile) return
    const key = stateKey(t.instanceId, t.itemId)
    setPhotoBusy((prev) => new Set(prev).add(key))
    setError(null)
    let added = 0
    for (const raw of Array.from(files).slice(0, 6)) {
      const file = await shrinkPhoto(raw, 2000, { alwaysJpeg: true })
      const { data, error: err } = await checklistReview.addPhoto({
        accountId: profile.account_id,
        instanceId: t.instanceId,
        itemId: t.itemId,
        locationId,
        file,
      })
      if (err || !data) {
        setError('Could not add the photo: ' + friendlyError(err?.message))
        break
      }
      added++
      setPhotos((prev) => [...prev, data as ItemPhoto])
    }
    setPhotoBusy((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    if (added > 0) {
      clearMissing(t.instanceId, t.itemId)
      if (t.checkAfter && !state.get(key)?.checked) void setChecked(t.instanceId, t.itemId, true)
    }
  }

  const removePhoto = async (p: ItemPhoto) => {
    if (!window.confirm('Remove this photo?')) return
    const { error: err } = await checklistReview.removePhoto(p)
    if (err) return setError(friendlyError(err.message))
    setPhotos((prev) => prev.filter((x) => x.id !== p.id))
  }

  const addComment = async (inst: InstanceWithTemplate, itemId: string, body: string) => {
    const { data, error: err } = await checklistReview.addComment({ instance_id: inst.id, item_id: itemId, location_id: locationId, body })
    if (err || !data) {
      setError('Could not post the comment: ' + friendlyError(err?.message))
      return false
    }
    setComments((prev) => [...prev, data as ItemComment])
    clearMissing(inst.id, itemId)
    return true
  }

  const removeComment = async (c: ItemComment) => {
    if (!window.confirm('Delete this comment?')) return
    const { data, error: err } = await checklistReview.removeComment(c.id)
    if (err || !data?.length) return setError(err ? friendlyError(err.message) : 'This comment is part of a submitted checklist, so it stays.')
    setComments((prev) => prev.filter((x) => x.id !== c.id))
  }

  const toggleThread = (key: string) =>
    setOpenThreads((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const startSubmit = (inst: InstanceWithTemplate) => {
    const items = itemsByChecklist[inst.checklist_id] ?? []
    const instComments = comments.filter((c) => c.instance_id === inst.id)
    const instPhotos = photos.filter((p) => p.instance_id === inst.id)
    const miss = missingBeforeSubmit(items, (id) => !!state.get(stateKey(inst.id, id))?.checked, instPhotos, instComments)
    setMissing((prev) => ({ ...prev, [inst.id]: miss }))
    if (miss.length > 0) {
      // Open the comment box on items that need a reason.
      setOpenThreads((prev) => {
        const next = new Set(prev)
        for (const m of miss) if (m.reason === 'not_done') next.add(stateKey(inst.id, m.item_id))
        return next
      })
      document.getElementById(`cl-item-${inst.id}-${miss[0].item_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setConfirmFor(inst)
  }

  const submit = async () => {
    if (!confirmFor) return
    setSubmitting(true)
    const { data, error: err } = await checklistReview.submit(confirmFor.id)
    setSubmitting(false)
    if (err || !data) {
      setError('Could not submit: ' + friendlyError(err?.message))
      setConfirmFor(null)
      return
    }
    if (!data.ok) {
      setMissing((prev) => ({ ...prev, [confirmFor.id]: data.missing }))
      setConfirmFor(null)
      return
    }
    setConfirmFor(null)
    await load()
  }

  // Role targeting: the admin (owner) sees every checklist; everyone else sees
  // only checklists assigned to their role. A null/empty roles list means "all".
  const visibleInstances = instances.filter((inst) => {
    if (profile?.role === 'owner') return true
    const roles = inst.checklist.roles
    if (!roles || roles.length === 0) return true
    return roles.includes(profile?.role ?? '')
  })

  if (loading) return <p className="text-sm text-ink-muted">Loading...</p>

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-muted">
        Today's checklists for {locationName}. Check off each item (photo items need a photo), comment on anything that wasn't done
        or needs a look, then submit the checklist to your Regional Manager.
      </p>

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {visibleInstances.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No checklists for today"
          description="No checklists are scheduled for your role at this site today. Manage templates to add or change schedules."
          action={isManagerPlus ? <Link to="/app/checklists/templates"><Button>Manage templates</Button></Link> : undefined}
        />
      ) : (
        visibleInstances.map((inst) => {
          const items = itemsByChecklist[inst.checklist_id] ?? []
          const submitted = inst.review_status != null
          const open = isOpenNow(inst.opens_at, inst.closes_at)
          const doneCount = items.filter((it) => state.get(stateKey(inst.id, it.id))?.checked).length
          const instMissing = missing[inst.id] ?? []
          return (
            <section key={inst.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-ink">{inst.checklist.name}</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Opens {timeOfDay(inst.checklist.opens_at_local)}
                    {inst.checklist.closes_at_local ? `, closes ${timeOfDay(inst.checklist.closes_at_local)}` : ', stays open all day'}
                  </p>
                  {inst.checklist.description && !submitted && <p className="mt-1 text-sm text-ink-muted">{inst.checklist.description}</p>}
                </div>
                {submitted ? (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isLate(inst) && <LateTag />}
                    <StagePill status={inst.review_status} />
                  </div>
                ) : (
                  <Badge tone={open ? 'ok' : 'warn'}>{open ? 'Open' : 'Closed'}</Badge>
                )}
              </div>

              {submitted ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-content px-3 py-2">
                  <p className="text-sm text-ink">
                    Submitted {clockTime(inst.submitted_at)} by {inst.submitted_by_name ?? 'someone'}
                    <span className="text-ink-muted">
                      {' '}· {inst.items_done ?? 0} of {inst.items_total ?? 0} done
                      {(inst.flagged_items?.length ?? 0) > 0 ? ` · ${inst.flagged_items.length} flagged` : ''}
                    </span>
                  </p>
                  <Link to={`/app/checklists/review/${inst.id}`} className="text-sm font-medium text-accent hover:underline">View</Link>
                </div>
              ) : items.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No items on this checklist yet.</p>
              ) : (
                <>
                  <ul className="mt-3 flex flex-col gap-2">
                    {items.map((item) => {
                      const key = stateKey(inst.id, item.id)
                      const entry = state.get(key)
                      const checked = !!entry?.checked
                      const itemPhotos = photos.filter((p) => p.instance_id === inst.id && p.item_id === item.id)
                      const itemComments = comments.filter((c) => c.instance_id === inst.id && c.item_id === item.id)
                      const busy = photoBusy.has(key)
                      const need = instMissing.find((m) => m.item_id === item.id)
                      const threadOpen = openThreads.has(key) || itemComments.length > 0
                      return (
                        <li key={item.id} id={`cl-item-${inst.id}-${item.id}`} className="flex flex-col gap-1.5">
                          <div className="flex items-stretch gap-1">
                            <button
                              type="button"
                              onClick={() => onTapItem(inst, item)}
                              disabled={busy}
                              className={cn(
                                'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition',
                                checked ? 'border-ok/40 bg-ok-soft text-ink' : need ? 'border-danger/50 bg-danger-soft/40 text-ink' : 'border-border bg-card text-ink hover:bg-content',
                              )}
                            >
                              {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" />
                                : checked ? <Check className="size-4 shrink-0 text-ok" />
                                : <Square className="size-4 shrink-0 text-ink-muted" />}
                              <span className="min-w-0 flex-1">
                                <span className={cn('block', checked && 'line-through opacity-70')}>{item.label}</span>
                                {checked && entry && (
                                  <span className="block text-xs text-ink-muted">
                                    {entry.last_actor_name || 'Someone'}{entry.last_event_at ? ` at ${dateTime(entry.last_event_at)}` : ''}
                                  </span>
                                )}
                              </span>
                              {item.requires_photo && (
                                <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs', itemPhotos.length ? 'text-ok' : 'text-ink-subtle')} title="Needs a photo">
                                  <Camera className="size-3.5" />
                                  <span className="hidden sm:inline">{itemPhotos.length ? 'Photo added' : 'Photo needed'}</span>
                                </span>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openPicker(inst.id, item.id, false)}
                              disabled={busy}
                              aria-label={`Add a photo to ${item.label}`}
                              className="flex w-11 shrink-0 flex-col items-center justify-center rounded-md border border-border bg-card text-ink-muted hover:bg-content hover:text-ink"
                            >
                              <Camera className="size-4" />
                              {itemPhotos.length > 0 && <span className="text-[10px] font-semibold">{itemPhotos.length}</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleThread(key)}
                              aria-label={`Comment on ${item.label}`}
                              aria-expanded={threadOpen}
                              className={cn(
                                'flex w-11 shrink-0 flex-col items-center justify-center rounded-md border bg-card hover:bg-content hover:text-ink',
                                itemComments.length ? 'border-accent/40 text-accent' : 'border-border text-ink-muted',
                              )}
                            >
                              <MessageSquare className="size-4" />
                              {itemComments.length > 0 && <span className="text-[10px] font-semibold">{itemComments.length}</span>}
                            </button>
                            {isManagerPlus && (
                              <button
                                type="button"
                                onClick={() => setHistoryFor({ instanceId: inst.id, itemId: item.id, label: item.label })}
                                aria-label={`History of ${item.label}`}
                                title="Who checked it and when"
                                className="hidden w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card text-ink-muted hover:bg-content hover:text-ink sm:flex"
                              >
                                <History className="size-4" />
                              </button>
                            )}
                          </div>
                          {need && <p className="ml-1 text-xs font-medium text-danger">{MISSING_TEXT[need.reason]}</p>}
                          {itemPhotos.length > 0 && (
                            <div className="ml-1">
                              <ItemPhotos photos={itemPhotos} small canRemove={(p) => p.uploaded_by === profile?.id} onRemove={(p) => void removePhoto(p)} />
                            </div>
                          )}
                          {threadOpen && (
                            <div className="ml-1 sm:ml-7">
                              <CommentThread
                                comments={itemComments}
                                canAdd
                                onAdd={(body) => addComment(inst, item.id, body)}
                                canDelete={(c) => c.author_id === profile?.id}
                                onDelete={(c) => void removeComment(c)}
                                placeholder={checked ? 'Anything the RM should know?' : 'Why wasn’t it done? Anything the RM should know?'}
                                autoFocus={openThreads.has(key) && itemComments.length === 0}
                              />
                            </div>
                          )}
                          <ChecklistItemActions instanceId={inst.id} itemId={item.id} hasAsset={!!item.asset_id} failed={!checked && itemComments.length > 0} />
                        </li>
                      )
                    })}
                  </ul>

                  {instMissing.length > 0 && (
                    <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
                      {instMissing.length} item{instMissing.length === 1 ? ' needs' : 's need'} something before this can be submitted (marked in red above).
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="text-sm text-ink-muted">{doneCount} of {items.length} checked off</p>
                    <Button onClick={() => startSubmit(inst)}>
                      <Send className="size-4" /> Submit checklist
                    </Button>
                  </div>
                </>
              )}

              {isManagerPlus && (
                <div className="mt-3">
                  <Link to={`/app/checklists/templates/${inst.checklist.id}`} className="text-xs text-accent hover:underline">
                    View template + audit log
                  </Link>
                </div>
              )}
            </section>
          )
        })
      )}

      {/* No `capture`: the phone offers Take Photo or the photo library. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {confirmFor && (
        <SubmitConfirm
          inst={confirmFor}
          notDone={(itemsByChecklist[confirmFor.checklist_id] ?? []).filter((it) => !state.get(stateKey(confirmFor.id, it.id))?.checked).length}
          busy={submitting}
          onCancel={() => setConfirmFor(null)}
          onSubmit={() => void submit()}
        />
      )}

      {historyFor && (
        <HistoryModal instanceId={historyFor.instanceId} itemId={historyFor.itemId} label={historyFor.label} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  )
}

function SubmitConfirm({ inst, notDone, busy, onCancel, onSubmit }: {
  inst: InstanceWithTemplate
  notDone: number
  busy: boolean
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <Modal open onClose={onCancel} title={`Submit ${inst.checklist.name}?`} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink">
          It goes to your Regional Manager for review. Items, checks and photos can't be changed after this.
        </p>
        {notDone > 0 && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-ink">
            {notDone} item{notDone === 1 ? ' isn’t' : 's aren’t'} checked off. The comment{notDone === 1 ? '' : 's'} explaining why go{notDone === 1 ? 'es' : ''} to the RM.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={onSubmit} disabled={busy}>{busy ? 'Submitting…' : 'Submit'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// Every check and uncheck of one item today.
function HistoryModal({ instanceId, itemId, label, onClose }: { instanceId: string; itemId: string; label: string; onClose: () => void }) {
  const [events, setEvents] = useState<ChecklistItemEvent[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void checklists.eventsForInstance(instanceId).then(({ data }) => {
      if (!cancelled) setEvents(((data as ChecklistItemEvent[] | null) ?? []).filter((r) => r.item_id === itemId))
    })
    return () => { cancelled = true }
  }, [instanceId, itemId])
  return (
    <Modal open onClose={onClose} title={`History: ${label}`} size="md">
      {events === null ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-ink-muted">No activity yet for this item today.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={ev.action === 'check' ? 'ok' : 'neutral'}>{ev.action === 'check' ? 'Checked' : 'Unchecked'}</Badge>
                <span className="text-ink">{ev.actor_name || 'Someone'}</span>
              </div>
              <span className="text-xs text-ink-muted">{dateTime(ev.occurred_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
