import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Car, Loader2, Trash2, Download, CheckCircle2, Send, CornerUpLeft, Plus, X, MapPin, Calculator } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { AddressAutocomplete, type AddressPick } from '@/components/forms/AddressAutocomplete'
import { geocodeAddress } from '@/lib/weather'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { mileage, type MileageRequest, type RouteStop } from '@/lib/queries/mileage'
import {
  POLICIES, CATEGORIES, DEPARTMENTS, BUSINESS_UNITS, CURRENCIES,
  defaultPolicy, usd, fmtDate, today, csvEsc, mdY, downloadCsv,
} from '@/lib/finance/expenseOptions'

// Mileage reimbursement submission (mirrors Corpay's Mileage expense flow) with
// the same AP review workflow as Per Diem. A user builds a route of stops; the app
// geocodes them and asks a keyless OSRM router for the driving distance, then the
// amount is miles × the IRS rate. Submitted -> AP Requests queue -> approved ->
// Complete tab -> CSV export for QuickBooks.

// IRS standard business mileage rate (2024). A per-request snapshot is stored so
// historical requests keep the rate they were filed at if this changes.
const MILEAGE_RATE = 0.67
const METERS_PER_MILE = 1609.344

// Keyless public OSRM routers (same OpenStreetMap ecosystem as Market Explorer),
// tried in order with failover.
const OSRM_HOSTS = [
  'https://router.project-osrm.org',
  'https://routing.openstreetmap.de/routed-car',
]
async function routeMiles(coords: { lat: number; lon: number }[], roundTrip: boolean): Promise<number | null> {
  if (coords.length < 2) return null
  const pts = roundTrip ? [...coords, coords[0]] : coords
  const path = pts.map((c) => `${c.lon},${c.lat}`).join(';')
  for (const host of OSRM_HOSTS) {
    try {
      const res = await fetch(`${host}/route/v1/driving/${path}?overview=false`)
      if (!res.ok) continue
      const data = (await res.json()) as { code?: string; routes?: { distance: number }[] }
      const meters = data.routes?.[0]?.distance
      if (data.code === 'Ok' && typeof meters === 'number') return meters / METERS_PER_MILE
    } catch { /* try next host */ }
  }
  return null
}

const round2 = (n: number) => Math.round(n * 100) / 100
const stopsOf = (r: MileageRequest): RouteStop[] => (Array.isArray(r.stops) ? (r.stops as unknown as RouteStop[]) : [])

// Shorten a full address to "street, city" for a readable description line.
const shortStop = (address: string) => {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : address.trim()
}
// Format a single date, or a start–end range for multi-day trips.
const dateRange = (start: string | null, end: string | null) =>
  !start ? '' : end && end !== start ? `${fmtDate(start)} – ${fmtDate(end)}` : fmtDate(start)

// Assemble the Description from the trip's date(s), destinations, and purpose.
function buildDescription(startStr: string, endStr: string, stops: RouteStop[], roundTrip: boolean, purpose: string): string {
  const dests = stops.map((s) => s.address.trim()).filter(Boolean).map(shortStop)
  if (dests.length === 0 && !purpose.trim()) return ''
  const segs: string[] = []
  const d = dateRange(startStr, endStr || null)
  if (d) segs.push(d)
  if (dests.length) segs.push(dests.join(' → ') + (roundTrip ? ' (round trip)' : ''))
  if (purpose.trim()) segs.push(purpose.trim())
  return segs.join(' · ')
}
const routeText = (r: MileageRequest) => stopsOf(r).map((s) => s.address).filter(Boolean).join(' → ') + (r.round_trip ? ' (round trip)' : '')

// --- CSV export (Complete tab) ---
const CSV_HEADERS = [
  'Employee', 'Policy', 'Category', 'Department', 'Business Unit', 'Date', 'End Date',
  'Miles', 'Rate', 'Amount', 'Currency', 'Round Trip', 'Route', 'Description', 'Submitted', 'Approved By', 'Approved Date',
] as const
function mileageCsv(rows: MileageRequest[]): string {
  const lines = rows.map((r) => [
    r.requested_by_name ?? '', r.policy ?? '', r.category ?? '', r.department ?? '', r.business_unit ?? '',
    mdY(r.expense_date), mdY(r.end_date), String(Number(r.miles) || 0), String(Number(r.rate) || MILEAGE_RATE), String(Number(r.amount) || 0),
    r.currency ?? 'USD', r.round_trip ? 'Yes' : 'No', stopsOf(r).map((s) => s.address).filter(Boolean).join(' > '),
    r.description ?? '', mdY(r.submitted_at), r.approved_by_name ?? '', mdY(r.approved_at),
  ].map(csvEsc).join(','))
  return [CSV_HEADERS.map(csvEsc).join(','), ...lines].join('\r\n') + '\r\n'
}
function csvFilename(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  return `MILEAGE-${mm}${now.getFullYear()}-${String(now.getTime()).slice(-6)}.csv`
}

const emptyStop = (): RouteStop => ({ address: '', lat: null, lon: null })
type AdminTab = 'requests' | 'complete'

export default function MileagePage() {
  const { profile } = useAuth()
  const isAP = profile?.role === 'owner' || profile?.role_category === 'finance'

  const [policy, setPolicy] = useState(() => defaultPolicy(profile?.role, profile?.role_category))
  const [expenseDate, setExpenseDate] = useState(today)
  const [multiDay, setMultiDay] = useState(false)
  const [endDate, setEndDate] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [purpose, setPurpose] = useState('')
  const [description, setDescription] = useState('')
  // Description auto-fills from date/destinations/purpose until the user edits it.
  const [descriptionTouched, setDescriptionTouched] = useState(false)
  const [category, setCategory] = useState('Mileage')
  const [department, setDepartment] = useState('')
  const [businessUnit, setBusinessUnit] = useState('')

  // Route builder.
  const [stops, setStops] = useState<RouteStop[]>([emptyStop(), emptyStop()])
  const [roundTrip, setRoundTrip] = useState(false)
  const [miles, setMiles] = useState('')
  const [calcBusy, setCalcBusy] = useState(false)
  const [calcError, setCalcError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const [rows, setRows] = useState<MileageRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<AdminTab>('requests')
  const [openId, setOpenId] = useState<string | null>(null)

  const amount = round2((Number(miles) || 0) * MILEAGE_RATE)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await mileage.list()
    setRows((data as MileageRequest[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  // Keep Description in sync with the date, route, and purpose — unless the user
  // has hand-edited it (then we leave their text alone until they reset).
  useEffect(() => {
    if (descriptionTouched) return
    setDescription(buildDescription(expenseDate, multiDay ? endDate : '', stops, roundTrip, purpose))
  }, [expenseDate, endDate, multiDay, stops, roundTrip, purpose, descriptionTouched])

  // Any structural change to the route invalidates a previously computed distance.
  const setStopText = (i: number, v: string) => {
    setMiles('')
    setStops((prev) => prev.map((s, idx) => (idx === i ? { address: v, lat: null, lon: null } : s)))
  }
  const pickStop = (i: number, pick: AddressPick) => {
    setMiles('')
    setStops((prev) => prev.map((s, idx) => (idx === i ? { address: pick.address, lat: pick.lat, lon: pick.lon } : s)))
  }
  const addStop = () => { setMiles(''); setStops((prev) => [...prev, emptyStop()]) }
  const removeStop = (i: number) => { setMiles(''); setStops((prev) => prev.filter((_, idx) => idx !== i)) }
  const toggleRoundTrip = () => { setMiles(''); setRoundTrip((v) => !v) }
  const toggleMultiDay = () => {
    const next = !multiDay
    setMultiDay(next)
    setEndDate(next ? (endDate || expenseDate) : '')
  }

  const calculate = async () => {
    setCalcError(null)
    const filled = stops.filter((s) => s.address.trim())
    if (filled.length < 2) { setCalcError('Add at least a start and a destination.'); return }
    setCalcBusy(true)
    // Resolve coordinates: picked suggestions already carry them; geocode any
    // free-typed stops.
    const next = [...stops]
    const resolved: { lat: number; lon: number }[] = []
    for (let i = 0; i < next.length; i++) {
      const s = next[i]
      if (!s.address.trim()) continue
      let { lat, lon } = s
      if (lat == null || lon == null) {
        const geo = await geocodeAddress(s.address)
        if (!geo) { setCalcBusy(false); setCalcError(`Couldn't find "${s.address}". Try picking it from the suggestions.`); return }
        lat = geo.lat; lon = geo.lon
        next[i] = { ...s, lat, lon }
      }
      resolved.push({ lat, lon })
    }
    setStops(next)
    const mi = await routeMiles(resolved, roundTrip)
    setCalcBusy(false)
    if (mi == null) { setCalcError('Could not calculate the driving distance. Check the addresses and try again.'); return }
    setMiles(mi.toFixed(1))
  }

  const resetForm = () => {
    setPurpose(''); setDescription(''); setDescriptionTouched(false)
    setDepartment(''); setBusinessUnit(''); setCategory('Mileage')
    setExpenseDate(today()); setMultiDay(false); setEndDate('')
    setStops([emptyStop(), emptyStop()]); setRoundTrip(false); setMiles('')
    setCalcError(null)
  }

  const submit = async (status: 'draft' | 'submitted') => {
    setError(null); setSaved(null)
    const filledStops = stops.filter((s) => s.address.trim())
    const mi = Number(miles)
    if (status === 'submitted') {
      if (!policy) return setError('Choose a policy.')
      if (!expenseDate) return setError('Choose a date.')
      if (multiDay && !endDate) return setError('Choose an end date.')
      if (multiDay && endDate < expenseDate) return setError('The end date must be on or after the start date.')
      if (filledStops.length < 2) return setError('Add at least a start and a destination.')
      if (!(mi > 0)) return setError('Calculate the mileage (or enter the miles) first.')
      if (!purpose.trim()) return setError('Add the purpose of the trip.')
      if (!description.trim()) return setError('Add a description.')
      if (!category || !department || !businessUnit) return setError('Choose a category, department, and business unit.')
    }
    setBusy(true)
    const { error: err } = await mileage.create({
      account_id: profile?.account_id ?? '',
      requested_by: profile?.id ?? null,
      requested_by_name: profile?.name ?? null,
      policy, expense_date: expenseDate, end_date: multiDay ? endDate : null, currency,
      stops: filledStops as unknown as MileageRequest['stops'],
      round_trip: roundTrip,
      miles: Number.isFinite(mi) ? mi : 0,
      rate: MILEAGE_RATE,
      amount: round2((Number.isFinite(mi) ? mi : 0) * MILEAGE_RATE),
      description: description.trim() || null,
      category: category || null, department: department || null, business_unit: businessUnit || null,
      status,
      submitted_at: status === 'submitted' ? new Date().toISOString() : null,
    })
    setBusy(false)
    if (err) return setError(err.message)
    setSaved(status === 'submitted' ? 'Submitted to AP.' : 'Draft saved.')
    resetForm()
    void load()
  }

  const submitDraft = async (r: MileageRequest) => {
    setBusy(true)
    await mileage.update(r.id, { status: 'submitted', submitted_at: new Date().toISOString() })
    setBusy(false); void load()
  }
  const approve = async (r: MileageRequest) => {
    setBusy(true)
    await mileage.update(r.id, {
      status: 'approved', approved_at: new Date().toISOString(),
      approved_by: profile?.id ?? null, approved_by_name: profile?.name ?? null,
    })
    setBusy(false); setOpenId(null); void load()
  }
  const unapprove = async (r: MileageRequest) => {
    setBusy(true)
    await mileage.update(r.id, { status: 'submitted', approved_at: null, approved_by: null, approved_by_name: null })
    setBusy(false); setOpenId(null); void load()
  }
  const remove = async (r: MileageRequest) => {
    if (!window.confirm('Delete this mileage request? This cannot be undone.')) return
    setBusy(true)
    await mileage.remove(r.id)
    setBusy(false); setOpenId(null); void load()
  }

  const myId = profile?.id ?? null
  const myRows = useMemo(() => rows.filter((r) => r.requested_by === myId), [rows, myId])
  const myDrafts = useMemo(() => myRows.filter((r) => r.status === 'draft'), [myRows])
  const submitted = useMemo(() => rows.filter((r) => r.status === 'submitted'), [rows])
  const approved = useMemo(() => rows.filter((r) => r.status === 'approved'), [rows])

  const exportComplete = () => { if (approved.length) downloadCsv(csvFilename(), mileageCsv(approved)) }
  const openRow = openId ? rows.find((r) => r.id === openId) ?? null : null

  const canSubmitStops = stops.filter((s) => s.address.trim()).length >= 2

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="Mileage" subtitle="Submit mileage reimbursement requests to Accounts Payable." />

      <div className="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-xs text-ink-muted">
        <strong className="text-ink">Early version.</strong> Build your route and we'll pull the driving miles automatically (reimbursed at {usd(MILEAGE_RATE)}/mile). Policy and Category options are still placeholders to finalize with AP.
      </div>

      {/* Submission form */}
      <section className="mt-5 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Car className="size-4 text-accent" /> New mileage request</h2>

        <div className="mt-4 flex justify-end">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
            <input type="checkbox" checked={multiDay} onChange={toggleMultiDay} className="size-4 cursor-pointer accent-accent" />
            Multi-day trip
          </label>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Employee">
            {(id) => <Input id={id} value={profile?.name ?? ''} readOnly className="bg-content text-ink-muted" />}
          </Field>
          <Field label="Policy" required>
            {(id) => (
              <Select id={id} value={policy} onChange={(e) => setPolicy(e.target.value)}>
                {POLICIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
            )}
          </Field>
          {multiDay ? (
            <>
              <Field label="Start date" required>
                {(id) => <Input id={id} type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />}
              </Field>
              <Field label="End date" required>
                {(id) => <Input id={id} type="date" value={endDate} min={expenseDate || undefined} onChange={(e) => setEndDate(e.target.value)} />}
              </Field>
            </>
          ) : (
            <Field label="Date" required>
              {(id) => <Input id={id} type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />}
            </Field>
          )}
          <Field label="Currency">
            {(id) => (
              <Select id={id} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
        </div>

        {/* Route builder */}
        <div className="mt-5 rounded-lg border border-border bg-content/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Route</h3>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-muted">
              <input type="checkbox" checked={roundTrip} onChange={toggleRoundTrip} className="size-4 cursor-pointer accent-accent" />
              Round trip (return to start)
            </label>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            {stops.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">
                  {i === 0 ? 'A' : String.fromCharCode(65 + i)}
                </span>
                <div className="min-w-0 flex-1">
                  <AddressAutocomplete
                    value={s.address}
                    placeholder={i === 0 ? 'Start address' : i === stops.length - 1 ? 'Destination address' : 'Stop address'}
                    onChange={(v) => setStopText(i, v)}
                    onSelect={(pick) => pickStop(i, pick)}
                  />
                </div>
                {stops.length > 2 && (
                  <button type="button" onClick={() => removeStop(i)} title="Remove stop"
                    className="grid size-8 shrink-0 place-items-center rounded-md border border-border text-ink-muted hover:text-danger">
                    <X className="size-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={addStop}><Plus className="size-4" /> Add stop</Button>
            <Button variant="secondary" size="sm" onClick={() => void calculate()} disabled={!canSubmitStops || calcBusy}>
              {calcBusy ? <Loader2 className="size-4 animate-spin" /> : <Calculator className="size-4" />} Calculate mileage
            </Button>
            <span className="text-xs text-ink-subtle"><MapPin className="mb-0.5 mr-1 inline size-3.5" />Driving distance via OpenStreetMap</span>
          </div>
          {calcError && <p className="mt-2 text-xs text-danger">{calcError}</p>}

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Miles" required>
              {(id) => <Input id={id} type="number" min="0" step="0.1" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} placeholder="0.0" />}
            </Field>
            <Field label="Rate">
              {(id) => <Input id={id} value={`${usd(MILEAGE_RATE)} / mile`} readOnly className="bg-content text-ink-muted" />}
            </Field>
            <Field label="Amount">
              {(id) => <Input id={id} value={usd(amount)} readOnly className="bg-content font-semibold text-ink" />}
            </Field>
          </div>
          <p className="mt-1 text-xs text-ink-subtle">Miles is auto-filled by Calculate; you can adjust it if needed. Amount = miles × rate.</p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4">
          <Field label="Purpose of trip" required>
            {(id) => <Input id={id} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Quarterly site inspections" />}
          </Field>
          <Field label="Description">
            {(id) => (
              <>
                <Input id={id} value={description} onChange={(e) => { setDescriptionTouched(true); setDescription(e.target.value) }} placeholder="Auto-filled from date, destinations, and purpose" />
                <p className="mt-1 text-xs text-ink-subtle">
                  Auto-filled from the date, your route, and the purpose.
                  {descriptionTouched && (
                    <button type="button" onClick={() => { setDescriptionTouched(false); setDescription(buildDescription(expenseDate, multiDay ? endDate : '', stops, roundTrip, purpose)) }} className="ml-1 font-medium text-accent hover:underline">
                      Reset to auto
                    </button>
                  )}
                </p>
              </>
            )}
          </Field>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Expense allocations</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Category" required>
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Department" required>
              {(id) => (
                <Select id={id} value={department} onChange={(e) => setDepartment(e.target.value)}>
                  <option value="">Select…</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Business unit" required>
              {(id) => (
                <Select id={id} value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)}>
                  <option value="">Select…</option>
                  {BUSINESS_UNITS.map((b) => <option key={b} value={b}>{b}</option>)}
                </Select>
              )}
            </Field>
          </div>
        </div>

        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {saved && <p className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">{saved}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => void submit('draft')} disabled={busy}>Save draft</Button>
          <Button onClick={() => void submit('submitted')} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Submit to AP
          </Button>
        </div>
      </section>

      {/* My drafts */}
      {myDrafts.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">My drafts</h2>
          <MileageTable
            rows={myDrafts} loading={false}
            columns={['date', 'policy', 'miles', 'amount', 'status']}
            empty="No drafts."
            renderActions={(r) => (
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => void submitDraft(r)} disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-content disabled:opacity-50">
                  <Send className="size-3.5" /> Submit
                </button>
                <IconDelete onClick={() => void remove(r)} />
              </div>
            )}
          />
        </section>
      )}

      {/* Non-AP submitters: their own submitted/approved requests (read-only). */}
      {!isAP && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink">My requests</h2>
          <MileageTable
            rows={myRows.filter((r) => r.status !== 'draft')} loading={loading}
            columns={['date', 'policy', 'route', 'miles', 'amount', 'status']}
            empty="You haven't submitted any mileage requests yet."
          />
        </section>
      )}

      {/* AP review workflow */}
      {isAP && (
        <section className="mt-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border">
            <TabButton active={tab === 'requests'} onClick={() => setTab('requests')} label="Requests" count={submitted.length} />
            <TabButton active={tab === 'complete'} onClick={() => setTab('complete')} label="Complete" count={approved.length} />
          </div>

          {tab === 'requests' ? (
            <div className="mt-4">
              <p className="mb-3 text-sm text-ink-muted">Submitted mileage requests awaiting review. Open one to check the route, then mark it approved.</p>
              <MileageTable
                rows={submitted} loading={loading}
                columns={['date', 'employee', 'policy', 'route', 'miles', 'amount']}
                empty="No requests waiting for review."
                onRowClick={(r) => setOpenId(r.id)}
              />
            </div>
          ) : (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-muted">Approved mileage requests, ready to export for QuickBooks.</p>
                <Button variant="secondary" onClick={exportComplete} disabled={approved.length === 0}>
                  <Download className="size-4" /> Export to CSV
                </Button>
              </div>
              <MileageTable
                rows={approved} loading={loading}
                columns={['date', 'employee', 'policy', 'miles', 'amount', 'approvedBy']}
                empty="No approved mileage requests yet."
                onRowClick={(r) => setOpenId(r.id)}
              />
            </div>
          )}
        </section>
      )}

      {isAP && openRow && (
        <ReviewModal
          row={openRow} busy={busy}
          onClose={() => setOpenId(null)}
          onApprove={() => void approve(openRow)}
          onUnapprove={() => void unapprove(openRow)}
          onDelete={() => void remove(openRow)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

type Col = 'date' | 'employee' | 'policy' | 'route' | 'miles' | 'amount' | 'status' | 'approvedBy'
const COL_LABEL: Record<Col, string> = {
  date: 'Date', employee: 'Employee', policy: 'Policy', route: 'Route',
  miles: 'Miles', amount: 'Amount', status: 'Status', approvedBy: 'Approved by',
}

function statusBadge(status: string) {
  if (status === 'approved') return <Badge tone="ok">Approved</Badge>
  if (status === 'submitted') return <Badge tone="accent">Submitted</Badge>
  return <Badge tone="neutral">Draft</Badge>
}

function MileageTable({
  rows, loading, columns, empty, onRowClick, renderActions,
}: {
  rows: MileageRequest[]
  loading: boolean
  columns: Col[]
  empty: string
  onRowClick?: (r: MileageRequest) => void
  renderActions?: (r: MileageRequest) => ReactNode
}) {
  const colSpan = columns.length + (renderActions ? 1 : 0)
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            {columns.map((c) => (
              <th key={c} className={cn('px-3 py-2.5 font-medium', (c === 'amount' || c === 'miles') && 'text-right')}>{COL_LABEL[c]}</th>
            ))}
            {renderActions && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-ink-muted">Loading…</td></tr>
          ) : rows.length === 0 ? (
            <tr><td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-ink-muted">{empty}</td></tr>
          ) : rows.map((r) => (
            <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={cn('border-t border-border hover:bg-content', onRowClick && 'cursor-pointer')}>
              {columns.map((c) => <td key={c} className={cn('px-3 py-2.5', cellClass(c))}>{cell(r, c)}</td>)}
              {renderActions && <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>{renderActions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function cellClass(c: Col): string {
  if (c === 'amount' || c === 'miles') return 'text-right tabular text-ink'
  if (c === 'employee') return 'text-ink'
  return 'text-ink-muted'
}
function cell(r: MileageRequest, c: Col): ReactNode {
  switch (c) {
    case 'date': return dateRange(r.expense_date, r.end_date)
    case 'employee': return r.requested_by_name ?? '—'
    case 'policy': return r.policy ?? '—'
    case 'route': return <span className="line-clamp-1 max-w-[280px]">{routeText(r) || '—'}</span>
    case 'miles': return (Number(r.miles) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })
    case 'amount': return <span className="font-semibold">{usd(Number(r.amount) || 0)}</span>
    case 'status': return statusBadge(r.status)
    case 'approvedBy': return r.approved_by_name ?? '—'
  }
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
        active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
      <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
        active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted')}>{count}</span>
    </button>
  )
}

function IconDelete({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="Delete"
      className="grid size-8 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft">
      <Trash2 className="size-4" />
    </button>
  )
}

function ReviewModal({
  row, busy, onClose, onApprove, onUnapprove, onDelete,
}: {
  row: MileageRequest
  busy: boolean
  onClose: () => void
  onApprove: () => void
  onUnapprove: () => void
  onDelete: () => void
}) {
  const isApproved = row.status === 'approved'
  const stops = stopsOf(row)
  return (
    <Modal open onClose={onClose} title="Mileage request" size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          {statusBadge(row.status)}
          <span className="text-2xl font-semibold tabular text-ink">{usd(Number(row.amount) || 0)}</span>
        </div>

        {/* Route */}
        <div className="rounded-md border border-border bg-content/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Route{row.round_trip ? ' · round trip' : ''}</span>
            <span className="text-xs text-ink-muted">{(Number(row.miles) || 0).toLocaleString('en-US', { maximumFractionDigits: 1 })} mi × {usd(Number(row.rate) || MILEAGE_RATE)}</span>
          </div>
          <ol className="flex flex-col gap-1.5">
            {stops.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-ink">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{String.fromCharCode(65 + i)}</span>
                {s.address}
              </li>
            ))}
            {row.round_trip && stops[0] && (
              <li className="flex items-start gap-2 text-sm text-ink-muted">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-content text-[10px] font-semibold text-ink-muted">↩</span>
                Return to {stops[0].address}
              </li>
            )}
          </ol>
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Detail label="Employee" value={row.requested_by_name ?? '—'} />
          <Detail label="Policy" value={row.policy ?? '—'} />
          <Detail label={row.end_date ? 'Dates' : 'Date'} value={dateRange(row.expense_date, row.end_date)} />
          <Detail label="Currency" value={row.currency ?? 'USD'} />
          <Detail label="Category" value={row.category ?? '—'} />
          <Detail label="Department" value={row.department ?? '—'} />
          <Detail label="Business unit" value={row.business_unit ?? '—'} />
          <Detail label="Submitted" value={fmtDate(row.submitted_at)} />
          <div className="sm:col-span-2"><Detail label="Description" value={row.description ?? '—'} /></div>
          {isApproved && (
            <div className="sm:col-span-2"><Detail label="Approved" value={`${row.approved_by_name ?? 'AP'} • ${fmtDate(row.approved_at)}`} /></div>
          )}
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={onDelete} disabled={busy}>
            <Trash2 className="size-4" /> Delete
          </Button>
          <div className="flex gap-2">
            {isApproved ? (
              <Button variant="secondary" onClick={onUnapprove} disabled={busy}>
                <CornerUpLeft className="size-4" /> Move back to Requests
              </Button>
            ) : (
              <Button onClick={onApprove} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Mark approved
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}
