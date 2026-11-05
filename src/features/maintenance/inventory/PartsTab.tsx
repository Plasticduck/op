import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Plus, Upload } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { downloadCsv } from '@/lib/csv'
import { mi, type PartListRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { errText, qty } from './format'
import { PartForm } from './PartForm'
import { Chips, ErrorNote, Loading, Muted, SearchBox, Thumb, useDebounced, WarnNote } from './ui'

const BASE = '/app/maintenance-inventory'
const EXPORT_COLUMNS = ['sku', 'name', 'description', 'category', 'manufacturer', 'mfr_part_number', 'uom', 'is_critical', 'location', 'bin', 'on_hand', 'min_qty', 'max_qty', 'unit_cost', 'vendor', 'vendor_part_number', 'lead_time_days', 'barcode']

export default function PartsTab() {
  const { me, refs, notify } = useMi()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const filter = params.get('filter') ?? 'all'
  const [category, setCategory] = useState('')
  const [rows, setRows] = useState<PartListRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [proposing, setProposing] = useState(false)
  const [showRequests, setShowRequests] = useState(params.get('requests') === '1')

  const load = useCallback(async () => {
    try {
      const r = await mi.parts({ q: dq, category: category || null, filter: filter === 'all' ? null : filter, limit: 120 })
      setRows(r.rows)
      setTotal(r.total)
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [dq, category, filter])
  useEffect(() => { void load() }, [load])

  const exportCsv = async () => {
    try {
      const data = await mi.exportStock()
      downloadCsv('maintenance-inventory-stock', [EXPORT_COLUMNS, ...data.map((r) => EXPORT_COLUMNS.map((c) => r[c]))])
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  const canEdit = me.rank >= 4
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, SKU, part number, vendor number, category" className="min-w-[240px] flex-1" />
        {canEdit ? <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New part</Button> : <Button variant="secondary" onClick={() => setProposing(true)}><Plus className="size-4" /> Propose a part</Button>}
        {me.rank >= 2 && <Button variant="secondary" onClick={() => void exportCsv()}><Download className="size-4" /> Export</Button>}
        {me.rank >= 5 && <Link to={`${BASE}/settings#import`}><Button variant="secondary"><Upload className="size-4" /> Import</Button></Link>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chips value={filter} onChange={(v) => setParams((p) => { if (v === 'all') p.delete('filter'); else p.set('filter', v); return p }, { replace: true })}
          options={[{ value: 'all', label: 'All' }, { value: 'stocked', label: 'Stocked' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' }, { value: 'critical', label: 'Critical' }]} />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full sm:w-56">
          <option value="">All categories</option>
          {refs.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>

      {canEdit && <PartRequests open={showRequests} onToggle={() => setShowRequests((v) => !v)} onChanged={load} />}

      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No parts match.</Muted>}
      {rows && rows.length > 0 && (
        <>
          <p className="text-xs text-ink-subtle">{total.toLocaleString()} part{total === 1 ? '' : 's'}{total > rows.length ? `. Showing the first ${rows.length}: search to narrow it down.` : ''}</p>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {rows.map((p) => (
              <li key={p.id}>
                <Link to={`${BASE}/parts/${p.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-content">
                  <Thumb path={p.photo_path} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-medium text-ink">{p.name}</span>
                      {p.is_critical && <Badge tone="danger">Critical</Badge>}
                      {p.is_sample && <Badge>Sample</Badge>}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {[p.sku, p.manufacturer && p.mfr_part_number ? `${p.manufacturer} ${p.mfr_part_number}` : null, p.category].filter(Boolean).join(' · ') || 'No details yet'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {p.locations > 0 ? (
                      <>
                        <div className={p.low ? 'font-semibold tabular-nums text-warn' : 'tabular-nums text-ink'}>{qty(p.available)}</div>
                        <div className="text-xs text-ink-subtle">{p.locations} location{p.locations === 1 ? '' : 's'}</div>
                      </>
                    ) : <span className="text-xs text-ink-subtle">Not stocked</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {adding && (
        <Modal open onClose={() => setAdding(false)} title="New part" size="lg">
          <PartForm onCancel={() => setAdding(false)} onSaved={(id) => { setAdding(false); navigate(`${BASE}/parts/${id}`) }} />
        </Modal>
      )}
      {proposing && <ProposePart onClose={() => setProposing(false)} onDone={() => { setProposing(false); notify('Sent to the director to add.') }} />}
    </div>
  )
}

function ProposePart({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [manufacturer, setManufacturer] = useState('')
  const [mpn, setMpn] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [dupes, setDupes] = useState<Array<{ id: string; name: string }>>([])
  const dName = useDebounced(name, 350)
  useEffect(() => {
    if (dName.trim().length < 3) return
    let alive = true
    void mi.checkDuplicates({ name: dName }).then((d) => { if (alive) setDupes(d.similar) }).catch(() => {})
    return () => { alive = false }
  }, [dName])
  const shownDupes = dName.trim().length < 3 ? [] : dupes
  const send = async () => {
    try {
      await mi.requestPart({ name, manufacturer: manufacturer || undefined, mpn: mpn || undefined, notes: notes || undefined })
      onDone()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="Propose a part" description="The maintenance director reviews it and adds it to the catalog.">
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        {shownDupes.length > 0 && <WarnNote>Already in the catalog? {shownDupes.map((d) => d.name).join(', ')}</WarnNote>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Manufacturer">{(id) => <Input id={id} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />}</Field>
          <Field label="Part number">{(id) => <Input id={id} value={mpn} onChange={(e) => setMpn(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim()} onClick={() => void send()}>Send</Button>
        </div>
      </div>
    </Modal>
  )
}

function PartRequests({ open, onToggle, onChanged }: { open: boolean; onToggle: () => void; onChanged: () => void }) {
  const { notify } = useMi()
  const [rows, setRows] = useState<Awaited<ReturnType<typeof mi.partRequests>>>([])
  const load = useCallback(() => { void mi.partRequests().then(setRows).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])
  const decide = async (id: string, approve: boolean) => {
    try {
      await mi.decidePartRequest(id, approve)
      load()
      onChanged()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  if (rows.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <button type="button" className="text-sm font-semibold text-accent" onClick={onToggle}>{rows.length} part request{rows.length === 1 ? '' : 's'} waiting</button>
      {open && rows.map((r) => (
        <div key={r.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm">
          <span className="min-w-0 flex-1 text-ink">{r.name}{r.manufacturer ? `, ${r.manufacturer}` : ''}{r.mfr_part_number ? ` ${r.mfr_part_number}` : ''}{r.notes ? `. ${r.notes}` : ''}</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={() => void decide(r.id, true)}>Add it</Button>
            <Button size="sm" variant="ghost" onClick={() => void decide(r.id, false)}>Decline</Button>
          </span>
        </div>
      ))}
    </div>
  )
}
