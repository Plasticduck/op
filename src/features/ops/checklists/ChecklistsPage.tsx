import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Camera, Check, ClipboardList, Loader2, Settings, Square } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { dateTime, timeOfDay } from '@/lib/format'
import {
  checklists,
  type ChecklistInstance,
  type ChecklistItemEvent,
  type ChecklistSubmissionLatest,
} from '@/lib/queries/ops'

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

const VERDICT: Record<
  ChecklistSubmissionLatest['ai_status'],
  { tone: 'ok' | 'danger' | 'warn' | 'neutral'; label: string }
> = {
  pass: { tone: 'ok', label: 'Verified' },
  discrepancy: { tone: 'danger', label: 'Discrepancy' },
  unclear: { tone: 'warn', label: 'Unclear' },
  error: { tone: 'neutral', label: 'Check failed' },
  pending: { tone: 'neutral', label: 'Checking...' },
}

type InstanceWithTemplate = ChecklistInstance & {
  checklist: {
    id: string
    name: string
    description: string | null
    opens_at_local: string
    closes_at_local: string | null
    reset_policy: string
  }
}

type ItemRow = { id: string; label: string; order_index: number; requires_photo: boolean }

type StateEntry = {
  checked: boolean
  last_actor_name: string | null
  last_event_at: string | null
}

function stateKey(instanceId: string, itemId: string) {
  return `${instanceId}:${itemId}`
}

function isOpenNow(opensAt: string, closesAt: string | null): boolean {
  const now = Date.now()
  const opens = new Date(opensAt).getTime()
  if (now < opens) return false
  if (!closesAt) return true
  return now < new Date(closesAt).getTime()
}

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const isManagerPlus = profile?.role !== 'employee'
  const locationName = locations.find((l) => l.id === locationId)?.name ?? 'this site'

  const [instances, setInstances] = useState<InstanceWithTemplate[]>([])
  const [itemsByChecklist, setItemsByChecklist] = useState<Record<string, ItemRow[]>>({})
  const [state, setState] = useState<Map<string, StateEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [auditFor, setAuditFor] = useState<{ instanceId: string; itemLabel: string } | null>(null)
  // Photo verification: which items have a baseline at this site, the latest
  // submission per (instance, item), and which cells are busy uploading/verifying.
  const [baselineItems, setBaselineItems] = useState<Set<string>>(new Set())
  const [subs, setSubs] = useState<Map<string, ChecklistSubmissionLatest>>(new Map())
  const [photoBusy, setPhotoBusy] = useState<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement | null>(null)
  const targetRef = useRef<{ kind: 'baseline' | 'submission'; instanceId: string; itemId: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data: instData, error: instErr } = await checklists.ensureTodayForLocation(locationId)
    if (instErr) {
      setError(instErr.message)
      setInstances([])
      setItemsByChecklist({})
      setState(new Map())
      setLoading(false)
      return
    }
    // Defensive: an instance whose template embed came back null (e.g. RLS hid
    // the template) would crash the render, so drop those rather than trust it.
    type RawInstance = ChecklistInstance & { checklist: InstanceWithTemplate['checklist'] | null }
    const list = (((instData as RawInstance[] | null) ?? []).filter(
      (i): i is InstanceWithTemplate => i.checklist != null,
    ))
    setInstances(list)

    const uniqueChecklistIds = Array.from(new Set(list.map((i) => i.checklist_id)))
    const itemResults = await Promise.all(uniqueChecklistIds.map((id) => checklists.items(id)))
    const itemsMap: Record<string, ItemRow[]> = {}
    uniqueChecklistIds.forEach((id, idx) => {
      itemsMap[id] = ((itemResults[idx].data as ItemRow[] | null) ?? []).slice().sort(
        (a, b) => a.order_index - b.order_index,
      )
    })
    setItemsByChecklist(itemsMap)

    const instanceIds = list.map((i) => i.id)
    const { data: stateData } = await checklists.itemStateFor(instanceIds)
    const map = new Map<string, StateEntry>()
    ;((stateData as Array<{
      instance_id: string | null
      item_id: string | null
      checked: boolean | null
      last_actor_name: string | null
      last_event_at: string | null
    }> | null) ?? []).forEach((row) => {
      if (!row.instance_id || !row.item_id) return
      map.set(stateKey(row.instance_id, row.item_id), {
        checked: !!row.checked,
        last_actor_name: row.last_actor_name,
        last_event_at: row.last_event_at,
      })
    })
    setState(map)

    // Photo verification: baselines set at this site + latest submissions.
    const photoItemIds = Object.values(itemsMap).flat().filter((i) => i.requires_photo).map((i) => i.id)
    const [baseRes, subRes] = await Promise.all([
      checklists.baselinesFor(photoItemIds, locationId),
      checklists.latestSubmissionsFor(instanceIds),
    ])
    setBaselineItems(new Set(((baseRes.data as { item_id: string }[] | null) ?? []).map((b) => b.item_id)))
    const sm = new Map<string, ChecklistSubmissionLatest>()
    ;((subRes.data as ChecklistSubmissionLatest[] | null) ?? []).forEach((s) => {
      sm.set(stateKey(s.instance_id, s.item_id), s)
    })
    setSubs(sm)
    setLoading(false)
  }, [locationId])

  const setBusy = (key: string, on: boolean) =>
    setPhotoBusy((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const openPicker = (kind: 'baseline' | 'submission', instanceId: string, itemId: string) => {
    targetRef.current = { kind, instanceId, itemId }
    fileRef.current?.click()
  }

  const onFile = async (file: File | null) => {
    const t = targetRef.current
    if (!file || !t) return
    setError(null)
    const dataUri = await fileToDataUri(file)

    if (t.kind === 'baseline') {
      const bk = `base:${t.itemId}`
      setBusy(bk, true)
      const { error: err } = await checklists.setBaseline({
        item_id: t.itemId,
        location_id: locationId,
        data_uri: dataUri,
        created_by: profile?.id ?? '',
      })
      setBusy(bk, false)
      if (err) return setError(err.message)
      setBaselineItems((prev) => new Set(prev).add(t.itemId))
      return
    }

    const key = stateKey(t.instanceId, t.itemId)
    setBusy(key, true)
    const { data, error: err } = await checklists.submitPhoto({
      instance_id: t.instanceId,
      item_id: t.itemId,
      location_id: locationId,
      data_uri: dataUri,
      submitted_by: profile?.id ?? '',
      submitted_by_name: profile?.name ?? null,
    })
    if (err || !data) {
      setBusy(key, false)
      return setError(err?.message ?? 'Upload failed')
    }
    const submissionId = (data as { id: string }).id
    // Submitting a photo also marks the task done.
    if (!state.get(key)?.checked) void onToggle(t.instanceId, t.itemId)
    const pending: ChecklistSubmissionLatest = {
      id: submissionId,
      instance_id: t.instanceId,
      item_id: t.itemId,
      location_id: locationId,
      submitted_by_name: profile?.name ?? null,
      ai_status: 'pending',
      ai_notes: null,
      created_at: new Date().toISOString(),
    }
    setSubs((prev) => new Map(prev).set(key, pending))
    const { data: vres } = await checklists.verifySubmission(submissionId)
    const v = vres as { ai_status?: ChecklistSubmissionLatest['ai_status']; ai_notes?: string } | null
    setSubs((prev) =>
      new Map(prev).set(key, {
        ...pending,
        ai_status: v?.ai_status ?? 'error',
        ai_notes: v?.ai_notes ?? null,
      }),
    )
    setBusy(key, false)
  }

  useEffect(() => {
    void load()
  }, [load])

  const instanceIds = useMemo(() => instances.map((i) => i.id), [instances])
  const instanceIdsKey = instanceIds.join(',')

  useEffect(() => {
    if (instanceIds.length === 0) return
    const channel = supabase
      .channel(`checklist-events-${locationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'checklist_item_events',
          filter: `instance_id=in.(${instanceIds.join(',')})`,
        },
        (payload) => {
          const row = payload.new as ChecklistItemEvent
          setState((prev) => {
            const next = new Map(prev)
            const key = stateKey(row.instance_id, row.item_id)
            const existing = next.get(key)
            if (existing?.last_event_at && new Date(existing.last_event_at) > new Date(row.occurred_at)) {
              return prev
            }
            next.set(key, {
              checked: row.action === 'check',
              last_actor_name: row.actor_name,
              last_event_at: row.occurred_at,
            })
            return next
          })
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [locationId, instanceIdsKey, instanceIds])

  const onToggle = async (instanceId: string, itemId: string) => {
    const key = stateKey(instanceId, itemId)
    const prevEntry = state.get(key)
    const currentChecked = !!prevEntry?.checked
    const nextChecked = !currentChecked
    setState((prev) => {
      const next = new Map(prev)
      next.set(key, {
        checked: nextChecked,
        last_actor_name: profile?.name ?? '',
        last_event_at: new Date().toISOString(),
      })
      return next
    })
    const { error: toggleErr } = await checklists.toggleItem(
      instanceId,
      itemId,
      nextChecked,
      profile?.id ?? '',
      profile?.name ?? null,
    )
    if (toggleErr) {
      setState((prev) => {
        const next = new Map(prev)
        if (prevEntry) next.set(key, prevEntry)
        else next.delete(key)
        return next
      })
      setError(toggleErr.message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Checklists"
        subtitle={`Today's checklists for ${locationName}.`}
        actions={
          isManagerPlus ? (
            <Link to="/app/checklists/templates">
              <Button variant="secondary">
                <Settings className="size-4" /> Manage templates
              </Button>
            </Link>
          ) : undefined
        }
      />

      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : instances.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No checklists for today"
          description="No checklists are scheduled for this site today. Manage templates to add or change schedules."
          action={
            isManagerPlus ? (
              <Link to="/app/checklists/templates">
                <Button>Manage templates</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {instances.map((inst) => {
            const open = isOpenNow(inst.opens_at, inst.closes_at)
            const items = itemsByChecklist[inst.checklist_id] ?? []
            return (
              <section
                key={inst.id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-ink">{inst.checklist.name}</h3>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      Opens {timeOfDay(inst.checklist.opens_at_local)}
                      {inst.checklist.closes_at_local
                        ? `, closes ${timeOfDay(inst.checklist.closes_at_local)}`
                        : ', stays open all day'}
                    </p>
                    {inst.checklist.description && (
                      <p className="mt-1 text-sm text-ink-muted">{inst.checklist.description}</p>
                    )}
                  </div>
                  <Badge tone={open ? 'ok' : 'warn'}>{open ? 'Open' : 'Closed'}</Badge>
                </div>

                {items.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-muted">No items on this checklist yet.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {items.map((item) => {
                      const key = stateKey(inst.id, item.id)
                      const entry = state.get(key)
                      const checked = !!entry?.checked
                      const sub = subs.get(key)
                      const hasBaseline = baselineItems.has(item.id)
                      const busy = photoBusy.has(key)
                      const baseBusy = photoBusy.has(`base:${item.id}`)
                      return (
                        <li key={item.id} className="flex flex-col gap-1">
                          <div className="flex items-stretch gap-1">
                            <button
                              type="button"
                              onClick={() => void onToggle(inst.id, item.id)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition',
                                checked
                                  ? 'border-ok/40 bg-ok-soft text-ink'
                                  : 'border-border bg-card text-ink hover:bg-content',
                              )}
                            >
                              {checked ? (
                                <Check className="size-4 shrink-0 text-ok" />
                              ) : (
                                <Square className="size-4 shrink-0 text-ink-muted" />
                              )}
                              <span className={cn('flex-1', checked && 'line-through opacity-70')}>
                                {item.label}
                              </span>
                              {item.requires_photo && (
                                <Camera className="size-3.5 shrink-0 text-ink-subtle" />
                              )}
                              {checked && entry && (
                                <span className="ml-auto whitespace-nowrap text-xs text-ink-muted">
                                  {entry.last_actor_name || 'Someone'}
                                  {entry.last_event_at ? ` at ${dateTime(entry.last_event_at)}` : ''}
                                </span>
                              )}
                            </button>
                            {isManagerPlus && (
                              <button
                                type="button"
                                onClick={() => setAuditFor({ instanceId: inst.id, itemLabel: item.label })}
                                className="shrink-0 rounded-md border border-border bg-card px-2 text-xs text-ink-muted hover:bg-content hover:text-ink"
                                aria-label={`Audit ${item.label}`}
                              >
                                Audit
                              </button>
                            )}
                          </div>

                          {item.requires_photo && (
                            <div className="ml-2 flex flex-col gap-2 rounded-md border border-border bg-content px-3 py-2 sm:ml-7">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-medium text-ink">Photo check</span>
                                {sub ? (
                                  <Badge tone={VERDICT[sub.ai_status].tone}>{VERDICT[sub.ai_status].label}</Badge>
                                ) : hasBaseline ? (
                                  <span className="text-ink-muted">Awaiting photo</span>
                                ) : (
                                  <span className="text-warn">No baseline set for this site</span>
                                )}
                                {sub?.submitted_by_name && (
                                  <span className="text-ink-subtle">by {sub.submitted_by_name}</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy || !hasBaseline}
                                  onClick={() => openPicker('submission', inst.id, item.id)}
                                  title={hasBaseline ? undefined : 'A manager must set a baseline photo first.'}
                                >
                                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
                                  {sub ? 'Retake photo' : 'Submit photo'}
                                </Button>
                                {isManagerPlus && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={baseBusy}
                                    onClick={() => openPicker('baseline', inst.id, item.id)}
                                  >
                                    {baseBusy && <Loader2 className="size-4 animate-spin" />}
                                    {hasBaseline ? 'Update baseline' : 'Set baseline'}
                                  </Button>
                                )}
                              </div>
                              {sub?.ai_notes && (
                                <p className="whitespace-pre-line text-xs text-ink-muted">{sub.ai_notes}</p>
                              )}
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}

                {isManagerPlus && (
                  <div className="mt-3">
                    <Link
                      to={`/app/checklists/templates/${inst.checklist.id}`}
                      className="text-xs text-accent hover:underline"
                    >
                      View template + audit log
                    </Link>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void onFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />

      {auditFor && (
        <AuditModal
          instanceId={auditFor.instanceId}
          itemLabel={auditFor.itemLabel}
          onClose={() => setAuditFor(null)}
        />
      )}
    </div>
  )
}

function AuditModal({
  instanceId,
  itemLabel,
  onClose,
}: {
  instanceId: string
  itemLabel: string
  onClose: () => void
}) {
  const [events, setEvents] = useState<Array<ChecklistItemEvent & { item: { label: string } | null }> | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { data } = await checklists.eventsForInstance(instanceId)
      if (cancelled) return
      const rows = (data as Array<ChecklistItemEvent & { item: { label: string } | null }> | null) ?? []
      setEvents(rows.filter((r) => r.item?.label === itemLabel))
    })()
    return () => {
      cancelled = true
    }
  }, [instanceId, itemLabel])

  return (
    <Modal open onClose={onClose} title={`Audit: ${itemLabel}`} size="md">
      {events === null ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-ink-muted">No activity yet for this item today.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2">
                <Badge tone={ev.action === 'check' ? 'ok' : 'neutral'}>
                  {ev.action === 'check' ? 'Checked' : 'Unchecked'}
                </Badge>
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

export default function ChecklistsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
