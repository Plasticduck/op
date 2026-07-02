import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { endOfMonth, format, startOfMonth } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { Input } from '@/components/ui/Input'
import { MonthGrid, type MonthGridEvent } from '@/components/data/MonthGrid'
import { useAuth } from '@/lib/auth'
import { calendar, type CalendarEvent } from '@/lib/queries/people'
import { googleCalendar, type GoogleEvent, type GoogleEventsResult } from '@/lib/queries/googleCalendar'

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const isManager = profile?.role !== 'employee'
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [rows, setRows] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState<{ presetDate?: string } | null>(null)
  const [open, setOpen] = useState<CalendarEvent | null>(null)
  const [google, setGoogle] = useState<{ connected: boolean; email?: string; events: GoogleEvent[] }>(
    { connected: false, events: [] },
  )
  const [googleNotice, setGoogleNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const from = startOfMonth(month).toISOString()
    const { data } = await calendar.forLocation(locationId, from)
    const list = ((data as CalendarEvent[] | null) ?? []).filter(
      (e) => new Date(e.start_at) <= endOfMonth(month),
    )
    setRows(list)
    setLoading(false)
  }, [locationId, month])

  useEffect(() => { void load() }, [load])

  // Google Calendar overlay (read-only, per user).
  const loadGoogle = useCallback(async () => {
    const from = startOfMonth(month).toISOString()
    const to = endOfMonth(month).toISOString()
    const { data, error } = await googleCalendar.events(from, to)
    if (error) return
    const r = data as GoogleEventsResult | null
    setGoogle({ connected: !!r?.connected, email: r?.email, events: r?.events ?? [] })
  }, [month])

  useEffect(() => { void loadGoogle() }, [loadGoogle])

  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get('google')
    if (g === 'connected') setGoogleNotice('Google Calendar connected.')
    else if (g === 'error') setGoogleNotice('Could not connect Google Calendar. Please try again.')
  }, [])

  const connectGoogle = async () => {
    setGoogleNotice(null)
    const { data, error } = await googleCalendar.connectUrl()
    const res = data as { url?: string; error?: string } | null
    if (error || res?.error === 'no_key') {
      setGoogleNotice('Google Calendar is not configured yet.')
      return
    }
    if (res?.url) window.location.href = res.url
  }

  const disconnectGoogle = async () => {
    await googleCalendar.disconnect()
    setGoogle({ connected: false, events: [] })
    setGoogleNotice(null)
  }

  const events: MonthGridEvent[] = useMemo(
    () => [
      ...rows.map((r) => ({
        id: r.id,
        date: r.start_at,
        title: r.title,
        tone: 'accent' as const,
      })),
      ...google.events.map((e) => ({
        id: `g:${e.id}`,
        date: e.start,
        title: e.title,
        tone: 'ok' as const,
      })),
    ],
    [rows, google.events],
  )

  const eventsById = useMemo(() => {
    const m = new Map(rows.map((r) => [r.id, r]))
    return m
  }, [rows])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Calendar"
        subtitle="Meetings, training, and events for this location."
        actions={
          isManager ? (
            <Button onClick={() => setAdding({})}>
              <Plus className="size-4" /> Add event
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-block size-2.5 rounded-full bg-ok" aria-hidden />
          {google.connected ? (
            <span className="text-ink-muted">
              Google Calendar: <span className="text-ink">{google.email ?? 'connected'}</span>
            </span>
          ) : (
            <span className="text-ink-muted">Overlay your Google Calendar events here.</span>
          )}
        </div>
        {google.connected ? (
          <Button variant="secondary" size="sm" onClick={disconnectGoogle}>
            Disconnect Google
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={connectGoogle}>
            Connect Google Calendar
          </Button>
        )}
      </div>

      {googleNotice && (
        <div className="rounded-md border border-border bg-accent-soft/50 px-3 py-2 text-sm text-ink">
          {googleNotice}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading...</p>
      ) : (
        <MonthGrid
          month={month}
          events={events}
          onMonthChange={setMonth}
          onDayClick={isManager ? (d) => setAdding({ presetDate: format(d, 'yyyy-MM-dd') }) : undefined}
          onEventClick={(e) => {
            const row = eventsById.get(e.id)
            if (row) setOpen(row)
          }}
        />
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.title}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="text-ink-muted">
              {open.all_day
                ? format(new Date(open.start_at), 'EEEE, MMMM d') + ' . All day'
                : format(new Date(open.start_at), 'EEEE, MMMM d, h:mm a') +
                  (open.end_at ? ' to ' + format(new Date(open.end_at), 'h:mm a') : '')}
            </div>
            {open.description && <p className="whitespace-pre-wrap text-ink">{open.description}</p>}
            {isManager && (
              <div className="flex justify-end">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    await calendar.remove(open.id)
                    setOpen(null)
                    void load()
                  }}
                >
                  <Trash2 className="size-4" /> Delete event
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {adding && (
        <EventModal
          locationId={locationId}
          createdBy={profile?.id ?? null}
          presetDate={adding.presetDate}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); void load() }}
        />
      )}
    </div>
  )
}

function EventModal({ locationId, createdBy, presetDate, onClose, onSaved }: {
  locationId: string
  createdBy: string | null
  presetDate?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [date, setDate] = useState(presetDate ?? '')
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!title.trim()) return setError('Enter a title')
    if (!date) return setError('Pick a date')
    const startAt = allDay ? new Date(date + 'T00:00') : new Date(`${date}T${start}`)
    const endAt = allDay ? null : new Date(`${date}T${end}`)
    const { error: err } = await calendar.create({
      location_id: locationId,
      title: title.trim(),
      description: description.trim() || null,
      all_day: allDay,
      start_at: startAt.toISOString(),
      end_at: endAt ? endAt.toISOString() : null,
      created_by: createdBy,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add event">
      <div className="flex flex-col gap-4">
        <Field label="Title" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Team meeting" />}</Field>
        <Field label="Date" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">{(id) => <TimeSelect id={id} value={start} onChange={setStart} />}</Field>
            <Field label="End">{(id) => <TimeSelect id={id} value={end} onChange={setEnd} />}</Field>
          </div>
        )}
        <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Add event</Button></div>
      </div>
    </Modal>
  )
}

export default function CalendarPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
