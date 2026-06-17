import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Lock, Plus, Receipt, Sparkles, Trash2, Unlock } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { AuditHistory } from '@/components/data/AuditHistory'
import { currency, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { closeouts, type Closeout } from '@/lib/queries/ops'

type Row = Closeout & { submitted_by: { name: string } | null }

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function Inner({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await closeouts.list(locationId)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const today = format(new Date(), 'yyyy-MM-dd')
  const hasToday = rows.some((r) => r.date === today)
  const weekStart = Date.now() - 7 * 24 * 3600 * 1000
  const weekSales = rows
    .filter((r) => new Date(r.date).getTime() >= weekStart)
    .reduce((a, r) => a + r.total_sales, 0)
  const avgDaily = rows.length ? rows.reduce((a, r) => a + r.total_sales, 0) / rows.length : 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Closeouts"
        subtitle="End-of-day sales reconciliation."
        actions={<Button onClick={() => setSubmitting(true)} disabled={hasToday}>
          <Plus className="size-4" /> {hasToday ? "Today submitted" : "Submit today's closeout"}
        </Button>}
      />

      <StatCardRow
        items={[
          { label: 'Today', value: hasToday ? 'Submitted' : 'Pending' },
          { label: 'Sales (7d)', value: currency(weekSales) },
          { label: 'Avg / day', value: currency(avgDaily) },
          { label: 'Records', value: rows.length },
        ]}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="No closeouts yet" description="Submit an end-of-day closeout to start tracking sales." action={<Button onClick={() => setSubmitting(true)}>Submit closeout</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium numeric">Sales</th>
                <th className="px-3 py-2.5 font-medium numeric">Total</th>
                <th className="px-3 py-2.5 font-medium numeric">Cash</th>
                <th className="px-3 py-2.5 font-medium numeric">Card</th>
                <th className="px-3 py-2.5 font-medium numeric">Deposit</th>
                <th className="px-3 py-2.5 font-medium">By</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const discrepancy = Math.abs(r.total_sales - r.deposit_amount) > 0.005 && r.deposit_amount > 0
                const hasGsr = r.sales_data != null
                const auto = r.gsr_extracted_at != null
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-content">
                    <td className="px-3 py-2.5 font-medium text-ink">
                      <div className="flex items-center gap-2">
                        <span>{shortDate(r.date)}</span>
                        {hasGsr && <Badge tone="accent">GSR</Badge>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 numeric tabular text-ink">
                      {currency(r.total_sales)}
                      {auto && <span className="ml-1 text-xs text-ink-muted">(auto)</span>}
                    </td>
                    <td className="px-3 py-2.5 numeric tabular text-ink">{currency(r.total_sales)}</td>
                    <td className="px-3 py-2.5 numeric tabular text-ink-muted">{currency(r.cash_amount)}</td>
                    <td className="px-3 py-2.5 numeric tabular text-ink-muted">{currency(r.card_amount)}</td>
                    <td className="px-3 py-2.5 numeric tabular">
                      <span className={discrepancy ? 'text-danger' : 'text-ink-muted'}>{currency(r.deposit_amount)}</span>
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{r.submitted_by?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.locked ? (
                        <Badge tone="neutral"><Lock className="size-3" /> Locked</Badge>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>Edit</Button>
                      )}
                      {r.locked && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                          <Unlock className="size-3.5" /> Unlock
                        </Button>
                      )}
                      <AuditHistory rowId={r.id} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {submitting && <CloseoutModal locationId={locationId} onClose={() => setSubmitting(false)} onSaved={() => { setSubmitting(false); void load() }} />}
      {editing && <CloseoutModal locationId={locationId} existing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load() }} />}
    </div>
  )
}

type ExtractedGsr = {
  total_sales?: number | null
  cash?: number | null
  credit?: number | null
  deposit?: number | null
  car_count?: number | null
  wash_packages?: unknown
  memberships?: unknown
  notes?: string | null
  report_date?: string | null
  [key: string]: unknown
}

function CloseoutModal({ locationId, existing, onClose, onSaved }: {
  locationId: string; existing?: Row; onClose: () => void; onSaved: () => void
}) {
  const { profile } = useAuth()
  const isEdit = !!existing
  const [date, setDate] = useState(existing?.date ?? format(new Date(), 'yyyy-MM-dd'))
  const [total, setTotal] = useState(String(existing?.total_sales ?? ''))
  const [cash, setCash] = useState(String(existing?.cash_amount ?? ''))
  const [card, setCard] = useState(String(existing?.card_amount ?? ''))
  const [deposit, setDeposit] = useState(String(existing?.deposit_amount ?? ''))
  const [drawer, setDrawer] = useState(String(existing?.drawer_count ?? ''))
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const filesRef = useRef<HTMLInputElement | null>(null)

  const [extracted, setExtracted] = useState<ExtractedGsr | null>(
    (existing?.sales_data as ExtractedGsr | null) ?? null,
  )
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const gsrInputRef = useRef<HTMLInputElement | null>(null)

  const onPickGsr = async (file: File) => {
    setExtractError(null)
    setExtracting(true)
    try {
      const dataUri = await fileToDataUri(file)
      const { data, error: invokeErr } = await supabase.functions.invoke('extract-drb-gsr', {
        body: { file_name: file.name, file_type: file.type, data_uri: dataUri },
      })
      if (invokeErr) {
        setExtractError(invokeErr.message)
        return
      }
      const payload = data as { ok?: boolean; error?: string; extracted?: ExtractedGsr } | null
      if (payload?.error === 'no_key') {
        setExtractError('AI extraction is not configured. Add an API key in settings.')
        return
      }
      if (!payload?.ok || !payload.extracted) {
        setExtractError('Could not extract data from this report.')
        return
      }
      const ex = payload.extracted
      setExtracted(ex)
      if (ex.total_sales != null) setTotal(String(ex.total_sales))
      if (ex.cash != null) setCash(String(ex.cash))
      if (ex.credit != null) setCard(String(ex.credit))
      if (ex.deposit != null) setDeposit(String(ex.deposit))
      if (ex.notes) setNotes(ex.notes)
      if (ex.report_date) setDate(ex.report_date)
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : 'Extraction failed')
    } finally {
      setExtracting(false)
    }
  }

  const save = async () => {
    setError(null)
    const basePayload = {
      total_sales: Number(total) || 0,
      cash_amount: Number(cash) || 0,
      card_amount: Number(card) || 0,
      deposit_amount: Number(deposit) || 0,
      drawer_count: Number(drawer) || 0,
      notes: notes.trim() || null,
    }
    const gsrPayload = extracted
      ? {
          sales_data: extracted as unknown as Closeout['sales_data'],
          gsr_extracted_at: existing?.gsr_extracted_at ?? new Date().toISOString(),
        }
      : {}
    setBusy(true)
    try {
      let newId: string | null = null
      if (isEdit) {
        if (existing!.locked && !reason.trim()) {
          setError('A reason is required to unlock and edit a closeout')
          return
        }
        if (existing!.locked) {
          await closeouts.update(existing!.id, { locked: false })
        }
        const { error: err } = await closeouts.update(existing!.id, { ...basePayload, ...gsrPayload, locked: true })
        if (err) { setError(err.message); return }
        newId = existing!.id
      } else {
        const { data, error: err } = await closeouts.create({
          location_id: locationId,
          date,
          submitted_by: profile?.id ?? null,
          locked: true,
          ...basePayload,
          ...gsrPayload,
        })
        if (err) {
          setError(err.message.includes('duplicate') ? 'A closeout already exists for this date.' : err.message)
          return
        }
        newId = (data as { id?: string } | null)?.id ?? null
      }

      if (newId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          const dataUri = await fileToDataUri(file)
          const { error: upErr } = await supabase.from('ops_attachments').insert({
            account_id: profile?.account_id ?? '',
            entity_type: 'closeout',
            entity_id: newId,
            file_name: file.name,
            file_type: file.type,
            data_uri: dataUri,
          })
          if (upErr) { setError(upErr.message); return }
        }
      }
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${shortDate(existing!.date)}` : 'Submit closeout'} size="lg">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border border-border bg-accent-soft/40 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-ink">
              <Sparkles className="size-4 text-accent" />
              <span className="font-medium">Auto-fill from DRB GSR (PDF)</span>
            </div>
            <input
              ref={gsrInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void onPickGsr(f)
              }}
            />
            <Button onClick={() => gsrInputRef.current?.click()} disabled={extracting}>
              {extracting ? <><Loader2 className="size-4 animate-spin" /> Extracting…</> : <>Upload DRB GSR (auto-fill)</>}
            </Button>
          </div>
          {extracted && !extracting && (
            <p className="text-xs text-ink-muted">
              Fields populated from GSR. Review before saving.
              {extracted.car_count != null && <> Cars: <span className="text-ink">{extracted.car_count}</span>.</>}
            </p>
          )}
          {extractError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{extractError}</p>}
        </div>

        {!isEdit && <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total sales">{(id) => <Input id={id} type="number" step="0.01" value={total} onChange={(e) => setTotal(e.target.value)} />}</Field>
          <Field label="Drawer count">{(id) => <Input id={id} type="number" step="0.01" value={drawer} onChange={(e) => setDrawer(e.target.value)} />}</Field>
          <Field label="Cash">{(id) => <Input id={id} type="number" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} />}</Field>
          <Field label="Card">{(id) => <Input id={id} type="number" step="0.01" value={card} onChange={(e) => setCard(e.target.value)} />}</Field>
          <Field label="Deposit" className="col-span-2">{(id) => <Input id={id} type="number" step="0.01" value={deposit} onChange={(e) => setDeposit(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>

        <Field label="Upload sales reports (optional)" hint="Attach screenshots or PDFs of any sales reports.">
          {() => (
            <div className="flex flex-col gap-2">
              <input
                ref={filesRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length > 0) setPendingFiles((prev) => [...prev, ...files])
                  e.target.value = ''
                }}
              />
              <div>
                <Button variant="secondary" size="sm" onClick={() => filesRef.current?.click()}>Choose files</Button>
              </div>
              {pendingFiles.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-border bg-content px-3 py-2 text-sm">
                  {pendingFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{f.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        {isEdit && existing!.locked && (
          <Field label="Reason for unlock" hint="Recorded in the audit trail" required>
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || extracting}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> Saving…</> : (isEdit ? 'Save & lock' : 'Submit')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export default function CloseoutsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
