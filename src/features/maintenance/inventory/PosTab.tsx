import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Mail, PackagePlus, Plus, Trash2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useCompany } from '@/lib/company'
import { fnErrorMessage } from '@/lib/fnError'
import { mi, type PartListRow, type PoDetail, type PoRow, type StockRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { day, dayTime, errText, money, PO_STATUS, qty } from './format'
import { act } from './offline'
import { buildPoPdf } from './poPdf'
import { Card, Chips, ErrorNote, Loading, Muted, SearchBox, Stepper, useDebounced } from './ui'

const BASE = '/app/maintenance-inventory'

export default function PosTab() {
  const { id } = useParams()
  return id ? <PoPage id={id} /> : <PoList />
}

function PoList() {
  const { refs, me } = useMi()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState<PoRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let alive = true
    mi.pos(filter === 'all' ? null : filter).then((r) => { if (alive) { setRows(r); setError(null) } }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [filter])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chips value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'submitted', label: 'To approve' }, { value: 'received', label: 'Received' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }]} />
        {me.rank >= 2 && <Button className="sm:ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> New PO</Button>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No purchase orders here. Reorder makes them from what's low.</Muted>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((o) => (
            <li key={o.id}>
              <Link to={`${BASE}/pos/${o.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-content">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">PO {o.number}</span>
                    <span className="truncate text-sm text-ink-muted">{o.vendor_name}</span>
                    {o.urgent && <Badge tone="danger">Urgent</Badge>}
                    {o.is_sample && <Badge>Sample</Badge>}
                  </div>
                  <p className="truncate text-xs text-ink-muted">{o.location_name}, {o.lines} line{o.lines === 1 ? '' : 's'}, {day(o.created_at)}</p>
                </div>
                <span className="shrink-0 text-sm tabular-nums text-ink">{money(o.total)}</span>
                <Badge tone={PO_STATUS[o.status].tone}>{PO_STATUS[o.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <NewPo vendors={refs.vendors} locations={refs.locations.filter((l) => l.can_manage && l.active)} onClose={() => setAdding(false)} onCreated={(pid) => { setAdding(false); navigate(`${BASE}/pos/${pid}`) }} />
      )}
    </div>
  )
}

function NewPo({ vendors, locations, onClose, onCreated }: { vendors: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }>; onClose: () => void; onCreated: (id: string) => void }) {
  const [vendor, setVendor] = useState('')
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [urgent, setUrgent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    try {
      onCreated((await mi.createPo(vendor, location, urgent)).id)
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="New purchase order">
      <div className="flex flex-col gap-3">
        <Field label="Vendor" required>
          {(id) => <Select id={id} value={vendor} onChange={(e) => setVendor(e.target.value)}><option value="">Pick one</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}
        </Field>
        <Field label="Ship to" required>
          {(id) => <Select id={id} value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgent (an emergency buy)</label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!vendor || !location} onClick={() => void create()}>Create</Button></div>
      </div>
    </Modal>
  )
}

function PoPage({ id }: { id: string }) {
  const { notify } = useMi()
  const { name: companyName } = useCompany()
  const [d, setD] = useState<PoDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addLine, setAddLine] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendTo, setSendTo] = useState('')
  const [receiving, setReceiving] = useState<PoDetail['lines'][number] | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await mi.poDetail(id)
      setD(r)
      setSendTo(r.vendor.email ?? '')
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const o = d.po
  const step = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      notify(message)
      await load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const download = async () => {
    const doc = await buildPoPdf(d, companyName || 'Mighty Wash')
    doc.save(`PO-${o.number}.pdf`)
  }
  const email = async () => {
    setBusy(true)
    try {
      const doc = await buildPoPdf(d, companyName || 'Mighty Wash')
      const base64 = (doc.output('datauristring') as string).split(',')[1]
      const { error: err } = await mi.sendPoEmail(o.id, base64, sendTo.trim())
      if (err) throw new Error(await fnErrorMessage(err, null, 'The email did not send.'))
      notify(`PO ${o.number} emailed to ${sendTo.trim()}.`)
      setSending(false)
      await load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/pos`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Purchase orders</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">PO {o.number}</h1>
            <Badge tone={PO_STATUS[o.status].tone}>{PO_STATUS[o.status].label}</Badge>
            {o.urgent && <Badge tone="danger">Urgent</Badge>}
          </div>
          <p className="text-sm text-ink-muted">{d.vendor.name}, to {d.location.name}. {money(o.total)}.</p>
          {o.sent_at && <p className="text-xs text-ink-subtle">Sent {dayTime(o.sent_at)}{o.sent_to ? ` to ${o.sent_to}` : ''}</p>}
        </div>
        <Button variant="secondary" onClick={() => void download()}><Download className="size-4" /> PDF</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {o.status === 'draft' && o.can_manage && <Button disabled={busy || d.lines.length === 0} onClick={() => void step(() => mi.submitPo(o.id), 'Submitted for approval.')}>Submit for approval</Button>}
        {o.status === 'submitted' && (o.can_approve ? (
          <>
            <Button disabled={busy} onClick={() => void step(() => mi.approvePo(o.id), 'Approved.')}>Approve {money(o.total)}</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void step(() => mi.approvePo(o.id, false), 'Sent back to draft.')}>Send back</Button>
          </>
        ) : <Muted>Over your approval limit{o.approval_limit != null ? ` of ${money(o.approval_limit)}` : ''}. A regional manager or the director approves this.</Muted>)}
        {o.status === 'approved' && o.can_manage && (
          <>
            <Button disabled={busy} onClick={() => setSending(true)}><Mail className="size-4" /> Send to vendor</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void step(() => mi.markPoSent(o.id, 'Ordered by phone or website'), 'Marked as sent.')}>Ordered another way</Button>
          </>
        )}
        {['received', 'partially_received'].includes(o.status) && o.can_manage && <Button variant="secondary" disabled={busy} onClick={() => void step(() => mi.closePo(o.id), 'Closed.')}>Close PO</Button>}
        {['draft', 'submitted', 'approved', 'sent'].includes(o.status) && o.can_manage && <Button variant="ghost" disabled={busy} onClick={() => setCancelling(true)}>Cancel PO</Button>}
      </div>

      <Card title="Lines" actions={o.status === 'draft' && o.can_manage ? <Button size="sm" variant="secondary" onClick={() => setAddLine(true)}><Plus className="size-4" /> Add</Button> : undefined}>
        {d.lines.length === 0 ? <Muted>No lines yet.</Muted> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={`${BASE}/parts/${l.part_id}`} className="font-medium text-ink hover:underline">{l.part_name}</Link>
                  <p className="text-xs text-ink-muted">{[l.sku, l.vendor_part_number && `Vendor # ${l.vendor_part_number}`].filter(Boolean).join(' · ')}</p>
                  <p className="tabular-nums text-ink-muted">{qty(l.qty_ordered)} at {money(l.unit_cost)} = {money(l.line_total)}. Received {qty(l.qty_received)}.</p>
                </div>
                {o.status === 'draft' && o.can_manage && (
                  <Button variant="ghost" size="icon" aria-label={`Remove ${l.part_name}`} onClick={() => void step(() => mi.savePoLine(o.id, l.part_id, 0), 'Removed.')}><Trash2 className="size-4" /></Button>
                )}
                {['approved', 'sent', 'partially_received'].includes(o.status) && o.can_receive && Number(l.qty_open) > 0 && (
                  <Button onClick={() => setReceiving(l)}><PackagePlus className="size-4" /> Receive {qty(l.qty_open)}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.receipts.length > 0 && (
        <Card title="Received">
          {d.receipts.map((r) => (
            <div key={r.id} className="border-t border-border py-2 text-sm first:border-t-0">
              <p className="text-ink">{(r.lines ?? []).map((l) => `${l.part_name} x${qty(l.qty)}`).join(', ')}</p>
              <p className="text-xs text-ink-subtle">{dayTime(r.received_at)}{r.by ? `, ${r.by}` : ''}</p>
              {r.packing_slip_path && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => { void mi.fileUrl(r.packing_slip_path as string).then((u) => { if (u) window.open(u, '_blank', 'noopener') }) }}>Packing slip</button>
              )}
            </div>
          ))}
        </Card>
      )}

      {addLine && <AddLine poId={o.id} onClose={() => setAddLine(false)} onSaved={() => { setAddLine(false); void load() }} />}
      {receiving && <ReceiveLine line={receiving} locationId={o.ship_to_location_id} onClose={() => setReceiving(null)} onDone={(m) => { setReceiving(null); notify(m); void load() }} />}
      {sending && (
        <Modal open onClose={() => setSending(false)} title="Email this PO" description="Sends the PDF to the vendor, and marks the PO sent.">
          <div className="flex flex-col gap-3">
            <Field label="Send to" required>{(fid) => <Input id={fid} type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="orders@vendor.com" />}</Field>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSending(false)}>Cancel</Button>
              <Button disabled={busy || !sendTo.includes('@')} onClick={() => void email()}><Mail className="size-4" /> Send</Button>
            </div>
          </div>
        </Modal>
      )}
      <ConfirmDialog open={cancelling} title={`Cancel PO ${o.number}?`} description="It comes off the on-order numbers. This can't be undone." confirmLabel="Cancel PO" onCancel={() => setCancelling(false)}
        onConfirm={() => { setCancelling(false); void step(() => mi.cancelPo(o.id), 'Cancelled.') }} />
    </div>
  )
}

function AddLine({ poId, onClose, onSaved }: { poId: string; onClose: () => void; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<PartListRow[]>([])
  const [count, setCount] = useState('1')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 15 }).then((r) => { if (alive) setRows(r.rows) })
    return () => { alive = false }
  }, [dq])
  const add = async (partId: string) => {
    try {
      await mi.savePoLine(poId, partId, Number(count) || 1, cost === '' ? null : Number(cost))
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="Add a line">
      <div className="flex flex-col gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Find a part" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">{(id) => <Input id={id} inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} />}</Field>
          <Field label="Cost each" hint="Blank uses the vendor's price.">{(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        {dq.trim() && rows.map((r) => (
          <button key={r.id} type="button" onClick={() => void add(r.id)} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content">
            <span className="truncate text-ink">{r.name}</span>
            <span className="shrink-0 text-xs text-ink-subtle">{r.sku}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function ReceiveLine({ line, locationId, onClose, onDone }: { line: PoDetail['lines'][number]; locationId: string; onClose: () => void; onDone: (m: string) => void }) {
  const { refs, accountId } = useMi()
  const [count, setCount] = useState(Number(line.qty_open))
  const [cost, setCost] = useState(String(line.unit_cost))
  const [bin, setBin] = useState('')
  const [slip, setSlip] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bins = refs.bins.filter((b) => b.location_id === locationId)
  useEffect(() => {
    let alive = true
    void mi.locationStock(locationId, line.part_name).then((rows: StockRow[]) => {
      const here = rows.find((r) => r.part_id === line.part_id)
      if (alive && here?.bin_id) setBin(here.bin_id)
    }).catch(() => {})
    return () => { alive = false }
  }, [locationId, line.part_id, line.part_name])
  const receive = async () => {
    setBusy(true)
    setError(null)
    try {
      const path = slip ? await mi.upload(accountId, 'packing-slips', slip, slip.name) : null
      const res = await act<{ on_hand: number; po_status: string }>('mi_receive_po_line', { p_line: line.id, p_qty: count, p_unit_cost: Number(cost), p_bin: bin || null, p_packing_slip: path }, `Received ${qty(count)} ${line.part_name}`)
      onDone(res.queued ? 'Saved on this phone. It will sync when you have signal.' : `Received ${qty(count)}. ${qty(res.data.on_hand)} on hand now.`)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Receive ${line.part_name}`} description={`${qty(line.qty_open)} still due.`}>
      <div className="flex flex-col gap-3">
        <Stepper value={count} onChange={setCount} min={1} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cost each">{(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
          <Field label="Bin">
            {(id) => <Select id={id} value={bin} onChange={(e) => setBin(e.target.value)}><option value="">Leave as is</option>{bins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
          </Field>
        </div>
        <Field label="Packing slip photo" hint="Optional.">{(id) => <Input id={id} type="file" accept="image/*" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button size="lg" disabled={busy || count <= 0} onClick={() => void receive()}>Receive {qty(count)}</Button>
      </div>
    </Modal>
  )
}
