import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type Elsewhere, type PartListRow, type TransferRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { day, errText, qty, TRANSFER_STATUS } from './format'
import { act } from './offline'
import { Chips, ErrorNote, Loading, Muted, SearchBox, useDebounced, WarnNote } from './ui'

export default function TransfersTab() {
  const { notify } = useMi()
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState<TransferRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState<{ t: TransferRow; mode: 'ship' | 'receive' } | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await mi.transfers(filter === 'all' ? null : filter))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [filter])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  const decide = async (fn: () => Promise<unknown>, m: string) => {
    try {
      await fn()
      notify(m)
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chips value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'in_transit', label: 'In transit' }, { value: 'received', label: 'Received' }, { value: 'all', label: 'All' }]} />
        <Button className="sm:ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> New transfer</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No transfers here.</Muted>}
      {rows?.map((t) => (
        <div key={t.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">#{t.number}</span>
            <span className="flex min-w-0 items-center gap-1 text-sm text-ink">{t.from_name} <ArrowRight className="size-3.5 text-ink-subtle" /> {t.to_name}</span>
            <Badge tone={TRANSFER_STATUS[t.status].tone} className="ml-auto">{TRANSFER_STATUS[t.status].label}</Badge>
          </div>
          <ul className="mt-2 text-sm">
            {t.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate text-ink">{l.part_name}</span>
                <span className="tabular-nums text-ink-muted">
                  {qty(l.qty_requested)} asked{Number(l.qty_shipped) > 0 ? `, ${qty(l.qty_shipped)} shipped` : ''}{Number(l.qty_received) > 0 ? `, ${qty(l.qty_received)} received` : ''}
                  {l.variance_qty != null && <span className="text-danger"> ({qty(l.variance_qty)} off)</span>}
                  {t.status === 'requested' && l.available_at_source != null && Number(l.available_at_source) < Number(l.qty_requested) && <span className="text-warn"> (only {qty(l.available_at_source)} there)</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-subtle">Asked {day(t.requested_at)}{t.requested_by ? ` by ${t.requested_by}` : ''}{t.notes ? `. ${t.notes}` : ''}</p>
          {(t.can_approve || t.can_ship || t.can_receive || t.can_cancel) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {t.can_approve && <Button size="sm" onClick={() => void decide(() => mi.decideTransfer(t.id, true), `Transfer #${t.number} approved.`)}>Approve</Button>}
              {t.can_approve && <Button size="sm" variant="secondary" onClick={() => void decide(() => mi.decideTransfer(t.id, false), `Transfer #${t.number} declined.`)}>Decline</Button>}
              {t.can_ship && <Button size="sm" onClick={() => setMoving({ t, mode: 'ship' })}>Ship</Button>}
              {t.can_receive && <Button size="sm" onClick={() => setMoving({ t, mode: 'receive' })}>Receive</Button>}
              {t.can_cancel && <Button size="sm" variant="ghost" onClick={() => void decide(() => mi.cancelTransfer(t.id), 'Cancelled.')}>Cancel</Button>}
            </div>
          )}
        </div>
      ))}
      {adding && <NewTransfer onClose={() => setAdding(false)} onDone={(m) => { setAdding(false); notify(m); void load() }} />}
      {moving && <MoveDialog t={moving.t} mode={moving.mode} onClose={() => setMoving(null)} onDone={(m) => { setMoving(null); notify(m); void load() }} />}
    </div>
  )
}

function MoveDialog({ t, mode, onClose, onDone }: { t: TransferRow; mode: 'ship' | 'receive'; onClose: () => void; onDone: (m: string) => void }) {
  const lines = mode === 'ship' ? t.lines : t.lines.filter((l) => Number(l.qty_shipped) > 0)
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(mode === 'ship' ? l.qty_requested : l.qty_shipped)])))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const short = mode === 'receive' && lines.some((l) => Number(qtys[l.id]) !== Number(l.qty_shipped))
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const p_lines = lines.map((l) => ({ line_id: l.id, qty: Number(qtys[l.id]) || 0 }))
      const res = mode === 'ship'
        ? await act('mi_ship_transfer', { p_transfer: t.id, p_lines }, `Shipped transfer #${t.number}`)
        : await act('mi_receive_transfer', { p_transfer: t.id, p_lines, p_notes: notes || null }, `Received transfer #${t.number}`)
      onDone(res.queued ? 'Saved on this phone. It will sync when you have signal.' : mode === 'ship' ? `Shipped. It's in transit to ${t.to_name}.` : `Received at ${t.to_name}.`)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`${mode === 'ship' ? 'Ship' : 'Receive'} transfer #${t.number}`} description={mode === 'ship' ? 'It leaves here now, and counts at neither place until it arrives.' : 'Enter what actually arrived.'}>
      <div className="flex flex-col gap-3">
        {lines.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{l.part_name}</span>
            <Input aria-label={`Quantity of ${l.part_name}`} inputMode="decimal" className="h-12 w-24 text-center text-lg" value={qtys[l.id]} onChange={(e) => setQtys((p) => ({ ...p, [l.id]: e.target.value }))} />
          </div>
        ))}
        {short && (
          <>
            <WarnNote>That doesn't match what was shipped. It's recorded as a variance.</WarnNote>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" disabled={busy} onClick={() => void go()}>{mode === 'ship' ? 'Ship it' : 'Receive it'}</Button>
      </div>
    </Modal>
  )
}

function NewTransfer({ onClose, onDone }: { onClose: () => void; onDone: (m: string) => void }) {
  const { refs } = useMi()
  const locations = refs.locations.filter((l) => l.active)
  const [to, setTo] = useState(locations.find((l) => l.can_act)?.id ?? '')
  const [from, setFrom] = useState('')
  const [notes, setNotes] = useState('')
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [found, setFound] = useState<PartListRow[]>([])
  const [lines, setLines] = useState<Array<{ part: PartListRow; qty: string }>>([])
  const [sources, setSources] = useState<Elsewhere[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 10 }).then((r) => { if (alive) setFound(r.rows) })
    return () => { alive = false }
  }, [dq])

  const firstPart = lines[0]?.part.id
  useEffect(() => {
    if (!firstPart) return
    let alive = true
    void mi.stockElsewhere(firstPart, to || null).then((s) => {
      if (!alive) return
      setSources(s)
      setFrom((cur) => cur || s[0]?.location_id || '')
    }).catch(() => {})
    return () => { alive = false }
  }, [firstPart, to])

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await act<{ number: number }>('mi_start_transfer', { p_from: from, p_to: to, p_lines: lines.map((l) => ({ part_id: l.part.id, qty: Number(l.qty) })), p_notes: notes || null }, 'Transfer request')
      onDone(res.queued ? 'Saved on this phone. It will sync when you have signal.' : `Transfer #${res.data.number} requested.`)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  // Locations with stock of the first part first, then the rest of what this person can see.
  const fromChoices = [
    ...sources.map((s) => ({ id: s.location_id, label: `${s.site_name ? `${s.site_name}: ` : ''}${s.location_name} (${qty(s.available)} free)` })),
    ...locations.filter((l) => !sources.some((s) => s.location_id === l.id) && l.id !== to).map((l) => ({ id: l.id, label: l.name })),
  ]
  return (
    <Modal open onClose={onClose} title="New transfer" size="lg">
      <div className="flex flex-col gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Add a part" />
        {dq.trim() && found.filter((f) => !lines.some((l) => l.part.id === f.id)).slice(0, 6).map((r) => (
          <button key={r.id} type="button" onClick={() => { setLines((p) => [...p, { part: r, qty: '1' }]); setQ('') }} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content">
            <span className="truncate text-ink">{r.name}</span>
            <Plus className="size-4 shrink-0 text-ink-subtle" />
          </button>
        ))}
        {lines.map((l, i) => (
          <div key={l.part.id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-ink">{l.part.name}</span>
            <Input aria-label="Quantity" inputMode="decimal" className="h-10 w-20 text-center" value={l.qty} onChange={(e) => setLines((p) => p.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines((p) => p.filter((_, k) => k !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="From">
            {(id) => <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Pick one</option>{fromChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}
          </Field>
          <Field label="To">
            {(id) => <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
          </Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !from || !to || from === to || lines.length === 0} onClick={() => void go()}>Request</Button>
        </div>
      </div>
    </Modal>
  )
}
