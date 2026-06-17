import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Trash2, Save, Loader2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { useLocations } from '@/lib/locations'
import { compareLocationName, cn } from '@/lib/utils'
import { dateTime, timeOfDay } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { checklists, type ChecklistItemEvent } from '@/lib/queries/ops'

type TemplateRow = {
  id: string
  account_id: string | null
  name: string
  description: string | null
  opens_at_local: string
  closes_at_local: string | null
  days_of_week: number[]
  reset_policy: string
  archived: boolean
  locations: { location_id: string }[]
}

type ItemRow = { id: string; label: string; order_index: number }

type ResetPolicy = 'daily' | 'weekly' | 'manual'

type EventWithItem = ChecklistItemEvent & { item: { label: string } | null }

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function pillClass(active: boolean): string {
  return cn(
    'rounded-full px-3 py-1.5 text-sm font-medium transition',
    active
      ? 'bg-accent text-white'
      : 'bg-card border border-border text-ink-muted hover:text-ink',
  )
}

export default function ChecklistDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { locations } = useLocations()

  const [template, setTemplate] = useState<TemplateRow | null>(null)
  const [items, setItems] = useState<ItemRow[]>([])
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [opensAt, setOpensAt] = useState('09:00')
  const [closesAt, setClosesAt] = useState('')
  const [resetPolicy, setResetPolicy] = useState<ResetPolicy>('daily')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [newItemLabel, setNewItemLabel] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [events, setEvents] = useState<EventWithItem[]>([])
  const [tab, setTab] = useState<'settings' | 'audit'>('settings')
  const [loading, setLoading] = useState(true)
  const [todayInstanceIds, setTodayInstanceIds] = useState<string[]>([])

  const load = async () => {
    if (!id) return
    setLoading(true)
    const [tpl, its] = await Promise.all([
      checklists.template(id),
      checklists.items(id),
    ])
    const t = (tpl.data as TemplateRow | null) ?? null
    setTemplate(t)
    setItems((its.data as ItemRow[] | null) ?? [])
    if (t) {
      setName(t.name)
      setDescription(t.description ?? '')
      setOpensAt(t.opens_at_local?.slice(0, 5) ?? '09:00')
      setClosesAt(t.closes_at_local ? t.closes_at_local.slice(0, 5) : '')
      setDaysOfWeek(t.days_of_week ?? [])
      setResetPolicy((t.reset_policy as ResetPolicy) ?? 'daily')
      const assigned = (t.locations ?? []).map((r) => r.location_id)
      setLocationIds(assigned)

      const ensured = await Promise.all(
        assigned.map((locId) => checklists.ensureTodayForLocation(locId)),
      )
      const instanceIds: string[] = []
      for (const r of ensured) {
        const rows = (r.data as { id: string; checklist_id: string }[] | null) ?? []
        for (const row of rows) {
          if (row.checklist_id === t.id) instanceIds.push(row.id)
        }
      }
      setTodayInstanceIds(instanceIds)

      const eventBatches = await Promise.all(
        instanceIds.map((iid) => checklists.eventsForInstance(iid)),
      )
      const all: EventWithItem[] = []
      for (const b of eventBatches) {
        const rows = (b.data as EventWithItem[] | null) ?? []
        all.push(...rows)
      }
      all.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
      setEvents(all)
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (tab !== 'audit' || todayInstanceIds.length === 0) return
    const channel = supabase
      .channel(`checklist-events-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'checklist_item_events',
          filter: `instance_id=in.(${todayInstanceIds.join(',')})`,
        },
        async (payload) => {
          const row = payload.new as ChecklistItemEvent
          const itemRow = items.find((i) => i.id === row.item_id)
          setEvents((prev) => [
            { ...row, item: itemRow ? { label: itemRow.label } : null },
            ...prev,
          ])
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [tab, todayInstanceIds, id, items])

  useEffect(() => {
    if (!savedAt) return
    const t = window.setTimeout(() => setSavedAt(null), 3000)
    return () => window.clearTimeout(t)
  }, [savedAt])

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>
  if (!template) return <p className="text-sm text-ink-muted">Checklist not found.</p>

  const toggleDay = (d: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    )
  }

  const toggleLocation = (locId: string) => {
    setLocationIds((prev) =>
      prev.includes(locId) ? prev.filter((x) => x !== locId) : [...prev, locId],
    )
  }

  const addItem = async () => {
    if (!id) return
    const label = newItemLabel.trim()
    if (!label) return
    await checklists.addItem({
      checklist_id: id,
      label,
      order_index: items.length,
    })
    setNewItemLabel('')
    const { data } = await checklists.items(id)
    setItems((data as ItemRow[] | null) ?? [])
  }

  const removeItem = async (itemId: string) => {
    if (!id) return
    await checklists.removeItem(itemId)
    const { data } = await checklists.items(id)
    setItems((data as ItemRow[] | null) ?? [])
  }

  const saveSettings = async () => {
    if (!id) return
    setSavingTemplate(true)
    await checklists.updateTemplate(id, {
      name,
      description: description || null,
      opens_at_local: opensAt,
      closes_at_local: closesAt || null,
      days_of_week: daysOfWeek,
      reset_policy: resetPolicy,
    })
    await checklists.setLocations(id, locationIds)
    setSavingTemplate(false)
    setSavedAt(new Date())
  }

  const archive = async () => {
    if (!id) return
    if (!window.confirm('Archive this checklist template? It will stop generating daily instances.')) return
    await checklists.archiveTemplate(id)
    navigate('/app/checklists/templates')
  }

  const today = new Date().getDay()
  const scheduledToday = daysOfWeek.includes(today)
  const sortedLocations = [...locations].sort((a, b) => compareLocationName(a.name, b.name))

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/app/checklists/templates"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Back to templates
      </Link>

      <PageHeader
        title={name}
        subtitle="Checklist template settings + audit log"
        actions={
          <Badge tone={scheduledToday ? 'ok' : 'neutral'}>
            {scheduledToday ? 'Today is scheduled' : 'Today is skipped'}
          </Badge>
        }
      />

      <div className="flex gap-1 rounded-md border border-border bg-card p-1 w-fit">
        <button
          onClick={() => setTab('settings')}
          className={cn(
            'rounded px-3 py-1.5 text-sm font-medium transition',
            tab === 'settings' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          Settings
        </button>
        <button
          onClick={() => setTab('audit')}
          className={cn(
            'rounded px-3 py-1.5 text-sm font-medium transition',
            tab === 'audit' ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
          )}
        >
          Audit log
        </button>
      </div>

      {tab === 'settings' ? (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-ink">Basics</h2>
            <Field label="Name" required>
              {(id) => (
                <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />
              )}
            </Field>
            <Field label="Description">
              {(id) => (
                <textarea
                  id={id}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
                />
              )}
            </Field>
          </section>

          <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-ink">Schedule</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Opens at">
                {(id) => <TimeSelect id={id} value={opensAt} onChange={setOpensAt} />}
              </Field>
              <Field
                label="Closes at (optional)"
                hint="Leave blank to keep the checklist open all day."
              >
                {() => <TimeSelect value={closesAt} onChange={setClosesAt} allowEmpty />}
              </Field>
            </div>

            <Field label="Days of week">
              {() => (
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, idx) => {
                    const active = daysOfWeek.includes(idx)
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleDay(idx)}
                        className={pillClass(active)}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
            </Field>

            <Field
              label="Reset policy"
              hint="Daily: checks reset every day. Weekly: checks persist Mon-Sun and reset Monday. Manual: never auto-resets."
            >
              {(id) => (
                <Select
                  id={id}
                  value={resetPolicy}
                  onChange={(e) => setResetPolicy(e.target.value as ResetPolicy)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="manual">Manual</option>
                </Select>
              )}
            </Field>
          </section>

          <section className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-ink">Assign to locations</h2>
            {sortedLocations.length === 0 ? (
              <p className="text-sm text-ink-muted">No locations available.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sortedLocations.map((loc) => {
                  const active = locationIds.includes(loc.id)
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggleLocation(loc.id)}
                      className={pillClass(active)}
                    >
                      {loc.name}
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-ink">Items</h2>
            {items.length === 0 ? (
              <p className="text-sm text-ink-muted">No items yet. Add one below.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {items.map((it) => (
                  <li key={it.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink">{it.label}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void removeItem(it.id)}
                      aria-label="Delete item"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                value={newItemLabel}
                onChange={(e) => setNewItemLabel(e.target.value)}
                placeholder="New item label"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addItem()
                  }
                }}
              />
              <Button variant="secondary" onClick={() => void addItem()}>
                <Plus className="size-4" /> Add item
              </Button>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="danger" onClick={() => void archive()}>
              Archive template
            </Button>
            <div className="flex items-center gap-3">
              {savedAt && (
                <span className="text-xs text-ok">
                  Saved at {timeOfDay(`${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`)}
                </span>
              )}
              <Button onClick={() => void saveSettings()} disabled={savingTemplate}>
                {savingTemplate ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                Save settings
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Today's activity</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Every check or uncheck across the assigned sites is logged here.
            </p>
          </div>
          {events.length === 0 ? (
            <EmptyState title="No activity today yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {events.map((event) => (
                <li
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div>
                    <span className="font-medium text-ink">
                      {event.item?.label ?? 'Item'}
                    </span>
                    <span className="ml-2 text-xs text-ink-subtle">
                      by {event.actor_name ?? 'Unknown'} at {dateTime(event.occurred_at)}
                    </span>
                  </div>
                  <Badge tone={event.action === 'check' ? 'ok' : 'neutral'}>
                    {event.action === 'check' ? 'checked' : 'unchecked'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
