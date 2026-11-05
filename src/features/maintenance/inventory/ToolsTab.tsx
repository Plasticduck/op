import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck, Plus, Printer, ScanLine } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { parseScan } from '@/features/it/inventory/scan'
import { mi, type ToolDetail, type ToolRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { day, dayTime, errText, money, TOOL_ACTION, TOOL_CONDITION, TOOL_STATUS } from './format'
import { LabelsDialog, type LabelItem } from './LabelsDialog'
import { ToolActions } from './ToolActions'
import { Card, Chips, ErrorNote, Loading, Muted, SearchBox, useDebounced } from './ui'

const BASE = '/app/maintenance-inventory'

export default function ToolsTab() {
  const { id } = useParams()
  return id ? <ToolPage id={id} /> : <ToolList />
}

function ToolList() {
  const { me, refs, notify } = useMi()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [filter, setFilter] = useState('all')
  const [rows, setRows] = useState<ToolRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)
  const [auditing, setAuditing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows(await mi.tools({ q: dq, mine: filter === 'mine', status: filter === 'all' || filter === 'mine' ? null : filter }))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [dq, filter])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  const manageable = refs.locations.filter((l) => l.can_manage && l.active)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search tools" className="min-w-[200px] flex-1" />
        {me.rank >= 2 && manageable.length > 0 && <Button onClick={() => setAdding(true)}><Plus className="size-4" /> New tool</Button>}
        {me.rank >= 2 && <Button variant="secondary" onClick={() => setAuditing(true)}><ClipboardCheck className="size-4" /> Audit</Button>}
        {me.rank >= 2 && rows && rows.length > 0 && (
          <Button variant="secondary" onClick={() => setLabels(rows.map((t) => ({ type: 'tool', id: t.id, name: t.name, site: t.home_name })))}><Printer className="size-4" /> Labels</Button>
        )}
      </div>
      <Chips value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }, { value: 'available', label: 'Available' },
        { value: 'checked_out', label: 'Out' }, { value: 'overdue', label: 'Overdue' }, { value: 'in_repair', label: 'In repair' }, { value: 'lost', label: 'Lost' },
      ]} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No tools here yet.</Muted>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((t) => (
            <li key={t.id}>
              <Link to={`${BASE}/tools/${t.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-content">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{t.name}</div>
                  <p className="truncate text-xs text-ink-muted">With {t.custodian ?? 'no one'}{t.serial_number ? ` · ${t.serial_number}` : ''}{t.due_at ? ` · due ${day(t.due_at)}` : ''}</p>
                </div>
                {t.pending && <Badge tone="warn">Hand-off</Badge>}
                {t.overdue && t.status === 'checked_out' ? <Badge tone="danger">Overdue</Badge> : <Badge tone={TOOL_STATUS[t.status].tone}>{TOOL_STATUS[t.status].label}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <ToolForm onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); notify('Tool added.') }} />}
      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} />}
      {auditing && <ToolAudit onClose={() => { setAuditing(false); void load() }} />}
    </div>
  )
}

function ToolForm({ existing, onClose, onSaved }: { existing?: ToolDetail['tool']; onClose: () => void; onSaved: () => void }) {
  const { refs } = useMi()
  const [f, setF] = useState({
    name: existing?.name ?? '', category: existing?.category ?? '', make: existing?.make ?? '', model: existing?.model ?? '', serial_number: existing?.serial_number ?? '',
    cost: existing?.cost != null ? String(existing.cost) : '', home_location_id: existing?.home_location_id ?? '', notes: existing?.notes ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await mi.saveTool({ ...f, id: existing?.id })
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title={existing ? 'Edit tool' : 'New tool'}>
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Torque wrench" />}</Field>
        <Field label="Home" required hint="Where it lives: a crib, stockroom or truck. It starts here.">
          {(id) => (
            <Select id={id} value={f.home_location_id} onChange={(e) => setF({ ...f, home_location_id: e.target.value })}>
              <option value="">Pick one</option>
              {refs.locations.filter((l) => l.can_manage && l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">{(id) => <Input id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
          <Field label="Serial number">{(id) => <Input id={id} value={f.serial_number} onChange={(e) => setF({ ...f, serial_number: e.target.value })} />}</Field>
          <Field label="Make">{(id) => <Input id={id} value={f.make} onChange={(e) => setF({ ...f, make: e.target.value })} />}</Field>
          <Field label="Model">{(id) => <Input id={id} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />}</Field>
          <Field label="Cost">{(id) => <Input id={id} inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.name.trim() || !f.home_location_id} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function ToolPage({ id }: { id: string }) {
  const { notify } = useMi()
  const navigate = useNavigate()
  const [d, setD] = useState<ToolDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [editing, setEditing] = useState(false)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await mi.toolDetail(id))
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  if (d.hidden) return <Muted>{d.message}</Muted>
  const t = d.tool
  const refresh = (m: string) => { notify(m); setNonce((n) => n + 1); void load() }
  const setStatus = async (status: string) => {
    try {
      await mi.setToolStatus(t.id, status)
      refresh(`Marked ${TOOL_STATUS[status as keyof typeof TOOL_STATUS].label.toLowerCase()}.`)
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={() => navigate(`${BASE}/tools`)} className="inline-flex items-center gap-1 self-start text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Tools</button>
      <Card>
        <ToolActions key={nonce} toolId={t.id} onDone={refresh} />
      </Card>
      <Card title="Details" actions={
        <span className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setLabels([{ type: 'tool', id: t.id, name: t.name, site: t.home_name }])}><Printer className="size-4" /> Label</Button>
          {t.can_manage && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
        </span>
      }>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Tag</dt><dd className="font-mono text-ink">{t.tag ?? 'Not printed yet'}</dd>
          <dt className="text-ink-muted">Condition</dt><dd className="text-ink">{TOOL_CONDITION[t.condition]}</dd>
          {t.category && <><dt className="text-ink-muted">Category</dt><dd className="text-ink">{t.category}</dd></>}
          {(t.make || t.model) && <><dt className="text-ink-muted">Make and model</dt><dd className="text-ink">{[t.make, t.model].filter(Boolean).join(' ')}</dd></>}
          {t.serial_number && <><dt className="text-ink-muted">Serial</dt><dd className="text-ink">{t.serial_number}</dd></>}
          {t.cost != null && <><dt className="text-ink-muted">Cost</dt><dd className="text-ink">{money(t.cost)}</dd></>}
        </dl>
        {t.can_manage && (
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {t.status !== 'available' && <Button size="sm" variant="secondary" onClick={() => void setStatus('available')}>Back in service</Button>}
            {t.status !== 'in_repair' && <Button size="sm" variant="secondary" onClick={() => void setStatus('in_repair')}>In repair</Button>}
            {t.status !== 'lost' && <Button size="sm" variant="secondary" onClick={() => void setStatus('lost')}>Lost</Button>}
            {t.status !== 'retired' && <Button size="sm" variant="ghost" onClick={() => void setStatus('retired')}>Retire</Button>}
          </div>
        )}
      </Card>
      <Card title="Custody history">
        <ul className="flex flex-col divide-y divide-border">
          {d.chain.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <span className="font-medium text-ink">{TOOL_ACTION[e.action] ?? e.action}</span>
              {(e.from || e.to) && <span className="text-ink-muted"> {e.from ? `from ${e.from} ` : ''}{e.to ? `to ${e.to}` : ''}</span>}
              {e.condition && e.condition !== 'good' && <span className="text-warn"> ({TOOL_CONDITION[e.condition as keyof typeof TOOL_CONDITION] ?? e.condition})</span>}
              {e.notes && <p className="text-ink-muted">{e.notes}</p>}
              <p className="text-xs text-ink-subtle">{dayTime(e.created_at)}{e.by ? `, ${e.by}` : ''}{e.due_at ? `, due ${day(e.due_at)}` : ''}</p>
            </li>
          ))}
        </ul>
      </Card>
      {editing && <ToolForm existing={t} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load() }} />}
      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} />}
    </div>
  )
}

// Walk a truck or crib scanning what's there. Anything left unscanned is marked lost.
function ToolAudit({ onClose }: { onClose: () => void }) {
  const { refs, notify } = useMi()
  const [location, setLocation] = useState('')
  const [audit, setAudit] = useState<string | null>(null)
  const [lines, setLines] = useState<Awaited<ReturnType<typeof mi.toolAudit>>>([])
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  const refresh = useCallback(async (a: string) => setLines(await mi.toolAudit(a)), [])
  const start = async () => {
    try {
      const a = await mi.startToolAudit(location)
      setAudit(a)
      await refresh(a)
    } catch (e) {
      setError(errText(e))
    }
  }
  const scanned = async (raw: string) => {
    if (!audit) return
    try {
      const res = await mi.resolveScan(parseScan(raw)?.tag ?? raw)
      if (res.kind !== 'tool') { notify('That isn\'t a tool sticker.', 'warn'); return }
      await mi.toolAuditScan(audit, res.id)
      await refresh(audit)
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const finish = async () => {
    if (!audit) return
    try {
      const r = await mi.finishToolAudit(audit)
      notify(r.missing ? `Audit finished. ${r.missing} tool${r.missing === 1 ? '' : 's'} marked lost.` : 'Audit finished. Everything was there.', r.missing ? 'warn' : 'ok')
      onClose()
    } catch (e) {
      setError(errText(e))
    }
  }
  const missing = lines.filter((l) => !l.found)
  return (
    <Modal open onClose={onClose} title="Tool audit" description="Scan each tool at this truck or crib. Whatever isn't scanned gets marked lost when you finish." size="lg">
      <div className="flex flex-col gap-3">
        {!audit ? (
          <>
            <Field label="Where">
              {(id) => (
                <Select id={id} value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">Pick one</option>
                  {refs.locations.filter((l) => l.can_act && l.active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              )}
            </Field>
            <Button disabled={!location} onClick={() => void start()}>Start</Button>
          </>
        ) : (
          <>
            {scanning ? <BarcodeScanner continuous onDetect={scanned} className="h-64 rounded-lg" /> : <Button variant="secondary" onClick={() => setScanning(true)}><ScanLine className="size-4" /> Open the camera</Button>}
            <p className="text-sm text-ink-muted">{lines.length - missing.length} of {lines.length} found.</p>
            {lines.map((l) => (
              <div key={l.tool_id} className="flex items-center justify-between gap-2 border-t border-border py-1.5 text-sm">
                <span className="truncate text-ink">{l.tool?.name}</span>
                {l.found ? <Badge tone="ok">Found</Badge> : <Badge>Not yet</Badge>}
              </div>
            ))}
            <Button onClick={() => void finish()}>Finish{missing.length ? `: mark ${missing.length} lost` : ''}</Button>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  )
}
