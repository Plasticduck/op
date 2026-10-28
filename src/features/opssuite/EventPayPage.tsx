import { useCallback, useEffect, useState } from 'react'
import { Check, CircleCheck, ClipboardCheck, Download, Loader2, PartyPopper, Plus, Send, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { employees } from '@/lib/queries/people'
import {
  attendeesOf,
  EVENT_PAY_APPROVER,
  eventPay,
  eventPayEmailDue,
  eventPayStatus,
  fmtTime,
  hoursBetween,
  MIGHTY_MAXX_DEFAULT,
  type EventAttendee,
  type EventPayRow,
  type EventPayStatus,
} from '@/lib/queries/eventPay'
import { downloadEventPayPdf, eventPayPdfBase64, fmtEventDate } from '@/lib/reports/eventPayPdf'
import type { Json } from '@/lib/database.types'
import { cn } from '@/lib/utils'

// Event Pay Requests: the digital version of the paper check request Mighty Wash
// used to pay team members who work an event. An RM or GM lists who attended, with
// arrival / departure (hours are worked out) and whether they wore the Mighty Maxx
// suit (a flat amount); everyone else is paid their hourly rate. Submitting saves
// the request and emails it with a PDF to Tayler (copy to the submitter). A
// Regional Manager's request goes to Garland Watson first, who approves or rejects
// it in the "Waiting for your approval" queue; approving sends it to Tayler. Each
// user sees only their own requests; kevan@washlyfe.com and Tayler see every
// request, Garland every RM request, and only Kevan can delete (RLS, 0175-0177).

type Draft = { key: string; name: string; arrival: string; departure: string; mightyMaxx: boolean; amount: string }

const blankPerson = (): Draft => ({ key: crypto.randomUUID(), name: '', arrival: '', departure: '', mightyMaxx: false, amount: '' })
const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const TONE: Record<EventPayStatus['tone'], string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}
const fmtSubmitted = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function EventPayPage() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const email = (profile?.email ?? '').toLowerCase()
  const isAdmin = email === 'kevan@washlyfe.com'
  const seesAll = isAdmin || email === 'tayler@mighty-wash.com'
  const isApprover = email === EVENT_PAY_APPROVER.email
  const isRm = profile?.role_category === 'regional_manager'

  const [rows, setRows] = useState<EventPayRow[]>([])
  const [loading, setLoading] = useState(true)

  const [locationId, setLocationId] = useState(activeLocation?.id ?? '')
  const [eventName, setEventName] = useState('')
  const [eventDate, setEventDate] = useState(todayIso)
  const [requesterName, setRequesterName] = useState(profile?.name ?? '')
  const [notes, setNotes] = useState('')
  const [people, setPeople] = useState<Draft[]>(() => [blankPerson()])
  const [roster, setRoster] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ row: EventPayRow; emailed: boolean } | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  // Approver queue: which request is being decided, the reject reason being typed,
  // and the outcome message.
  const [decidingId, setDecidingId] = useState<string | null>(null)
  const [rejectFor, setRejectFor] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [decided, setDecided] = useState<{ text: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await eventPay.list()
    setRows((data as unknown as EventPayRow[]) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  // The profile can arrive after first render; fill the defaults once it does.
  useEffect(() => { if (profile?.name) setRequesterName((v) => v || profile.name) }, [profile?.name])
  useEffect(() => { if (activeLocation?.id) setLocationId((v) => v || activeLocation.id) }, [activeLocation?.id])

  // Name suggestions: the active team at the chosen site.
  useEffect(() => {
    if (!locationId) { setRoster([]); return }
    let alive = true
    void employees.listActive(locationId).then(({ data }) => {
      if (!alive) return
      setRoster(((data ?? []) as { first_name: string; last_name: string }[]).map((e) => `${e.first_name} ${e.last_name}`.trim()))
    })
    return () => { alive = false }
  }, [locationId])

  const setPerson = (key: string, patch: Partial<Draft>) =>
    setPeople((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)))

  const validate = (): string | null => {
    if (!locationId) return 'Choose the site.'
    if (!eventName.trim()) return 'Enter the event.'
    if (!eventDate) return 'Enter the event date.'
    if (!requesterName.trim()) return 'Enter who is requesting the pay.'
    for (const [i, p] of people.entries()) {
      const who = p.name.trim() || `Team member ${i + 1}`
      if (!p.name.trim()) return `Enter the name for team member ${i + 1}.`
      if (!p.arrival || !p.departure) return `Enter ${who}'s arrival and departure times.`
      if (hoursBetween(p.arrival, p.departure) <= 0) return `${who}'s departure has to be after their arrival.`
      if (p.mightyMaxx && !(Number(p.amount) > 0)) return `Enter the Mighty Maxx amount for ${who}.`
    }
    return null
  }

  const submit = async () => {
    const problem = validate()
    if (problem) { setError(problem); return }
    if (!profile) return
    setBusy(true)
    setError(null)
    setDone(null)
    const attendees: EventAttendee[] = people.map((p) => ({
      name: p.name.trim(),
      arrival: p.arrival,
      departure: p.departure,
      hours: hoursBetween(p.arrival, p.departure),
      mighty_maxx: p.mightyMaxx,
      amount: p.mightyMaxx ? Number(p.amount) : null,
    }))
    const { data, error: err } = await eventPay.create({
      account_id: profile.account_id,
      location_id: locationId || null,
      event_name: eventName.trim(),
      event_date: eventDate,
      requester_name: requesterName.trim(),
      submitted_by: profile.id,
      submitter_name: profile.name || null,
      attendees: attendees as unknown as Json,
      notes: notes.trim() || null,
    })
    if (err || !data) {
      setError(err?.message ?? 'Could not save the request.')
      setBusy(false)
      return
    }
    const row = data as unknown as EventPayRow
    const pdf = await eventPayPdfBase64(row).catch(() => null)
    const { error: mailErr } = await eventPay.email(row.id, pdf)
    setDone({ row, emailed: !mailErr })
    setEventName('')
    setNotes('')
    setPeople([blankPerson()])
    setBusy(false)
    void load()
  }

  // Re-send a request whose email didn't go out.
  const resend = async (r: EventPayRow) => {
    setSendingId(r.id)
    const pdf = await eventPayPdfBase64(r).catch(() => null)
    await eventPay.email(r.id, pdf)
    setSendingId(null)
    void load()
  }

  // Approve (emails Tayler with the PDF) or reject (with a reason) a pending request.
  const decide = async (r: EventPayRow, decision: 'approve' | 'reject') => {
    const note = rejectNote.trim()
    if (decision === 'reject' && !note) return
    setDecidingId(r.id)
    setDecided(null)
    const pdf = decision === 'approve' ? await eventPayPdfBase64(r).catch(() => null) : null
    const { error: err } = await eventPay.decide(r.id, decision, pdf, note || undefined)
    // 502 = the decision was saved but the email to Tayler didn't go out.
    const status = (err as { context?: Response } | null)?.context?.status
    if (!err) {
      setDecided({ ok: true, text: decision === 'approve' ? `Approved "${r.event_name}" and sent it to Tayler.` : `Rejected "${r.event_name}". ${r.submitter_name || 'The submitter'} was emailed the reason.` })
    } else if (decision === 'approve' && status === 502) {
      setDecided({ ok: false, text: `Approved "${r.event_name}", but the email to Tayler didn't go out. Use Send in the list below to try again.` })
    } else {
      setDecided({ ok: false, text: `Couldn't ${decision} "${r.event_name}". Refresh the page and try again.` })
    }
    setRejectFor(null)
    setRejectNote('')
    setDecidingId(null)
    void load()
  }

  const remove = async (r: EventPayRow) => {
    if (!window.confirm(`Delete the request for "${r.event_name}"? This can't be undone.`)) return
    await eventPay.remove(r.id)
    void load()
  }

  const totalHours = people.reduce((a, p) => a + (p.arrival && p.departure ? hoursBetween(p.arrival, p.departure) : 0), 0)
  const maxxTotal = people.reduce((a, p) => a + (p.mightyMaxx ? Number(p.amount) || 0 : 0), 0)
  const rosterId = 'event-pay-roster'
  const pending = isApprover ? rows.filter((r) => r.needs_approval && r.approval_status === 'pending') : []

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="Event Pay Requests"
        subtitle={`Pay team members who work an event. Requests are emailed to Tayler with a copy to you. Regional Manager requests go to ${EVENT_PAY_APPROVER.name} for approval first.`}
      />

      {decided && (
        <p className={cn('mt-4 rounded-md px-3 py-2 text-sm', decided.ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>{decided.text}</p>
      )}

      {pending.length > 0 && (
        <section className="mt-5 rounded-xl border border-warn/40 bg-card p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ClipboardCheck className="size-4 text-warn" /> Waiting for your approval
            <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">{pending.length}</span>
          </h2>
          <p className="mt-1 text-xs text-ink-muted">Requests from Regional Managers. Approving one emails it to Tayler for payroll; rejecting one emails the reason back to whoever submitted it.</p>
          <div className="mt-3 flex flex-col gap-3">
            {pending.map((r) => {
              const att = attendeesOf(r)
              const hrs = att.reduce((a, p) => a + (Number(p.hours) || 0), 0)
              const maxx = att.filter((p) => p.mighty_maxx).reduce((a, p) => a + (Number(p.amount) || 0), 0)
              const working = decidingId === r.id
              return (
                <div key={r.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{r.event_name}</p>
                      <p className="text-xs text-ink-muted">
                        {r.location?.name ?? 'No site'} · {fmtEventDate(r.event_date)} · Requested by {r.requester_name}
                        {r.submitter_name && r.submitter_name !== r.requester_name ? ` (submitted by ${r.submitter_name})` : ''} · {fmtSubmitted(r.created_at)}
                      </p>
                    </div>
                    <button type="button" onClick={() => void downloadEventPayPdf(r)}
                      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-content">
                      <Download className="size-3.5" /> PDF
                    </button>
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {att.map((p) => (
                        <tr key={p.name + p.arrival}>
                          <td className="py-1 pr-2 font-medium text-ink">{p.name}</td>
                          <td className="py-1 pr-2 text-ink-muted">{fmtTime(p.arrival)} to {fmtTime(p.departure)}</td>
                          <td className="py-1 pr-2 text-right tabular-nums text-ink-muted">{(Number(p.hours) || 0).toFixed(2)} h</td>
                          <td className="py-1 text-right text-ink-muted">{p.mighty_maxx ? `Mighty Maxx ${money(Number(p.amount) || 0)}` : 'Hourly rate'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-ink-muted">
                    {att.length} team member{att.length === 1 ? '' : 's'} · {hrs.toFixed(2)} hours{maxx ? ` · Mighty Maxx ${money(maxx)}` : ''}
                  </p>
                  {r.notes && <p className="mt-1 text-xs text-ink-muted"><strong className="text-ink">Notes:</strong> {r.notes}</p>}

                  {rejectFor === r.id ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="Why isn't this approved? This is emailed to the submitter."
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => { setRejectFor(null); setRejectNote('') }} disabled={working}>Cancel</Button>
                        <Button variant="danger" onClick={() => void decide(r, 'reject')} disabled={working || !rejectNote.trim()}>
                          {working ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => { setRejectFor(r.id); setRejectNote('') }} disabled={!!decidingId}>
                        <X className="size-4" /> Reject
                      </Button>
                      <Button onClick={() => void decide(r, 'approve')} disabled={!!decidingId}>
                        {working ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve and send to Tayler
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><PartyPopper className="size-4 text-accent" /> New request</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select a site…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Event date" required>
            {(id) => <Input id={id} type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />}
          </Field>
          <Field label="Event" required>
            {(id) => <Input id={id} value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Lubbock Christmas Parade" />}
          </Field>
          <Field label="Requested by" required hint="Usually you or the RM">
            {(id) => <Input id={id} value={requesterName} onChange={(e) => setRequesterName(e.target.value)} />}
          </Field>
        </div>

        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Team members at the event</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Check <strong className="text-ink">Mighty Maxx</strong> for whoever wore the suit: they’re paid a flat amount, usually
            ${MIGHTY_MAXX_DEFAULT} for an event up to 2 to 3 hours and more for a longer one. Everyone else is paid their hourly
            rate for the hours shown.
          </p>
          <datalist id={rosterId}>{roster.map((n) => <option key={n} value={n} />)}</datalist>

          <div className="mt-3 flex flex-col gap-3">
            {people.map((p, i) => {
              const hours = p.arrival && p.departure ? hoursBetween(p.arrival, p.departure) : null
              return (
                <div key={p.key} className="rounded-lg border border-border bg-content/40 p-3">
                  <div className="flex items-start gap-2">
                    <Field label={`Team member ${i + 1}`} required className="min-w-0 flex-1">
                      {(id) => (
                        <Input id={id} list={rosterId} value={p.name} onChange={(e) => setPerson(p.key, { name: e.target.value })} placeholder="Name" />
                      )}
                    </Field>
                    {people.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPeople((prev) => prev.filter((x) => x.key !== p.key))}
                        className="mt-7 grid size-9 shrink-0 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft"
                        aria-label="Remove team member"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Field label="Arrival" required>
                      {(id) => <TimeSelect id={id} value={p.arrival} onChange={(v) => setPerson(p.key, { arrival: v })} allowEmpty />}
                    </Field>
                    <Field label="Departure" required>
                      {(id) => <TimeSelect id={id} value={p.departure} onChange={(v) => setPerson(p.key, { departure: v })} allowEmpty />}
                    </Field>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-ink">Hours</span>
                      <span className="flex h-10 items-center text-sm font-semibold tabular-nums text-ink">{hours != null ? hours.toFixed(2) : '–'}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                      <input
                        type="checkbox"
                        checked={p.mightyMaxx}
                        onChange={(e) => setPerson(p.key, {
                          mightyMaxx: e.target.checked,
                          amount: e.target.checked && !p.amount ? String(MIGHTY_MAXX_DEFAULT) : p.amount,
                        })}
                        className="size-4 accent-accent"
                      />
                      Mighty Maxx
                    </label>
                    {p.mightyMaxx ? (
                      <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
                        Amount $
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          inputMode="decimal"
                          value={p.amount}
                          onChange={(e) => setPerson(p.key, { amount: e.target.value })}
                          className="h-9 w-24"
                        />
                      </label>
                    ) : (
                      <span className="text-xs text-ink-subtle">Paid their hourly rate</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" onClick={() => setPeople((prev) => [...prev, blankPerson()])}>
              <Plus className="size-4" /> Add team member
            </Button>
            <div className="text-sm text-ink-muted">
              {people.length} team member{people.length === 1 ? '' : 's'} · <span className="tabular-nums">{totalHours.toFixed(2)}</span> hours
              {maxxTotal > 0 && <> · Mighty Maxx <span className="tabular-nums">{money(maxxTotal)}</span></>}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <Field label="Notes" hint="Anything payroll should know (optional)">
            {(id) => (
              <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                className="w-full rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
            )}
          </Field>
        </div>

        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {done && (
          <div className={cn('mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 text-sm', done.emailed ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
            <span className="inline-flex items-center gap-2">
              <CircleCheck className="size-4" />
              {done.emailed
                ? done.row.needs_approval
                  ? `Sent to ${EVENT_PAY_APPROVER.name} for approval: ${done.row.event_name}. Once approved, it goes to Tayler. A copy was emailed to you.`
                  : `Sent to Tayler: ${done.row.event_name}. A copy was emailed to you.`
                : `Saved ${done.row.event_name}, but the email didn't go out. Use Send in the list below to try again.`}
            </span>
            <button type="button" onClick={() => void downloadEventPayPdf(done.row)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-ink hover:bg-content">
              <Download className="size-3.5" /> PDF
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {isRm ? 'Submit for approval' : 'Submit request'}
          </Button>
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">{seesAll ? 'All requests' : isApprover ? 'My requests and RM requests' : 'My requests'}</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">Loading requests…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-muted">No event pay requests yet.</p>
          ) : (
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Event date</th>
                  <th className="px-3 py-2 font-medium">Event</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium">Team members</th>
                  <th className="px-3 py-2 text-right font-medium">Hours</th>
                  <th className="px-3 py-2 text-right font-medium">Mighty Maxx</th>
                  <th className="px-3 py-2 font-medium">Requested by</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const att = attendeesOf(r)
                  const hrs = att.reduce((a, p) => a + (Number(p.hours) || 0), 0)
                  const maxx = att.filter((p) => p.mighty_maxx).reduce((a, p) => a + (Number(p.amount) || 0), 0)
                  const st = eventPayStatus(r)
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">{fmtEventDate(r.event_date)}</td>
                      <td className="px-3 py-2.5 font-medium text-ink">{r.event_name}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{r.location?.name ?? '–'}</td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        {att.map((p) => (
                          <div key={p.name + p.arrival}>
                            {p.name}{p.mighty_maxx && <span className="ml-1.5 rounded bg-accent-soft px-1 py-px text-[10px] font-semibold text-accent">MAXX</span>}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{hrs.toFixed(2)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{maxx ? money(maxx) : '–'}</td>
                      <td className="px-3 py-2.5 text-ink-muted">{r.requester_name}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', TONE[st.tone])}>{st.label}</span>
                        {r.decided_by_name && r.approval_status === 'approved' && (
                          <p className="mt-1 text-[11px] text-ink-subtle">by {r.decided_by_name}</p>
                        )}
                        {r.approval_status === 'rejected' && (
                          <p className="mt-1 max-w-[14rem] text-[11px] text-ink-muted">
                            {r.decided_by_name ? `${r.decided_by_name}: ` : ''}{r.decision_note}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          {/* Re-send: the submitter, Kevan, or (RM requests) the approver; the email function's rule. */}
                          {eventPayEmailDue(r) && (isAdmin || r.submitted_by === profile?.id || (isApprover && r.needs_approval)) && (
                            <button type="button" onClick={() => void resend(r)} disabled={sendingId === r.id}
                              className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-content disabled:opacity-50">
                              {sendingId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send
                            </button>
                          )}
                          <button type="button" onClick={() => void downloadEventPayPdf(r)}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-content">
                            <Download className="size-3.5" /> PDF
                          </button>
                          {isAdmin && (
                            <button type="button" onClick={() => void remove(r)} aria-label="Delete request"
                              className="grid size-7 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft">
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
